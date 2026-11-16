// GitHub API 同源代理
// 路由：/api/* → https://api.github.com/*
// Token 存在 Makers 控制台环境变量 GH_TOKEN 中，绝不出现在前端代码里
// 安全：请求必须携带 x-admin-auth 头 = 后台管理密码的 SHA-256
//       （与仓库 admin.hash 文件或内置默认哈希匹配）

const ADMIN_HASHES = [
  // 默认密码 ZW5jci5vcmcvMBMGA1U 的 SHA-256（兜底；后台改密码后以 admin.hash 为准）
  'd984835a8950be8ef98615ec5567151e5b1c95cfe71725e1b688a68c36f45617',
];
const HASH_URL = 'https://raw.githubusercontent.com/imicq/astro-admin/main/admin.hash';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 允许的哈希 = 内置列表 + 仓库 admin.hash 当前值（边缘 Cache 缓存 60 秒）
async function allowedHashes() {
  const hashes = new Set(ADMIN_HASHES);
  try {
    const cache = caches.default;
    let hit = await cache.match(HASH_URL);
    if (!hit) {
      const res = await fetch(HASH_URL + '?t=' + Date.now());
      if (res.ok) {
        const text = await res.text();
        await cache.put(HASH_URL, new Response(text, {
          headers: { 'Cache-Control': 'max-age=60' },
        }));
        hit = new Response(text);
      }
    }
    if (hit) hashes.add((await hit.text()).trim().toLowerCase());
  } catch { /* 网络异常时仅用内置哈希 */ }
  return hashes;
}

export async function onRequest(context) {
  const { request, params, env } = context;
  const auth = (request.headers.get('x-admin-auth') || '').toLowerCase();
  const allowed = await allowedHashes();
  if (!auth || !allowed.has(auth)) {
    return json({ message: '未授权（请重新登录后台）' }, 401);
  }
  const token = env.GH_TOKEN;
  if (!token) {
    return json({ message: '代理未配置 GH_TOKEN 环境变量，请到 Makers 控制台设置' }, 500);
  }
  const subpath = (params['default'] || params.path || []).join('/');
  if (!subpath) return json({ message: '缺少 API 路径' }, 400);
  const url = new URL(request.url);
  const ghUrl = `https://api.github.com/${subpath}${url.search}`;

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('User-Agent', 'astro-admin-proxy');
  const ct = request.headers.get('Content-Type');
  if (ct) headers.set('Content-Type', ct);

  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();

  let res;
  try {
    res = await fetch(ghUrl, { method, headers, body });
  } catch (e) {
    return json({ message: 'GitHub 请求失败：' + String(e) }, 502);
  }
  const text = await res.text();
  const out = new Headers();
  out.set('Content-Type', res.headers.get('Content-Type') || 'application/json');
  out.set('Cache-Control', 'no-store');
  return new Response(text, { status: res.status, headers: out });
}
