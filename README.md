# astro-admin

Astro 博客在线后台管理系统。纯静态单页应用，部署在腾讯云 EdgeOne **Makers**，配合 GitHub API 实现**全网页化发布管理博客**，无需本地环境。

## 功能

- 🔐 连接 GitHub 仓库（Personal Access Token，仅存本地浏览器）
- ✍️ **文章管理**：新建 / 编辑 / 删除，front matter 可视化表单 + Markdown 编辑 + 实时预览
- 💭 **碎碎念管理**：发布、编辑、删除
- 📄 **独立页面管理**：新建任意页面（对应前台 `/{页面}/` 路径）
- 🔗 **友链管理**：表格化增删改（写入博客仓库 `src/data/links.json`）
- 🎨 **站点设置**：站点名 / 副标题 / 作者 / 头像 / 公告 / 主题色 / 暗色模式 / 导航栏 / 社交链接 / Twikoo 环境地址（写入 `src/data/site.json`）
- 💬 **评论管理**：对接 Twikoo 管理 API，查看 / 删除 / 显示隐藏评论
- 🚀 **一键发布**：所有改动先攒在队列里，一键合并为**一次 Git 提交**推送 —— 只触发**一次** Makers 构建，节省免费构建次数
- 🔄 **仅重新构建前台**按钮：提交触发文件强制重建

## 工作原理

```
后台（本仓库，Makers 部署）
    │  浏览器内调用 GitHub API（Git Data API）
    ▼
astro-blog 仓库（一次合并提交）
    │  push 事件自动触发
    ▼
腾讯云 Makers 自动构建 → 前台更新（约 1~3 分钟）
```

改动不会立即构建，所有修改先进入「待发布队列」，确认后一键发布，避免 Makers 免费额度被浪费。

## 部署（腾讯云 Makers）

- 构建命令：留空（纯静态，无构建）
- 输出目录：`/`（仓库根目录）

## 使用前配置

1. 在 GitHub 生成一个 **Personal Access Token（classic）**，勾选 `repo` 权限：<https://github.com/settings/tokens>
2. 打开本后台，填入 Token + 仓库 `owner/repo` + 分支，保存。

> ⚠️ Token 保存在浏览器 localStorage 中，请勿在公共电脑使用；Token 泄露请立即在 GitHub 撤销。

## 评论管理

进入「评论管理」后输入 Twikoo 管理密码（部署 Twikoo 后首次进入管理面板时设置的密码）。

## 与博客仓库的约定

本后台默认操作以下文件路径（对应 astro-blog 仓库）：

| 文件 | 对应后台功能 |
| --- | --- |
| `src/content/posts/*.md` | 文章管理 |
| `src/content/moments/*.md` | 碎碎念 |
| `src/content/pages/*.md` | 独立页面 |
| `src/data/links.json` | 友链管理 |
| `src/data/site.json` | 站点设置 |
