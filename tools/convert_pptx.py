"""Convert the Entertainment.pptx record into structured JSON.

Usage: python3 -I convert.py <pptx> <out_dir>
"""
import json, os, re, sys
from collections import Counter
from pptx import Presentation

A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

MARKS = {
    '67AABF': 'video',    # 遊戲影片（已看）
    'FA2B5C': 'music',    # 音樂（已聽）
    'F1C232': 'played',   # 已玩過
    'BF9000': 'playing',  # 遊玩中
    'B45F06': 'dropped',  # 退坑
    '274E13': 'anime',    # 動畫（已看）
}
DEFAULT_SIZE = 18

REGION_OF = {}
SLIDE_COMPANY = {}      # first slide -> company
SEP_RE = re.compile(r'^[\s\-–—_]{8,}$')
TRAIL_SEP_RE = re.compile(r'[\-–—]{8,}\s*$')

review = []
counters = Counter()


def nid(prefix):
    counters[prefix] += 1
    return f"{prefix}{counters[prefix]:04d}"


def rgb(run):
    try:
        c = run.font.color
        if c.type is None:
            return None
        return str(c.rgb)
    except Exception:
        return None


def run_link(run, slide):
    h = run._r.find(f'.//{A}hlinkClick')
    if h is None:
        return None, None
    rid = h.get(RID)
    if not rid or rid not in slide.part.rels:
        return None, None
    rel = slide.part.rels[rid]
    if rel.is_external:
        return 'ext', rel.target_ref
    try:
        name = rel.target_part.partname
        m = re.search(r'slide(\d+)\.xml', str(name))
        return 'int', int(m.group(1)) if m else None
    except Exception:
        return None, None


class Para:
    def __init__(self, pa, slide):
        self.runs = []
        sizes = []
        for r in pa.runs:
            if not r.text:
                continue
            kind, target = run_link(r, slide)
            self.runs.append({
                'text': r.text,
                'url': target if kind == 'ext' else None,
                'slide': target if kind == 'int' else None,
                'mark': MARKS.get(rgb(r) or ''),
                'italic': bool(r.font.italic),
            })
            sizes.append(int(r.font.size.pt) if r.font.size else 0)
        raw = ''.join(r['text'] for r in self.runs)
        self.indented = raw[:1] in (' ', '\t', '\u3000') and raw.strip() != ''
        self.text = raw.strip()
        self.size = max(sizes) if sizes else 0
        if self.size == 0:
            self.size = DEFAULT_SIZE
        self.has_link = any(r['url'] for r in self.runs)
        self.bold = any(r.font.bold for r in pa.runs if r.text.strip())
        self.marked = any(r['mark'] for r in self.runs)
        self.italic_only = bool(self.runs) and all(r['italic'] or not r['text'].strip() for r in self.runs)

    @property
    def is_sep(self):
        return bool(SEP_RE.match(self.text))


# ---------------------------------------------------------------- segments

def merge_runs(runs):
    """Merge adjacent runs with identical url+mark."""
    out = []
    for r in runs:
        if out and out[-1]['url'] == r['url'] and out[-1]['mark'] == r['mark']:
            out[-1] = dict(out[-1], text=out[-1]['text'] + r['text'])
        else:
            out.append(dict(r))
    return out


MAI_RE = re.compile(r'\s*[\(（]\s*\*?\s*舞\s*[\)）]\s*$')


def make_seg(text, url=None, mark=None):
    s = {'text': text}
    if url:
        s['url'] = url
    if mark:
        s['mark'] = mark
    return s


def finalize_link(seg):
    t = seg['text']
    st = t.strip()
    if st == '*':
        seg['playlist'] = True
        seg['text'] = '合集'
        return seg
    if st.startswith('*'):
        seg['playlist'] = True
        st = st[1:].strip()
    m = MAI_RE.search(st)
    if m or re.fullmatch(r'\*?舞', st):
        seg['channel'] = '舞秋風'
        st = MAI_RE.sub('', st) if m else ''
        if st.startswith('*'):
            seg['playlist'] = True
            st = st[1:].strip()
        if not st:
            st = '舞秋風'
    seg['text'] = st
    return seg


def clean_entry(segs):
    """Tidy decorations, merge plain text, attach '*' prefixes to links."""
    out = []
    for s in segs:
        if 'url' not in s:
            t = s['text'].replace('--', ' ')
            t = re.sub(r'\s+', ' ', t)
            s = dict(s, text=t)
        if out and 'url' not in out[-1] and 'url' not in s and out[-1].get('mark') == s.get('mark'):
            out[-1]['text'] += s['text']
        else:
            out.append(s)
    # '*' at end of a plain segment right before a link => playlist
    for i, s in enumerate(out):
        if 'url' in s:
            prev = out[i - 1] if i else None
            if prev is not None and 'url' not in prev and prev['text'].rstrip().endswith('*'):
                prev['text'] = prev['text'].rstrip()[:-1]
                s['text'] = '*' + s['text'].lstrip('*')
            finalize_link(s)
    # a link whose label is only '*' => playlist flag for the following link
    fixed = []
    for i, s in enumerate(out):
        if 'url' in s and s['text'] in ('', '舞秋風') and s.get('_star'):
            pass
        fixed.append(s)
    out = fixed
    # Plain '(舞)' text right after a link => channel on that link
    for i, s in enumerate(out):
        if 'url' not in s and re.match(r'^\s*[\(（]\*?舞[\)）]', s['text']) and i and 'url' in out[i - 1]:
            out[i - 1]['channel'] = '舞秋風'
            s['text'] = re.sub(r'^\s*[\(（]\*?舞[\)）]', '', s['text'])
    out = [s for s in out if s['text'] != '' or 'url' in s]
    for s in out:
        if 'url' not in s and not s['text'].strip():
            s.pop('mark', None)
    changed = True
    while changed:
        changed = False
        for i in range(len(out) - 2):
            a, b, c = out[i], out[i + 1], out[i + 2]
            if 'url' in a and 'url' in c and a['url'] == c['url'] and 'url' not in b and len(b['text']) <= 3:
                a['text'] += b['text'] + c['text']
                del out[i + 1:i + 3]
                changed = True
                break
        for i in range(len(out) - 1):
            a, b = out[i], out[i + 1]
            if 'url' in a and 'url' in b and a['url'] == b['url']:
                a['text'] += b['text']
                for k in ('playlist', 'channel'):
                    if k in b:
                        a[k] = b[k]
                del out[i + 1]
                changed = True
                break
    # trim punctuation at ends
    if out and 'url' not in out[0]:
        out[0]['text'] = re.sub(r'^[\s、,，。;；:]+', '', out[0]['text'])
    if out and 'url' not in out[-1]:
        out[-1]['text'] = re.sub(r'[\s、,，。;；]+$', '', out[-1]['text'])
    out = [s for s in out if s['text'] != '' or 'url' in s]
    for s in out:
        if 'mark' in s and s['mark'] is None:
            del s['mark']
    return out


def split_line(runs):
    """Split a paragraph into entries at '˙' / '。' and top-level {…} groups.
    Returns list of (segments, note)."""
    runs = merge_runs(runs)
    entries, cur, depth = [], [], 0
    note = None

    def flush():
        nonlocal cur
        segs = clean_entry(cur)
        if segs and any(s['text'].strip() or 'url' in s for s in segs):
            entries.append(segs)
        cur = []

    for r in runs:
        if r['url']:
            cur.append(make_seg(r['text'], r['url'], r['mark']))
            continue
        buf = ''
        text = r['text']
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == '※' and depth == 0:
                if buf:
                    cur.append(make_seg(buf, None, r['mark']))
                    buf = ''
                note = (note + ' ' if note else '') + '※' + text[i + 1:].strip()
                break
            if ch == '˙' and depth == 0 and re.match(r'^\s*(\d+|[IVX]+)\s*[:：]', text[i + 1:]) and any('url' in x for x in cur):
                buf += '・'
                i += 1
                continue
            if ch in '˙。' and depth == 0:
                if buf:
                    cur.append(make_seg(buf, None, r['mark']))
                    buf = ''
                flush()
            elif ch == '{':
                if buf:
                    cur.append(make_seg(buf, None, r['mark']))
                    buf = ''
                if depth == 0 and any('url' in s for s in cur):
                    flush()
                depth += 1
            elif ch == '}':
                if buf:
                    cur.append(make_seg(buf, None, r['mark']))
                    buf = ''
                depth = max(0, depth - 1)
                if depth == 0:
                    flush()
            else:
                buf += ch
            i += 1
        if buf:
            cur.append(make_seg(buf, None, r['mark']))
    flush()
    return entries, note, depth


# ---------------------------------------------------------------- typing

def infer_type(segs, section, area):
    text = ''.join(s['text'] for s in segs)
    marks = {s.get('mark') for s in segs}
    if section == 'music' or ('music' in marks and not (marks & {'video', 'anime'})):
        return 'music'
    if re.search(r'Evo\.', text):
        return 'evolution'
    if re.search(r'Ver\.\s*Compare', text, re.I):
        return 'compare'
    if re.search(r'小說|漫畫|輕小說', text):
        return 'reading'
    if area == 'anime' and ('anime' in marks or re.search(r'第.季|劇場版|OVA|SP|Season|動畫|電影', text)):
        return 'anime'
    if re.search(r'解說|劇情|世界觀|解讀|解析|雜談|科普|講解|時間線|探討|史', text):
        return 'lore'
    if marks & {'played', 'playing', 'dropped'}:
        return 'play'
    if any('url' in s for s in segs):
        urls = [s['url'] for s in segs if 'url' in s]
        if all(re.search(r'fandom|wiki|vgmdb|wikipedia|prts', u) for u in urls):
            return 'reference'
        return 'video'
    return 'other'


def plain(segs):
    return re.sub(r'\s+', ' ', ''.join(s['text'] for s in segs)).strip()


def head_title(text):
    t = re.sub(r'\((?:本作)?[^()]*Wiki[^()]*\)', '', text)
    t = re.sub(r'[\s,、]*(劇場版|動畫|本作)?\s*Wiki[\s,、]*', ' ', t)
    t = t.replace('--', ' ').replace('{', ' ').replace('}', ' ')
    t = re.sub(r'^\(Sub\)\s*', '', t)
    t = re.sub(r'[\(（]\s*\*?\s*舞\s*[\)）]', '', t).replace('*', '')
    m = re.fullmatch(r'\s*\[(.*)\]\s*', t)
    if m:
        t = m.group(1)
    t = t.strip(' ,、:：*˙')
    if t.count('(') > t.count(')'):
        t += ')'
    elif t.startswith('(') and t.endswith(')'):
        t = t[1:-1]
    t = re.sub(r'\s+', ' ', t).strip()
    return t or re.sub(r'\s*Wiki\s*', '', text).strip() or text.strip()


# ---------------------------------------------------------------- tree build

def new_node(title, kind, slide, head=None):
    n = {'id': nid('n'), 'kind': kind, 'title': title}
    if head:
        segs = clean_entry([dict(s) for s in head])
        st = next((s.get('mark') for s in segs if s.get('mark') in ('played', 'playing', 'dropped')), None)
        if st:
            n['status'] = st
        if any('url' in s for s in segs):
            n['links'] = segs
    n['entries'] = []
    n['children'] = []
    n['_slide'] = slide
    return n


def add_entries(node, para, section, area, slide):
    entries, note, depth = split_line(para.runs)
    if depth:
        review.append({'slide': slide, 'node': node['id'], 'issue': '大括號 { } 未成對，拆分可能有誤', 'text': para.text})
    for segs in entries:
        if not segs:
            continue
        if len(segs) == 1 and segs[0]['text'] in ('*',) and 'url' not in segs[0]:
            continue
        e = {'id': nid('e'), 'section': section, 'type': infer_type(segs, section, area), 'segments': segs}
        node['entries'].append(e)
    if note:
        target = node['entries'][-1] if entries and node['entries'] else node
        target.setdefault('notes', []).append(note)


def heading_segments(para):
    return [make_seg(r['text'], r['url'], r['mark']) for r in merge_runs(para.runs)]


def parse_content_shape(paras, root, slide, area, company_lookup=None, initial_section='main'):
    """Parse paragraphs of one text box under `root`. Returns last top-level node."""
    link_sizes = [p.size for p in paras if p.has_link and not p.is_sep]
    cs = min(link_sizes) if link_sizes else min([p.size for p in paras] or [DEFAULT_SIZE])
    stack = [(999, root)]
    section = 'main'
    music_anchor = None
    last_top = None
    prev_bold_entry = None
    if initial_section == 'music':
        section, music_anchor = 'music', root
    for p in paras:
        if not p.text or p.text in ('*',):
            continue
        txt = p.text
        if p.is_sep:
            section = 'music'
            music_anchor = stack[1][1] if len(stack) > 1 else stack[0][1]
            continue
        trailing_sep = bool(TRAIL_SEP_RE.search(txt))
        if trailing_sep:
            # strip dashes from the runs
            for r in p.runs:
                r['text'] = TRAIL_SEP_RE.sub('', r['text']) if TRAIL_SEP_RE.search(r['text']) else r['text']
            p.text = ''.join(r['text'] for r in p.runs).strip()
            txt = p.text
        if txt.startswith('※'):
            tgt = stack[-1][1]
            tgt.setdefault('notes', []).append(txt)
            continue
        # company bracket heading inside a box: [Valve]
        m = re.fullmatch(r'\[\s*(.+?)\s*\]', txt)
        if m and company_lookup:
            comp = company_lookup(m.group(1), p)
            stack = [(999, comp)]
            section = 'main'
            continue
        bullet_label = txt.startswith('˙') and not p.has_link and txt.rstrip().endswith((':', '：'))
        n_links = len([r for r in p.runs if r['url']])
        label_line = txt.rstrip().endswith((':', '：')) and n_links == 1 and len(txt) <= 50
        is_heading = label_line or (p.size > cs and len(txt) <= 70 and (not txt.startswith('˙') or bullet_label)
                      and not (section == 'music' and p.has_link))
        eff = p.size + 0.5 if (label_line and p.size <= cs) else p.size
        if not is_heading and p.italic_only and not p.has_link and len(txt) <= 30:
            is_heading, eff = True, p.size + 0.5
        # a plain, non-bold line right after a bold entry line => note of that entry (e.g. Minecraft map rules)
        if (not is_heading and not p.has_link and not p.marked and not p.bold and prev_bold_entry is not None
                and p.size == prev_bold_entry[0]):
            prev_bold_entry[1].setdefault('notes', []).append(txt)
            continue
        if is_heading:
            while len(stack) > 1 and stack[-1][0] <= eff:
                stack.pop()
            if section == 'music' and music_anchor is not None and len(stack) == 1:
                section = 'main'
            parent = stack[-1][1]
            n = new_node(head_title(txt), 'group', slide, heading_segments(p))
            n['_music'] = section == 'music'
            n['_size'] = eff
            parent['children'].append(n)
            stack.append((eff, n))
            prev_bold_entry = None
            if len(stack) == 2:
                last_top = n
            if p.has_link and len([r for r in p.runs if r['url']]) > 3:
                review.append({'slide': slide, 'node': n['id'], 'issue': '標題列含多個連結，可能其實是內容而非分類', 'text': txt})
        else:
            target = stack[-1][1]
            if section == 'music' and music_anchor is not None and target is not music_anchor and not target.get('_music'):
                target = music_anchor
            before = len(target['entries'])
            if p.indented and target['entries'] and p.has_link and not txt.startswith('˙'):
                prev_e = target['entries'][-1]
                tmp = {'entries': []}
                add_entries(tmp, p, section, area, slide)
                for e in tmp['entries']:
                    prev_e['segments'] += [make_seg(' ')] + e['segments']
                    prev_e['segments'] = clean_entry(prev_e['segments'])
                continue
            add_entries(target, p, section, area, slide)
            if p.bold and len(target['entries']) > before:
                prev_bold_entry = (p.size, target['entries'][-1])
            elif p.has_link or p.marked:
                prev_bold_entry = None
        if trailing_sep:
            section = 'music'
            music_anchor = stack[1][1] if len(stack) > 1 else stack[0][1]
    return last_top, section, (music_anchor if section == 'music' and music_anchor is not None else stack[-1][1])


def shape_info(sh, slide):
    paras = [Para(pa, slide) for pa in sh.text_frame.paragraphs]
    paras = [p for p in paras if p.text]
    return {
        'x0': (sh.left or 0) / 91440, 'x1': ((sh.left or 0) + (sh.width or 0)) / 91440,
        'y': (sh.top or 0) / 91440, 'paras': paras,
    }


def is_header_shape(si, area):
    ps = si['paras']
    if not ps or len(ps) > 2:
        return False
    big = all((p.size >= 30 or p.italic_only or re.fullmatch(r'\[.+\]', p.text))
              and len([r for r in p.runs if r['url']]) <= 3 and len(p.text) <= 50 for p in ps)
    if not big:
        return False
    # a header shape should not be a lone content line sitting next to other columns
    return True


def overlaps(a, b):
    return min(a['x1'], b['x1']) - max(a['x0'], b['x0']) > 3


def main(src, out):
    prs = Presentation(src)
    slides = list(prs.slides)

    # ---------- slide 1: regions and companies
    games = {'id': 'games', 'title': '遊戲（依公司）', 'nodes': []}
    companies = {}
    region = None
    s1 = slides[0]
    for sh in s1.shapes:
        if not sh.has_text_frame:
            continue
        for pa in sh.text_frame.paragraphs:
            p = Para(pa, s1)
            if not p.text or p.text.startswith('※'):
                continue
            target = next((r['slide'] for r in p.runs if r['slide']), None)
            url = next((r['url'] for r in p.runs if r['url']), None)
            if target is None and url is None:
                region = new_node(p.text, 'region', 1)
                games['nodes'].append(region)
            else:
                c = new_node(p.text, 'company', 1)
                if url:
                    c['links'] = [make_seg('官網', url)]
                region['children'].append(c)
                companies[p.text.lower()] = c
                if target:
                    SLIDE_COMPANY.setdefault(target, []).append(c)

    def find_company(name, para=None, parent=None, slide=None):
        key = name.lower().strip()
        for k, c in companies.items():
            if k == key or k.replace(' ', '') == key.replace(' ', '') or key in k or k in key:
                return c
        # new subsidiary under parent
        c = new_node(name, 'company', slide)
        c['subsidiary'] = True
        if para is not None:
            segs = heading_segments(para)
            if any('url' in s for s in segs):
                c['links'] = clean_entry(segs)
        (parent or region)['children'].append(c)
        companies[key] = c
        review.append({'slide': slide, 'node': c['id'], 'issue': f'子公司「{name}」已放在「{(parent or region)["title"]}」底下，請確認歸屬'})
        return c

    other = {'id': 'other-games', 'title': '其他遊戲', 'nodes': []}
    anime = {'id': 'anime', 'title': '動漫', 'nodes': []}
    misc = {'id': 'misc', 'title': '多媒體雜項', 'nodes': []}
    channels = []

    cur_company = None
    prev_top = None
    carry_section = 'main'
    last_group = None
    # manual overrides for slides shared by companies without [brackets]
    SHAPE_COMPANY = {'Shadow of the Colossus': 'Japan Studio', '明日方舟': '鷹角網路'}

    def first_is_heading(ps):
        link_sizes = [p.size for p in ps if p.has_link and not p.is_sep]
        cs = min(link_sizes) if link_sizes else min(p.size for p in ps)
        p0 = ps[0]
        return p0.size > cs or bool(re.fullmatch(r'\[.+\]', p0.text))

    for idx, slide in enumerate(slides, 1):
        if idx in (1, 2, 56, 57):
            continue
        new_company_slide = idx in SLIDE_COMPANY
        if new_company_slide:
            cur_company = SLIDE_COMPANY[idx][0]
        if 3 <= idx <= 45:
            area, slide_root = 'games', cur_company
        elif 46 <= idx <= 55:
            area, slide_root = 'other', None
        else:
            area, slide_root = 'anime', None

        infos = [shape_info(sh, slide) for sh in slide.shapes if sh.has_text_frame and sh.text_frame.text.strip()]
        infos = [i for i in infos if i['paras'] and not all(p.text in ('*', '{ }', '{  }', '{}') for p in i['paras'])]
        infos.sort(key=lambda i: (0 if i['x1'] - i['x0'] >= 90 else 1, int(i['x0'] // 40), i['y'], i['x0']))
        headers = [i for i in infos if is_header_shape(i, area)]
        contents = [i for i in infos if i not in headers]

        def root_for(info, fallback, only_strong=False):
            cands = [h for h in headers if h is not info and 'node' in h and h['y'] < info['y'] and overlaps(h, info)]
            if only_strong:
                cands = [h for h in cands if h.get('company') or h['x1'] - h['x0'] >= 90]
            if not cands:
                return fallback
            return max(cands, key=lambda h: h['y'])['node']

        for h in headers:
            p0 = h['paras'][0]
            txt = ' '.join(p.text for p in h['paras'])
            if area == 'games' and (p0.italic_only or re.fullmatch(r'\[.+\]', p0.text)):
                h['node'] = find_company(p0.text.strip('[] '), p0, parent=cur_company, slide=idx)
                h['company'] = True
                continue
            segs = []
            for p in h['paras']:
                segs += heading_segments(p)
            is_sub = txt.startswith('(Sub)')
            n = new_node(head_title(txt), 'series' if area == 'games' else ('work' if area == 'anime' else 'category'), idx, segs)
            parent = root_for(h, slide_root, only_strong=True)
            if area == 'games':
                for k, v in SHAPE_COMPANY.items():
                    if txt.startswith(k):
                        parent = find_company(v, slide=idx)
                        review.append({'slide': idx, 'node': n['id'], 'issue': f'第 {idx} 頁由多家公司共用，「{k}」已歸到「{v}」，請確認'})
                if is_sub and prev_top is not None:
                    parent = prev_top
                    n['kind'] = 'subseries'
            if parent is None:
                (other if area == 'other' else anime)['nodes'].append(n)
            else:
                parent['children'].append(n)
            h['node'] = n
            if area == 'games' and not is_sub:
                prev_top = n
                last_group = n
                carry_section = 'main'

        for c in contents:
            ps = c['paras']
            fallback = slide_root
            if area == 'games':
                first_heading = next((p.text for p in ps if p.text and not p.is_sep), '')
                for k, v in SHAPE_COMPANY.items():
                    if first_heading.startswith(k):
                        fallback = find_company(v, slide=idx)
                        review.append({'slide': idx, 'node': fallback['id'], 'issue': f'第 {idx} 頁由多家公司共用，「{k}」已歸到「{v}」，請確認'})
            root = root_for(c, fallback)
            sentinel = None
            if root is None and area == 'anime':
                sentinel = root = {'id': 'tmp', 'kind': 'work', 'title': '', 'entries': [], 'children': []}
            elif root is None:
                root = other['nodes'][-1] if other['nodes'] else None
                if root is None:
                    continue
            init = 'main'
            cont = False
            if area == 'games' and root.get('kind') == 'company' and last_group is not None:
                if new_company_slide:
                    cont = ps[0].is_sep or ps[0].text.startswith('˙')
                else:
                    cont = ps[0].is_sep or not first_is_heading(ps)
            if cont:
                root = prev_top if ps[0].is_sep and prev_top is not None else last_group
                init = carry_section
                review.append({'slide': idx, 'node': root['id'], 'issue': f'第 {idx} 頁（或其中一欄）沒有標題，判斷為「{root["title"]}」的延續，請確認'})
            lookup = (lambda name, p, _s=idx: find_company(name, p, parent=cur_company, slide=_s)) if area == 'games' else None
            was_company_root = root.get('kind') == 'company'
            top, sec, lg = parse_content_shape(ps, root, idx, area, lookup, init)
            if sentinel is not None:
                prevw = anime['nodes'][-1] if anime['nodes'] else None
                if sentinel['entries']:
                    if prevw is None:
                        prevw = new_node('（未分類）', 'work', idx)
                        anime['nodes'].append(prevw)
                    prevw['entries'] += sentinel['entries']
                    review.append({'slide': idx, 'node': prevw['id'], 'issue': f'第 {idx} 頁開頭沒有作品標題的內容，已接到「{prevw["title"]}」，請確認'})
                if sentinel.get('notes') and prevw is not None:
                    prevw.setdefault('notes', []).extend(sentinel['notes'])
                for ch in sentinel['children']:
                    if ch.get('_size', 0) >= 30 or prevw is None:
                        ch['kind'] = 'work'
                        anime['nodes'].append(ch)
                        prevw = ch
                    else:
                        prevw['children'].append(ch)
            if area == 'games':
                carry_section = sec
                last_group = lg
                if top is not None and was_company_root:
                    prev_top = top

    # ---------- slide 57: anime source medium
    src_map = {}
    s57 = slides[56]
    medium = None
    MEDIUM = {'輕小說': 'light-novel', '漫畫': 'manga', '遊戲': 'game', '原創': 'original'}
    for sh in s57.shapes:
        if not sh.has_text_frame:
            continue
        for pa in sh.text_frame.paragraphs:
            p = Para(pa, s57)
            for k, v in MEDIUM.items():
                if p.text.startswith('※' + k):
                    medium = v
            for r in p.runs:
                if r['slide']:
                    src_map.setdefault(r['slide'], []).append((r['text'], medium))
    ALIAS = {'地錯': '地下城', '魔劣': '劣等生', '實教': '實力至上', '黑籃': '籃球', '進巨': '巨人', 'Re': 'Re:', '零': 'Re:',
             '哆啦': '哆啦', 'A': '哆啦', '夢': '哆啦', 'Konosuba': '祝福', '惡魔高校': '惡魔高校', '約戰': '約會'}
    for n in anime['nodes']:
        cands = src_map.get(n['_slide'], [])
        mediums = {m for _, m in cands}
        if len(mediums) == 1:
            n['source'] = mediums.pop()
        else:
            for name, m in cands:
                key = ALIAS.get(name, name)
                if key in n['title'] or name in n['title']:
                    n['source'] = m
                    break
        if 'source' not in n:
            review.append({'slide': n['_slide'], 'node': n['id'], 'issue': '無法判斷原作媒介（輕小說／漫畫／遊戲／原創）'})

    # ---------- slide 56: channels and misc
    s56 = slides[55]
    cat = None
    misc_node = new_node('雜項（書、音樂、節目）', 'category', 56)
    misc['nodes'].append(misc_node)
    in_misc = False
    for sh in s56.shapes:
        if not sh.has_text_frame:
            continue
        for pa in sh.text_frame.paragraphs:
            p = Para(pa, s56)
            if not p.text:
                continue
            if p.text.startswith('Channels'):
                continue
            if p.text.startswith('雜項'):
                in_misc = True
                continue
            if not in_misc:
                m = re.match(r'^([^:：]+)[:：]', p.text)
                cat = m.group(1) if m else '其他'
                for r in merge_runs(p.runs):
                    if r['url']:
                        name = r['text'].strip(' 、,')
                        if channels and channels[-1]['url'] == r['url']:
                            channels[-1]['name'] += name
                            continue
                        channels.append({'id': nid('c'), 'name': name, 'url': r['url'], 'category': cat,
                                         'platform': 'bilibili' if 'bilibili' in r['url'] else ('youtube' if 'youtu' in r['url'] else 'other'),
                                         'subscribed': False})
            else:
                links = [r for r in merge_runs(p.runs) if r['url']]
                if links and all('youtu' in r['url'] or 'bilibili' in r['url'] for r in links) and re.search(r'Music|OST|BGM|Epic', p.text, re.I):
                    for r in links:
                        channels.append({'id': nid('c'), 'name': r['text'].strip(' 、,'), 'url': r['url'], 'category': '音樂',
                                         'platform': 'bilibili' if 'bilibili' in r['url'] else 'youtube', 'subscribed': False})
                    rest = re.sub(r'.*BGM maker,\s*', '', p.text)
                    if rest and rest != p.text:
                        misc_node['entries'].append({'id': nid('e'), 'section': 'main', 'type': 'music',
                                                     'segments': [make_seg('其他音樂來源：' + rest.strip(' ,，'))]})
                else:
                    misc_node['entries'].append({'id': nid('e'), 'section': 'main', 'type': 'other',
                                                 'segments': clean_entry([make_seg(r['text'], r['url'], r['mark']) for r in merge_runs(p.runs)])})
    # 舞秋風 as a channel (referenced by many links)
    channels.insert(0, {'id': 'c-mai', 'name': '舞秋風', 'url': '', 'category': '實況主', 'platform': 'youtube',
                        'subscribed': True, 'note': '第一位關注的實況主；紀錄中以 channel="舞秋風" 標註他的影片'})

    # ---------- cleanup
    def tidy(n, path):
        if '舞秋風' in n['title']:
            for e in n.get('entries', []):
                for sg in e['segments']:
                    if 'url' in sg and 'youtu' in sg['url']:
                        sg.setdefault('channel', '舞秋風')
        n.pop('_music', None)
        n.pop('_size', None)
        slide = n.pop('_slide', None)
        if slide:
            n['origin'] = f'ppt:{slide}'
        for c in n['children']:
            tidy(c, path + [n['title']])
        if not n['entries']:
            del n['entries']
        if not n['children']:
            del n['children']
        if 'entries' not in n and 'children' not in n and 'links' not in n and 'status' not in n and n['kind'] not in ('company', 'region'):
            review.append({'slide': slide, 'node': n['id'], 'issue': '空節點（沒有內容），可能是預留的分類或轉換遺漏', 'text': n['title']})

    for sec in (games, other, anime, misc):
        for n in sec['nodes']:
            tidy(n, [])

    os.makedirs(out, exist_ok=True)

    def dump(name, obj):
        with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
            f.write('\n')

    for sec in (games, other, anime, misc):
        dump(f"{sec['id']}.json", {'version': 1, 'section': sec['id'], 'title': sec['title'], 'nodes': sec['nodes']})
    dump('channels.json', {'version': 1, 'channels': channels})
    # review: dedupe
    seen, rv = set(), []
    for r in review:
        k = (r.get('node'), r['issue'])
        if k in seen:
            continue
        seen.add(k)
        rv.append(dict(r, id=nid('r')))
    dump('review.json', {'version': 1, 'items': rv})

    # stats
    def walk(n):
        yield n
        for c in n.get('children', []):
            yield from walk(c)
    links = 0
    nodes = 0
    for sec in (games, other, anime, misc):
        for root in sec['nodes']:
            for n in walk(root):
                nodes += 1
                links += sum(1 for s in n.get('links', []) if 'url' in s)
                for e in n.get('entries', []):
                    links += sum(1 for s in e['segments'] if 'url' in s)
    links += sum(1 for c in channels if c['url'])
    print(f'nodes={nodes} links={links} channels={len(channels)} review={len(rv)}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
