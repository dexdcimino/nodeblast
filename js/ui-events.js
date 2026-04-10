// ══════════════════════════════════════
//  NodeBlast — UI EVENTS
//  Tooltip, toast, modal, account menu
// ══════════════════════════════════════

import State from './state.js';
import { openColorPopup, closeColorPopup } from './color.js';

/* ── Toast ── */
let _toastT;
export function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastT);
  const dur = Math.min(4500, Math.max(2500, msg.length * 100));
  _toastT = setTimeout(() => t.classList.remove('show'), dur);
}

/* ── Modal ── */
export function showModal({ title, msg, sub, confirmLabel, danger, onConfirm }) {
  const modal = document.getElementById('dex-modal');
  if (!modal) { if (window.confirm(msg)) onConfirm?.(); return; }
  document.getElementById('dex-modal-title').textContent = title;
  document.getElementById('dex-modal-msg').innerHTML = msg;
  const subEl = document.getElementById('dex-modal-sub');
  if (subEl) { subEl.textContent = sub || ''; subEl.style.display = sub ? 'block' : 'none'; }
  const confirmBtn = document.getElementById('dex-modal-confirm');
  confirmBtn.textContent = confirmLabel || 'Confirm';
  confirmBtn.className = 'dex-modal-btn ' + (danger ? 'danger' : 'primary');

  const close = () => {
    modal.classList.remove('open');
    if (modal._onBg) { modal.removeEventListener('click', modal._onBg); modal._onBg = null; }
    if (modal._onKey) { document.removeEventListener('keydown', modal._onKey, true); modal._onKey = null; }
  };
  modal.classList.add('open');
  document.getElementById('dex-modal-cancel').onclick = (e) => { e.stopPropagation(); close(); };
  confirmBtn.onclick = (e) => { e.stopPropagation(); close(); onConfirm?.(); };
  const onBg = (e) => { if (e.target === modal) { e.stopPropagation(); close(); } };
  modal._onBg = onBg;
  modal.addEventListener('click', onBg);
  const onKey = (e) => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); close(); onConfirm?.(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  };
  modal._onKey = onKey;
  document.addEventListener('keydown', onKey, true);
}

/* ── Tooltip system ── */
export function initTooltips() {
  const tipEl = document.getElementById('dex-tip');
  let timer = null, target = null, clickedEl = null;
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || !el.dataset.tip) {
      if (target && !e.target.closest('[data-tip]')) {
        clearTimeout(timer); timer = null; target = null;
        tipEl?.classList.remove('visible');
      }
      return;
    }
    if (el === target || el === clickedEl) return;
    target = el;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!tipEl || !target) return;
      tipEl.textContent = target.dataset.tip;
      const rect = target.getBoundingClientRect();
      const pos = target.dataset.tipPos;
      if (pos === 'right') {
        tipEl.style.left = (rect.right + 6) + 'px';
        tipEl.style.top = (rect.top + rect.height / 2) + 'px';
        tipEl.style.transform = 'translateY(-50%)';
      } else if (pos === 'below') {
        tipEl.style.left = (rect.left + rect.width / 2) + 'px';
        tipEl.style.top = (rect.bottom + 6) + 'px';
        tipEl.style.transform = 'translate(-50%,0)';
      } else {
        tipEl.style.left = (rect.left + rect.width / 2) + 'px';
        tipEl.style.top = (rect.top - 8) + 'px';
        tipEl.style.transform = 'translate(-50%,-100%)';
        if (rect.top < 40) {
          tipEl.style.top = (rect.bottom + 8) + 'px';
          tipEl.style.transform = 'translate(-50%,0)';
        }
      }
      tipEl.classList.add('visible');
      const tr = tipEl.getBoundingClientRect();
      if (tr.left < 4) tipEl.style.left = (4 + tr.width / 2) + 'px';
      if (tr.right > window.innerWidth - 4) tipEl.style.left = (window.innerWidth - 4 - tr.width / 2) + 'px';
    }, 400);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el === target) {
      if (e.relatedTarget && el && el.contains(e.relatedTarget)) return;
      clearTimeout(timer); timer = null; target = null;
      tipEl?.classList.remove('visible');
    }
    if (el === clickedEl) clickedEl = null;
  });
  document.addEventListener('mousedown', (e) => {
    tipEl?.classList.remove('visible');
    clickedEl = e.target.closest('[data-tip]');
    target = null;
  });
}

/* ── Account menu ── */
let _menuMainView = true;
function _resetMenuView() {
  document.getElementById('acct-menu-scroll').style.display = '';
  document.getElementById('acct-settings-view').style.display = 'none';
  document.getElementById('acct-footer').style.display = '';
  _menuMainView = true;
  _closeEditPanel();
}
function _showSettingsView() {
  document.getElementById('acct-menu-scroll').style.display = 'none';
  document.getElementById('acct-settings-view').style.display = 'flex';
  document.getElementById('acct-footer').style.display = 'none';
  _menuMainView = false;
}

function _openEditPanel() {
  const p = document.getElementById('acct-edit-panel');
  const editBtn = document.getElementById('acct-edit-btn');
  p.style.display = 'flex';
  editBtn.classList.add('active');
  const nameIn = document.getElementById('acct-username-input');
  const hexIn = document.getElementById('acct-edit-hex-input');
  if (nameIn) { nameIn.value = State.profile?.displayName || ''; nameIn.focus(); }
  if (hexIn) hexIn.value = '#' + (State.profile?.hexCode || '5AAA72').toUpperCase();
  _updateEditColorPreview();
}
function _closeEditPanel() {
  const p = document.getElementById('acct-edit-panel');
  if (p) p.style.display = 'none';
  document.getElementById('acct-edit-btn')?.classList.remove('active');
  closeColorPopup();
}
function _updateEditColorPreview() {
  const hex = document.getElementById('acct-edit-hex-input')?.value || '#5AAA72';
  const preview = document.getElementById('acct-edit-color-preview');
  if (preview) preview.style.background = hex;
}

export function openAccountMenu() {
  const menu = document.getElementById('acct-menu');
  const btn = document.getElementById('acct-btn');
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.style.left = 'auto';
  menu.classList.add('open');
  _resetMenuView();
}
export function closeAccountMenu() {
  document.getElementById('acct-menu')?.classList.remove('open');
  closeColorPopup();
}

export function initAccountMenu(handlers) {
  const { onSignOut, onSaveProfile } = handlers;

  document.getElementById('acct-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('acct-menu');
    if (menu.classList.contains('open')) closeAccountMenu();
    else openAccountMenu();
  });

  document.getElementById('acct-menu-close')?.addEventListener('click', closeAccountMenu);

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('acct-menu');
    if (!menu?.classList.contains('open')) return;
    if (menu.contains(e.target)) return;
    if (document.getElementById('acct-btn')?.contains(e.target)) return;
    if (document.getElementById('clr-popup')?.contains(e.target)) return;
    closeAccountMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('acct-menu')?.classList.contains('open')) {
      closeAccountMenu();
    }
  });

  // Dropdown toggles (Catalysts, People)
  document.querySelectorAll('.acct-dropdown-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const body = toggle.nextElementSibling;
      if (body) body.style.display = body.style.display === 'flex' ? 'none' : 'flex';
    });
  });

  // Edit profile
  document.getElementById('acct-edit-btn')?.addEventListener('click', () => {
    const p = document.getElementById('acct-edit-panel');
    if (p.style.display === 'flex') _closeEditPanel();
    else _openEditPanel();
  });
  document.getElementById('acct-edit-cancel-btn')?.addEventListener('click', _closeEditPanel);
  document.getElementById('acct-edit-save-btn')?.addEventListener('click', () => {
    const name = document.getElementById('acct-username-input').value.trim();
    const hex = document.getElementById('acct-edit-hex-input').value.replace('#', '').toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex)) { toast('Invalid hex color'); return; }
    onSaveProfile?.({ displayName: name || 'anon', hexCode: hex });
    _closeEditPanel();
    toast('Profile saved');
  });
  document.getElementById('acct-edit-hex-input')?.addEventListener('input', _updateEditColorPreview);
  document.getElementById('acct-edit-color-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const hexIn = document.getElementById('acct-edit-hex-input');
    openColorPopup(e.currentTarget, hexIn?.value || '#5AAA72', (newHex) => {
      if (hexIn) hexIn.value = newHex.toUpperCase();
      _updateEditColorPreview();
    });
  });

  // Status buttons
  document.querySelectorAll('#acct-status-toggle .status-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#acct-status-toggle .status-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
    });
  });

  // Hex copy
  document.getElementById('acct-hex-copy-btn')?.addEventListener('click', () => {
    const name = State.profile?.displayName || 'anon';
    const hex = State.profile?.hexCode || '5aaa72';
    navigator.clipboard?.writeText(`${name}#${hex}`);
    toast('Copied ' + name + '#' + hex);
  });

  // Settings view toggle
  document.getElementById('acct-settings-btn')?.addEventListener('click', _showSettingsView);
  document.getElementById('settings-back-btn')?.addEventListener('click', _resetMenuView);
  document.getElementById('acct-signout-btn')?.addEventListener('click', () => onSignOut?.());
  document.getElementById('settings-signout-btn')?.addEventListener('click', () => onSignOut?.());
}

/* ── Audio sliders ── */
const _AK = { master: 'nb-vol-master', music: 'nb-vol-music', fx: 'nb-vol-fx' };
const _MK = { master: 'nb-mute-master', music: 'nb-mute-music', fx: 'nb-mute-fx' };

export function initAudioSettings() {
  const ids = [
    { id: 'master', slider: 'master-volume', val: 'master-volume-val', mute: 'master-mute-toggle' },
    { id: 'music', slider: 'music-volume', val: 'music-volume-val', mute: 'music-mute-toggle' },
    { id: 'fx', slider: 'fx-volume', val: 'fx-volume-val', mute: 'fx-mute-toggle' },
  ];
  for (const p of ids) {
    const s = document.getElementById(p.slider);
    const v = document.getElementById(p.val);
    const mw = document.getElementById(p.mute);
    if (!s || !v || !mw) continue;
    const m = mw.querySelector('input');
    const storedVol = parseInt(localStorage.getItem(_AK[p.id]) || '50', 10);
    const storedMute = localStorage.getItem(_MK[p.id]) === 'true';
    s.value = storedVol; v.textContent = storedVol + '%';
    if (m) m.checked = !storedMute;
    s.addEventListener('input', () => {
      v.textContent = s.value + '%';
      localStorage.setItem(_AK[p.id], s.value);
    });
    m?.addEventListener('change', () => {
      localStorage.setItem(_MK[p.id], m.checked ? 'false' : 'true');
    });
  }
}
