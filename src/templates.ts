import { ServiceConfig, groupServicesByCategory } from "./user-config";

const THEME_SCRIPT = `
(function() {
  var key = 'multiprox-theme';
  function apply(t) {
    document.documentElement.classList.toggle('dark', t === 'dark');
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
  }
  var saved = localStorage.getItem(key);
  if (saved === 'dark' || saved === 'light') apply(saved);
  else apply(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  window.toggleTheme = function() {
    var next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem(key, next);
    apply(next);
  };
})();
`.trim();

const BASE_CSS = `
:root {
  --bg: #f4f6f9;
  --bg-panel: #ffffff;
  --accent: #3b6ef5;
  --accent-hover: #2f5ad4;
  --text: #1a1d26;
  --text-muted: #5c6370;
  --border: #dde1e8;
  --shadow: 0 4px 24px rgba(0,0,0,0.08);
  --danger: #e5484d;
}
.dark {
  --bg: #0f1117;
  --bg-panel: #1a1d27;
  --accent: #5b8aff;
  --accent-hover: #7aa0ff;
  --text: #e8eaed;
  --text-muted: #9aa0ad;
  --border: #2d3140;
  --shadow: 0 4px 24px rgba(0,0,0,0.4);
  --danger: #ff6b6b;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  line-height: 1.5;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
button, .btn {
  cursor: pointer;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 500;
  transition: background 0.15s, transform 0.1s;
}
button:active, .btn:active { transform: scale(0.98); }
.theme-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 0.4rem 0.65rem;
  font-size: 1.1rem;
  line-height: 1;
}
.theme-btn:hover { background: var(--border); }
`.trim();

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — MultiProx</title>
  <style>${BASE_CSS}</style>
</head>
<body>
${body}
<script>${THEME_SCRIPT}</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function loginPage(error?: string): string {
  const errorBlock = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : "";

  const body = `
<style>
  .login-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }
  .login-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: var(--shadow);
    padding: 2.5rem 2rem;
    width: 100%;
    max-width: 400px;
    position: relative;
  }
  .login-card h1 {
    font-size: 1.75rem;
    margin-bottom: 0.25rem;
    text-align: center;
  }
  .login-card .subtitle {
    color: var(--text-muted);
    text-align: center;
    margin-bottom: 2rem;
    font-size: 0.9rem;
  }
  .login-card label {
    display: block;
    margin-bottom: 0.4rem;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .login-card input[type="password"],
  .login-card input[type="text"] {
    width: 100%;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font-size: 1rem;
    margin-bottom: 1.25rem;
  }
  .login-card input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .login-card .submit-btn {
    width: 100%;
    padding: 0.75rem;
    background: var(--accent);
    color: #fff;
  }
  .login-card .submit-btn:hover { background: var(--accent-hover); }
  .error {
    color: var(--danger);
    background: rgba(229,72,77,0.1);
    border: 1px solid var(--danger);
    border-radius: 8px;
    padding: 0.6rem 0.85rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }
  .top-actions {
    position: absolute;
    top: 1rem;
    right: 1rem;
  }
</style>
<div class="login-wrap">
  <div class="login-card">
    <div class="top-actions">
      <button type="button" class="theme-btn" id="theme-toggle" onclick="toggleTheme()">🌙</button>
    </div>
    <h1>MultiProx</h1>
    <p class="subtitle">多服务认证反向代理入口</p>
    ${errorBlock}
    <form method="POST" action="/login">
      <label for="username">用户名</label>
      <input type="text" id="username" name="username" required autofocus autocomplete="username">
      <label for="password">密码</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <button type="submit" class="submit-btn">登录</button>
    </form>
  </div>
</div>`;

  return pageShell("登录", body);
}

export function dashboardPage(username: string, services: ServiceConfig[]): string {
  const groups = groupServicesByCategory(services);
  const categoryBlocks: string[] = [];

  for (const [category, items] of groups) {
    const cards = items
      .map((s) => {
        const proxyUrl = `/proxy/${encodeURIComponent(username)}${s.path}/`;
        const desc = s.description
          ? `<p class="card-desc">${escapeHtml(s.description)}</p>`
          : "";
        const wsBadge = s.websocket
          ? '<span class="badge ws">WebSocket</span>'
          : "";

        return `
        <div class="service-card">
          <a class="card-link" href="${escapeHtml(proxyUrl)}">
            <div class="card-icon">🔗</div>
            <div class="card-body">
              <h2>${escapeHtml(s.name)}</h2>
              ${desc}
              <div class="card-meta">
                <span class="endpoint">${escapeHtml(s.host)}:${s.port}</span>
                ${wsBadge}
              </div>
            </div>
          </a>
        </div>`;
      })
      .join("");

    categoryBlocks.push(`
    <section class="category-block">
      <h2 class="category-title">${escapeHtml(category)}</h2>
      <div class="card-grid">${cards}</div>
    </section>`);
  }

  const content =
    categoryBlocks.join("") ||
    '<p class="empty">暂无服务。请在终端执行 <code>multiprox add</code> 添加。</p>';

  const body = `
<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 2rem;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .header h1 { font-size: 1.35rem; }
  .header-actions { display: flex; gap: 0.5rem; align-items: center; }
  .logout-btn, .theme-btn {
    padding: 0.45rem 1rem;
    border-radius: 8px;
    font-size: 0.875rem;
  }
  .logout-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }
  .logout-btn:hover { background: var(--bg); text-decoration: none; }
  .main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-bottom: 1.5rem;
  }
  .hint code {
    font-family: ui-monospace, monospace;
    font-size: 0.82rem;
  }
  .category-block { margin-bottom: 2rem; }
  .category-title {
    font-size: 1rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
    font-weight: 600;
  }
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.25rem;
  }
  .service-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    transition: border-color 0.15s;
  }
  .service-card:hover { border-color: var(--accent); }
  .card-link {
    display: flex;
    gap: 1rem;
    padding: 1.25rem;
    color: inherit;
    text-decoration: none;
  }
  .card-link:hover { text-decoration: none; }
  .card-icon { font-size: 2rem; line-height: 1; }
  .card-body { flex: 1; min-width: 0; }
  .card h2 { font-size: 1.1rem; margin-bottom: 0.35rem; }
  .card-desc { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.6rem; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.8rem; }
  .endpoint { color: var(--text-muted); font-family: ui-monospace, monospace; }
  .badge {
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge.ws { background: rgba(59,110,245,0.15); color: var(--accent); }
  .empty { text-align: center; color: var(--text-muted); padding: 3rem; }
</style>
<header class="header">
  <h1>MultiProx · ${escapeHtml(username)}</h1>
  <div class="header-actions">
    <button type="button" class="theme-btn" id="theme-toggle" onclick="toggleTheme()">🌙</button>
    <a href="/logout" class="logout-btn">退出</a>
  </div>
</header>
<main class="main">
  <p class="hint">仪表盘只读。添加/删除/排序请在 SSH 终端执行：<code>multiprox add</code>、<code>multiprox remove</code>、<code>multiprox layout</code></p>
  <div id="dashboard">${content}</div>
</main>`;

  return pageShell("仪表盘", body);
}

export function notFoundPage(): string {
  const body = `
<style>
  .nf-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2rem;
  }
  .nf-code {
    font-size: 6rem;
    font-weight: 700;
    color: var(--accent);
    line-height: 1;
    margin-bottom: 0.5rem;
  }
  .nf-msg {
    color: var(--text-muted);
    margin-bottom: 2rem;
    font-size: 1.1rem;
  }
  .nf-link {
    display: inline-block;
    padding: 0.6rem 1.25rem;
    background: var(--accent);
    color: #fff;
    border-radius: 8px;
    text-decoration: none;
  }
  .nf-link:hover { background: var(--accent-hover); text-decoration: none; }
  .nf-theme { position: fixed; top: 1rem; right: 1rem; }
</style>
<div class="nf-wrap">
  <button type="button" class="theme-btn nf-theme" id="theme-toggle" onclick="toggleTheme()">🌙</button>
  <div class="nf-code">404</div>
  <p class="nf-msg">页面未找到</p>
  <a href="/" class="nf-link">返回仪表盘</a>
</div>`;

  return pageShell("404", body);
}

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#3b6ef5"/>
  <path d="M8 10h6v12H8zm10 0h6v8h-6z" fill="#fff" opacity="0.9"/>
  <circle cx="23" cy="22" r="3" fill="#7aa0ff"/>
</svg>`;
