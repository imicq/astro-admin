// 站点默认连接配置。
// GitHub Token 不放在前端：存放在 EdgeOne Makers 控制台环境变量 GH_TOKEN 中，
// 由边缘函数（edge-functions/api）代理转发，浏览器不接触 Token。
window.DEFAULT_GH_CONFIG = {
  owner: 'imicq',
  repo: 'astro-blog',
  branch: 'main',
};
