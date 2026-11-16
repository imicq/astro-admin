// ============================================================
// 博客后台管理 —— 主应用
// 视图：概览 / 文章 / 碎碎念 / 独立页面 / 友链 / 站点设置 / 评论 / 发布
// ============================================================

import {
  getConfig, saveConfig, isConfigured,
  readFile, listDir, utf8ToB64,
  getQueue, enqueue, dequeue, publishQueue, triggerRebuild, updatePublishBar,
} from './github.js';
import {
  twikooLogin, twikooLogged, twikooLogout,
  getAdminComments, commentDelete, commentShow, commentSticky,
} from './twikoo.js';

const main = document.getElementById('main');
const $ = (s) => document.querySelector(s);

// ---------- 小工具 ----------
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 2600);
}

function confirmBox(text) {
  return new Promise((resolve) => {
    $('#confirm-text').textContent = text;
    $('#confirm-mask').hidden = false;
    window._confirmResolve = resolve;
  });
}
window.closeConfirm = (v) => {
  $('#confirm-mask').hidden = true;
  window._confirmResolve?.(v);
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}+08:00`;
}

function fmDate(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}+08:00`;
}

// 站点配置缓存（从博客仓库读取 src/data/site.json）
async function ensureSiteCache() {
  let cache = localStorage.getItem('site_cache');
  if (cache) return JSON.parse(cache);
  const { content } = await readFile('src/data/site.json');
  localStorage.setItem('site_cache', content);
  return JSON.parse(content);
}
function invalidateSiteCache() { localStorage.removeItem('site_cache'); }

// front matter 解析
function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return { fm, body: m[2] };
}

// ---------- 路由 ----------
const routes = {};
function route() {
  const hash = location.hash.replace(/^#\//, '') || 'dashboard';
  const [view, ...rest] = hash.split('/');
  if (view === 'login' || (!isConfigured() && view !== 'setup')) return renderSetup();
  (routes[view] || routes.dashboard)(rest.join('/'));
}

window.addEventListener('hashchange', route);

document.querySelectorAll('#side-nav a').forEach((a) => {
  a.addEventListener('click', () => {
    document.querySelectorAll('#side-nav a').forEach((x) => x.classList.remove('active'));
    a.classList.add('active');
    location.hash = '#/' + a.dataset.view;
  });
});

function setNav(view) {
  document.querySelectorAll('#side-nav a').forEach((x) => {
    x.classList.toggle('active', x.dataset.view === view);
  });
}

// ---------- 登录 / 首次配置 ----------
routes.setup = () => {
  setNav('');
  const c = getConfig();
  main.innerHTML = `
    <div class="login-wrap" style="position:fixed;inset:0;z-index:100">
      <div class="login-box">
        <h1>📝 连接你的博客仓库</h1>
        <p class="tip">需要一个 GitHub Personal Access Token（classic，勾选 <b>repo</b> 权限），
        在 <a href="https://github.com/settings/tokens" target="_blank">这里</a> 生成。</p>
        <label class="f">GitHub Token</label>
        <input type="password" id="su-token" value="${esc(c.token)}" placeholder="ghp_xxxx" />
        <div class="form-row">
          <div>
            <label class="f">仓库 Owner</label>
            <input type="text" id="su-owner" value="${esc(c.owner)}" placeholder="你的用户名" />
          </div>
          <div>
            <label class="f">仓库名</label>
            <input type="text" id="su-repo" value="${esc(c.repo)}" placeholder="astro-blog" />
          </div>
        </div>
        <label class="f">分支</label>
        <input type="text" id="su-branch" value="${esc(c.branch)}" placeholder="main" />
        <div class="form-actions">
          <button class="btn primary" id="su-save" style="width:100%">保存并进入后台</button>
        </div>
        <p class="tip" style="margin-top:12px">说明：Token 仅保存在你当前浏览器的本地存储中，用于调用 GitHub API 编辑仓库文件。</p>
      </div>
    </div>`;
  $('#su-save').onclick = () => {
    saveConfig({
      token: $('#su-token').value.trim(),
      owner: $('#su-owner').value.trim(),
      repo: $('#su-repo').value.trim(),
      branch: $('#su-branch').value.trim() || 'main',
    });
    invalidateSiteCache();
    $('#repo-info').textContent = `${getConfig().owner}/${getConfig().repo}`;
    toast('已保存配置', 'ok');
    location.hash = '#/dashboard';
    route();
  };
};

document.getElementById('btn-logout').onclick = async () => {
  if (!(await confirmBox('仅清除本浏览器的配置信息？'))) return;
  ['gh_token', 'gh_owner', 'gh_repo', 'gh_branch', 'twikoo_token', 'site_cache'].forEach((k) => localStorage.removeItem(k));
  location.hash = '#/login';
  route();
};

// ---------- 概览 ----------
routes.dashboard = async () => {
  setNav('dashboard');
  main.innerHTML = '<h1 class="page">概览</h1><div class="panel">加载中…</div>';
  try {
    const [posts, moments, pages] = await Promise.all([
      listDir('src/content/posts'),
      listDir('src/content/moments'),
      listDir('src/content/pages'),
    ]);
    const queue = getQueue();
    const site = await ensureSiteCache().catch(() => null);
    main.innerHTML = `
      <h1 class="page">概览</h1>
      <div class="panel" style="display:flex;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:150px"><div style="font-size:2rem;font-weight:700">${posts.length}</div><div style="color:var(--muted)">文章</div></div>
        <div style="flex:1;min-width:150px"><div style="font-size:2rem;font-weight:700">${moments.length}</div><div style="color:var(--muted)">碎碎念</div></div>
        <div style="flex:1;min-width:150px"><div style="font-size:2rem;font-weight:700">${pages.length}</div><div style="color:var(--muted)">独立页面</div></div>
        <div style="flex:1;min-width:150px"><div style="font-size:2rem;font-weight:700">${queue.length}</div><div style="color:var(--muted)">待发布改动</div></div>
      </div>
      <div class="panel">
        <h2 class="sec" style="margin-top:0">快捷操作</h2>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn primary" onclick="location.hash='#/posts/new'">✍️ 写文章</button>
          <button class="btn" onclick="location.hash='#/moments/new'">💭 发碎碎念</button>
          <button class="btn" onclick="location.hash='#/comments'">💬 管理评论</button>
          <button class="btn ok" id="qk-rebuild">🔄 重新构建前台</button>
        </div>
        <p style="color:var(--muted);font-size:.85rem;margin-bottom:0">
          当前仓库：${getConfig().owner}/${getConfig().repo}（分支 ${getConfig().branch}）${site ? ` · 站点：${esc(site.siteUrl)}` : ''}
        </p>
      </div>`;
    $('#qk-rebuild').onclick = quickRebuild;
  } catch (e) {
    main.innerHTML = `<div class="panel">加载失败：${esc(e.message)}</div>`;
  }
};

async function quickRebuild() {
  if (!(await confirmBox('触发一次前台重新构建（提交一次变更，消耗一次 Makers 构建额度）？'))) return;
  try {
    toast('正在触发构建…');
    await triggerRebuild();
    toast('已提交触发变更，Makers 会自动开始构建', 'ok');
  } catch (e) {
    toast('触发失败：' + e.message, 'err');
  }
}

// ---------- 文章管理 ----------
const POSTS_DIR = 'src/content/posts';
routes.posts = async (param) => {
  if (param === 'new') return renderPostEditor(null);
  if (param) return renderPostEditor(decodeURIComponent(param));
  setNav('posts');
  main.innerHTML = '<h1 class="page">文章管理</h1><div class="panel">加载中…</div>';
  try {
    const items = await listDir(POSTS_DIR);
    const files = items.filter((f) => f.name.endsWith('.md'));
    const rows = await Promise.all(files.map(async (f) => {
      const { content } = await readFile(`${POSTS_DIR}/${f.name}`);
      const { fm } = parseFrontMatter(content);
      const slug = f.name.replace(/\.md$/, '');
      return { slug, title: fm.title || slug, date: fm.date || '', draft: fm.draft === 'true', category: fm.category || '' };
    }));
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    main.innerHTML = `
      <h1 class="page" style="display:flex;justify-content:space-between;align-items:center">
        文章管理 <button class="btn primary" onclick="location.hash='#/posts/new'">＋ 新文章</button>
      </h1>
      <div class="panel">
        ${rows.length ? `<table class="list">
          <tr><th>标题</th><th>分类</th><th>日期</th><th>状态</th><th>操作</th></tr>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.title)}</td>
              <td>${esc(r.category)}</td>
              <td>${esc((r.date || '').replace('T', ' ').slice(0, 16))}</td>
              <td>${r.draft ? '<span class="badge orange">草稿</span>' : '<span class="badge green">已发布</span>'}</td>
              <td>
                <a class="btn link-like" href="#/posts/${encodeURIComponent(r.slug)}">编辑</a>
                <a class="btn link-like danger-text" data-del="${esc(r.slug)}">删除</a>
              </td>
            </tr>`).join('')}
        </table>` : '<div class="empty-tip">还没有文章，点击右上角新建一篇吧</div>'}
      </div>`;
    main.querySelectorAll('[data-del]').forEach((el) => {
      el.onclick = () => deleteFile(`${POSTS_DIR}/${el.dataset.del}.md`, el.dataset.del);
    });
  } catch (e) {
    main.innerHTML = `<div class="panel">加载失败：${esc(e.message)}</div>`;
  }
};

function renderPostEditor(slug) {
  setNav('posts');
  if (slug) {
    readFile(`${POSTS_DIR}/${slug}.md`).then(({ content }) => fillPostEditor(slug, content)).catch((e) => toast(e.message, 'err'));
  } else {
    fillPostEditor(null, `---\ntitle: "新文章"\ndate: ${fmDate()}\ndraft: false\nsummary: ""\ncategory: "未分类"\ntags: []\n---\n\n`);
  }
}

function fillPostEditor(slug, content) {
  const { fm, body } = parseFrontMatter(content);
  const tags = Array.isArray(fm.tags) ? fm.tags.join(', ') : String(fm.tags || '').replace(/[\[\]']/g, '').replace(/,\s*/g, ', ');
  main.innerHTML = `
    <h1 class="page">${slug ? '编辑文章：' + esc(slug) : '新文章'}</h1>
    <div class="panel">
      <div class="form-row">
        <div><label class="f">标题</label><input type="text" id="pe-title" value="${esc(fm.title || '')}"></div>
        <div style="flex:0 0 200px"><label class="f">分类</label><input type="text" id="pe-category" value="${esc((fm.category || '').replace(/"/g, '') || '未分类')}"></div>
      </div>
      <div class="form-row">
        <div><label class="f">日期</label><input type="text" id="pe-date" value="${esc(fm.date || fmDate())}"></div>
        <div style="flex:0 0 140px;display:flex;align-items:flex-end;padding-bottom:8px">
          <label style="cursor:pointer"><input type="checkbox" id="pe-draft" ${fm.draft === 'true' ? 'checked' : ''}> 草稿（不发布）</label>
        </div>
      </div>
      <label class="f">标签（逗号分隔）</label>
      <input type="text" id="pe-tags" value="${esc(tags)}">
      <label class="f">摘要（显示在文章卡片上）</label>
      <textarea id="pe-summary" rows="2">${esc((fm.summary || '').replace(/"/g, ''))}</textarea>
      <label class="f">正文（Markdown）</label>
      <div class="editor-grid">
        <textarea class="code" id="pe-body">${esc(body)}</textarea>
        <div class="preview-pane" id="pe-preview"></div>
      </div>
      <div class="form-actions">
        <button class="btn primary" id="pe-save">${slug ? '保存改动（加入发布队列）' : '保存新文章（加入发布队列）'}</button>
        <a class="btn ghost" href="#/posts">返回列表</a>
        <span style="color:var(--muted);font-size:.85rem">改动不会立即构建，统一在「发布与构建」里一键发布</span>
      </div>
    </div>`;

  const bodyEl = $('#pe-body');
  const updatePreview = () => { $('#pe-preview').innerHTML = marked.parse(bodyEl.value || ''); };
  bodyEl.addEventListener('input', updatePreview);
  updatePreview();

  $('#pe-save').onclick = () => {
    const title = $('#pe-title').value.trim();
    if (!title) return toast('标题不能为空', 'err');
    const tagList = $('#pe-tags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const fmText = [
      '---',
      `title: ${JSON.stringify(title)}`,
      `date: ${$('#pe-date').value.trim() || fmDate()}`,
      `draft: ${$('#pe-draft').checked}`,
      `summary: ${JSON.stringify($('#pe-summary').value.trim())}`,
      `category: ${JSON.stringify($('#pe-category').value.trim() || '未分类')}`,
      `tags: [${tagList.map((t) => JSON.stringify(t)).join(', ')}]`,
      '---',
      '',
    ].join('\n');
    const finalSlug = slug || $('#pe-title').value.trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-') || `post-${Date.now()}`;
    const key = `${POSTS_DIR}/${finalSlug}.md`;
    enqueue({
      key,
      path: key,
      action: 'write',
      content: fmText + bodyEl.value,
      title: (slug ? '更新文章 ' : '新建文章 ') + title,
      time: Date.now(),
    });
    toast('已加入发布队列，记得去「发布与构建」一键发布', 'ok');
    setTimeout(() => (location.hash = '#/posts'), 800);
  };
}

// ---------- 碎碎念 ----------
const MOMENTS_DIR = 'src/content/moments';
routes.moments = async (param) => {
  if (param === 'new') return renderMomentEditor(null);
  setNav('moments');
  main.innerHTML = '<h1 class="page">碎碎念</h1><div class="panel">加载中…</div>';
  try {
    const items = (await listDir(MOMENTS_DIR)).filter((f) => f.name.endsWith('.md'));
    const rows = [];
    for (const f of items) {
      const { content } = await readFile(`${MOMENTS_DIR}/${f.name}`);
      const { fm, body } = parseFrontMatter(content);
      rows.push({ name: f.name, date: fm.date || '', mood: (fm.mood || '').replace(/'/g, ''), body: body.trim().slice(0, 80) });
    }
    rows.sort((a, b) => b.name.localeCompare(a.name));
    main.innerHTML = `
      <h1 class="page" style="display:flex;justify-content:space-between;align-items:center">
        碎碎念 <button class="btn primary" onclick="location.hash='#/moments/new'">＋ 发一条</button>
      </h1>
      <div class="panel">
        ${rows.length ? `<table class="list">
          <tr><th>时间</th><th>内容</th><th>操作</th></tr>
          ${rows.map((r) => `
            <tr>
              <td>${esc((r.date || '').replace('T', ' ').slice(0, 16))} ${esc(r.mood)}</td>
              <td>${esc(r.body)}…</td>
              <td>
                <a class="btn link-like" data-edit="${esc(r.name)}">编辑</a>
                <a class="btn link-like danger-text" data-del="${esc(r.name)}">删除</a>
              </td>
            </tr>`).join('')}
        </table>` : '<div class="empty-tip">还没有碎碎念</div>'}
      </div>`;
    main.querySelectorAll('[data-edit]').forEach((el) => (el.onclick = () => renderMomentEditor(el.dataset.edit)));
    main.querySelectorAll('[data-del]').forEach((el) => (el.onclick = () => deleteFile(`${MOMENTS_DIR}/${el.dataset.del}`, el.dataset.del)));
  } catch (e) {
    main.innerHTML = `<div class="panel">加载失败：${esc(e.message)}</div>`;
  }
};

async function renderMomentEditor(name) {
  setNav('moments');
  let fm = { date: fmDate(), mood: '' }, body = '';
  if (name) {
    const { content } = await readFile(`${MOMENTS_DIR}/${name}`);
    const p = parseFrontMatter(content);
    fm = { date: fm.date, mood: p.fm.mood || '', ...p.fm };
    body = p.body;
  }
  main.innerHTML = `
    <h1 class="page">${name ? '编辑碎碎念' : '发一条碎碎念'}</h1>
    <div class="panel">
      <div class="form-row">
        <div><label class="f">时间</label><input type="text" id="me-date" value="${esc(fm.date)}"></div>
        <div style="flex:0 0 140px"><label class="f">心情 emoji</label><input type="text" id="me-mood" value="${esc(fm.mood)}" placeholder="😊"></div>
      </div>
      <label class="f">内容（支持 Markdown）</label>
      <textarea id="me-body" rows="5">${esc(body)}</textarea>
      <div class="form-actions">
        <button class="btn primary" id="me-save">保存（加入发布队列）</button>
        <a class="btn ghost" href="#/moments">返回</a>
      </div>
    </div>`;
  $('#me-save').onclick = () => {
    const text = [
      '---',
      `date: ${$('#me-date').value.trim() || fmDate()}`,
      `mood: '${($('#me-mood').value || '').replace(/'/g, '')}'`,
      '---',
      '',
      $('#me-body').value,
    ].join('\n');
    const finalName = name || `${$('#me-date').value.slice(0, 10) || '2026-01-01'}-${Date.now() % 1000}.md`;
    const key = `${MOMENTS_DIR}/${finalName}`;
    enqueue({ key, path: key, action: 'write', content: text, title: '碎碎念 ' + finalName, time: Date.now() });
    toast('已加入发布队列', 'ok');
    setTimeout(() => (location.hash = '#/moments'), 800);
  };
}

// ---------- 独立页面 ----------
const PAGES_DIR = 'src/content/pages';
routes.pages = async (param) => {
  if (param === 'new') return renderPageEditor(null);
  if (param) return renderPageEditor(decodeURIComponent(param));
  setNav('pages');
  main.innerHTML = '<h1 class="page">独立页面</h1><div class="panel">加载中…</div>';
  try {
    const items = (await listDir(PAGES_DIR)).filter((f) => f.name.endsWith('.md'));
    main.innerHTML = `
      <h1 class="page" style="display:flex;justify-content:space-between;align-items:center">
        独立页面 <button class="btn primary" onclick="location.hash='#/pages/new'">＋ 新页面</button>
      </h1>
      <div class="panel">
        <p style="color:var(--muted);font-size:.85rem;margin-top:0">
          页面文件对应前台 <code>/页面名/</code> 地址（如 about.md → /about/）。
          需要加入导航栏时，在「站点设置」的 nav 里添加对应链接。
        </p>
        ${items.length ? `<table class="list">
          <tr><th>文件</th><th>地址</th><th>操作</th></tr>
          ${items.map((f) => `
            <tr>
              <td>${esc(f.name)}</td>
              <td>/${f.name.replace(/\.md$/, '')}/</td>
              <td>
                <a class="btn link-like" href="#/pages/${encodeURIComponent(f.name.replace(/\.md$/, ''))}">编辑</a>
                <a class="btn link-like danger-text" data-del="${esc(f.name)}">删除</a>
              </td>
            </tr>`).join('')}
        </table>` : '<div class="empty-tip">还没有独立页面</div>'}
      </div>`;
    main.querySelectorAll('[data-del]').forEach((el) => {
      el.onclick = () => deleteFile(`${PAGES_DIR}/${el.dataset.del}`, el.dataset.del);
    });
  } catch (e) {
    main.innerHTML = `<div class="panel">加载失败：${esc(e.message)}</div>`;
  }
};

async function renderPageEditor(slug) {
  setNav('pages');
  let fm = { title: '', comments: true }, body = '';
  if (slug) {
    const { content } = await readFile(`${PAGES_DIR}/${slug}.md`);
    const p = parseFrontMatter(content);
    fm = { ...fm, ...p.fm };
    body = p.body;
  }
  main.innerHTML = `
    <h1 class="page">${slug ? '编辑页面：' + esc(slug) : '新独立页面'}</h1>
    <div class="panel">
      <div class="form-row">
        <div><label class="f">页面标题</label><input type="text" id="pg-title" value="${esc(fm.title || '')}"></div>
        <div style="flex:0 0 220px"><label class="f">页面标识（URL，英文）</label>
          <input type="text" id="pg-slug" value="${esc(slug || '')}" placeholder="如 friends" ${slug ? 'disabled' : ''}>
        </div>
      </div>
      <label style="margin:12px 0;display:block;cursor:pointer">
        <input type="checkbox" id="pg-comments" ${fm.comments === false ? '' : 'checked'}> 页面底部显示评论
      </label>
      <label class="f">内容（Markdown）</label>
      <div class="editor-grid">
        <textarea class="code" id="pg-body">${esc(body)}</textarea>
        <div class="preview-pane" id="pg-preview"></div>
      </div>
      <div class="form-actions">
        <button class="btn primary" id="pg-save">保存（加入发布队列）</button>
        <a class="btn ghost" href="#/pages">返回</a>
      </div>
    </div>`;
  const bodyEl = $('#pg-body');
  const updatePreview = () => { $('#pg-preview').innerHTML = marked.parse(bodyEl.value || ''); };
  bodyEl.addEventListener('input', updatePreview);
  updatePreview();
  $('#pg-save').onclick = () => {
    const finalSlug = (slug || $('#pg-slug').value.trim().replace(/[^\w-]/g, '-')).replace(/\.md$/, '');
    if (!finalSlug) return toast('请填写页面标识', 'err');
    const title = $('#pg-title').value.trim() || finalSlug;
    const text = [
      '---',
      `title: ${JSON.stringify(title)}`,
      `comments: ${$('#pg-comments').checked}`,
      '---',
      '',
      bodyEl.value,
    ].join('\n');
    const key = `${PAGES_DIR}/${finalSlug}.md`;
    enqueue({ key, path: key, action: 'write', content: text, title: '页面 ' + finalSlug, time: Date.now() });
    toast('已加入发布队列。如需在导航显示，去「站点设置」nav 里加一条', 'ok');
    setTimeout(() => (location.hash = '#/pages'), 1000);
  };
}

// ---------- 友链 ----------
routes.links = async () => {
  setNav('links');
  let links = [];
  try {
    const { content } = await readFile('src/data/links.json');
    links = JSON.parse(content);
  } catch (e) {
    toast('读取 links.json 失败：' + e.message, 'err');
  }
  main.innerHTML = `
    <h1 class="page" style="display:flex;justify-content:space-between;align-items:center">
      友链管理 <button class="btn primary" id="lk-add">＋ 添加友链</button>
    </h1>
    <div class="panel">
      <table class="list" id="lk-table">
        <tr><th>名称</th><th>链接</th><th>头像</th><th>描述</th><th>操作</th></tr>
        ${links.map((l, i) => `
          <tr data-i="${i}">
            <td><input type="text" class="lk-name" value="${esc(l.name || '')}"></td>
            <td><input type="url" class="lk-url" value="${esc(l.url || '')}"></td>
            <td><input type="text" class="lk-avatar" value="${esc(l.avatar || '')}"></td>
            <td><input type="text" class="lk-desc" value="${esc(l.desc || '')}"></td>
            <td><a class="btn link-like danger-text" data-rm="${i}">移除</a></td>
          </tr>`).join('')}
      </table>
      ${links.length === 0 ? '<div class="empty-tip">暂无友链，点击右上角添加</div>' : ''}
      <div class="form-actions">
        <button class="btn primary" id="lk-save">保存改动（加入发布队列）</button>
      </div>
    </div>`;
  $('#lk-add').onclick = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="text" class="lk-name"></td>
      <td><input type="url" class="lk-url"></td>
      <td><input type="text" class="lk-avatar"></td>
      <td><input type="text" class="lk-desc"></td>
      <td><a class="btn link-like danger-text">移除</a></td>`;
    tr.querySelector('.danger-text').onclick = () => tr.remove();
    $('#lk-table').appendChild(tr);
  };
  main.querySelectorAll('[data-rm]').forEach((el) => (el.onclick = () => el.closest('tr').remove()));
  $('#lk-save').onclick = () => {
    const out = [];
    main.querySelectorAll('#lk-table tr[data-i], #lk-table tr:not(:first-child)').forEach((tr) => {
      const name = tr.querySelector('.lk-name')?.value.trim();
      if (!name) return;
      out.push({
        name,
        url: tr.querySelector('.lk-url')?.value.trim() || '',
        avatar: tr.querySelector('.lk-avatar')?.value.trim() || '',
        desc: tr.querySelector('.lk-desc')?.value.trim() || '',
      });
    });
    enqueue({
      key: 'src/data/links.json',
      path: 'src/data/links.json',
      action: 'write',
      content: JSON.stringify(out, null, 2) + '\n',
      title: '更新友链',
      time: Date.now(),
    });
    toast('友链已加入发布队列', 'ok');
  };
};

// ---------- 站点设置 ----------
routes.settings = async () => {
  setNav('settings');
  let site;
  try {
    site = await ensureSiteCache();
  } catch (e) {
    main.innerHTML = `<div class="panel">读取 site.json 失败：${esc(e.message)}</div>`;
    return;
  }
  const navRows = site.nav.map((n, i) => `
    <tr>
      <td><input type="text" class="nv-text" value="${esc(n.text)}"></td>
      <td><input type="text" class="nv-url" value="${esc(n.url)}"></td>
      <td><a class="btn link-like danger-text">移除</a></td>
    </tr>`).join('');
  main.innerHTML = `
    <h1 class="page">站点设置</h1>
    <div class="panel">
      <h2 class="sec" style="margin-top:0">基本信息</h2>
      <div class="form-row">
        <div><label class="f">站点名</label><input type="text" id="st-title" value="${esc(site.title)}"></div>
        <div><label class="f">副标题</label><input type="text" id="st-subtitle" value="${esc(site.subtitle)}"></div>
      </div>
      <div class="form-row">
        <div><label class="f">作者名</label><input type="text" id="st-author" value="${esc(site.author)}"></div>
        <div><label class="f">作者头像地址</label><input type="text" id="st-avatar" value="${esc(site.avatar)}"></div>
      </div>
      <div class="form-row">
        <div><label class="f">站点地址（siteUrl）</label><input type="text" id="st-url" value="${esc(site.siteUrl)}"></div>
        <div style="flex:0 0 180px"><label class="f">默认主题模式</label>
          <select id="st-color">
            <option value="auto" ${site.colorMode === 'auto' ? 'selected' : ''}>跟随系统</option>
            <option value="light" ${site.colorMode === 'light' ? 'selected' : ''}>浅色</option>
            <option value="dark" ${site.colorMode === 'dark' ? 'selected' : ''}>深色</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div><label class="f">主题色</label><input type="text" id="st-accent" value="${esc(site.accentColor)}"></div>
        <div><label class="f">Twikoo 评论环境地址</label><input type="text" id="st-twikoo" value="${esc(site.twikooEnvId)}"></div>
      </div>
      <label class="f">公告栏（留空则不显示）</label>
      <textarea id="st-ann" rows="2">${esc(site.announcement || '')}</textarea>
      <label class="f">页脚文字（支持 {year} {author} 变量）</label>
      <input type="text" id="st-footer" value="${esc(site.footerText)}">

      <h2 class="sec">导航栏</h2>
      <table class="list" id="nav-table">
        <tr><th style="width:180px">文字</th><th>链接</th><th style="width:80px">操作</th></tr>
        ${navRows}
      </table>
      <button class="btn small" id="nav-add" style="margin-top:8px">＋ 添加导航项</button>

      <h2 class="sec">社交链接</h2>
      <table class="list" id="soc-table">
        <tr><th style="width:180px">文字</th><th>链接</th><th style="width:80px">操作</th></tr>
        ${site.social.map((n) => `
          <tr>
            <td><input type="text" class="sc-text" value="${esc(n.text)}"></td>
            <td><input type="text" class="sc-url" value="${esc(n.url)}"></td>
            <td><a class="btn link-like danger-text">移除</a></td>
          </tr>`).join('')}
      </table>
      <button class="btn small" id="soc-add" style="margin-top:8px">＋ 添加社交链接</button>

      <div class="form-actions">
        <button class="btn primary" id="st-save">保存设置（加入发布队列）</button>
        <span style="color:var(--muted);font-size:.85rem">保存后需一键发布才会更新前台</span>
      </div>
    </div>`;

  const addRow = (tableId, cls1, cls2) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="text" class="${cls1}"></td><td><input type="text" class="${cls2}"></td>
      <td><a class="btn link-like danger-text">移除</a></td>`;
    tr.querySelector('.danger-text').onclick = () => tr.remove();
    document.getElementById(tableId).appendChild(tr);
  };
  $('#nav-add').onclick = () => addRow('nav-table', 'nv-text', 'nv-url');
  $('#soc-add').onclick = () => addRow('soc-table', 'sc-text', 'sc-url');
  main.querySelectorAll('.danger-text').forEach((el) => (el.onclick = () => el.closest('tr').remove()));

  $('#st-save').onclick = () => {
    const collect = (tableId, c1, c2) => {
      const arr = [];
      document.querySelectorAll(`#${tableId} tr`).forEach((tr) => {
        const a = tr.querySelector(`.${c1}`)?.value.trim();
        const b = tr.querySelector(`.${c2}`)?.value.trim();
        if (a && b) arr.push({ text: a, url: b });
      });
      return arr;
    };
    const out = {
      siteUrl: $('#st-url').value.trim(),
      title: $('#st-title').value.trim(),
      subtitle: $('#st-subtitle').value.trim(),
      titleSuffix: site.titleSuffix,
      author: $('#st-author').value.trim(),
      avatar: $('#st-avatar').value.trim(),
      announcement: $('#st-ann').value,
      footerText: $('#st-footer').value,
      accentColor: $('#st-accent').value.trim(),
      colorMode: $('#st-color').value,
      nav: collect('nav-table', 'nv-text', 'nv-url'),
      twikooEnvId: $('#st-twikoo').value.trim(),
      social: collect('soc-table', 'sc-text', 'sc-url'),
    };
    enqueue({
      key: 'src/data/site.json',
      path: 'src/data/site.json',
      action: 'write',
      content: JSON.stringify(out, null, 2) + '\n',
      title: '更新站点设置',
      time: Date.now(),
    });
    localStorage.setItem('site_cache', JSON.stringify(out));
    toast('站点设置已加入发布队列', 'ok');
  };
};

// ---------- 评论管理 ----------
routes.comments = async () => {
  setNav('comments');
  if (!twikooLogged()) return renderTwikooLogin();
  main.innerHTML = '<h1 class="page">评论管理</h1><div class="panel">加载中…</div>';
  renderCommentList(1);
};

function renderTwikooLogin() {
  main.innerHTML = `
    <h1 class="page">评论管理</h1>
    <div class="panel" style="max-width:420px">
      <p style="color:var(--muted);font-size:.88rem">输入 Twikoo 管理密码（在 Twikoo 部署后首次设置的那个）。</p>
      <label class="f">Twikoo 管理密码</label>
      <input type="password" id="tk-pwd">
      <div class="form-actions"><button class="btn primary" id="tk-login">登录</button></div>
    </div>`;
  $('#tk-login').onclick = async () => {
    try {
      await twikooLogin($('#tk-pwd').value);
      toast('登录成功', 'ok');
      route();
    } catch (e) {
      toast('登录失败：' + e.message, 'err');
    }
  };
}

async function renderCommentList(page) {
  try {
    const d = await getAdminComments(page, 20);
    const comments = (d.data?.comments || []).map((c) => ({
      id: c._id || c.id,
      nick: c.nick,
      mail: c.mail,
      content: c.comment,
      time: c.created ? new Date(Number(c.created) || c.created).toLocaleString('zh-CN') : '',
      url: c.url,
      isSpam: c.isSpam,
      reply: c.reply,
    }));
    const count = d.data?.count || comments.length;
    main.innerHTML = `
      <h1 class="page" style="display:flex;justify-content:space-between;align-items:center">
        评论管理 <a class="btn ghost small" id="tk-out">退出评论登录</a>
      </h1>
      <div class="panel">
        <div class="pagination">
          <button class="btn small" id="c-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <span>第 ${page} 页 · 共 ${count} 条</span>
          <button class="btn small" id="c-next" ${page * 20 >= count ? 'disabled' : ''}>下一页</button>
        </div>
        ${comments.length ? comments.map((c) => `
          <div class="comment-item">
            <div class="c-meta">
              <b>${esc(c.nick)}</b>
              <span>${esc(c.time)}</span>
              ${c.isSpam ? '<span class="badge red">垃圾</span>' : ''}
              ${c.reply ? '<span class="badge gray">回复</span>' : ''}
              ${c.url ? `<span class="badge gray">${esc(c.url)}</span>` : ''}
            </div>
            <div class="c-content">${c.content || ''}</div>
            <div class="c-meta" style="margin-top:6px">
              <a class="btn link-like danger-text" data-cdel="${esc(c.id)}">删除</a>
              <a class="btn link-like" data-cshow="${esc(c.id)}" data-cur="${c.isSpam ? 0 : 1}">${c.isSpam ? '显示' : '隐藏'}</a>
            </div>
          </div>`).join('') : '<div class="empty-tip">暂无评论</div>'}
      </div>`;
    $('#c-prev').onclick = () => renderCommentList(page - 1);
    $('#c-next').onclick = () => renderCommentList(page + 1);
    $('#tk-out').onclick = () => { twikooLogout(); route(); };
    main.querySelectorAll('[data-cdel]').forEach((el) => {
      el.onclick = async () => {
        if (!(await confirmBox('确定删除这条评论？不可恢复。'))) return;
        try { await commentDelete(el.dataset.cdel); toast('已删除', 'ok'); renderCommentList(page); }
        catch (e) { toast('删除失败：' + e.message, 'err'); }
      };
    });
    main.querySelectorAll('[data-cshow]').forEach((el) => {
      el.onclick = async () => {
        try {
          await commentShow(el.dataset.cshow, el.dataset.cur === '1' ? false : true);
          toast('已更新', 'ok');
          renderCommentList(page);
        } catch (e) { toast('操作失败：' + e.message, 'err'); }
      };
    });
  } catch (e) {
    main.innerHTML = `<h1 class="page">评论管理</h1><div class="panel">加载失败：${esc(e.message)}<br>
      <button class="btn" onclick="location.hash='#/comments';location.reload()">重试</button></div>`;
  }
}

// ---------- 发布与构建 ----------
routes.publish = async () => {
  setNav('publish');
  const q = getQueue();
  main.innerHTML = `
    <h1 class="page">发布与构建</h1>
    <div class="panel">
      <p style="color:var(--muted);font-size:.88rem;margin-top:0">
        改动会先攒在下面的队列里，点「发布更改」会<b>合并成一次 Git 提交</b>推送到仓库，
        从而只触发一次 Makers 构建，节省构建次数。
      </p>
      ${q.length ? q.map((it) => `
        <div class="queue-item">
          <span class="badge ${it.action === 'delete' ? 'red' : 'orange'}">${it.action === 'delete' ? '删除' : '写入'}</span>
          <span class="path">${esc(it.path)}</span>
          <span style="color:var(--muted);font-size:.82rem">${esc(it.title || '')}</span>
          <a class="btn link-like danger-text" data-rm="${esc(it.key)}">移除</a>
        </div>`).join('') : '<div class="empty-tip">队列为空，改完文章/设置后来这里一键发布</div>'}
      <div class="form-actions" style="margin-top:20px">
        <button class="btn primary" id="pb-go" ${q.length ? '' : 'disabled'}>🚀 一键发布更改</button>
        <button class="btn ok" id="pb-rebuild">🔄 仅重新构建前台</button>
        <span id="pb-status" style="color:var(--muted);font-size:.88rem"></span>
      </div>
    </div>
    <div class="panel">
      <h2 class="sec" style="margin-top:0">说明</h2>
      <p style="font-size:.9rem">
        · 发布后腾讯云 Makers 会检测到仓库更新并自动构建部署前台（约 1~3 分钟）。<br>
        · 「仅重新构建前台」用于只改了 Twikoo 配置等博客文件之外的情况，会提交一个触发文件强制重建。<br>
        · 构建进度可在 Makers 控制台查看。
      </p>
    </div>`;
  main.querySelectorAll('[data-rm]').forEach((el) => {
    el.onclick = () => { dequeue(el.dataset.rm); routes.publish(); };
  });
  $('#pb-go').onclick = async () => {
    if (!(await confirmBox(`将 ${getQueue().length} 项改动合并为一次提交发布？`))) return;
    const st = $('#pb-status');
    $('#pb-go').disabled = true;
    st.textContent = '正在提交到 GitHub…';
    try {
      const r = await publishQueue();
      st.textContent = `✅ 已提交 ${r.sha.slice(0, 7)}，Makers 正在自动构建，约 1~3 分钟后前台更新`;
      toast('发布成功，等待构建', 'ok');
    } catch (e) {
      st.textContent = '';
      $('#pb-go').disabled = false;
      toast('发布失败：' + e.message, 'err');
    }
  };
  $('#pb-rebuild').onclick = async () => {
    if (!(await confirmBox('触发一次前台重新构建（提交一次变更，消耗一次构建额度）？'))) return;
    const st = $('#pb-status');
    $('#pb-rebuild').disabled = true;
    st.textContent = '正在触发…';
    try {
      await triggerRebuild();
      st.textContent = '✅ 已触发，等待构建';
      toast('已触发重新构建', 'ok');
    } catch (e) {
      st.textContent = '';
      $('#pb-rebuild').disabled = false;
      toast('触发失败：' + e.message, 'err');
    }
  };
};

// ---------- 通用：删除文件 ----------
async function deleteFile(path, label) {
  if (!(await confirmBox(`确定删除「${label}」？删除会先加入队列，发布后生效。`))) return;
  enqueue({ key: path, path, action: 'delete', title: '删除 ' + label, time: Date.now() });
  toast('删除已加入发布队列', 'ok');
}

// ---------- 启动 ----------
document.getElementById('repo-info').textContent = isConfigured()
  ? `${getConfig().owner}/${getConfig().repo}` : '未配置';
updatePublishBar();
route();
