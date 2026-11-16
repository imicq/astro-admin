// ============================================================
// GitHub API 封装 + 待发布队列
// ============================================================

const LS = {
  get(k) { return localStorage.getItem(k); },
  set(k, v) { localStorage.setItem(k, v); },
  del(k) { localStorage.removeItem(k); },
};

export function getConfig() {
  const def = (typeof window !== 'undefined' && window.DEFAULT_GH_CONFIG) || {};
  return {
    token: LS.get('gh_token') || def.token || '',
    owner: LS.get('gh_owner') || def.owner || 'imicq',
    repo: LS.get('gh_repo') || def.repo || 'astro-blog',
    branch: LS.get('gh_branch') || def.branch || 'main',
  };
}

export function saveConfig(cfg) {
  LS.set('gh_token', cfg.token);
  LS.set('gh_owner', cfg.owner);
  LS.set('gh_repo', cfg.repo);
  LS.set('gh_branch', cfg.branch || 'main');
}

export function isConfigured() {
  const c = getConfig();
  return !!(c.owner && c.repo);
}

const API = 'https://api.github.com';

// gh() 请求路由：
//  - 本浏览器保存了 Token（高级设置里填过）→ 直连 api.github.com
//  - 否则走同源边缘函数代理 /api/*（Token 在服务器环境变量里，前端不接触）
async function gh(method, path, body) {
  const localToken = LS.get('gh_token');
  const headers = {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  if (localToken) {
    headers.Authorization = `Bearer ${localToken}`;
  } else {
    const auth = sessionStorage.getItem('admin_auth');
    if (!auth) throw new Error('登录状态已失效，请重新登录后台');
    headers['x-admin-auth'] = auth;
  }
  const base = localToken ? API : '/api';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub API ${method} ${path} 失败：${res.status} ${err.message || ''}`);
  }
  return res.json();
}

// ---------- base64 ----------
export function utf8ToB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
export function b64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}

// ---------- 仓库文件 ----------
export async function listDir(path) {
  try {
    const items = await gh('GET', `/repos/${getConfig().owner}/${getConfig().repo}/contents/${path}?ref=${getConfig().branch}`);
    return Array.isArray(items) ? items : [];
  } catch (e) {
    if (String(e).includes('404')) return [];
    throw e;
  }
}

export async function readFile(path) {
  const r = await gh('GET', `/repos/${getConfig().owner}/${getConfig().repo}/contents/${encodeURIComponent(path)}?ref=${getConfig().branch}`);
  return { content: b64ToUtf8(r.content), sha: r.sha };
}

// ---------- 待发布队列 ----------
const QUEUE_KEY = 'publish_queue';
export function getQueue() {
  try { return JSON.parse(LS.get(QUEUE_KEY) || '[]'); } catch { return []; }
}
export function setQueue(q) { LS.set(QUEUE_KEY, JSON.stringify(q)); updatePublishBar(); }

export function enqueue(op) {
  // op: { key, path, action: 'write'|'delete', content?, title?, time }
  const q = getQueue().filter((it) => it.key !== op.key);
  q.push(op);
  setQueue(q);
}

export function dequeue(key) {
  setQueue(getQueue().filter((it) => it.key !== key));
}

export function updatePublishBar() {
  const bar = document.getElementById('publish-bar');
  const count = document.getElementById('publish-count');
  const n = getQueue().length;
  if (!bar) return;
  if (n > 0) {
    bar.hidden = false;
    count.textContent = `⚙️ ${n} 项改动待发布`;
  } else {
    bar.hidden = true;
  }
}

// ---------- 批量提交（一次 commit 包含所有改动） ----------
export async function publishQueue() {
  const q = getQueue();
  if (!q.length) throw new Error('队列为空');
  const c = getConfig();

  // 1. 取最新 commit
  const ref = await gh('GET', `/repos/${c.owner}/${c.repo}/git/ref/heads/${c.branch}`);
  const commitSha = ref.object.sha;
  const commit = await gh('GET', `/repos/${c.owner}/${c.repo}/git/commits/${commitSha}`);
  const baseTreeSha = commit.tree.sha;

  // 2. 为写入项创建 blob
  const tree = [];
  for (const item of q) {
    if (item.action === 'write') {
      const blob = await gh('POST', `/repos/${c.owner}/${c.repo}/git/blobs`, {
        content: utf8ToB64(item.content),
        encoding: 'base64',
      });
      tree.push({ path: item.path, mode: '100644', type: 'blob', sha: blob.sha });
    } else {
      // 删除：sha 置 null
      tree.push({ path: item.path, mode: '100644', type: 'blob', sha: null });
    }
  }

  // 3. 创建 tree
  const newTree = await gh('POST', `/repos/${c.owner}/${c.repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree,
  });

  // 4. 创建 commit
  const msg = q.length === 1
    ? `chore(admin): ${q[0].title || q[0].path}`
    : `chore(admin): 发布 ${q.length} 项改动`;
  const newCommit = await gh('POST', `/repos/${c.owner}/${c.repo}/git/commits`, {
    message: msg,
    tree: newTree.sha,
    parents: [commitSha],
  });

  // 5. 更新引用（触发 Makers 自动构建）
  await gh('PATCH', `/repos/${c.owner}/${c.repo}/git/refs/heads/${c.branch}`, {
    sha: newCommit.sha,
    force: false,
  });

  setQueue([]);
  return newCommit;
}

// ---------- 立即触发重新构建（空改动提交一个触发文件） ----------
export async function triggerRebuild() {
  const path = '.build-trigger';
  const stamp = new Date().toISOString();
  enqueue({ key: path, path, action: 'write', content: stamp, title: '触发重新构建' });
  const r = await publishQueue();
  return r;
}

// ---------- 管理密码哈希同步 ----------
// 密码哈希存于本仓库（astro-admin）的 admin.hash，边缘函数代理读取它校验请求合法性。
// 后台改密码时调用此函数同步远端，让新密码立即对代理生效。
export async function commitAdminHash(hashHex) {
  const def = (typeof window !== 'undefined' && window.DEFAULT_GH_CONFIG) || {};
  const owner = def.owner || 'imicq';
  const repo = 'astro-admin';
  const branch = 'main';
  let sha;
  try {
    const r = await gh('GET', `/repos/${owner}/${repo}/contents/admin.hash?ref=${branch}`);
    sha = r.sha;
  } catch { /* 文件尚不存在 */ }
  await gh('PUT', `/repos/${owner}/${repo}/contents/admin.hash`, {
    message: 'chore(admin): update admin password hash',
    content: utf8ToB64(hashHex + '\n'),
    sha,
    branch,
  });
}
