import { state, $, esc, toast, rerender, segsHtml, githubConfig, store, sectionFile, sectionList,
  TYPE_LABEL, KIND_LABEL, STATUS_LABEL, SOURCE_LABEL } from './app.js';
import { segsToMarkup, markupToSegs } from './markup.js';
import { commitFiles } from './github.js';

// ------------------------------------------------------------------ basics
const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function serialize(path) {
  if (path === 'data/channels.json') return `${JSON.stringify(state.channels, null, 1)}\n`;
  if (path === 'data/review.json') return `${JSON.stringify(state.review, null, 1)}\n`;
  const sec = sectionList().find((s) => s.file === path);
  return `${JSON.stringify(state.sections[sec.id], null, 1)}\n`;
}

export function markDirty(path) {
  state.dirty.add(path);
  updatePending();
}

function updatePending() {
  const n = state.dirty.size;
  $('#pending-bar').hidden = n === 0;
  $('#pending-text').textContent = n ? `有 ${n} 個資料檔尚未提交：${[...state.dirty].map((p) => p.replace('data/', '')).join('、')}` : '';
}

function select(name, map, value, empty = null) {
  const opts = Object.entries(map).map(([k, v]) => `<option value="${esc(k)}"${k === value ? ' selected' : ''}>${esc(v)}</option>`).join('');
  return `<select name="${name}">${empty !== null ? `<option value="">${esc(empty)}</option>` : ''}${opts}</select>`;
}

function openDialog(html, bind) {
  const d = $('#dialog');
  d.innerHTML = html;
  d.showModal();
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  if (bind) bind(d);
  return d;
}

function confirmDialog(title, body, okLabel, onOk, danger = true) {
  openDialog(`<h3>${esc(title)}</h3><p>${body}</p><div class="btn-row">
    <button class="pill-btn ${danger ? 'danger' : 'primary'}" id="dlg-ok">${esc(okLabel)}</button>
    <button class="pill-btn" data-close>取消</button></div>`, (d) => {
    $('#dlg-ok', d).addEventListener('click', () => { d.close(); onOk(); });
  });
}

// ------------------------------------------------------------------ init
export function initEditor() {
  const btn = $('#edit-toggle');
  const setMode = (on) => {
    state.editing = on;
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '結束編輯' : '編輯';
    store.set('el-editing', on);
  };
  setMode(store.get('el-editing', false));
  btn.addEventListener('click', () => { setMode(!state.editing); rerender(); });
  $('#pending-commit').addEventListener('click', commitDialog);
  $('#pending-download').addEventListener('click', downloadDirty);
  $('#pending-discard').addEventListener('click', () => confirmDialog('放棄所有未提交的變更？', '頁面會重新載入，尚未提交的修改都會消失。', '放棄變更', () => {
    state.dirty.clear();
    location.reload();
  }));
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty.size) { e.preventDefault(); e.returnValue = ''; }
  });
  updatePending();
}

function downloadDirty() {
  for (const p of state.dirty) {
    const blob = new Blob([serialize(p)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.split('/').pop();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
}

function commitDialog() {
  const cfg = githubConfig();
  openDialog(`<h3>提交到 GitHub</h3>
    <form id="commit-form">
    <div class="fgrid">
      <label class="field">擁有者<input name="owner" value="${esc(cfg.owner)}" required></label>
      <label class="field">Repo<input name="repo" value="${esc(cfg.repo)}" required></label>
      <label class="field">分支<input name="branch" value="${esc(cfg.branch)}" required></label>
      <label class="field wide">GitHub Token（只存在這個瀏覽器）<input name="token" type="password" value="${esc(cfg.token)}" placeholder="github_pat_…" required></label>
      <label class="field wide">說明<input name="message" value="Update records via web editor"></label>
    </div>
    <p class="help">Token 請用 fine-grained token，只授權這個 repo 的 <code>Contents: Read and write</code>。詳見 README。</p>
    <p id="commit-err" class="help" style="color:var(--danger)" hidden></p>
    <div class="btn-row"><button class="pill-btn primary" type="submit" id="commit-go">提交</button><button class="pill-btn" type="button" data-close>取消</button></div>
    </form>`, (d) => {
    $('#commit-form', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const conf = { owner: f.get('owner').trim(), repo: f.get('repo').trim(), branch: f.get('branch').trim(), token: f.get('token').trim() };
      store.set('el-gh', conf);
      const go = $('#commit-go', d);
      go.disabled = true;
      go.textContent = '提交中…';
      const files = [...state.dirty].map((p) => ({ path: p, content: serialize(p) }));
      try {
        await commitFiles(conf, files, f.get('message') || 'Update records via web editor', state.original);
        files.forEach((x) => { state.original[x.path] = x.content; });
        state.dirty.clear();
        updatePending();
        d.close();
        toast('已提交。GitHub Pages 大約 1 分鐘後會更新。', 4000);
      } catch (err) {
        const el = $('#commit-err', d);
        el.hidden = false;
        el.textContent = err.message;
        go.disabled = false;
        go.textContent = '提交';
      }
    });
  });
}

// ------------------------------------------------------------------ node editor
const SECTION_LABEL = { main: '紀錄', music: '音樂' };

function entryRow(e = { id: newId('e'), section: 'main', type: 'video', segments: [] }) {
  return `<div class="e-edit" data-eid="${esc(e.id)}">
    ${select('section', SECTION_LABEL, e.section || 'main')}
    ${select('type', TYPE_LABEL, e.type || 'other')}
    <div class="e-text">
      <textarea name="markup" rows="2" aria-label="內容">${esc(segsToMarkup(e.segments))}</textarea>
      <textarea name="notes" rows="1" aria-label="備註" placeholder="備註（每行一則，可留空）">${esc((e.notes || []).join('\n'))}</textarea>
    </div>
    <div class="e-btns"><button type="button" class="pill-btn small" data-er="up" title="上移">↑</button><button type="button" class="pill-btn small" data-er="down" title="下移">↓</button><button type="button" class="pill-btn small danger" data-er="del" title="刪除">✕</button></div>
    <div class="preview">${segsHtml(e.segments)}</div>
  </div>`;
}

export function nodeEditorHtml(n) {
  const r = n.release || {};
  const extra = Object.entries(n.extra || {});
  return `<form class="edit-panel" id="node-form">
    <h3>編輯此項目</h3>
    <div class="fgrid">
      <label class="field wide">名稱<input name="title" value="${esc(n.title)}" required></label>
      <label class="field">類別${select('kind', KIND_LABEL, n.kind)}</label>
      <label class="field">個人狀態${select('status', STATUS_LABEL, n.status || '', '（無）')}</label>
      <label class="field">原作媒介${select('source', SOURCE_LABEL, n.source || '', '（無）')}</label>
      <label class="field">標籤（逗號分隔）<input name="tags" value="${esc((n.tags || []).join(', '))}"></label>
      <label class="field">發行／上映日期<input name="rdate" value="${esc(r.date || '')}" placeholder="1996、1996-10 或 1996-10-25"></label>
      <label class="field">地區<input name="rregion" value="${esc(r.region || '')}" placeholder="JP / NA / TW…"></label>
      <label class="field wide">日期資料來源（網址）<input name="rsource" value="${esc(r.source || '')}"></label>
      <label class="field wide">標題連結<textarea name="links" rows="2">${esc(segsToMarkup(n.links || []))}</textarea></label>
      <label class="field wide">備註（每行一則）<textarea name="notes" rows="2">${esc((n.notes || []).join('\n'))}</textarea></label>
      <div class="field wide">自訂欄位
        <div id="kv-rows">${extra.map(([k, v]) => kvRow(k, v)).join('')}</div>
        <div><button type="button" class="pill-btn small" data-act="add-kv">＋ 新增欄位</button></div>
      </div>
    </div>
    <h3 style="margin-top:16px">紀錄</h3>
    <div id="entry-rows">${(n.entries || []).map(entryRow).join('')}</div>
    <div class="btn-row"><button type="button" class="pill-btn" data-act="add-entry">＋ 新增紀錄</button></div>
    <p class="help">連結語法：<code>[文字](網址)</code>，加標記：<code>[文字](網址){影片}</code>。標記可用 影片／音樂／動畫／已玩／遊玩中／退坑、<code>合集</code>、<code>舞</code>（舞秋風）、<code>ch:頻道名</code>，多個用逗號分隔。沒有連結的標記文字：<code>[Shadow of Mordor]{已玩}</code>。</p>
    <p id="node-err" class="help" style="color:var(--danger)" hidden></p>
    <div class="btn-row">
      <button type="submit" class="pill-btn primary">套用變更</button>
      <button type="button" class="pill-btn" data-act="cancel">還原</button>
      <span style="flex:1"></span>
      <button type="button" class="pill-btn" data-act="add-child">＋ 子項目</button>
      <button type="button" class="pill-btn" data-act="move">移動到…</button>
      <button type="button" class="pill-btn" data-act="up">上移</button>
      <button type="button" class="pill-btn" data-act="down">下移</button>
      <button type="button" class="pill-btn danger" data-act="delete">刪除</button>
    </div>
  </form>`;
}

function kvRow(k = '', v = '') {
  return `<div class="kv-row"><input name="kk" value="${esc(k)}" placeholder="欄位名稱"><input name="kv" value="${esc(v)}" placeholder="內容"><button type="button" class="pill-btn small danger" data-kv-del>✕</button></div>`;
}

function siblingsOf(id) {
  const rec = state.idx.get(id);
  return rec.parent ? rec.parent.children : state.sections[rec.section].nodes;
}

export function bindNodeEditor(id) {
  const rec = state.idx.get(id);
  if (!rec) return;
  const n = rec.node;
  const form = $('#node-form');
  const file = sectionFile(rec.section);

  form.addEventListener('input', (e) => {
    const row = e.target.closest('.e-edit');
    if (row && e.target.name === 'markup') {
      const { segs, errors } = markupToSegs(e.target.value);
      row.querySelector('.preview').innerHTML = segsHtml(segs) + (errors.length ? `<br><span style="color:var(--danger)">${errors.map(esc).join('；')}</span>` : '');
    }
  });

  form.addEventListener('click', (e) => {
    const er = e.target.closest('[data-er]');
    if (er) {
      const row = er.closest('.e-edit');
      if (er.dataset.er === 'del') row.remove();
      if (er.dataset.er === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      if (er.dataset.er === 'down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      return;
    }
    if (e.target.closest('[data-kv-del]')) { e.target.closest('.kv-row').remove(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'add-entry') {
      const last = n.entries && n.entries.length ? n.entries[n.entries.length - 1] : null;
      $('#entry-rows').insertAdjacentHTML('beforeend', entryRow({ id: newId('e'), section: last ? last.section : 'main', type: last ? last.type : 'video', segments: [] }));
      $('#entry-rows').lastElementChild.querySelector('textarea').focus();
    }
    if (act === 'add-kv') $('#kv-rows').insertAdjacentHTML('beforeend', kvRow());
    if (act === 'cancel') rerender();
    if (act === 'up' || act === 'down') {
      const sib = siblingsOf(id);
      const i = sib.indexOf(n);
      const j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= sib.length) return;
      [sib[i], sib[j]] = [sib[j], sib[i]];
      markDirty(file);
      rerender();
      toast(act === 'up' ? '已上移' : '已下移');
    }
    if (act === 'delete') {
      const kids = n.children ? n.children.length : 0;
      confirmDialog(`刪除「${n.title}」？`, kids ? `底下的 ${kids} 個子項目也會一起刪除。` : '這個項目的所有紀錄都會刪除。', '刪除', () => {
        const sib = siblingsOf(id);
        sib.splice(sib.indexOf(n), 1);
        if (rec.parent && !rec.parent.children.length) delete rec.parent.children;
        markDirty(file);
        location.hash = rec.parent ? `#/n/${rec.parent.id}` : `#/s/${rec.section}`;
        rerender(false);
      });
    }
    if (act === 'add-child') addNodeDialog((child) => {
      (n.children ||= []).push(child);
      markDirty(file);
      location.hash = `#/n/${child.id}`;
      rerender(false);
    });
    if (act === 'move') moveDialog(id);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const errs = [];
    const title = f.get('title').trim();
    if (!title) errs.push('名稱不能空白');
    const links = markupToSegs(f.get('links'));
    errs.push(...links.errors.map((x) => `標題連結：${x}`));
    const entries = [];
    form.querySelectorAll('.e-edit').forEach((row, i) => {
      const md = row.querySelector('[name=markup]').value.trim();
      const { segs, errors } = markupToSegs(md);
      errs.push(...errors.map((x) => `第 ${i + 1} 筆紀錄：${x}`));
      if (!md) return;
      const old = (n.entries || []).find((x) => x.id === row.dataset.eid) || {};
      const notes = row.querySelector('[name=notes]').value.split('\n').map((x) => x.trim()).filter(Boolean);
      const ent = { ...old, id: row.dataset.eid, section: row.querySelector('[name=section]').value, type: row.querySelector('[name=type]').value, segments: segs };
      if (notes.length) ent.notes = notes; else delete ent.notes;
      entries.push(ent);
    });
    const rdate = f.get('rdate').trim();
    if (rdate && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(rdate)) errs.push('日期格式請用 YYYY、YYYY-MM 或 YYYY-MM-DD');
    if (errs.length) {
      const el = $('#node-err');
      el.hidden = false;
      el.textContent = errs.join('；');
      return;
    }
    n.title = title;
    n.kind = f.get('kind');
    const setOpt = (k, v) => { if (v) n[k] = v; else delete n[k]; };
    setOpt('status', f.get('status'));
    setOpt('source', f.get('source'));
    const tags = f.get('tags').split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    setOpt('tags', tags.length ? tags : null);
    if (rdate) {
      n.release = { date: rdate, precision: rdate.length === 4 ? 'year' : rdate.length === 7 ? 'month' : 'day' };
      if (f.get('rregion').trim()) n.release.region = f.get('rregion').trim();
      if (f.get('rsource').trim()) n.release.source = f.get('rsource').trim();
    } else delete n.release;
    setOpt('links', links.segs.length ? links.segs : null);
    const notes = f.get('notes').split('\n').map((x) => x.trim()).filter(Boolean);
    setOpt('notes', notes.length ? notes : null);
    const extra = {};
    form.querySelectorAll('.kv-row').forEach((r) => {
      const k = r.querySelector('[name=kk]').value.trim();
      if (k) extra[k] = r.querySelector('[name=kv]').value.trim();
    });
    setOpt('extra', Object.keys(extra).length ? extra : null);
    setOpt('entries', entries.length ? entries : null);
    markDirty(file);
    rerender();
    toast('已套用（記得提交到 GitHub）');
  });
}

function addNodeDialog(onCreate) {
  openDialog(`<h3>新增項目</h3><form id="add-form"><div class="fgrid">
      <label class="field wide">名稱<input name="title" required autofocus></label>
      <label class="field">類別${select('kind', KIND_LABEL, 'work')}</label>
      <label class="field">個人狀態${select('status', STATUS_LABEL, '', '（無）')}</label>
    </div><div class="btn-row"><button class="pill-btn primary" type="submit">新增</button><button class="pill-btn" type="button" data-close>取消</button></div></form>`, (d) => {
    $('#add-form', d).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const node = { id: newId('n'), kind: f.get('kind'), title: f.get('title').trim() };
      if (f.get('status')) node.status = f.get('status');
      d.close();
      onCreate(node);
    });
  });
}

function moveDialog(id) {
  const rec = state.idx.get(id);
  const forbidden = new Set();
  const mark = (x) => { forbidden.add(x.id); (x.children || []).forEach(mark); };
  mark(rec.node);
  const options = [];
  for (const s of sectionList()) options.push({ id: `sec:${s.id}`, label: `【${state.sections[s.id].title}】最上層` });
  for (const [nid, r] of state.idx) {
    if (forbidden.has(nid)) continue;
    options.push({ id: nid, label: `${state.sections[r.section].title} › ${r.path.map((x) => x.title).join(' › ')}` });
  }
  const list = (q) => options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 60)
    .map((o) => `<button type="button" class="pill-btn small" style="display:block;width:100%;text-align:left;margin:3px 0;border-radius:8px" data-to="${esc(o.id)}">${esc(o.label)}</button>`).join('');
  openDialog(`<h3>把「${esc(rec.node.title)}」移動到…</h3>
    <input id="mv-q" class="tree-filter" placeholder="搜尋目標位置" autofocus>
    <div id="mv-list" style="max-height:50vh;overflow:auto">${list('')}</div>
    <div class="btn-row"><button class="pill-btn" data-close>取消</button></div>`, (d) => {
    $('#mv-q', d).addEventListener('input', (e) => { $('#mv-list', d).innerHTML = list(e.target.value); });
    $('#mv-list', d).addEventListener('click', (e) => {
      const b = e.target.closest('[data-to]');
      if (!b) return;
      const to = b.dataset.to;
      const sib = siblingsOf(id);
      sib.splice(sib.indexOf(rec.node), 1);
      if (rec.parent && !rec.parent.children.length) delete rec.parent.children;
      markDirty(sectionFile(rec.section));
      if (to.startsWith('sec:')) {
        const sid = to.slice(4);
        state.sections[sid].nodes.push(rec.node);
        markDirty(sectionFile(sid));
      } else {
        const target = state.idx.get(to);
        (target.node.children ||= []).push(rec.node);
        markDirty(sectionFile(target.section));
      }
      d.close();
      rerender();
      toast('已移動');
    });
  });
}

// ------------------------------------------------------------------ section root add
export function sectionAddHtml() {
  return '<div class="edit-panel"><button class="pill-btn" id="sec-add">＋ 新增最上層項目</button></div>';
}
export function bindSectionAdd(sid) {
  const b = $('#sec-add');
  if (!b) return;
  b.addEventListener('click', () => addNodeDialog((node) => {
    state.sections[sid].nodes.push(node);
    markDirty(sectionFile(sid));
    location.hash = `#/n/${node.id}`;
    rerender(false);
  }));
}

// ------------------------------------------------------------------ channels
function chRow(c = { id: newId('c'), name: '', url: '', category: '', platform: 'youtube', subscribed: false, note: '' }) {
  return `<tr data-cid="${esc(c.id)}">
    <td><input name="name" value="${esc(c.name)}" style="width:100%"></td>
    <td><input name="url" value="${esc(c.url)}" style="width:100%"></td>
    <td><input name="category" value="${esc(c.category || '')}" style="width:100%"></td>
    <td><input name="platform" value="${esc(c.platform || '')}" style="width:90px"></td>
    <td><input name="subscribed" type="checkbox"${c.subscribed ? ' checked' : ''}></td>
    <td><input name="note" value="${esc(c.note || '')}" style="width:100%"></td>
    <td><button type="button" class="pill-btn small danger" data-ch-del>✕</button></td></tr>`;
}
export function channelEditorHtml() {
  return `<form class="edit-panel" id="ch-form"><h3>編輯頻道</h3><div class="tbl-wrap"><table class="tbl" id="ch-table">
    <tr><th>名稱</th><th>網址</th><th>分類</th><th>平台</th><th>訂閱</th><th>備註</th><th></th></tr>
    ${state.channels.channels.map(chRow).join('')}</table></div>
    <div class="btn-row"><button type="button" class="pill-btn" id="ch-add">＋ 新增頻道</button><button type="submit" class="pill-btn primary">套用變更</button></div></form>`;
}
export function bindChannelEditor() {
  const form = $('#ch-form');
  if (!form) return;
  $('#ch-add').addEventListener('click', () => $('#ch-table').insertAdjacentHTML('beforeend', chRow()));
  form.addEventListener('click', (e) => { if (e.target.closest('[data-ch-del]')) e.target.closest('tr').remove(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const rows = [...form.querySelectorAll('tr[data-cid]')];
    state.channels.channels = rows.map((r) => {
      const v = (k) => r.querySelector(`[name=${k}]`).value.trim();
      const old = state.channels.channels.find((c) => c.id === r.dataset.cid) || {};
      const c = { ...old, id: r.dataset.cid, name: v('name'), url: v('url'), category: v('category'), platform: v('platform'), subscribed: r.querySelector('[name=subscribed]').checked };
      if (v('note')) c.note = v('note'); else delete c.note;
      return c;
    }).filter((c) => c.name);
    markDirty('data/channels.json');
    rerender();
    toast('已套用（記得提交到 GitHub）');
  });
}

// ------------------------------------------------------------------ review
export function reviewButtons(r) {
  return `<button class="pill-btn small" data-resolve="${esc(r.id)}">已處理</button>`;
}
let reviewBound = false;
export function bindReview() {
  if (reviewBound) return;
  reviewBound = true;
  $('#main').addEventListener('click', (e) => {
    const b = e.target.closest('[data-resolve]');
    if (!b) return;
    state.review.items = state.review.items.filter((x) => x.id !== b.dataset.resolve);
    markDirty('data/review.json');
    rerender();
  });
}
