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
  // 与官方前端一致：传输与鉴权均使用 md5(密码)
  const m = md5(password);
  let d;
  try {
    d = await twikoo('LOGIN', { password: m });
  } catch (e) {
    // 未配置管理密码 → 首次输入的密码自动初始化为管理密码
    if ((e.messageRaw || '').includes('未配置管理密码')) {
      await twikoo('SET_PASSWORD', { password: m });
      d = await twikoo('LOGIN', { password: m });
    } else {
      throw e;
    }
  }
  // 后端 isAdmin 校验 md5(accessToken) === ADMIN_PASS，存 md5(密码) 即可通过
  LS.set('twikoo_token', m);
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

export async function getTwikooConfigAdmin() {
  return twikoo('GET_CONFIG_FOR_ADMIN', { accessToken: token() });
}

export async function setTwikooConfigAdmin(data) {
  return twikoo('SET_CONFIG', { accessToken: token(), ...data });
}
