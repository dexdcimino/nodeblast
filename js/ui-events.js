// ══════════════════════════════════════
//  NodeBlast — UI EVENTS
//  Tooltip, toast, account menu, audio (DexNote-style)
// ══════════════════════════════════════

import State from './state.js';
import { openColorPopup, closeColorPopup } from './color.js';
import { showModal as _showModal } from './modal.js';
import { SOCIAL_PLATFORMS, detectPlatform, MAX_SOCIAL_LINKS } from './social.js';

// Flag flipped by auth.js around signInWithPopup so the account menu
// click-outside-to-close handler doesn't fire when the popup opens/blurs.
let _signingIn = false;
export function setSigningIn(v) { _signingIn = !!v; }
export function isSigningIn() { return _signingIn; }

// Re-export showModal so existing importers (catalysts.js, init.js) keep working.
export const showModal = _showModal;

// ══════════════════════════════════════════════════════════════
// MD12: colon-triggered emoji picker for the bio textarea
// ══════════════════════════════════════════════════════════════
const EMOJI_CATEGORIES = [
  { icon: '😀', label: 'Smileys', emojis: ['😀','😂','😊','😍','🥰','😎','🤔','😅','😭','😤','🤯','🥳','😴','🤩','😏','🙄','😬','🤗','😇','🥺','😈','💀','👻','🤖','🎃'] },
  { icon: '👍', label: 'Gestures', emojis: ['👍','👎','👋','🤝','✌️','🤞','👌','🤌','💪','🙏','🫶','👏','🫡','🤙','☝️','🫵','🤘','✊','👊'] },
  { icon: '❤️', label: 'Hearts', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','💕','💞','💓','💗','💖','💝','💘','🫀'] },
  { icon: '🔥', label: 'Popular', emojis: ['🔥','✨','⚡','💥','🎉','🎊','🏆','💎','🚀','⭐','🌟','💯','🎯','💡','🔑','⚔️','🛡️','💰','👑','🎮'] },
  { icon: '🌙', label: 'Nature', emojis: ['🌙','☀️','🌈','⛅','🌊','🌸','🍀','🌿','🍄','🌺','🦋','🐉','🦄','🐺','🦅','🐬','🌻','🍁','❄️','🌋'] },
  { icon: '💻', label: 'Objects', emojis: ['💻','📱','🎧','🎮','🕹️','📷','🎨','✏️','📚','🔭','🧪','⚙️','🔧','💾','📡','🎵','🎤','🎸','🥁','🎹'] },
  { icon: '🍕', label: 'Food', emojis: ['🍕','🍔','🌮','🍜','🍣','🍩','🍪','☕','🧃','🍺','🥂','🍰','🧁','🍭','🥤','🧋','🍦','🥐','🍟','🌯'] },
];

const EMOJI_SHORTCODE_LIST = [
  ['smile','😊'],['laugh','😂'],['heart','❤️'],['fire','🔥'],['star','⭐'],
  ['rocket','🚀'],['thumbsup','👍'],['thumbsdown','👎'],['wave','👋'],
  ['clap','👏'],['pray','🙏'],['muscle','💪'],['ok','👌'],['check','✅'],
  ['x','❌'],['warning','⚠️'],['lightning','⚡'],['sparkles','✨'],
  ['party','🎉'],['tada','🎊'],['trophy','🏆'],['gem','💎'],['crown','👑'],
  ['target','🎯'],['key','🔑'],['lock','🔒'],['bulb','💡'],['brain','🧠'],
  ['eyes','👀'],['100','💯'],['cool','😎'],['think','🤔'],['cry','😭'],
  ['wow','🤯'],['hug','🤗'],['love','🥰'],['gun','🔫'],['sword','⚔️'],
  ['shield','🛡️'],['moon','🌙'],['sun','☀️'],['rainbow','🌈'],['snow','❄️'],
  ['tree','🌿'],['flower','🌸'],['dragon','🐉'],['wolf','🐺'],['cat','🐱'],
  ['dog','🐶'],['penguin','🐧'],['snake','🐍'],['pizza','🍕'],['coffee','☕'],
  ['code','💻'],['phone','📱'],['music','🎵'],['game','🎮'],['art','🎨'],
  ['book','📚'],['camera','📷'],['globe','🌍'],['ghost','👻'],['skull','💀'],
  ['robot','🤖'],['alien','👽'],['poop','💩'],['nerd','🤓'],
];

let _emojiPickerOpen = false;
let _emojiFullPanelOpen = false;
let _emojiSelectedIdx = 0;

function _searchEmojis(query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const results = [];
  for (const [name, emoji] of EMOJI_SHORTCODE_LIST) {
    if (name.startsWith(q)) results.push(emoji);
    if (results.length >= 8) break;
  }
  if (results.length < 8) {
    for (const [name, emoji] of EMOJI_SHORTCODE_LIST) {
      if (!name.startsWith(q) && name.includes(q) && !results.includes(emoji)) {
        results.push(emoji);
        if (results.length >= 8) break;
      }
    }
  }
  return results;
}

function _showEmojiSuggestions(emojis) {
  const picker = document.getElementById('acct-emoji-picker');
  const suggestions = document.getElementById('acct-emoji-suggestions');
  if (!picker || !suggestions) return;
  suggestions.innerHTML = '';
  if (emojis.length === 0) { _hideEmojiPicker(); return; }
  emojis.forEach((emoji, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acct-emoji-suggestion' + (i === _emojiSelectedIdx ? ' selected' : '');
    btn.textContent = emoji;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep textarea focused
      _insertEmoji(emoji);
    });
    suggestions.appendChild(btn);
  });
  picker.style.display = 'flex';
  _emojiPickerOpen = true;
}

function _hideEmojiPicker() {
  const picker = document.getElementById('acct-emoji-picker');
  if (picker) picker.style.display = 'none';
  _emojiPickerOpen = false;
  _emojiSelectedIdx = 0;
}

function _insertEmoji(emoji) {
  const ta = document.getElementById('acct-bio-input');
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const colonPos = val.lastIndexOf(':', start - 1);
  if (colonPos !== -1 && !/\s/.test(val.slice(colonPos + 1, start))) {
    ta.value = val.slice(0, colonPos) + emoji + val.slice(end);
    const newPos = colonPos + [...emoji].length;
    ta.selectionStart = ta.selectionEnd = newPos;
  } else {
    ta.value = val.slice(0, start) + emoji + val.slice(end);
    ta.selectionStart = ta.selectionEnd = start + [...emoji].length;
  }
  _hideEmojiPicker();
  _updateBioCount();
  ta.focus();
}

function _openFullEmojiPanel() {
  const panel = document.getElementById('acct-emoji-full-panel');
  if (!panel) return;
  _hideEmojiPicker();
  _renderFullEmojiPanel(0);
  const wrap = document.getElementById('acct-bio-wrap');
  if (wrap) {
    const rect = wrap.getBoundingClientRect();
    const panelH = 320;
    const panelW = 280;
    let top = rect.top - panelH - 6;
    let left = rect.left;
    if (top < 8) top = rect.bottom + 6;
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
    top = Math.max(8, Math.min(top, window.innerHeight - panelH - 8));
    left = Math.max(8, left);
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
  }
  panel.style.display = 'flex';
  _emojiFullPanelOpen = true;
}

function _renderFullEmojiPanel(catIdx) {
  const catsEl = document.getElementById('acct-emoji-panel-cats');
  const gridEl = document.getElementById('acct-emoji-panel-grid');
  if (!catsEl || !gridEl) return;
  catsEl.innerHTML = '';
  EMOJI_CATEGORIES.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acct-emoji-cat-btn' + (i === catIdx ? ' active' : '');
    btn.textContent = cat.icon;
    btn.setAttribute('data-tip', cat.label);
    btn.addEventListener('click', () => _renderFullEmojiPanel(i));
    catsEl.appendChild(btn);
  });
  gridEl.innerHTML = '';
  const currentCat = EMOJI_CATEGORIES[catIdx];
  currentCat.emojis.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acct-emoji-grid-btn';
    btn.textContent = emoji;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      _insertEmoji(emoji);
      _closeFullEmojiPanel();
    });
    gridEl.appendChild(btn);
  });
}

function _closeFullEmojiPanel() {
  const panel = document.getElementById('acct-emoji-full-panel');
  if (panel) panel.style.display = 'none';
  _emojiFullPanelOpen = false;
}

export function initBioEmojiPicker() {
  const ta = document.getElementById('acct-bio-input');
  if (!ta) return;

  ta.addEventListener('input', () => {
    const val = ta.value;
    const pos = ta.selectionStart;
    const colonPos = val.lastIndexOf(':', pos - 1);
    if (colonPos === -1) { _hideEmojiPicker(); return; }
    const fragment = val.slice(colonPos + 1, pos);
    if (/\s/.test(fragment) || fragment.length === 0) { _hideEmojiPicker(); return; }
    _emojiSelectedIdx = 0;
    _showEmojiSuggestions(_searchEmojis(fragment));
  });

  ta.addEventListener('keydown', (e) => {
    if (!_emojiPickerOpen) return;
    const suggestions = document.querySelectorAll('.acct-emoji-suggestion');
    if (e.key === 'Escape') {
      e.preventDefault();
      _hideEmojiPicker();
    } else if (e.key === 'Enter' && suggestions.length > 0) {
      e.preventDefault();
      const selected = suggestions[_emojiSelectedIdx];
      if (selected) selected.dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
      e.preventDefault();
      _emojiSelectedIdx = (_emojiSelectedIdx + 1) % suggestions.length;
      suggestions.forEach((s, i) => s.classList.toggle('selected', i === _emojiSelectedIdx));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      _emojiSelectedIdx = (_emojiSelectedIdx - 1 + suggestions.length) % suggestions.length;
      suggestions.forEach((s, i) => s.classList.toggle('selected', i === _emojiSelectedIdx));
    }
  });

  ta.addEventListener('blur', () => {
    // Delay so a mousedown on a suggestion gets to fire first.
    setTimeout(() => { if (!_emojiFullPanelOpen) _hideEmojiPicker(); }, 150);
  });

  document.getElementById('acct-emoji-expand-btn')?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    _openFullEmojiPanel();
  });
  document.getElementById('acct-emoji-panel-close')?.addEventListener('click', _closeFullEmojiPanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _emojiFullPanelOpen) {
      _closeFullEmojiPanel();
      document.getElementById('acct-bio-input')?.focus();
    }
  });

  document.addEventListener('mousedown', (e) => {
    const panel = document.getElementById('acct-emoji-full-panel');
    const expandBtn = document.getElementById('acct-emoji-expand-btn');
    if (_emojiFullPanelOpen && panel && !panel.contains(e.target) && !expandBtn?.contains(e.target)) {
      _closeFullEmojiPanel();
    }
  });
}

/* ── Shared helpers ── */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strip any ".dev" suffix from a display name. ".dev" is an automatic
// admin badge now — never part of the stored username — so this is
// applied defensively wherever we read a legacy value that still has
// it baked in.
export function stripDevSuffix(name) {
  return String(name ?? '').replace(/\.dev$/i, '').trim();
}

// Render a username with an automatic ".dev" admin badge when isAdmin
// is true. The badge is a gray, slightly smaller suffix rendered via a
// separate span so it doesn't inherit the parent color. Any ".dev"
// stored inside the name itself is stripped first — it's never supposed
// to be part of the stored value, but legacy profiles may still have it.
export function renderUsername(name, hexColor, isAdmin = false, isDev = false) {
  const base = stripDevSuffix(name || 'anon');
  const safeName = escapeHtml(base);
  const colorAttr = hexColor ? ` style="color:${escapeHtml(hexColor)}"` : '';
  let html = `<span class="uname-main"${colorAttr}>${safeName}</span>`;
  if (isAdmin) html += '<span class="uname-dev-tag">.dev</span>';
  if (isDev) html += '<span class="nb-dev-badge" title="NodeBlast Developer">DEV</span>';
  return html;
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

function _updateBioCount() {
  const input = document.getElementById('acct-bio-input');
  const count = document.getElementById('acct-bio-count');
  if (!input || !count) return;
  count.textContent = (input.value || '').length + '/150';
}

// Working set of social links while the edit panel is open. Each
// entry: { platform, url }. Reset on every panel open so Cancel
// doesn't mutate the source data.
let _editingLinks = [];

function _renderLinksList() {
  const list = document.getElementById('acct-links-list');
  const addBtn = document.getElementById('acct-links-add-btn');
  if (!list) return;
  list.innerHTML = '';
  _editingLinks.forEach((link, idx) => {
    const row = document.createElement('div');
    row.className = 'acct-link-row';
    row.dataset.idx = String(idx);
    // Platform dropdown
    const select = document.createElement('select');
    select.className = 'acct-link-platform';
    SOCIAL_PLATFORMS.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      if (p.id === link.platform) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      _editingLinks[idx].platform = select.value;
    });
    row.appendChild(select);
    // URL input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'acct-link-url';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = 'https://...';
    input.value = link.url || '';
    input.addEventListener('input', () => {
      _editingLinks[idx].url = input.value;
      // Auto-detect platform on paste/typing — but only if the user
      // hasn't explicitly picked a non-detected platform yet. We check
      // by comparing the select's current value against what detect
      // would say about the old URL; if they match, the dropdown is
      // "tracking" and we keep updating it.
      const detected = detectPlatform(input.value);
      if (detected && detected !== 'website') {
        select.value = detected;
        _editingLinks[idx].platform = detected;
      }
    });
    row.appendChild(input);
    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'acct-link-remove';
    removeBtn.setAttribute('aria-label', 'Remove link');
    removeBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.addEventListener('click', () => {
      _editingLinks.splice(idx, 1);
      _renderLinksList();
    });
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
  if (addBtn) addBtn.disabled = _editingLinks.length >= MAX_SOCIAL_LINKS;
}

// Read-only view of the current editing list. Exported so the save
// handler can capture it into the onSaveProfile payload.
function _collectLinks() {
  return _editingLinks
    .map((l) => ({ platform: l.platform || detectPlatform(l.url), url: (l.url || '').trim() }))
    .filter((l) => l.url);
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
  const bioIn = document.getElementById('acct-bio-input');
  // Strip any legacy ".dev" suffix from the input so admins see just
  // their base name — the badge lives next to the input as a static
  // span controlled by isAdmin.
  if (nameIn) { nameIn.value = stripDevSuffix(State.profile?.displayName || ''); nameIn.focus(); }
  if (hexIn) hexIn.value = '#' + (State.profile?.hexCode || '5AAA72').toUpperCase();
  if (bioIn) {
    // MD11: clear any previously dragged inline height so the textarea
    // opens at the CSS default — the max-height rule still caps growth.
    bioIn.style.height = '';
    bioIn.value = State.profile?.bio || '';
  }
  // Seed the working social links list from State. Clone objects so
  // the editing loop can mutate them without touching State.profile.
  _editingLinks = Array.isArray(State.profile?.socialLinks)
    ? State.profile.socialLinks.map((l) => ({ ...l }))
    : [];
  _renderLinksList();
  _updateEditColorPreview();
  _updateBioCount();
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

// MD22: true if any site-level modal is currently showing. Used by
// the account-dropdown outside-click + Escape handlers so that
// interacting with a modal doesn't also dismiss the dropdown
// sitting behind it.
function _isAnyModalOpen() {
  return !!document.querySelector(
    '#cat-modal.open, #signin-modal.open, #dex-modal.open, #cat-detail-popup.open, #unlock-modal.open, #backup-modal.open'
  );
}

export function openAccountMenu() {
  closeColorPopup();
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
    // MD22: when any modal is up (edit catalyst, sign-in, confirm,
    // detail popup), clicks elsewhere on the page are the user
    // interacting with the modal — not a dismissal gesture for the
    // dropdown. Leave the dropdown alone so it's still there when
    // the modal closes.
    if (_isAnyModalOpen()) return;
    closeAccountMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('acct-menu')?.classList.contains('open')) {
      // MD22: Escape with a modal showing belongs to the modal. Let
      // the modal handle it first — next Escape will fall through
      // to us and close the dropdown.
      if (_isAnyModalOpen()) return;
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

  // Edit profile — pencil icon, plus the hex dot and hex label act as
  // shortcuts into the same edit panel (DexNote parity).
  const toggleEdit = () => {
    const p = document.getElementById('acct-edit-panel');
    if (p && p.style.display === 'flex') _closeEditPanel();
    else _openEditPanel();
  };
  document.getElementById('acct-edit-btn')?.addEventListener('click', toggleEdit);
  document.getElementById('acct-hex-dot')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEdit();
  });
  document.getElementById('acct-hex-label')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEdit();
  });
  document.getElementById('acct-edit-cancel-btn')?.addEventListener('click', _closeEditPanel);
  // MD30: live space → underscore conversion on the username input.
  document.getElementById('acct-username-input')?.addEventListener('input', (e) => {
    const el = e.target;
    const cursor = el.selectionStart;
    el.value = el.value.replace(/ /g, '_');
    el.selectionStart = el.selectionEnd = cursor;
  });
  document.getElementById('acct-edit-save-btn')?.addEventListener('click', async () => {
    // MD30: safety-net strip on save in case the live handler missed
    const name = document.getElementById('acct-username-input').value.replace(/ /g, '_').trim();
    const hex = document.getElementById('acct-edit-hex-input').value.replace('#', '').toLowerCase();
    const bio = (document.getElementById('acct-bio-input')?.value || '').trim().slice(0, 150);
    const socialLinks = _collectLinks();
    if (!/^[0-9a-f]{6}$/.test(hex)) { toast('Invalid hex color'); return; }
    try {
      await onSaveProfile?.({ displayName: name || 'anon', hexCode: hex, bio, socialLinks });
      _closeEditPanel();
      toast('Profile saved');
    } catch (err) {
      toast(err?.message || 'Could not save profile');
    }
  });
  // Live character counter for the bio textarea
  document.getElementById('acct-bio-input')?.addEventListener('input', _updateBioCount);
  // Add Link button — appends a fresh row to the working set.
  document.getElementById('acct-links-add-btn')?.addEventListener('click', () => {
    if (_editingLinks.length >= MAX_SOCIAL_LINKS) return;
    _editingLinks.push({ platform: 'website', url: '' });
    _renderLinksList();
    // Focus the new input so the user can start typing immediately.
    const rows = document.querySelectorAll('#acct-links-list .acct-link-row');
    const lastRow = rows[rows.length - 1];
    lastRow?.querySelector('.acct-link-url')?.focus();
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

  // MD12: colon-triggered emoji picker for the bio textarea
  initBioEmojiPicker();
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
