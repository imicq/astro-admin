// ============================================================
// Twikoo 评论管理 API 封装
// ============================================================

const LS = {
  get(k) { return localStorage.getItem(k); },
  set(k, v) { localStorage.setItem(k, v); },
  del(k) { localStorage.removeItem(k); },
};

import { getConfig } from './github.js';

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
  if (data.code !== 0) throw new Error(data.message || `Twikoo ${event} 失败`);
  return data;
}

export async function twikooLogin(password) {
  const d = await twikoo('GET_ACCESS_TOKEN', { password });
  LS.set('twikoo_token', d.accessToken);
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
  const d = await twikoo('GET_COMMENTS_ADMIN', { accessToken: token(), page, pageSize });
  return d; // { data: { comments: [...], count: n } }
}

export async function commentDelete(id) {
  return twikoo('COMMENT_DELETE', { accessToken: token(), id });
}

export async function commentShow(id, shown) {
  return twikoo('COMMENT_SHOWN', { accessToken: token(), id, shown });
}

export async function commentSticky(id, sticky) {
  return twikoo('COMMENT_STICKY', { accessToken: token(), id, sticky });
}

export async function getTwikooConfigAdmin() {
  return twikoo('GET_CONFIG_ADMIN', { accessToken: token() });
}

export async function setTwikooConfigAdmin(data) {
  return twikoo('SET_CONFIG', { accessToken: token(), ...data });
}
