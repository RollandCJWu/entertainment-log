import { MARK_LABEL } from './markup.js';
import { readFile } from './github.js';
import { initEditor, nodeEditorHtml, bindNodeEditor, sectionAddHtml, bindSectionAdd, channelEditorHtml, bindChannelEditor, reviewButtons, bindReview } from './editor.js';

// ------------------------------------------------------------------ config
const PASSWORD = '2a921804'; // 只是擋一般訪客，不是真正的加密
const SECTIONS = [
  { id: 'games', file: 'data/games.json', desc: '依地區與公司整理的遊戲紀錄' },
  { id: 'other-games', file: 'data/other-games.json', desc: '小遊戲、RPG Maker、依年代分類的遊戲' },
  { id: 'anime', file: 'data/anime.json', desc: '動畫、輕小說、漫畫與原聲帶' },
  { id: 'misc', file: 'data/misc.json', desc: '書、音樂、節目等雜項' },
];
const FILES = { channels: 'data/channels.json', review: 'data/review.json' };

export const TYPE_LABEL = {
  play: '親自遊玩', video: '影片', lore: '劇情解說', music: '音樂', anime: '動畫', reading: '小說/漫畫',
  evolution: '系列演進', compare: '版本比較', trivia: '雜談', reference: '資料', other: '其他',
};
export const KIND_LABEL = {
  region: '地區', company: '公司', category: '分類', series: '系列', subseries: '子系列', group: '分組', work: '作品',
};
export const STATUS_LABEL = { played: '已玩過', playing: '遊玩中', dropped: '退坑' };
export const SOURCE_LABEL = { 'light-novel': '輕小說原作', manga: '漫畫原作', game: '遊戲原作', original: '原創' };
const MARK_COLOR = {
  video: 'var(--m-video)', music: 'var(--m-music)', anime: 'var(--m-anime)',
  played: 'var(--m-played)', playing: 'var(--m-playing)', dropped: 'var(--m-dropped)',
};

// ------------------------------------------------------------------ state
export const state = {
  sections: {},     // id -> parsed json
  channels: null,
  review: null,
  original: {},     // path -> text as loaded (for conflict detection)
  dirty: new Set(), // paths
  editing: false,
  idx: new Map(),   // node id -> {node, parent, section, path:[nodes]}
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
export { store };

export function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function sectionFile(id) {
  const s = SECTIONS.find((x) => x.id === id);
  return s ? s.file : FILES[id];
}
export function sectionList() { return SECTIONS; }

// ------------------------------------------------------------------ auth
function unlocked() {
  try { return localStorage.getItem('el-auth') === PASSWORD; } catch { return false; }
}
function setupLock() {
  const lock = $('#lock');
  if (unlocked()) return Promise.resolve();
  lock.hidden = false;
  $('#lock-input').focus();
  return new Promise((resolve) => {
    $('#lock-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if ($('#lock-input').value.trim() === PASSWORD) {
        try { localStorage.setItem('el-auth', PASSWORD); } catch { /* ignore */ }
        lock.hidden = true;
        resolve();
      } else {
        $('#lock-err').hidden = false;
        $('#lock-input').select();
      }
    });
  });
}

// ------------------------------------------------------------------ loading
export function githubConfig() {
  const def = { owner: 'RollandCJWu', repo: 'entertainment-log', branch: 'main', token: '' };
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    def.owner = host.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    if (seg) def.repo = seg;
  }
  return { ...def, ...store.get('el-gh', {}) };
}

async function loadText(path) {
  const cfg = githubConfig();
  if (cfg.token) {
    try { return await readFile(cfg, path); } catch (e) { console.warn(e); }
  }
  const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`無法載入 ${path}`);
  return res.text();
}

async function loadAll() {
  const paths = [...SECTIONS.map((s) => s.file), FILES.channels, FILES.review];
  const texts = await Promise.all(paths.map(loadText));
  paths.forEach((p, i) => { state.original[p] = texts[i]; });
  SECTIONS.forEach((s, i) => { state.sections[s.id] = JSON.parse(texts[i]); });
  state.channels = JSON.parse(texts[SECTIONS.length]);
  state.review = JSON.parse(texts[SECTIONS.length + 1]);
  try {
    const res = await fetch(`data/link-report.json?v=${Date.now()}`, { cache: 'no-store' });
    state.links = res.ok ? await res.json() : null;
  } catch { state.links = null; }
  buildIndex();
}

export function buildIndex() {
  state.idx.clear();
  const walk = (node, parent, section, path) => {
    const p = [...path, node];
    state.idx.set(node.id, { node, parent, section, path: p });
    (node.children || []).forEach((c) => walk(c, node, section, p));
  };
  for (const s of SECTIONS) (state.sections[s.id].nodes || []).forEach((n) => walk(n, null, s.id, []));
}

// ------------------------------------------------------------------ helpers
export function siteOf(url) {
  if (!url) return '';
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'YouTube';
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'B站';
  if (u.includes('ani.gamer.com.tw')) return '巴哈';
  if (u.includes('anime1')) return 'Anime1';
  if (u.includes('vgmdb')) return 'VGMdb';
  if (u.includes('spotify')) return 'Spotify';
  if (u.includes('khinsider')) return 'KHInsider';
  if (u.includes('steam')) return 'Steam';
  if (u.includes('fandom.com') || u.includes('wiki')) return 'Wiki';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '其他'; }
}
const isVideoSite = (url) => ['YouTube', 'B站'].includes(siteOf(url));

export function segsHtml(segs = [], q = null) {
  return segs.map((s) => {
    let t = esc(s.text);
    if (q) t = highlight(t, q);
    const cls = s.mark ? ` mk-${s.mark}` : '';
    let extra = '';
    if (s.playlist) extra += '<span class="badge pl" title="合集／播放清單">合集</span>';
    if (s.channel) extra += `<span class="badge ch" title="頻道：${esc(s.channel)}">${s.channel === '舞秋風' ? '舞' : esc(s.channel)}</span>`;
    if (s.url) {
      const site = siteOf(s.url);
      const title = [site, s.mark ? MARK_LABEL[s.mark] : (isVideoSite(s.url) ? '未標記' : '')].filter(Boolean).join('・');
      return `<a class="lk${cls}" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">${t || esc(site)}</a>${extra}`;
    }
    return s.mark ? `<span class="${cls.trim()}" title="${MARK_LABEL[s.mark]}">${t}</span>${extra}` : t + extra;
  }).join('');
}

function highlight(html, q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let out = html;
  for (const t of terms) {
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

export const plain = (segs = []) => segs.map((s) => s.text).join('').replace(/\s+/g, ' ').trim();

function markCounts(node, deep = true) {
  const c = { video: 0, music: 0, anime: 0, played: 0, playing: 0, dropped: 0, links: 0, entries: 0, nodes: 0 };
  const visit = (n) => {
    c.nodes += 1;
    if (n.status) c[n.status] += 1;
    for (const s of n.links || []) if (s.url) c.links += 1;
    for (const e of n.entries || []) {
      c.entries += 1;
      for (const s of e.segments) {
        if (s.url) c.links += 1;
        if (s.mark) c[s.mark] += 1;
      }
    }
    if (deep) (n.children || []).forEach(visit);
  };
  visit(node);
  return c;
}

function markBar(c) {
  const keys = ['played', 'playing', 'dropped', 'video', 'anime', 'music'];
  const total = keys.reduce((a, k) => a + c[k], 0);
  if (!total) return '';
  return `<div class="bar-marks" aria-hidden="true">${keys.filter((k) => c[k]).map((k) => `<i style="width:${(c[k] / total) * 100}%;background:${MARK_COLOR[k]}"></i>`).join('')}</div>`;
}

function crumbs(path, section) {
  const sec = state.sections[section];
  const parts = [`<a href="#/s/${section}">${esc(sec.title)}</a>`];
  path.slice(0, -1).forEach((n) => parts.push(`<a href="#/n/${n.id}">${esc(n.title)}</a>`));
  return `<nav class="crumbs">${parts.join('<span class="sep">›</span>')}</nav>`;
}

function releaseText(r) {
  if (!r || !r.date) return '';
  return `${esc(r.date)}${r.region ? ` (${esc(r.region)})` : ''}`;
}

// ------------------------------------------------------------------ sidebar tree
const expanded = new Set(store.get('el-open', []));
function renderTree(filter = '') {
  const f = filter.trim().toLowerCase();
  const cur = (location.hash.match(/^#\/n\/(.+)$/) || [])[1];
  const curPath = cur && state.idx.get(cur) ? state.idx.get(cur).path.map((n) => n.id) : [];
  const matches = (n) => !f || n.title.toLowerCase().includes(f) || (n.children || []).some(matches);
  const item = (n) => {
    if (!matches(n)) return '';
    const kids = (n.children || []).filter(matches);
    const open = f ? true : expanded.has(n.id) || curPath.includes(n.id);
    const dot = n.status ? `<span class="dot" style="background:${MARK_COLOR[n.status]}" title="${STATUS_LABEL[n.status]}"></span>` : '';
    return `<li><div class="row${n.id === cur ? ' current' : ''}">
      <button class="tw${kids.length ? '' : ' leaf'}" data-tw="${n.id}" aria-label="展開">${open ? '▾' : '▸'}</button>
      ${dot}<a href="#/n/${n.id}" title="${esc(n.title)}">${esc(n.title)}</a></div>
      ${kids.length && open ? `<ul>${kids.map(item).join('')}</ul>` : ''}</li>`;
  };
  $('#tree').innerHTML = SECTIONS.map((s) => {
    const sec = state.sections[s.id];
    const body = (sec.nodes || []).map(item).join('');
    if (f && !body) return '';
    return `<div class="sec"><a href="#/s/${s.id}">${esc(sec.title)}</a></div><ul>${body}</ul>`;
  }).join('') || '<p class="empty">沒有符合的項目</p>';
}

// ------------------------------------------------------------------ views
function viewHome() {
  const playing = [];
  for (const { node } of state.idx.values()) if (node.status === 'playing') playing.push(node);
  const tot = { nodes: state.idx.size, links: 0 };
  for (const s of SECTIONS) for (const n of state.sections[s.id].nodes) tot.links += markCounts(n).links;
  return `
    <div class="mobile-links"><a href="#/stats">統計</a><a href="#/channels">頻道</a><a href="#/review">待確認</a></div>
    <div class="hero"><h1 class="title">娛樂紀錄</h1>
      <p>${tot.nodes} 個項目・${tot.links} 個連結</p></div>
    <div class="sections">${SECTIONS.map((s) => {
      const sec = state.sections[s.id];
      let n = 0;
      sec.nodes.forEach((x) => { n += markCounts(x).nodes; });
      return `<a class="card section-card" href="#/s/${s.id}"><h3>${esc(sec.title)}</h3><p>${esc(s.desc)}・${n} 項</p></a>`;
    }).join('')}</div>
    ${playing.length ? `<div class="block"><h2>遊玩中</h2><div class="filters">${playing.map((n) => `<a class="tag st-playing" href="#/n/${n.id}">${esc(n.title)}</a>`).join('')}</div></div>` : ''}
    <div class="legend">${Object.entries(MARK_LABEL).map(([k, v]) => `<span><span class="dot" style="background:${MARK_COLOR[k]}"></span>${k === 'video' ? '看過影片' : k === 'music' ? '聽過音樂' : k === 'anime' ? '看過動畫' : v}</span>`).join('')}
      <span><span class="badge pl">合集</span>播放清單</span><span><span class="badge ch">舞</span>舞秋風</span></div>`;
}

function viewSection(id) {
  const sec = state.sections[id];
  if (!sec) return viewNotFound();
  return `<nav class="crumbs"><a href="#/">首頁</a></nav>
    <h1 class="title">${esc(sec.title)}</h1>
    ${state.editing ? sectionAddHtml(id) : ''}
    <div class="block">${kidsHtml(sec.nodes)}</div>`;
}

function kidsHtml(nodes) {
  if (!nodes || !nodes.length) return '';
  return `<div class="kids">${nodes.map((n) => {
    const c = markCounts(n);
    const sub = [KIND_LABEL[n.kind] || n.kind, n.children ? `${n.children.length} 個子項` : '', c.entries ? `${c.entries} 筆紀錄` : ''].filter(Boolean).join('・');
    return `<a class="card kid" href="#/n/${n.id}"><strong>${n.status ? `<span class="dot" style="display:inline-block;background:${MARK_COLOR[n.status]}"></span> ` : ''}${esc(n.title)}</strong><small>${esc(sub)}</small>${markBar(c)}</a>`;
  }).join('')}</div>`;
}

function entriesHtml(list) {
  return `<ul class="entries">${list.map((e) => `<li class="entry">
      <span class="etype">${esc(TYPE_LABEL[e.type] || e.type || '')}</span>
      <div class="etext">${segsHtml(e.segments)}${(e.notes || []).map((t) => `<span class="enote">${esc(t)}</span>`).join('')}</div>
    </li>`).join('')}</ul>`;
}

function viewNode(id) {
  const rec = state.idx.get(id);
  if (!rec) return viewNotFound();
  const n = rec.node;
  const tags = [
    `<span class="tag">${esc(KIND_LABEL[n.kind] || n.kind)}</span>`,
    n.status ? `<span class="tag st-${n.status}">${STATUS_LABEL[n.status]}</span>` : '',
    n.source ? `<span class="tag">${esc(SOURCE_LABEL[n.source] || n.source)}</span>` : '',
    n.release && n.release.date ? `<span class="tag" title="發行／上映日期">📅 ${releaseText(n.release)}</span>` : '',
    ...(n.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`),
    n.origin ? `<span class="tag" title="原 PPT 頁碼">${esc(n.origin.replace('ppt:', 'PPT 第 '))} 頁</span>` : '',
  ].join('');
  const extra = n.extra && Object.keys(n.extra).length
    ? `<div class="block"><table class="tbl card">${Object.entries(n.extra).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></div>` : '';
  const main = (n.entries || []).filter((e) => e.section !== 'music');
  const music = (n.entries || []).filter((e) => e.section === 'music');
  return `${crumbs(rec.path, rec.section)}
    <h1 class="title">${esc(n.title)}</h1>
    <div class="meta-row">${tags}</div>
    ${n.links && n.links.length ? `<div class="meta-row">${segsHtml(n.links)}</div>` : ''}
    ${n.notes && n.notes.length ? `<div class="notes">${n.notes.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
    ${state.editing ? nodeEditorHtml(n, rec) : ''}
    ${extra}
    ${main.length ? `<div class="block"><h2>紀錄</h2><div class="card">${entriesHtml(main)}</div></div>` : ''}
    ${music.length ? `<div class="block"><h2>音樂 / OST</h2><div class="card">${entriesHtml(music)}</div></div>` : ''}
    ${n.children && n.children.length ? `<div class="block"><h2>子項目</h2>${kidsHtml(n.children)}</div>` : ''}`;
}

// ---- search
const FILTERS = [
  { key: 'm', val: 'played', label: '已玩過' }, { key: 'm', val: 'playing', label: '遊玩中' }, { key: 'm', val: 'dropped', label: '退坑' },
  { key: 'm', val: 'video', label: '看過影片' }, { key: 'm', val: 'anime', label: '看過動畫' }, { key: 'm', val: 'music', label: '聽過音樂' },
  { key: 'm', val: 'unmarked', label: '未標記影片連結' }, { key: 'm', val: 'mai', label: '舞秋風' }, { key: 'm', val: 'playlist', label: '合集' },
];

function parseQuery() {
  const qs = (location.hash.split('?')[1] || '');
  const p = new URLSearchParams(qs);
  return { q: p.get('q') || '', m: p.get('m') || '', t: p.get('t') || '', s: p.get('s') || '' };
}
function queryHash(o) {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) p.set(k, v); });
  return `#/search?${p}`;
}

function segMatch(s, m) {
  if (m === 'unmarked') return s.url && !s.mark && isVideoSite(s.url);
  if (m === 'mai') return s.channel === '舞秋風';
  if (m === 'playlist') return !!s.playlist;
  return s.mark === m;
}

function viewSearch() {
  const f = parseQuery();
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text) => terms.every((t) => text.toLowerCase().includes(t));
  const results = [];
  let count = 0;
  for (const { node, section, path } of state.idx.values()) {
    if (f.s && section !== f.s) continue;
    const pathText = path.map((x) => x.title).join(' ');
    const nodeText = `${pathText} ${(node.notes || []).join(' ')} ${plain(node.links)}`;
    const nodeHit = terms.length && hit(nodeText) && hit(`${node.title} ${(node.notes || []).join(' ')} ${plain(node.links)}`);
    const nodeMarkHit = f.m && ['played', 'playing', 'dropped'].includes(f.m) && node.status === f.m;
    const es = (node.entries || []).filter((e) => {
      if (f.t && e.type !== f.t) return false;
      if (f.m && !e.segments.some((s) => segMatch(s, f.m))) return false;
      if (!terms.length) return !!(f.m || f.t);
      return hit(`${pathText} ${plain(e.segments)} ${(e.notes || []).join(' ')}`);
    });
    const showNode = (nodeHit && !f.t && (!f.m || nodeMarkHit)) || (!terms.length && nodeMarkHit && !f.t);
    if (!es.length && !showNode) continue;
    results.push({ node, path, section, es });
    count += es.length || 1;
    if (results.length > 400) break;
  }
  const chip = (key, val, label) => {
    const on = f[key] === val;
    return `<button class="chip" aria-pressed="${on}" data-q='${esc(JSON.stringify({ ...f, [key]: on ? '' : val }))}'>${label}</button>`;
  };
  const typeChips = Object.entries(TYPE_LABEL).map(([k, v]) => chip('t', k, v)).join('');
  const secChips = SECTIONS.map((s) => chip('s', s.id, state.sections[s.id].title)).join('');
  const body = results.length ? results.map((r) => `<div class="card result-group">
      <div class="result-head"><a href="#/n/${r.node.id}">${highlight(esc(r.node.title), f.q)}</a>
        <span class="path">・${esc(state.sections[r.section].title)}${r.path.length > 1 ? ' › ' + r.path.slice(0, -1).map((x) => esc(x.title)).join(' › ') : ''}</span>
        ${r.node.status ? ` <span class="tag st-${r.node.status}">${STATUS_LABEL[r.node.status]}</span>` : ''}</div>
      ${r.es.length ? `<ul class="entries">${r.es.map((e) => `<li class="entry"><span class="etype">${esc(TYPE_LABEL[e.type] || '')}</span><div class="etext">${segsHtml(e.segments, f.q)}</div></li>`).join('')}</ul>` : '<div style="height:10px"></div>'}
    </div>`).join('') : '<p class="empty">沒有符合的結果。</p>';
  return `<h1 class="title">${f.q ? `搜尋「${esc(f.q)}」` : '篩選'}</h1>
    <div class="meta-row">${results.length} 個項目・${count} 筆</div>
    <div class="filters">${FILTERS.map((x) => chip(x.key, x.val, x.label)).join('')}</div>
    <div class="filters">${typeChips}</div>
    <div class="filters">${secChips}</div>
    ${body}`;
}

// ---- stats
function viewStats() {
  const c = { nodes: 0, entries: 0, links: 0, played: 0, playing: 0, dropped: 0, video: 0, music: 0, anime: 0, mai: 0, unmarked: 0 };
  const bySite = {}; const byType = {}; const bySource = {}; const byDecade = {}; const bySection = {};
  const statusNodes = { played: [], playing: [], dropped: [] };
  for (const { node, section } of state.idx.values()) {
    c.nodes += 1;
    bySection[section] = (bySection[section] || 0) + 1;
    if (node.status) { c[node.status] += 1; statusNodes[node.status].push(node); }
    if (node.source) bySource[node.source] = (bySource[node.source] || 0) + 1;
    if (node.release && node.release.date) {
      const y = parseInt(node.release.date.slice(0, 4), 10);
      if (y) { const d = `${Math.floor(y / 10) * 10}s`; byDecade[d] = (byDecade[d] || 0) + 1; }
    }
    const segs = [...(node.links || []), ...(node.entries || []).flatMap((e) => e.segments)];
    for (const e of node.entries || []) { c.entries += 1; byType[e.type] = (byType[e.type] || 0) + 1; }
    for (const s of segs) {
      if (s.url) { c.links += 1; const st = siteOf(s.url); bySite[st] = (bySite[st] || 0) + 1; }
      if (s.mark) c[s.mark] += 1;
      if (s.channel === '舞秋風') c.mai += 1;
      if (s.url && !s.mark && isVideoSite(s.url)) c.unmarked += 1;
    }
  }
  const tile = (n, label, href) => `<a class="card tile" ${href ? `href="${href}"` : ''} style="text-decoration:none"><b>${n}</b><span>${label}</span></a>`;
  const bars = (obj, labels = {}, hrefFn = null, limit = 12) => {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit);
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return `<div class="card bars">${rows.map(([k, v]) => `<div class="row"><span>${hrefFn ? `<a href="${hrefFn(k)}">${esc(labels[k] || k)}</a>` : esc(labels[k] || k)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><span class="num">${v}</span></div>`).join('') || '<p class="empty">尚無資料</p>'}</div>`;
  };
  const secLabels = Object.fromEntries(SECTIONS.map((s) => [s.id, state.sections[s.id].title]));
  return `<h1 class="title">統計</h1>
    <div class="stat-tiles">
      ${tile(c.nodes, '項目')}${tile(c.entries, '紀錄')}${tile(c.links, '連結')}
      ${tile(c.played, '已玩過（標記）', queryHash({ m: 'played' }))}${tile(c.playing, '遊玩中', queryHash({ m: 'playing' }))}${tile(c.dropped, '退坑', queryHash({ m: 'dropped' }))}
      ${tile(c.video, '看過的影片連結', queryHash({ m: 'video' }))}${tile(c.anime, '看過的動畫連結', queryHash({ m: 'anime' }))}${tile(c.music, '聽過的音樂連結', queryHash({ m: 'music' }))}
      ${tile(c.mai, '舞秋風影片', queryHash({ m: 'mai' }))}${tile(c.unmarked, '未標記的影片連結', queryHash({ m: 'unmarked' }))}
    </div>
    <div class="stat-grid">
      <div class="block"><h2>紀錄類型</h2>${bars(byType, TYPE_LABEL, (k) => queryHash({ t: k }))}</div>
      <div class="block"><h2>連結來源網站</h2>${bars(bySite)}</div>
      <div class="block"><h2>各區項目數</h2>${bars(bySection, secLabels, (k) => `#/s/${k}`)}</div>
      <div class="block"><h2>動漫原作媒介</h2>${bars(bySource, SOURCE_LABEL)}</div>
      <div class="block"><h2>發行年代</h2>${bars(byDecade, {}, null, 20)}<p class="help">依各項目的「發行／上映日期」統計，日期陸續補上後才會有資料。</p></div>
    </div>`;
}

// ---- channels
function viewChannels() {
  const groups = {};
  for (const ch of state.channels.channels) (groups[ch.category || '其他'] ||= []).push(ch);
  return `<h1 class="title">頻道</h1>
    <p class="help">這裡記錄常看但未訂閱的頻道（已訂閱的不在此列），以及特別標註的舞秋風。</p>
    ${state.editing ? channelEditorHtml() : ''}
    ${Object.entries(groups).map(([g, list]) => `<div class="block"><h2>${esc(g)}</h2><div class="card tbl-wrap"><table class="tbl">
      <tr><th>名稱</th><th>平台</th><th>訂閱</th><th>備註</th></tr>
      ${list.map((ch) => `<tr><td>${ch.url ? `<a class="lk" href="${esc(ch.url)}" target="_blank" rel="noopener noreferrer">${esc(ch.name)}</a>` : esc(ch.name)}${ch.name === '舞秋風' ? ` ・<a href="${queryHash({ m: 'mai' })}">看紀錄</a>` : ''}</td><td>${esc(ch.platform || '')}</td><td>${ch.subscribed ? '是' : '否'}</td><td>${esc(ch.note || '')}</td></tr>`).join('')}
    </table></div></div>`).join('')}`;
}

// ---- review
function viewReview() {
  const items = state.review.items;
  return `<h1 class="title">待確認清單</h1>
    <p class="help">從 PPT 自動轉換時，判斷不確定的地方列在這裡。檢查過、或修正後，可在編輯模式按「已處理」移除。</p>
    ${items.length ? `<div class="card tbl-wrap"><table class="tbl"><tr><th>PPT 頁</th><th>問題</th><th>項目</th>${state.editing ? '<th></th>' : ''}</tr>
    ${items.map((r) => {
      const rec = r.node && state.idx.get(r.node);
      return `<tr><td>${r.slide ?? ''}</td><td>${esc(r.issue)}${r.text ? `<br><small style="color:var(--ink-3)">${esc(r.text)}</small>` : ''}</td>
        <td>${rec ? `<a href="#/n/${r.node}">${esc(rec.node.title)}</a>` : ''}</td>${state.editing ? `<td>${reviewButtons(r)}</td>` : ''}</tr>`;
    }).join('')}</table></div>` : '<p class="empty">全部處理完了 🎉</p>'}
    ${linkReportHtml()}`;
}

function linkReportHtml() {
  const r = state.links;
  if (!r) return '<div class="block"><h2>失效連結</h2><p class="help">尚未執行過連結檢查（GitHub Actions 每月自動跑一次，也可以手動執行）。</p></div>';
  const row = (x) => `<tr><td><a class="lk" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.where[0]?.text || x.url)}</a></td><td>${x.status ?? '逾時'}</td>
    <td>${x.where.map((w) => (w.node ? `<a href="#/n/${w.node}">${esc(w.title)}</a>` : esc(w.title))).join('、')}</td></tr>`;
  return `<div class="block"><h2>失效連結（${esc(r.checked_at.slice(0, 10))} 檢查 ${r.checked} 個）</h2>
    ${r.broken.length ? `<div class="card tbl-wrap"><table class="tbl"><tr><th>連結</th><th>狀態</th><th>所在項目</th></tr>${r.broken.map(row).join('')}</table></div>` : '<p class="help">沒有發現失效連結。</p>'}
    ${r.unknown.length ? `<details style="margin-top:10px"><summary class="help">另有 ${r.unknown.length} 個連結無法確認（網站阻擋自動檢查或逾時）</summary><div class="card tbl-wrap"><table class="tbl">${r.unknown.map(row).join('')}</table></div></details>` : ''}</div>`;
}

function viewNotFound() {
  return '<h1 class="title">找不到這個項目</h1><p><a href="#/">回首頁</a></p>';
}

// ------------------------------------------------------------------ router
export function render() {
  const h = location.hash || '#/';
  const main = $('#main');
  let html;
  let after = null;
  if (h.startsWith('#/n/')) {
    const id = decodeURIComponent(h.slice(4));
    html = viewNode(id);
    after = () => state.editing && bindNodeEditor(id);
  } else if (h.startsWith('#/s/')) {
    const id = h.slice(4);
    html = viewSection(id);
    after = () => state.editing && bindSectionAdd(id);
  } else if (h.startsWith('#/search')) {
    html = viewSearch();
    $('#search-input').value = parseQuery().q;
  } else if (h.startsWith('#/stats')) html = viewStats();
  else if (h.startsWith('#/channels')) { html = viewChannels(); after = () => state.editing && bindChannelEditor(); }
  else if (h.startsWith('#/review')) { html = viewReview(); after = () => state.editing && bindReview(); }
  else html = viewHome();
  main.innerHTML = html;
  if (after) after();
  document.querySelectorAll('.toplinks a').forEach((a) => a.classList.toggle('active', h.startsWith(a.getAttribute('href'))));
  $('#review-count').textContent = state.review.items.length || '';
  renderTree($('#tree-filter').value);
  closeNav();
}

export function rerender(keepScroll = true) {
  const y = window.scrollY;
  buildIndex();
  render();
  if (keepScroll) window.scrollTo(0, y);
}

function closeNav() {
  $('#sidebar').classList.remove('open');
  $('#scrim').hidden = true;
}

function bindChrome() {
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#search-input').value.trim();
    const cur = location.hash.startsWith('#/search') ? parseQuery() : {};
    location.hash = queryHash({ ...cur, q });
  });
  $('#main').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (b) location.hash = queryHash(JSON.parse(b.dataset.q));
  });
  $('#tree').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tw]');
    if (!b) return;
    const id = b.dataset.tw;
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    store.set('el-open', [...expanded]);
    renderTree($('#tree-filter').value);
  });
  $('#tree-filter').addEventListener('input', (e) => renderTree(e.target.value));
  $('#nav-toggle').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; });
  $('#scrim').addEventListener('click', closeNav);
}

// ------------------------------------------------------------------ boot
(async function boot() {
  await setupLock();
  $('#app').hidden = false;
  $('#main').innerHTML = '<p class="empty">載入中…</p>';
  try {
    await loadAll();
  } catch (e) {
    $('#main').innerHTML = `<h1 class="title">載入失敗</h1><p>${esc(e.message)}</p>`;
    return;
  }
  bindChrome();
  initEditor();
  render();
})();
