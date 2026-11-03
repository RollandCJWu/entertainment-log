#!/usr/bin/env python3
"""Validate the data/*.json files against the schema described in docs/schema.md.

Usage:
  python3 tools/validate.py            # validate, exit 1 on errors
  python3 tools/validate.py --new-id n # print a fresh id with prefix n (node) / e (entry) / c (channel)
"""
import json
import os
import re
import sys
import time
import random
import string

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECTIONS = ['games', 'other-games', 'anime', 'misc']
KINDS = {'region', 'company', 'category', 'series', 'subseries', 'group', 'work'}
STATUS = {'played', 'playing', 'dropped'}
SOURCES = {'light-novel', 'manga', 'game', 'original'}
MARKS = {'video', 'music', 'anime', 'played', 'playing', 'dropped'}
TYPES = {'play', 'video', 'lore', 'music', 'anime', 'reading', 'evolution', 'compare', 'trivia', 'reference', 'other'}
ENTRY_SECTIONS = {'main', 'music'}
NODE_KEYS = {'id', 'kind', 'title', 'status', 'source', 'release', 'tags', 'links', 'notes', 'extra', 'entries', 'children', 'origin', 'subsidiary'}
ENTRY_KEYS = {'id', 'section', 'type', 'segments', 'notes', 'extra'}
SEG_KEYS = {'text', 'url', 'mark', 'playlist', 'channel'}

errors, warnings = [], []


def new_id(prefix):
    t = format(int(time.time() * 1000), 'x')
    r = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(3))
    return f'{prefix}{t}{r}'


def err(where, msg):
    errors.append(f'{where}: {msg}')


def check_segments(where, segs):
    if not isinstance(segs, list):
        return err(where, 'segments 必須是陣列')
    for i, s in enumerate(segs):
        w = f'{where}.segments[{i}]'
        if not isinstance(s, dict) or 'text' not in s or not isinstance(s['text'], str):
            err(w, '每個 segment 必須有字串 text')
            continue
        extra = set(s) - SEG_KEYS
        if extra:
            err(w, f'不允許的欄位 {sorted(extra)}')
        if 'url' in s and not re.match(r'^https?://', s['url'] or ''):
            err(w, f'url 格式錯誤：{s.get("url")!r}')
        if 'mark' in s and s['mark'] not in MARKS:
            err(w, f'mark 必須是 {sorted(MARKS)} 之一')
        if 'playlist' in s and s['playlist'] is not True:
            err(w, 'playlist 只能是 true（不需要時請省略）')
        if 'channel' in s and not isinstance(s['channel'], str):
            err(w, 'channel 必須是字串')


def check_str_list(where, v, name):
    if not isinstance(v, list) or not all(isinstance(x, str) and x.strip() for x in v):
        err(where, f'{name} 必須是非空字串陣列')


def check_node(n, path, ids, eids):
    where = f'{path}/{n.get("title", "?")}'
    if not isinstance(n, dict):
        return err(path, 'node 必須是物件')
    nid = n.get('id')
    if not isinstance(nid, str) or not nid:
        err(where, '缺少 id')
    elif nid in ids:
        err(where, f'id 重複：{nid}')
    else:
        ids.add(nid)
    if not isinstance(n.get('title'), str) or not n['title'].strip():
        err(where, '缺少 title')
    if n.get('kind') not in KINDS:
        err(where, f'kind 必須是 {sorted(KINDS)} 之一')
    if 'status' in n and n['status'] not in STATUS:
        err(where, f'status 必須是 {sorted(STATUS)} 之一')
    if 'source' in n and n['source'] not in SOURCES:
        err(where, f'source 必須是 {sorted(SOURCES)} 之一')
    if 'release' in n:
        r = n['release']
        if not isinstance(r, dict) or not re.fullmatch(r'\d{4}(-\d{2}(-\d{2})?)?', str(r.get('date', ''))):
            err(where, 'release.date 必須是 YYYY / YYYY-MM / YYYY-MM-DD')
        else:
            prec = {4: 'year', 7: 'month', 10: 'day'}[len(r['date'])]
            if r.get('precision') != prec:
                err(where, f'release.precision 應為 {prec}')
            if 'source' in r and not re.match(r'^https?://', r['source']):
                err(where, 'release.source 必須是網址')
    for k in ('notes', 'tags'):
        if k in n:
            check_str_list(where, n[k], k)
    if 'extra' in n and (not isinstance(n['extra'], dict) or not all(isinstance(v, str) for v in n['extra'].values())):
        err(where, 'extra 必須是 {欄位: 字串}')
    if 'links' in n:
        check_segments(f'{where}.links', n['links'])
    unknown = set(n) - NODE_KEYS
    if unknown:
        warnings.append(f'{where}: 未定義的欄位 {sorted(unknown)}（若是新欄位，請更新 docs/schema.md 與 tools/validate.py）')
    for i, e in enumerate(n.get('entries', []) or []):
        w = f'{where}.entries[{i}]'
        if e.get('id') in eids or not e.get('id'):
            err(w, f'entry id 缺少或重複：{e.get("id")}')
        eids.add(e.get('id'))
        if e.get('section') not in ENTRY_SECTIONS:
            err(w, 'section 必須是 main 或 music')
        if e.get('type') not in TYPES:
            err(w, f'type 必須是 {sorted(TYPES)} 之一')
        if not e.get('segments'):
            err(w, 'segments 不可為空')
        check_segments(w, e.get('segments', []))
        if 'notes' in e:
            check_str_list(w, e['notes'], 'notes')
        unknown = set(e) - ENTRY_KEYS
        if unknown:
            err(w, f'不允許的欄位 {sorted(unknown)}')
    if 'entries' in n and not n['entries']:
        err(where, 'entries 為空陣列時請直接省略此欄位')
    if 'children' in n:
        if not n['children']:
            err(where, 'children 為空陣列時請直接省略此欄位')
        for c in n['children']:
            check_node(c, where, ids, eids)


def check_format(path, text, obj):
    expected = json.dumps(obj, ensure_ascii=False, indent=1) + '\n'
    if text != expected:
        warnings.append(f'{path}: 格式與標準輸出不同（請用 json.dump(..., ensure_ascii=False, indent=1) 並以換行結尾），diff 會比較亂')


def main():
    if len(sys.argv) > 2 and sys.argv[1] == '--new-id':
        print(new_id(sys.argv[2]))
        return 0
    ids, eids = set(), set()
    for sec in SECTIONS:
        p = os.path.join(ROOT, 'data', f'{sec}.json')
        with open(p, encoding='utf-8') as f:
            text = f.read()
        try:
            d = json.loads(text)
        except json.JSONDecodeError as e:
            err(p, f'JSON 解析失敗：{e}')
            continue
        check_format(f'data/{sec}.json', text, d)
        if d.get('section') != sec:
            err(p, f'section 應為 {sec}')
        for n in d.get('nodes', []):
            check_node(n, sec, ids, eids)
    p = os.path.join(ROOT, 'data', 'channels.json')
    with open(p, encoding='utf-8') as f:
        text = f.read()
    ch = json.loads(text)
    check_format('data/channels.json', text, ch)
    cids = set()
    for c in ch.get('channels', []):
        if not c.get('id') or c['id'] in cids:
            err('channels', f'id 缺少或重複：{c.get("id")}')
        cids.add(c.get('id'))
        if not c.get('name'):
            err('channels', f'{c.get("id")} 缺少 name')
        if c.get('url') and not re.match(r'^https?://', c['url']):
            err('channels', f'{c.get("name")} url 格式錯誤')
    p = os.path.join(ROOT, 'data', 'review.json')
    with open(p, encoding='utf-8') as f:
        text = f.read()
    rv = json.loads(text)
    check_format('data/review.json', text, rv)
    for r in rv.get('items', []):
        if r.get('node') and r['node'] not in ids:
            warnings.append(f'review {r.get("id")}: 指向不存在的節點 {r["node"]}（可刪除此項）')
    for w in warnings:
        print('WARN ', w)
    for e in errors:
        print('ERROR', e)
    print(f'{len(ids)} nodes, {len(eids)} entries, {len(cids)} channels; {len(errors)} errors, {len(warnings)} warnings')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
