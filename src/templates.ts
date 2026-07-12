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

export function dashboardPage(
  username: string,
  services: ServiceConfig[],
  writable = true
): string {
  const boot = JSON.stringify({ username, services, writable }).replace(/</g, "\\u003c");
  const content = renderDashboardContent(username, services, writable);

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
  .logout-btn, .theme-btn, .fab-add {
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
  .fab-add {
    position: fixed;
    right: 1.5rem;
    bottom: 1.5rem;
    width: 3.25rem;
    height: 3.25rem;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-size: 1.75rem;
    line-height: 1;
    box-shadow: var(--shadow);
    z-index: 20;
  }
  .fab-add:hover { background: var(--accent-hover); }
  .main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4.5rem;
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
    min-height: 3rem;
  }
  .card-grid.drop-target { outline: 2px dashed var(--accent); outline-offset: 4px; }
  .service-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    transition: border-color 0.15s, opacity 0.15s;
    position: relative;
  }
  .service-card:hover { border-color: var(--accent); }
  .service-card.dragging { opacity: 0.45; }
  .card-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.45rem 0.65rem 0;
  }
  .drag-handle {
    cursor: grab;
    color: var(--text-muted);
    font-size: 0.95rem;
    user-select: none;
    padding: 0.2rem 0.35rem;
  }
  .card-delete {
    background: transparent;
    border: none;
    color: var(--danger);
    font-size: 1.2rem;
    line-height: 1;
    padding: 0.2rem 0.45rem;
  }
  .card-delete:hover { opacity: 0.8; }
  .card-link {
    display: flex;
    gap: 1rem;
    padding: 0.35rem 1.25rem 1.25rem;
    color: inherit;
    text-decoration: none;
  }
  .card-link:hover { text-decoration: none; }
  .card-icon { font-size: 2rem; line-height: 1; }
  .card-body { flex: 1; min-width: 0; }
  .card-body h2 { font-size: 1.1rem; margin-bottom: 0.35rem; }
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
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.45);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 30;
    padding: 1rem;
  }
  .modal-backdrop.open { display: flex; }
  .modal {
    width: 100%;
    max-width: 420px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    padding: 1.5rem;
  }
  .modal h2 { margin-bottom: 1rem; font-size: 1.15rem; }
  .modal label {
    display: block;
    margin: 0.75rem 0 0.35rem;
    font-size: 0.85rem;
    font-weight: 500;
  }
  .modal input[type="text"],
  .modal input[type="number"] {
    width: 100%;
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
  }
  .modal .checkbox-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.85rem;
    font-size: 0.9rem;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1.25rem;
  }
  .btn-secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.55rem 1rem;
    border-radius: 8px;
  }
  .btn-primary {
    background: var(--accent);
    color: #fff;
    padding: 0.55rem 1rem;
    border-radius: 8px;
  }
  .btn-primary:hover { background: var(--accent-hover); }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 5rem;
    transform: translateX(-50%);
    background: var(--bg-panel);
    border: 1px solid var(--border);
    padding: 0.65rem 1rem;
    border-radius: 8px;
    box-shadow: var(--shadow);
    display: none;
    z-index: 25;
    font-size: 0.9rem;
  }
  .toast.show { display: block; }
  .read-only .drag-handle,
  .read-only .card-delete,
  .read-only .fab-add { display: none; }
</style>
<header class="header">
  <h1>MultiProx · ${escapeHtml(username)}</h1>
  <div class="header-actions">
    <button type="button" class="theme-btn" id="theme-toggle" onclick="toggleTheme()">🌙</button>
    <a href="/logout" class="logout-btn">退出</a>
  </div>
</header>
<main class="main${writable ? "" : " read-only"}">
  <p class="hint" id="dashboard-hint">${writable
    ? "点击卡片访问服务；拖动卡片调整顺序与分类，点击右下角 + 添加。"
    : "当前配置不可由网关写入。请执行 <code>multiprox passwd</code> 修复权限，或使用 CLI 管理。"}</p>
  <div id="dashboard">${content}</div>
</main>
${writable ? '<button type="button" class="fab-add" id="fab-add" title="添加服务">+</button>' : ""}
<div class="modal-backdrop" id="add-modal">
  <form class="modal" id="add-form">
    <h2>添加端口转发</h2>
    <label for="add-name">名称</label>
    <input id="add-name" name="name" type="text" required>
    <label for="add-description">说明</label>
    <input id="add-description" name="description" type="text">
    <label for="add-host">后端地址</label>
    <input id="add-host" name="host" type="text" value="127.0.0.1" required>
    <label for="add-port">端口</label>
    <input id="add-port" name="port" type="number" min="1" max="65535" required>
    <label for="add-category">分类</label>
    <input id="add-category" name="category" type="text">
    <label class="checkbox-row">
      <input id="add-ws" name="websocket" type="checkbox">
      <span>启用 WebSocket</span>
    </label>
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="add-cancel">取消</button>
      <button type="submit" class="btn-primary">添加</button>
    </div>
  </form>
</div>
<div class="toast" id="toast"></div>
<script>window.__MULTIPROX_BOOT__ = ${boot};</script>
<script>${DASHBOARD_SCRIPT}</script>`;

  return pageShell("仪表盘", body);
}

function renderDashboardContent(
  username: string,
  services: ServiceConfig[],
  writable: boolean
): string {
  const groups = groupServicesByCategory(services);
  const categoryBlocks: string[] = [];

  for (const [category, items] of groups) {
    const cards = items.map((s) => renderServiceCard(username, s, writable)).join("");
    categoryBlocks.push(`
    <section class="category-block" data-category="${escapeHtml(category)}">
      <h2 class="category-title">${escapeHtml(category)}</h2>
      <div class="card-grid" data-drop-zone>${cards}</div>
    </section>`);
  }

  return (
    categoryBlocks.join("") ||
    '<p class="empty">暂无服务。点击右下角 + 添加，或在终端执行 <code>multiprox add</code>。</p>'
  );
}

function renderServiceCard(username: string, s: ServiceConfig, writable: boolean): string {
  const proxyUrl = `/proxy/${encodeURIComponent(username)}${s.path}/`;
  const desc = s.description ? `<p class="card-desc">${escapeHtml(s.description)}</p>` : "";
  const wsBadge = s.websocket ? '<span class="badge ws">WebSocket</span>' : "";
  const toolbar = writable
    ? `<div class="card-toolbar">
        <span class="drag-handle" draggable="true" data-drag-handle="1" title="拖动排序">⋮⋮</span>
        <button type="button" class="card-delete" data-delete-id="${escapeHtml(s.id)}" title="删除">×</button>
      </div>`
    : "";

  return `
  <div class="service-card" data-id="${escapeHtml(s.id)}" data-category="${escapeHtml(s.category || "未分类")}">
    ${toolbar}
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
}

const DASHBOARD_SCRIPT = `
(function() {
  var boot = window.__MULTIPROX_BOOT__ || { username: "", services: [], writable: false };
  var state = { services: boot.services.slice(), writable: !!boot.writable };
  var dragId = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function showToast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(function() { el.classList.remove("show"); }, 2600);
  }

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: "same-origin" }, opts || {}))
      .then(function(res) {
        return res.json().catch(function() { return {}; }).then(function(data) {
          if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
          return data;
        });
      });
  }

  function groupServices(services) {
    var groups = new Map();
    services.slice().sort(function(a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function(s) {
      var cat = s.category || "未分类";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(s);
    });
    return groups;
  }

  function renderDashboard() {
    var root = $("#dashboard");
    if (!root) return;
    var groups = groupServices(state.services);
    if (!groups.size) {
      root.innerHTML = '<p class="empty">暂无服务。点击右下角 + 添加，或在终端执行 <code>multiprox add</code>。</p>';
      return;
    }
    var html = [];
    groups.forEach(function(items, category) {
      html.push('<section class="category-block" data-category="' + esc(category) + '">');
      html.push('<h2 class="category-title">' + esc(category) + '</h2>');
      html.push('<div class="card-grid" data-drop-zone>');
      items.forEach(function(s) { html.push(renderCard(s)); });
      html.push('</div></section>');
    });
    root.innerHTML = html.join("");
    bindInteractions();
  }

  function renderCard(s) {
    var proxyUrl = "/proxy/" + encodeURIComponent(boot.username) + s.path + "/";
    var desc = s.description ? '<p class="card-desc">' + esc(s.description) + '</p>' : '';
    var ws = s.websocket ? '<span class="badge ws">WebSocket</span>' : '';
    var toolbar = state.writable
      ? '<div class="card-toolbar"><span class="drag-handle" draggable="true" data-drag-handle="1" title="拖动排序">⋮⋮</span><button type="button" class="card-delete" data-delete-id="' + esc(s.id) + '" title="删除">×</button></div>'
      : '';
    return '<div class="service-card" data-id="' + esc(s.id) + '" data-category="' + esc(s.category || "未分类") + '">' +
      toolbar +
      '<a class="card-link" href="' + esc(proxyUrl) + '"><div class="card-icon">🔗</div><div class="card-body"><h2>' + esc(s.name) + '</h2>' +
      desc + '<div class="card-meta"><span class="endpoint">' + esc(s.host) + ':' + s.port + '</span>' + ws + '</div></div></a></div>';
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function collectLayoutItems() {
    var items = [];
    var order = 0;
    $$("#dashboard .category-block").forEach(function(section) {
      var category = section.getAttribute("data-category") || "未分类";
      var normalized = category === "未分类" ? undefined : category;
      $$(".service-card", section).forEach(function(card) {
        items.push({ id: card.getAttribute("data-id"), order: order++, category: normalized });
      });
    });
    return items;
  }

  function saveLayout() {
    if (!state.writable) return Promise.resolve();
    return api("/api/services/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: collectLayoutItems() })
    }).then(function(data) {
      state.services = data.services || state.services;
      renderDashboard();
      showToast("布局已保存");
    });
  }

  function bindInteractions() {
    if (!state.writable) return;

    $$(".card-delete", $("#dashboard")).forEach(function(btn) {
      btn.addEventListener("click", function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var id = btn.getAttribute("data-delete-id");
        if (!id || !confirm("删除服务 " + id + "？")) return;
        api("/api/services/" + encodeURIComponent(id), { method: "DELETE" })
          .then(function() {
            state.services = state.services.filter(function(s) { return s.id !== id; });
            renderDashboard();
            showToast("已删除");
          })
          .catch(function(err) { showToast(err.message); });
      });
    });

    $$("[data-drag-handle]", $("#dashboard")).forEach(function(handle) {
      handle.addEventListener("dragstart", function(ev) {
        var card = handle.closest(".service-card");
        if (!card) return;
        dragId = card.getAttribute("data-id");
        card.classList.add("dragging");
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = "move";
          ev.dataTransfer.setData("text/plain", dragId);
        }
      });
      handle.addEventListener("dragend", function() {
        var card = handle.closest(".service-card");
        if (card) card.classList.remove("dragging");
        dragId = null;
        $$(".card-grid.drop-target").forEach(function(z) { z.classList.remove("drop-target"); });
      });
    });

    $$("[data-drop-zone]", $("#dashboard")).forEach(function(zone) {
      zone.addEventListener("dragover", function(ev) {
        ev.preventDefault();
        zone.classList.add("drop-target");
      });
      zone.addEventListener("dragleave", function() { zone.classList.remove("drop-target"); });
      zone.addEventListener("drop", function(ev) {
        ev.preventDefault();
        zone.classList.remove("drop-target");
        var id = dragId || (ev.dataTransfer && ev.dataTransfer.getData("text/plain"));
        if (!id) return;
        var card = $('.service-card[data-id="' + id + '"]');
        if (!card) return;
        var after = ev.target.closest(".service-card");
        if (after && after !== card) {
          after.parentNode.insertBefore(card, after);
        } else {
          zone.appendChild(card);
        }
        var section = zone.closest(".category-block");
        if (section) card.setAttribute("data-category", section.getAttribute("data-category") || "未分类");
        saveLayout().catch(function(err) { showToast(err.message); });
      });
    });
  }

  var modal = $("#add-modal");
  var form = $("#add-form");
  var fab = $("#fab-add");
  if (fab) {
    fab.addEventListener("click", function() { modal.classList.add("open"); $("#add-name").focus(); });
  }
  var cancel = $("#add-cancel");
  if (cancel) {
    cancel.addEventListener("click", function() { modal.classList.remove("open"); form.reset(); $("#add-host").value = "127.0.0.1"; });
  }
  if (form) {
    form.addEventListener("submit", function(ev) {
      ev.preventDefault();
      var payload = {
        name: $("#add-name").value.trim(),
        description: $("#add-description").value.trim() || undefined,
        host: $("#add-host").value.trim() || "127.0.0.1",
        port: parseInt($("#add-port").value, 10),
        category: $("#add-category").value.trim() || undefined,
        websocket: $("#add-ws").checked
      };
      api("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function(data) {
        if (data.service) state.services.push(data.service);
        modal.classList.remove("open");
        form.reset();
        $("#add-host").value = "127.0.0.1";
        renderDashboard();
        showToast("已添加");
      }).catch(function(err) { showToast(err.message); });
    });
  }

  api("/api/services").then(function(data) {
    state.services = data.services || state.services;
    state.writable = !!data.writable;
    if (!state.writable) document.querySelector(".main").classList.add("read-only");
    renderDashboard();
  }).catch(function() { bindInteractions(); });
})();
`.trim();

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
