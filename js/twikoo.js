// ============================================================
// Twikoo 评论管理 API 封装
// 适配 EdgeOne Makers 版（twikoo-eo）协议：
//   登录=LOGIN，评论列表=COMMENT_GET_FOR_ADMIN，
//   显示/隐藏=COMMENT_SET_FOR_ADMIN，删除=COMMENT_DELETE_FOR_ADMIN
// 鉴权方式：accessToken 传管理密码原文（后端校验 md5(token)==ADMIN_PASS）
// ============================================================

const LS = {
  get(k) { return localStorage.getItem(k); },
  set(k, v) { localStorage.setItem(k, v); },
  del(k) { localStorage.removeItem(k); },
};

async function twikoo(event, payload = {}) {
  const envId =
    LS.get('twikoo_url') ||
    JSON.parse(LS.get('site_cache') || '{"twikooEnvId":""}').twikooEnvId || '';
  if (!envId) throw new Error('未配置 Twikoo 环境地址，请先到「站点设置」读取配置');
  const res = await fetch(envId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, ...payload }),
  });
  if (!res.ok) throw new Error(`Twikoo ${event} 请求失败：HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) {
    const e = new Error(data.message || `Twikoo ${event} 失败`);
    e.code = data.code;
    e.messageRaw = data.message || '';
    throw e;
  }
  return data;
}

export async function twikooLogin(password) {
  if (!password) throw new Error('请输入密码');
  if (typeof md5 !== 'function') throw new Error('md5 组件未加载，请刷新页面重试');
  // Twikoo 2.0.13：服务端对传入密码做 md5 后比对 ADMIN_PASS，因此传「密码原文」；
  // 兼容旧版后端（需要前端先 md5）作为兜底。
  const m = md5(password);
  let ok = false;
  try {
    await twikoo('LOGIN', { password });
    ok = true;
  } catch (e1) {
    try {
      await twikoo('LOGIN', { password: m });
      ok = true;
    } catch (e2) {
      // 未配置管理密码 → 初始化（传原文，后端存 md5(原文)）
      if ((e2.messageRaw || '').includes('未配置管理密码')) {
        await twikoo('SET_PASSWORD', { password });
        await twikoo('LOGIN', { password });
        ok = true;
      } else {
        throw e2;
      }
    }
  }
  if (!ok) throw new Error('登录失败');
  // 后端 isAdmin 校验 md5(accessToken) === ADMIN_PASS → accessToken 需传「密码原文」或 md5
  // 用一次真实的 COMMENT_GET_FOR_ADMIN 探测哪种形式有效，就存哪种。
  for (const cand of [password, m]) {
    try {
      await twikoo('COMMENT_GET_FOR_ADMIN', { accessToken: cand, page: 1, per: 1 });
      LS.set('twikoo_token', cand);
      return true;
    } catch (_) { /* 尝试下一种 */ }
  }
  // 都没通过也先存原文（与官方前端一致），登录态保留但评论接口可能提示重新登录
  LS.set('twikoo_token', password);
  return true;
}

export function twikooLogged() {
  return !!LS.get('twikoo_token');
}

export function twikooLogout() {
  LS.del('twikoo_token');
}

function token() {
  return LS.get('twikoo_token');
}

export async function getAdminComments(page = 1, pageSize = 20) {
  const d = await twikoo('COMMENT_GET_FOR_ADMIN', { accessToken: token(), page, per: pageSize });
  // 返回结构：{ code:0, count, data: [评论数组] }
  return { data: { comments: Array.isArray(d.data) ? d.data : [], count: d.count ?? 0 } };
}

export async function commentDelete(id) {
  return twikoo('COMMENT_DELETE_FOR_ADMIN', { accessToken: token(), id });
}

export async function commentShow(id, shown) {
  return twikoo('COMMENT_SET_FOR_ADMIN', { accessToken: token(), id, set: { isSpam: !shown } });
}

export async function commentSticky(id, sticky) {
  return twikoo('COMMENT_SET_FOR_ADMIN', { accessToken: token(), id, set: { sticky: !!sticky } });
}

// 公开接口：最新评论（不需要管理员登录）
export async function getRecentComments(pageSize = 8) {
  const d = await twikoo('GET_RECENT_COMMENTS', { pageSize, includeReply: true });
  return Array.isArray(d.data) ? d.data : [];
}

// 管理员读取 Twikoo 全量配置（返回 config 对象）
export async function getTwikooConfigAdmin() {
  const d = await twikoo('GET_CONFIG_FOR_ADMIN', { accessToken: token() });
  return d.config || d.data || {};
}

// 管理员保存 Twikoo 配置（body.config，后端合并语义）
export async function setTwikooConfigAdmin(config) {
  return twikoo('SET_CONFIG', { accessToken: token(), config });
}
