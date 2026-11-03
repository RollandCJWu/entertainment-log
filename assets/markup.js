// Inline markup used by the web editor to edit an entry's segments as one line of text.
//
//   plain text                       → plain segment
//   [label](https://url)             → link
//   [label](https://url){音樂,合集}  → link with options
//   [label]{已玩}                    → marked text without a link
//
// Options (comma separated, Chinese or English):
//   影片/video  音樂/music  動畫/anime  已玩/played  遊玩中/playing  退坑/dropped
//   合集/playlist   舞 (= channel 舞秋風)   ch:頻道名 (any channel)
// Use \[ \] \\ to write literal brackets.

export const MARKS = ['video', 'music', 'anime', 'played', 'playing', 'dropped'];
export const MARK_LABEL = {
  video: '影片', music: '音樂', anime: '動畫', played: '已玩', playing: '遊玩中', dropped: '退坑',
};
const ALIAS = {
  video: 'video', '影片': 'video', '遊戲影片': 'video',
  music: 'music', '音樂': 'music',
  anime: 'anime', '動畫': 'anime',
  played: 'played', '已玩': 'played', '已玩過': 'played',
  playing: 'playing', '遊玩中': 'playing',
  dropped: 'dropped', '退坑': 'dropped',
};

function esc(t) {
  return t.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

export function segsToMarkup(segs = []) {
  return segs.map((s) => {
    const opts = [];
    if (s.mark) opts.push(MARK_LABEL[s.mark] || s.mark);
    if (s.playlist) opts.push('合集');
    if (s.channel) opts.push(s.channel === '舞秋風' ? '舞' : `ch:${s.channel}`);
    if (!s.url && !opts.length) return esc(s.text);
    let out = `[${esc(s.text)}]`;
    if (s.url) out += `(${s.url})`;
    if (opts.length) out += `{${opts.join(',')}}`;
    return out;
  }).join('');
}

export function markupToSegs(src) {
  const segs = [];
  const errors = [];
  let buf = '';
  let i = 0;
  const pushText = () => {
    if (buf) segs.push({ text: buf });
    buf = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch !== '[') {
      buf += ch;
      i += 1;
      continue;
    }
    // read label
    let j = i + 1;
    let label = '';
    let closed = false;
    while (j < src.length) {
      if (src[j] === '\\' && j + 1 < src.length) { label += src[j + 1]; j += 2; continue; }
      if (src[j] === ']') { closed = true; break; }
      label += src[j];
      j += 1;
    }
    if (!closed) {
      errors.push('有「[」沒有對應的「]」');
      buf += src.slice(i);
      break;
    }
    let k = j + 1;
    let url = null;
    let opts = null;
    if (src[k] === '(') {
      let depth = 1;
      let m = k + 1;
      while (m < src.length && depth > 0) {
        if (src[m] === '(') depth += 1;
        else if (src[m] === ')') depth -= 1;
        if (depth > 0) m += 1;
      }
      if (depth !== 0) {
        errors.push(`連結「${label}」的網址缺少「)」`);
        buf += src.slice(i);
        break;
      }
      url = src.slice(k + 1, m).trim();
      k = m + 1;
    }
    if (src[k] === '{') {
      const end = src.indexOf('}', k);
      if (end < 0) {
        errors.push(`「${label}」的選項缺少「}」`);
      } else {
        opts = src.slice(k + 1, end).split(/[,，]/).map((x) => x.trim()).filter(Boolean);
        k = end + 1;
      }
    }
    if (url === null && opts === null) {
      buf += `[${label}]`;
      i = j + 1;
      continue;
    }
    pushText();
    const seg = { text: label };
    if (url) {
      if (!/^https?:\/\//i.test(url)) errors.push(`「${label}」的網址看起來不正確：${url}`);
      seg.url = url;
    }
    for (const o of opts || []) {
      if (ALIAS[o]) seg.mark = ALIAS[o];
      else if (o === '合集' || o === 'playlist' || o === '*') seg.playlist = true;
      else if (o === '舞') seg.channel = '舞秋風';
      else if (/^ch[:：]/.test(o)) seg.channel = o.replace(/^ch[:：]\s*/, '');
      else errors.push(`不認得的選項「${o}」`);
    }
    segs.push(seg);
    i = k;
  }
  pushText();
  return { segs, errors };
}
