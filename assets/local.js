// 本機資料夾模式：資料以電腦上的 JSON 檔為主，GitHub 只是偶爾上傳的備份。
// 使用 File System Access API（電腦版 Chrome / Edge）。
//
// 同步規則：資料夾裡的 _sync.json 記錄「上次和 GitHub 一致時」每個檔案的 git blob sha（base）。
//   本機 ≠ base、GitHub = base → 本機較新（可上傳）
//   本機 = base、GitHub ≠ base → GitHub 較新（可下載，例如另一台電腦或 Claude 改的）
//   兩邊都 ≠ base            → 衝突，由使用者選擇保留哪一邊，另一邊先備份到 _backups/
import { state, $, esc, toast, githubConfig, store, dataPaths } from './app.js';
import { openDialog, confirmDialog } from './editor.js';
import { readFile, listDir, commitFiles } from './github.js';

const SYNC_FILE = '_sync.json';
const BACKUP_DIR = '_backups';
const nameOf = (path) => path.split('/').pop();

export const local = {
  supported: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
  handle: null,   // FileSystemDirectoryHandle
  mode: 'none',   // 'none'（沒設定）| 'local'（使用中）| 'readonly'（有設定但這次只看 GitHub）
  sync: { base: {} },
  localSha: {},   // path -> sha
  remoteSha: null, // path -> sha；null = 還沒檢查或檢查失敗
  remoteErr: '',
  checkedAt: 0,
  writing: new Map(), // path -> Promise
  failed: new Set(),
};
export const isLocal = () => local.mode === 'local';

// ------------------------------------------------------------------ IndexedDB（只存資料夾的 handle）
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('entertainment-log', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function kv(method, key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', method === 'get' ? 'readonly' : 'readwrite');
    const st = tx.objectStore('kv');
    const r = method === 'get' ? st.get(key) : method === 'put' ? st.put(value, key) : st.delete(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// ------------------------------------------------------------------ 檔案工具
export const norm = (t) => t.replace(/^﻿/, '').replace(/\r\n/g, '\n');

async function gitSha(text) {
  const enc = new TextEncoder();
  const body = enc.encode(text);
  const head = enc.encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(head.length + body.length);
  buf.set(head);
  buf.set(body, head.length);
  const h = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readName(dir, name) {
  try {
    const fh = await dir.getFileHandle(name);
    return norm(await (await fh.getFile()).text());
  } catch (e) {
    if (e.name === 'NotFoundError') return null;
    throw e;
  }
}
async function writeName(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); // 寫到暫存檔，close() 時才取代原檔
  await w.write(text);
  await w.close();
}

export async function localText(path) {
  const t = await readName(local.handle, nameOf(path));
  if (t === null) throw new Error(`本機資料夾裡找不到 ${nameOf(path)}`);
  local.localSha[path] = await gitSha(t);
  try { JSON.parse(t); } catch (e) {
    const err = new Error(`本機的 ${nameOf(path)} 不是有效的 JSON（${e.message}）。`);
    err.localPath = path;
    throw err;
  }
  return t;
}

async function backup(path, text, tag) {
  const dir = await local.handle.getDirectoryHandle(BACKUP_DIR, { create: true });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const name = `${stamp}-${tag}-${nameOf(path)}`;
  await writeName(dir, name, text);
  return `${BACKUP_DIR}/${name}`;
}

async function loadSync() {
  const t = await readName(local.handle, SYNC_FILE);
  try { local.sync = t ? { base: {}, ...JSON.parse(t) } : { base: {} }; } catch { local.sync = { base: {} }; }
}
async function saveSync() {
  local.sync.note = '網頁用來判斷本機和 GitHub 哪一邊比較新，請不要手動修改。';
  await writeName(local.handle, SYNC_FILE, `${JSON.stringify(local.sync, null, 1)}\n`);
}

// ------------------------------------------------------------------ GitHub 端
async function remoteText(path) {
  const cfg = githubConfig();
  try { return norm(await readFile(cfg, path)); } catch (e) {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw e;
    return norm(await res.text());
  }
}

export async function checkRemote() {
  const cfg = githubConfig();
  try {
    const list = await listDir(cfg, 'data');
    const m = {};
    for (const f of list) m[f.path] = f.sha;
    local.remoteSha = m;
    local.remoteErr = '';
    // 沒有 base 但兩邊一樣 → 直接視為已同步
    let changed = false;
    for (const p of dataPaths()) {
      if (!local.sync.base[p] && m[p] && m[p] === local.localSha[p]) { local.sync.base[p] = m[p]; changed = true; }
    }
    if (changed) await saveSync();
  } catch (e) {
    local.remoteSha = null;
    local.remoteErr = e.message;
  }
  local.checkedAt = Date.now();
  renderBar();
}

/** 每個檔案的狀態：same | local | remote | conflict | unknown */
export function fileStates() {
  return dataPaths().map((path) => {
    const l = local.localSha[path];
    const b = local.sync.base[path];
    const r = local.remoteSha ? local.remoteSha[path] : undefined;
    let st;
    if (!local.remoteSha) st = l && b && l !== b ? 'local' : 'unknown';
    else if (l === r) st = 'same';
    else if (!b) st = 'conflict';
    else if (l !== b && r === b) st = 'local';
    else if (l === b && r !== b) st = 'remote';
    else st = 'conflict';
    return { path, name: nameOf(path), state: st };
  });
}

// ------------------------------------------------------------------ 開機
/** 回傳 'none' | 'local' | 'prompt'（有設定資料夾，但需要使用者按一下重新授權） */
export async function localBoot() {
  if (!local.supported) return 'none';
  try { local.handle = (await kv('get', 'dir')) || null; } catch { local.handle = null; }
  if (!local.handle) return 'none';
  const perm = await local.handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') { local.mode = 'local'; await loadSync(); return 'local'; }
  return 'prompt';
}

/** 授權畫面：回傳 'local' 或 'readonly' */
export function askReconnect() {
  const main = $('#main');
  main.innerHTML = `<div class="local-card">
    <h1 class="title">開啟本機資料夾</h1>
    <p>資料存在你電腦上的資料夾「<b>${esc(local.handle.name)}</b>」。瀏覽器需要你按一下才能讀寫它。</p>
    <p class="help">在 Chrome / Edge 的授權視窗選「每次造訪都允許」，之後就不用再按。</p>
    <div class="btn-row"><button class="pill-btn primary" id="lc-open">開啟本機資料夾</button>
    <button class="pill-btn" id="lc-ro">這次只看 GitHub 版本（唯讀）</button></div></div>`;
  return new Promise((resolve) => {
    $('#lc-open').addEventListener('click', async () => {
      try {
        if (await local.handle.requestPermission({ mode: 'readwrite' }) === 'granted') {
          local.mode = 'local';
          await loadSync();
          resolve('local');
          return;
        }
      } catch (e) { console.warn(e); }
      toast('沒有取得資料夾權限');
    });
    $('#lc-ro').addEventListener('click', () => { local.mode = 'readonly'; resolve('readonly'); });
  });
}

let reloadData = null; // 由 app.js 提供：重新讀資料並重畫

export function initLocalUi(reload) {
  reloadData = reload;
  const btn = $('#local-toggle');
  if (!local.supported) return;
  btn.hidden = false;
  btn.textContent = isLocal() ? `本機：${local.handle.name}` : '本機資料夾';
  btn.setAttribute('aria-pressed', String(isLocal()));
  btn.addEventListener('click', openPanel);
  window.addEventListener('beforeunload', (e) => {
    if (local.writing.size || local.failed.size) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => {
    if (isLocal() && document.visibilityState === 'visible' && Date.now() - local.checkedAt > 5 * 60 * 1000) checkRemote();
  });
  renderBar();
  if (isLocal()) checkRemote();
}

// ------------------------------------------------------------------ 儲存（每次「套用變更」都會呼叫）
export function saveLocal(path, text) {
  const prev = local.writing.get(path) || Promise.resolve();
  const job = prev.then(async () => {
    await writeName(local.handle, nameOf(path), text);
    local.localSha[path] = await gitSha(text);
    state.original[path] = text;
    local.failed.delete(path);
  }).catch((e) => {
    local.failed.add(path);
    openDialog(`<h3>存檔失敗</h3><p>${esc(nameOf(path))} 沒有寫進本機資料夾：${esc(e.message)}</p>
      <p class="help">請先不要關閉頁面。可以按「重試」，或用下方按鈕把目前的內容另存下來。</p>
      <div class="btn-row"><button class="pill-btn primary" id="sv-retry">重試</button><button class="pill-btn" id="sv-dl">下載這個檔案</button><button class="pill-btn" data-close>關閉</button></div>`, (d) => {
      $('#sv-retry', d).addEventListener('click', () => { d.close(); saveLocal(path, text); });
      $('#sv-dl', d).addEventListener('click', () => downloadText(nameOf(path), text));
    });
  }).finally(() => {
    if (local.writing.get(path) === job) local.writing.delete(path);
    renderBar();
  });
  local.writing.set(path, job);
  renderBar();
  return job;
}

function downloadText(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ------------------------------------------------------------------ 提示列
function ago(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}

export function renderBar() {
  const bar = $('#local-bar');
  if (!bar) return;
  if (local.mode === 'readonly') {
    bar.hidden = false;
    bar.className = 'pending-bar local-bar';
    $('#local-text').textContent = `目前顯示 GitHub 版本（唯讀），可能比本機資料夾「${local.handle.name}」舊。`;
    $('#local-btns').innerHTML = '<button class="pill-btn primary" data-lb="reload">開啟本機資料夾</button>';
  } else if (isLocal()) {
    const fs = fileStates();
    const pick = (s) => fs.filter((f) => f.state === s).map((f) => f.name);
    const loc = pick('local'); const rem = pick('remote'); const con = pick('conflict');
    const parts = [];
    let cls = '';
    if (local.writing.size) parts.push('儲存中…');
    if (local.failed.size) { parts.push(`存檔失敗：${[...local.failed].map(nameOf).join('、')}`); cls = ' warn'; }
    if (con.length) { parts.push(`本機和 GitHub 都改過：${con.join('、')}，請按「詳細」選擇要保留哪一邊`); cls = ' warn'; }
    if (rem.length) { parts.push(`GitHub 上有比較新的版本：${rem.join('、')}（可能是另一台電腦或 Claude 改的）`); cls = cls || ' warn'; }
    if (loc.length) parts.push(`已存到本機，${loc.length} 個檔案還沒上傳到 GitHub：${loc.join('、')}`);
    if (!local.remoteSha && local.remoteErr) parts.push('目前無法檢查 GitHub');
    bar.hidden = parts.length === 0;
    bar.className = `pending-bar local-bar${cls}`;
    const last = local.sync.lastUpload ? `・上次上傳 ${ago(local.sync.lastUpload)}` : '';
    $('#local-text').textContent = parts.join('；') + (loc.length ? last : '');
    $('#local-btns').innerHTML = [
      rem.length ? '<button class="pill-btn primary" data-lb="pull">從 GitHub 更新</button>' : '',
      loc.length && !con.length ? `<button class="pill-btn${rem.length ? '' : ' primary'}" data-lb="upload">上傳到 GitHub</button>` : '',
      '<button class="pill-btn" data-lb="panel">詳細</button>',
    ].join('');
  } else {
    bar.hidden = true;
  }
  bar.querySelectorAll('[data-lb]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.lb;
    if (a === 'reload') location.reload();
    else if (a === 'pull') pull();
    else if (a === 'upload') uploadDialog();
    else openPanel();
  }));
  const btn = $('#local-toggle');
  if (btn && isLocal()) btn.textContent = `本機：${local.handle.name}`;
}

// ------------------------------------------------------------------ 動作
async function afterDataChange() {
  if (reloadData) await reloadData();
  else location.reload();
  renderBar();
}

async function pull(only = null) {
  await checkRemote();
  const targets = fileStates().filter((f) => f.state === 'remote' && (!only || only.includes(f.path)));
  if (!targets.length) { toast('沒有需要從 GitHub 更新的檔案'); return; }
  try {
    for (const f of targets) {
      const t = await remoteText(f.path);
      const sha = await gitSha(t);
      if (sha !== local.remoteSha[f.path]) throw new Error('GitHub 的檔案還在更新中，請過一分鐘再試');
      await writeName(local.handle, f.name, t);
      local.localSha[f.path] = sha;
      local.sync.base[f.path] = sha;
    }
    local.sync.lastDownload = Date.now();
    await saveSync();
    await afterDataChange();
    toast(`已從 GitHub 更新：${targets.map((f) => f.name).join('、')}`, 4000);
  } catch (e) {
    toast(`更新失敗：${e.message}`, 5000);
  }
}

/** 本機檔案壞掉時：先備份本機檔，再換成 GitHub 版本 */
export async function restoreFromGitHub(path) {
  const lt = await readName(local.handle, nameOf(path));
  const where = lt !== null ? await backup(path, lt, 'broken') : '';
  const rt = await remoteText(path);
  await writeName(local.handle, nameOf(path), rt);
  local.sync.base[path] = await gitSha(rt);
  await saveSync();
  return where;
}

/** 衝突處理：keep = 'local' 或 'remote'。被放棄的那一邊先備份到 _backups/。 */
async function resolveConflict(path, keep) {
  const rt = await remoteText(path);
  const rsha = await gitSha(rt);
  if (keep === 'local') {
    const where = await backup(path, rt, 'github');
    local.sync.base[path] = rsha; // 之後就會變成「本機較新」，上傳時覆蓋 GitHub
    await saveSync();
    toast(`GitHub 版本已備份到 ${where}，請再按「上傳到 GitHub」`, 5000);
    renderBar();
  } else {
    const lt = await readName(local.handle, nameOf(path));
    let where = '';
    if (lt !== null) where = await backup(path, lt, 'local');
    await writeName(local.handle, nameOf(path), rt);
    local.localSha[path] = rsha;
    local.sync.base[path] = rsha;
    await saveSync();
    await afterDataChange();
    toast(where ? `本機版本已備份到 ${where}` : '已改用 GitHub 版本', 5000);
  }
}

function uploadDialog() {
  const cfg = githubConfig();
  const files = fileStates().filter((f) => f.state === 'local');
  if (!files.length) { toast('沒有需要上傳的檔案'); return; }
  openDialog(`<h3>上傳到 GitHub</h3>
    <form id="up-form">
    <p>會把 ${files.map((f) => `<code>${esc(f.name)}</code>`).join('、')} 一次提交到 GitHub 當作備份。</p>
    <div class="fgrid">
      <label class="field wide">GitHub Token（只存在這個瀏覽器）<input name="token" type="password" value="${esc(cfg.token)}" placeholder="github_pat_…" required></label>
      <label class="field wide">說明<input name="message" value="Sync records from local folder"></label>
    </div>
    <p class="help">每台電腦第一次上傳時要貼一次 token，做法見 README。</p>
    <p id="up-err" class="help" style="color:var(--danger)" hidden></p>
    <div class="btn-row"><button class="pill-btn primary" type="submit" id="up-go">上傳</button><button class="pill-btn" type="button" data-close>取消</button></div>
    </form>`, (d) => {
    $('#up-form', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const conf = { ...cfg, token: f.get('token').trim() };
      store.set('el-gh', { owner: conf.owner, repo: conf.repo, branch: conf.branch, token: conf.token });
      const go = $('#up-go', d);
      const err = $('#up-err', d);
      go.disabled = true;
      go.textContent = '上傳中…';
      try {
        await Promise.all(local.writing.values());
        await checkRemote();
        if (!local.remoteSha) throw new Error(`無法連到 GitHub：${local.remoteErr}`);
        const st = fileStates();
        const bad = st.filter((x) => x.state === 'conflict' || x.state === 'remote');
        const up = st.filter((x) => x.state === 'local');
        if (bad.some((x) => x.state === 'conflict')) throw new Error('有檔案兩邊都改過，請先到「詳細」處理');
        if (!up.length) throw new Error('沒有需要上傳的檔案');
        const payload = [];
        for (const x of up) {
          const t = await readName(local.handle, x.name);
          JSON.parse(t);
          payload.push({ path: x.path, content: t, sha: await gitSha(t) });
        }
        await commitFiles(conf, payload.map(({ path, content }) => ({ path, content })), f.get('message') || 'Sync records from local folder');
        for (const x of payload) { local.sync.base[x.path] = x.sha; local.remoteSha[x.path] = x.sha; local.localSha[x.path] = x.sha; }
        local.sync.lastUpload = Date.now();
        await saveSync();
        d.close();
        renderBar();
        toast(`已上傳 ${payload.length} 個檔案。GitHub Pages 大約 1 分鐘後更新。${bad.length ? `（${bad.map((x) => x.name).join('、')} 在 GitHub 上比較新，沒有上傳）` : ''}`, 5000);
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
        go.disabled = false;
        go.textContent = '上傳';
      }
    });
  });
}

const STATE_LABEL = {
  same: '與 GitHub 相同', local: '本機較新（未上傳）', remote: 'GitHub 較新', conflict: '兩邊都改過', unknown: '未知（無法檢查 GitHub）',
};

async function connectFolder() {
  let dir;
  try { dir = await window.showDirectoryPicker({ id: 'entertainment-log', mode: 'readwrite' }); } catch { return; }
  // 選到整個 repo 的話，改用裡面的 data/
  if (await readName(dir, 'games.json') === null) {
    try {
      const sub = await dir.getDirectoryHandle('data');
      if (await readName(sub, 'games.json') !== null) dir = sub;
    } catch { /* 沒有 data/ */ }
  }
  const prevHandle = local.handle;
  local.handle = dir;
  const missing = [];
  for (const p of dataPaths()) if (await readName(dir, nameOf(p)) === null) missing.push(p);
  const finish = async () => {
    try {
      await loadSync();
      for (const p of missing) {
        const t = await remoteText(p);
        await writeName(dir, nameOf(p), t);
        local.sync.base[p] = await gitSha(t);
      }
      if (missing.length) { local.sync.lastDownload = Date.now(); await saveSync(); }
      await kv('put', 'dir', dir);
      toast(missing.length ? `已把 ${missing.length} 個檔案從 GitHub 下載到「${dir.name}」` : `已連結「${dir.name}」`, 4000);
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      local.handle = prevHandle;
      toast(`連結失敗：${e.message}`, 5000);
    }
  };
  if (missing.length === dataPaths().length) {
    confirmDialog(`「${dir.name}」裡還沒有資料`, '要從 GitHub 下載目前的全部資料到這個資料夾，之後就以這裡的檔案為主嗎？', '下載並使用', finish, false);
  } else if (missing.length) {
    confirmDialog(`「${dir.name}」少了 ${missing.length} 個檔案`, `${missing.map((p) => `<code>${esc(nameOf(p))}</code>`).join('、')} 會從 GitHub 下載補上，其他檔案維持本機的內容。`, '補上並使用', finish, false);
  } else {
    finish();
  }
}

function disconnect() {
  const dirty = isLocal() && fileStates().some((f) => f.state === 'local' || f.state === 'conflict');
  confirmDialog('中斷本機資料夾？', `${dirty ? '<b>還有修改沒上傳到 GitHub。</b>' : ''}資料夾裡的檔案不會被刪除；這個瀏覽器之後會改回讀 GitHub 版本，可以隨時重新連結。`, '中斷連結', async () => {
    await kv('del', 'dir');
    location.reload();
  });
}

export async function openPanel() {
  if (!local.supported) {
    openDialog('<h3>本機資料夾</h3><p>這個瀏覽器不支援直接讀寫電腦上的資料夾，請用電腦版 Chrome 或 Edge。</p><div class="btn-row"><button class="pill-btn" data-close>關閉</button></div>');
    return;
  }
  if (!isLocal()) {
    const ro = local.mode === 'readonly';
    openDialog(`<h3>本機資料夾</h3>
      <p>把資料存在電腦上的一個資料夾，網頁直接讀寫那裡的 JSON。每次修改會自動存檔，不用每次都提交；GitHub 變成偶爾上傳的備份。</p>
      <ul class="help-list">
        <li>可以選一個空資料夾，網頁會先從 GitHub 下載目前的資料。</li>
        <li>建議放在 OneDrive／Google Drive 等雲端同步資料夾，個人電腦和實驗室電腦就會是同一份。</li>
        <li>手機和沒有連結資料夾的瀏覽器會看到 GitHub 上的版本。</li>
      </ul>
      <div class="btn-row">${ro ? '<button class="pill-btn primary" id="lp-re">開啟「' + esc(local.handle.name) + '」</button>' : ''}
      <button class="pill-btn${ro ? '' : ' primary'}" id="lp-pick">${ro ? '改選其他資料夾' : '選擇資料夾'}</button>
      ${ro ? '<button class="pill-btn danger" id="lp-off">中斷連結</button>' : ''}
      <button class="pill-btn" data-close>取消</button></div>`, (d) => {
      $('#lp-pick', d).addEventListener('click', () => { d.close(); connectFolder(); });
      const re = $('#lp-re', d);
      if (re) re.addEventListener('click', () => location.reload());
      const off = $('#lp-off', d);
      if (off) off.addEventListener('click', () => { d.close(); disconnect(); });
    });
    return;
  }
  await checkRemote();
  const fs = fileStates();
  const rows = fs.map((f) => `<tr><td><code>${esc(f.name)}</code></td><td class="st-${f.state}">${STATE_LABEL[f.state]}</td><td>${f.state === 'conflict'
    ? `<button class="pill-btn small" data-cf="local" data-p="${esc(f.path)}">用本機版本</button> <button class="pill-btn small" data-cf="remote" data-p="${esc(f.path)}">用 GitHub 版本</button>`
    : f.state === 'remote' ? `<button class="pill-btn small" data-pl="${esc(f.path)}">從 GitHub 更新</button>` : ''}</td></tr>`).join('');
  const any = (s) => fs.some((f) => f.state === s);
  openDialog(`<h3>本機資料夾：${esc(local.handle.name)}</h3>
    <table class="sync-table"><tbody>${rows}</tbody></table>
    ${local.remoteErr ? `<p class="help" style="color:var(--danger)">無法檢查 GitHub：${esc(local.remoteErr)}</p>` : ''}
    ${any('conflict') ? '<p class="help">「兩邊都改過」：通常是在另一台電腦改過又上傳了，這台也有沒上傳的修改。選擇要保留的一邊，另一邊會先備份到資料夾裡的 <code>_backups/</code>。</p>' : ''}
    <p class="help">上次上傳：${local.sync.lastUpload ? ago(local.sync.lastUpload) : '還沒有'}・上次從 GitHub 下載：${local.sync.lastDownload ? ago(local.sync.lastDownload) : '還沒有'}</p>
    <div class="btn-row">
      ${any('local') && !any('conflict') ? '<button class="pill-btn primary" id="lp-up">上傳到 GitHub</button>' : ''}
      <button class="pill-btn" id="lp-pick">改選其他資料夾</button>
      <button class="pill-btn danger" id="lp-off">中斷連結</button>
      <button class="pill-btn" data-close>關閉</button></div>`, (d) => {
    const up = $('#lp-up', d);
    if (up) up.addEventListener('click', () => { d.close(); uploadDialog(); });
    $('#lp-pick', d).addEventListener('click', () => { d.close(); connectFolder(); });
    $('#lp-off', d).addEventListener('click', () => { d.close(); disconnect(); });
    d.querySelectorAll('[data-pl]').forEach((b) => b.addEventListener('click', () => { d.close(); pull([b.dataset.pl]); }));
    d.querySelectorAll('[data-cf]').forEach((b) => b.addEventListener('click', () => {
      const keep = b.dataset.cf;
      const name = nameOf(b.dataset.p);
      d.close();
      confirmDialog(keep === 'local' ? `保留本機的 ${name}？` : `改用 GitHub 的 ${name}？`,
        keep === 'local' ? 'GitHub 上的版本會先備份到 <code>_backups/</code>，下次上傳時會被本機版本取代。' : '本機的版本會先備份到 <code>_backups/</code>，然後換成 GitHub 的版本。',
        '確定', () => resolveConflict(b.dataset.p, keep).catch((e) => toast(`失敗：${e.message}`, 5000)), false);
    }));
  });
}
