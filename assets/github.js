// Minimal GitHub REST helpers: read files fresh and commit several files in one commit.

const API = 'https://api.github.com';

function headers(token, raw = false) {
  const h = { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh(cfg, method, path, body) {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}${path}`, {
    method,
    headers: { ...headers(cfg.token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg += ` ${(await res.json()).message}`; } catch { /* ignore */ }
    throw new Error(`GitHub API ${method} ${path} 失敗：${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Read a file's text straight from the repository (bypasses the Pages cache). */
export async function readFile(cfg, path) {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, {
    headers: headers(cfg.token, true),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`讀取 ${path} 失敗（${res.status}）`);
  return res.text();
}

/**
 * Commit files atomically. `expected` maps path -> text we started from; if the
 * remote file differs we stop rather than overwrite someone else's change.
 */
export async function commitFiles(cfg, files, message, expected = {}) {
  for (const f of files) {
    if (!(f.path in expected)) continue;
    const remote = await readFile(cfg, f.path);
    if (remote !== expected[f.path]) {
      throw new Error(`遠端的 ${f.path} 已經被其他變更更新過（可能是 AI 或另一個分頁）。請先「下載 JSON」備份，重新整理頁面後再編輯。`);
    }
  }
  const ref = await gh(cfg, 'GET', `/git/ref/heads/${cfg.branch}`);
  const parent = ref.object.sha;
  const commit = await gh(cfg, 'GET', `/git/commits/${parent}`);
  const tree = await gh(cfg, 'POST', '/git/trees', {
    base_tree: commit.tree.sha,
    tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  const next = await gh(cfg, 'POST', '/git/commits', { message, tree: tree.sha, parents: [parent] });
  await gh(cfg, 'PATCH', `/git/refs/heads/${cfg.branch}`, { sha: next.sha });
  return next;
}
