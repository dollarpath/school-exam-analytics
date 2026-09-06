/* ============================================================
   School Exam Analytics System — shared client helpers
   Loaded on every authenticated page. Provides the themed
   header/nav, toast + modal helpers, and fetch wrappers.
   ============================================================ */

const App = (function () {
  const state = { init: null, user: null };

  // ---- Tiny fetch wrapper with JSON + error handling ----
  async function api(url, { method = 'GET', body, form } = {}) {
    const opts = { method, headers: {} };
    if (form) {
      opts.body = form; // FormData — browser sets content-type
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await res.json();
    } else {
      data = { raw: await res.text() };
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.detail = data && data.detail;
      throw err;
    }
    return data;
  }

  // ---- Toast notifications ----
  function toast(message, type = 'success', ms = 3200) {
    let wrap = document.getElementById('toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'error' ? '✖' : type === 'warn' ? '⚠' : type === 'info' ? 'ℹ' : '✓';
    el.innerHTML = `<span>${icon}</span><div>${escapeHtml(message)}</div>`;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; setTimeout(() => el.remove(), 250); }, ms);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- Modal helper ----
  function openModal({ title, body, footer, onClose }) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h3>${title}</h3><button class="btn btn-ghost btn-sm" data-close>✖</button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector('[data-close]')?.addEventListener('click', closeModal);
    return { el: backdrop, close: closeModal };
  }
  function closeModal() {
    document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
  }
  function confirmDialog(message, onOk, okLabel = 'OK') {
    const m = openModal({
      title: 'Confirm',
      body: `<p>${message}</p>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button>
               <button class="btn btn-danger" id="confirmOk">${okLabel}</button>`,
    });
    m.el.querySelector('#confirmOk').addEventListener('click', () => { closeModal(); onOk(); });
  }

  // ---- Formatting ----
  function fmtNum(n, d = 2) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
  }
  function pct(n) { return n === null || n === undefined ? '—' : `${Math.round(n)}%`; }

  // ---- Fetch /api/init and theme the page ----
  async function loadInit() {
    const data = await api('/api/init');
    state.init = data;
    applyTheme(data);
    return data;
  }

  function applyTheme(init) {
    const s = init && init.school;
    const root = document.documentElement;
    if (s) {
      if (s.primary_color) root.style.setProperty('--primary', s.primary_color);
      if (s.secondary_color) root.style.setProperty('--secondary', s.secondary_color);
    }
    // Header rendering
    const brandName = (s && s.name) || 'School';
    const motto = (s && s.motto) || '';
    const logoPath = (s && s.logo_path) || '';
    const el = document.getElementById('php-brand');
    if (el) {
      const logoHtml = logoPath
        ? `<img src="${logoPath}" alt="logo">`
        : `<div class="no-logo">${escapeHtml(brandName.charAt(0))}</div>`;
      el.innerHTML = `
        <div class="brand">
          <div class="brand-logo">${logoHtml}</div>
          <div class="brand-text">
            <div class="brand-name">${escapeHtml(brandName)}</div>
            ${motto ? `<div class="brand-motto">${escapeHtml(motto)}</div>` : ''}
          </div>
        </div>`;
    }
  }

  function renderNav(active) {
    const nav = document.getElementById('ph-nav');
    if (!nav) return;
    const user = state.user;
    const isAdmin = user && user.is_admin;
    const items = [
      ['/index', 'Home', 'home'],
      ['/marks', 'Marks Entry', 'marks'],
      ['/broadsheet', 'Broadsheet', 'broadsheet'],
      ['/report', 'Reports', 'report'],
      ['/data', 'Data Viewer', 'data'],
      ['/timetable', 'Timetable', 'timetable'],
    ];
    let html = items.map(([href, label, id]) =>
      `<a href="${href}" class="${active === id ? 'active' : ''}">${label}</a>`).join('');
    if (isAdmin) {
      html += `<a href="/admin" class="${active === 'admin' ? 'active' : ''}">Admin</a>`;
    }
    nav.innerHTML = html;
  }

  // ---- Session / auth ----
  function setUser(user) {
    state.user = user;
    const el = document.getElementById('php-user');
    if (el) {
      const role = user && user.is_admin ? 'Admin' : (user && user.is_hoi ? 'Head of Institution' : 'Teacher');
      el.innerHTML = `
        <span class="role-pill">${role}</span>
        <span>${escapeHtml((user && user.full_name) || 'User')}</span>
        <button class="btn btn-outline btn-sm" id="logoutBtn" style="border-color: rgba(255,255,255,0.5);color:#fff;background:transparent;">Logout</button>`;
      el.querySelector('#logoutBtn').addEventListener('click', async () => {
        await api('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      });
    }
  }

  async function boot(active) {
    try { await loadInit(); } catch (e) { /* non-fatal */ }
    try {
      const me = await api('/api/auth/me');
      setUser(me.user);
    } catch (e) {
      // not authenticated — redirect
      window.location.href = '/login';
      return;
    }
    renderNav(active);
  }

  return { api, toast, openModal, closeModal, confirmDialog, escapeHtml, fmtNum, pct, loadInit, applyTheme, setUser, boot, state };
})();

/* Each page calls App.boot(activeSection) on its own. */
