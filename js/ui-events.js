// ══════════════════════════════════════
//  NodeBlast — UI EVENTS
//  Tooltip, toast, account menu, audio (DexNote-style)
// ══════════════════════════════════════

import State from './state.js';
import { openColorPopup, closeColorPopup } from './color.js';
import { showModal as _showModal } from './modal.js';

// Flag flipped by auth.js around signInWithPopup so the account menu
// click-outside-to-close handler doesn't fire when the popup opens/blurs.
let _signingIn = false;
export function setSigningIn(v) { _signingIn = !!v; }
export function isSigningIn() { return _signingIn; }

// Re-export showModal so existing importers (catalysts.js, init.js) keep working.
export const showModal = _showModal;

/* ── Shared helpers ── */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render a username, styling any trailing/embedded ".dev" suffix as an
// admin badge (gray, slightly smaller) regardless of the parent color.
export function renderUsername(name, hexColor) {
  const safeName = escapeHtml(name || 'anon');
  const lower = safeName.toLowerCase();
  const idx = lower.indexOf('.dev');
  const colorAttr = hexColor ? ` style="color:${escapeHtml(hexColor)}"` : '';
  if (idx === -1) {
    return `<span class="uname-main"${colorAttr}>${safeName}</span>`;
  }
  const main = safeName.slice(0, idx);
  const tag = safeName.slice(idx);
  return `<span class="uname-main"${colorAttr}>${main}</span><span class="uname-dev-tag">${tag}</span>`;
}

/* ── Toast (DexNote-verbatim) ── */
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

/* ── Tooltip system (DexNote-verbatim) ── */
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
        const tipOff = parseInt(target.dataset.tipOffset) || 8;
        tipEl.style.top = (rect.top - tipOff) + 'px';
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

/* ══════════════════════════════════════
   Account menu — open/close, settings view, edit panel
   (DexNote-identical behavior)
══════════════════════════════════════ */

function _hideSettingsView() {
  document.getElementById('acct-settings-view')?.classList.remove('visible');
  document.getElementById('acct-menu-scroll').style.display = '';
  document.getElementById('acct-footer').style.display = '';
}
function _showSettingsView() {
  document.getElementById('acct-menu-scroll').style.display = 'none';
  document.getElementById('acct-footer').style.display = 'none';
  document.getElementById('acct-settings-view')?.classList.add('visible');
}

function _updateEditColorPreview() {
  const hex = document.getElementById('acct-edit-hex-input')?.value || '#5AAA72';
  const preview = document.getElementById('acct-edit-color-preview');
  if (preview) preview.style.background = hex;
}

function _openEditPanel() {
  const p = document.getElementById('acct-edit-panel');
  const editBtn = document.getElementById('acct-edit-btn');
  if (!p) return;
  p.style.display = 'flex';
  editBtn?.classList.add('active');
  document.getElementById('acct-menu-scroll')?.classList.add('edit-panel-active');
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
  document.getElementById('acct-menu-scroll')?.classList.remove('edit-panel-active');
  closeColorPopup();
}

function _resetMenuView() {
  _hideSettingsView();
  _closeEditPanel();
  // Collapse any open dropdown sections
  document.querySelectorAll('.acct-dropdown-section.open').forEach((s) => s.classList.remove('open'));
}

export function openAccountMenu() {
  const menu = document.getElementById('acct-menu');
  const btn = document.getElementById('acct-btn');
  if (!menu || !btn) return;
  if (window.innerWidth <= 640) {
    menu.style.top = ''; menu.style.right = '0'; menu.style.left = '0'; menu.style.bottom = '0';
    menu.classList.add('mobile-sheet');
  } else {
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.left = 'auto';
    menu.style.bottom = '';
    menu.classList.remove('mobile-sheet');
  }
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
    if (_signingIn) return;
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

  // Dropdown toggles — toggle .open on section; CSS handles body visibility.
  // stopPropagation so the document click-outside handler doesn't race.
  document.querySelectorAll('.acct-dropdown-toggle').forEach((toggle) => {
    toggle.setAttribute('type', 'button');
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const section = toggle.closest('.acct-dropdown-section');
      if (section) section.classList.toggle('open');
    });
  });

  // Edit profile
  document.getElementById('acct-edit-btn')?.addEventListener('click', () => {
    const p = document.getElementById('acct-edit-panel');
    if (p.style.display === 'flex') _closeEditPanel();
    else _openEditPanel();
  });
  document.getElementById('acct-edit-cancel-btn')?.addEventListener('click', _closeEditPanel);
  document.getElementById('acct-edit-save-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('acct-username-input').value.trim();
    const hex = document.getElementById('acct-edit-hex-input').value.replace('#', '').toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex)) { toast('Invalid hex color'); return; }
    try {
      await onSaveProfile?.({ displayName: name || 'anon', hexCode: hex });
      _closeEditPanel();
      toast('Profile saved');
    } catch (err) {
      toast(err?.message || 'Could not save profile');
    }
  });
  // Enter in username input → save
  document.getElementById('acct-username-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('acct-edit-save-btn')?.click(); }
  });
  document.getElementById('acct-edit-hex-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('acct-edit-save-btn')?.click(); }
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

  // Status buttons (UI-only for now — no presence backend)
  document.querySelectorAll('#acct-status-toggle .status-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#acct-status-toggle .status-btn').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
    });
  });

  // Hex copy (full username#hexcode)
  document.getElementById('acct-hex-copy-btn')?.addEventListener('click', () => {
    const name = State.profile?.displayName || 'anon';
    const hex = State.profile?.hexCode || '5aaa72';
    navigator.clipboard?.writeText(`${name}#${hex}`);
    toast('Copied ' + name + '#' + hex);
  });

  // Avatar upload — read file, convert to data URL, save via onSaveProfile
  document.getElementById('acct-avatar-upload-btn')?.addEventListener('click', () => {
    document.getElementById('acct-avatar-file')?.click();
  });
  document.getElementById('acct-avatar-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await onSaveProfile?.({ photoURL: dataUrl });
      toast('Photo updated');
    } catch (err) {
      toast('Could not upload photo');
    }
  });

  // Settings view toggle
  document.getElementById('acct-settings-btn')?.addEventListener('click', _showSettingsView);
  document.getElementById('settings-back-btn')?.addEventListener('click', _hideSettingsView);
  document.getElementById('acct-signout-btn')?.addEventListener('click', () => onSignOut?.());
  document.getElementById('settings-signout-btn')?.addEventListener('click', () => onSignOut?.());
}

/* ══════════════════════════════════════
   Audio sliders (DexNote-verbatim behavior)
══════════════════════════════════════ */
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
