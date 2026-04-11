// ══════════════════════════════════════════════════════════════
//  NodeBlast — NOTIFICATIONS
//  Bell menu, badge, clear, and the centered super-notif overlay.
//  Public API (mounted on window once initialized):
//    window._nbAddNotif({ text, icon, type, actions })
//    window._nbShowSuperNotif({ icon, title, subtitle, body, actions, type })
//  Ported from DexNote's init.js _dexAddNotif / _dexShowSuperNotif.
// ══════════════════════════════════════════════════════════════

const DEFAULT_BELL_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

function _notifRelativeTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d + 'd ago';
}

function _playChime(type) {
  const key = 'nb-notif-audio-' + (type || 'all');
  if (localStorage.getItem(key) === 'off') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
    setTimeout(() => ctx.close(), 300);
  } catch {}
}

function _syncBadge() {
  const list = document.getElementById('notif-list');
  const badge = document.getElementById('notif-badge');
  const clearBtn = document.getElementById('notif-clear-btn');
  if (!list) return;
  const hasItems = !!list.querySelector('.notif-item');
  const hasUnread = !!list.querySelector('.notif-item.unread');
  if (badge) badge.style.display = hasUnread ? '' : 'none';
  if (clearBtn) clearBtn.style.display = hasItems ? '' : 'none';
  if (!hasItems && !list.querySelector('#notif-empty')) {
    list.innerHTML = '<div id="notif-empty">No notifications</div>';
  }
}

function _addNotif({ text, time, icon, type, actions, onClick } = {}) {
  const list = document.getElementById('notif-list');
  if (!list) return;
  const empty = document.getElementById('notif-empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'notif-item unread';
  const now = Date.now();
  const iconHtml = icon || DEFAULT_BELL_SVG;
  const timeText = time || _notifRelativeTime(now);

  item.innerHTML = `
    <div class="notif-item-icon">${iconHtml}</div>
    <div class="notif-item-body">
      <div class="notif-item-text">${text || ''}</div>
      <div class="notif-time" data-created="${now}">${timeText}</div>
    </div>
    <button class="notif-item-delete" title="Delete">
      <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/></svg>
    </button>
  `;

  item.querySelector('.notif-item-body').addEventListener('click', () => {
    item.classList.remove('unread');
    if (typeof onClick === 'function') onClick();
    _syncBadge();
  });
  item.querySelector('.notif-item-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    item.remove();
    _syncBadge();
  });

  list.prepend(item);
  _syncBadge();
  _playChime(type);
}

/* ── Super (centered) notification ── */
let _superTimer = null;
const _superQueue = [];
let _superActive = false;

function _dismissSuper() {
  if (_superTimer) { clearTimeout(_superTimer); _superTimer = null; }
  const container = document.getElementById('notif-super');
  if (!container) { _superActive = false; return; }
  container.classList.remove('visible');
  setTimeout(() => {
    container.style.display = 'none';
    _superActive = false;
    if (_superQueue.length) {
      const next = _superQueue.shift();
      setTimeout(() => _showSuper(next), 150);
    }
  }, 320);
}

function _showSuper({ icon, title, subtitle, body, actions }) {
  _superActive = true;
  const container = document.getElementById('notif-super');
  if (!container) { _superActive = false; return; }

  document.getElementById('notif-super-icon').innerHTML = icon || '';
  document.getElementById('notif-super-title').textContent = title || '';
  const subEl = document.getElementById('notif-super-subtitle');
  subEl.textContent = subtitle || '';
  subEl.style.display = subtitle ? '' : 'none';
  document.getElementById('notif-super-body').innerHTML = body || '';

  const actEl = document.getElementById('notif-super-actions');
  actEl.innerHTML = '';
  if (actions && actions.length) {
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.addEventListener('click', () => {
        _dismissSuper();
        if (typeof a.onClick === 'function') a.onClick();
      });
      actEl.appendChild(btn);
    });
  }

  container.style.display = 'flex';
  // Force a reflow so the .visible class transition actually runs.
  void container.offsetHeight;
  container.classList.add('visible');
  _superTimer = setTimeout(_dismissSuper, 10000);
}

function _showSuperPublic(opts) {
  if (_superActive) { _superQueue.push(opts); return; }
  _showSuper(opts || {});
}

export function initNotifications() {
  const btn = document.getElementById('notif-btn');
  const menu = document.getElementById('notif-menu');
  const clearBtn = document.getElementById('notif-clear-btn');
  const superOverlay = document.getElementById('notif-super');

  // Toggle menu on bell click; close on outside click.
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    menu?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!menu?.classList.contains('open')) return;
    if (menu.contains(e.target)) return;
    if (btn?.contains(e.target)) return;
    menu.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu?.classList.contains('open')) menu.classList.remove('open');
  });

  clearBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = document.getElementById('notif-list');
    if (list) list.innerHTML = '<div id="notif-empty">No notifications</div>';
    _syncBadge();
  });

  // Super overlay: click outside card dismisses. Escape dismisses.
  superOverlay?.addEventListener('click', (e) => {
    if (!e.target.closest('#notif-super-card')) _dismissSuper();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _superActive) { e.stopPropagation(); _dismissSuper(); }
  }, true);

  // Expose public API so other modules (or the console, for testing)
  // can drop notifications without importing anything.
  window._nbAddNotif = _addNotif;
  window._nbShowSuperNotif = _showSuperPublic;
}

/* ── Quick Tips hover panel ── */
export function initHelpPanel() {
  const btn = document.getElementById('help-btn');
  const panel = document.getElementById('help-panel');
  if (!btn || !panel) return;

  let hideTimer = null;
  const show = () => {
    clearTimeout(hideTimer); hideTimer = null;
    panel.classList.add('open');
  };
  const hide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => panel.classList.remove('open'), 180);
  };
  btn.addEventListener('mouseenter', show);
  btn.addEventListener('mouseleave', hide);
  panel.addEventListener('mouseenter', show);
  panel.addEventListener('mouseleave', hide);

  // Collapsible sections
  panel.querySelectorAll('.help-section-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      toggle.closest('.help-section')?.classList.toggle('collapsed');
    });
  });
}
