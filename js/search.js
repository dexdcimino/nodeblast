// ══════════════════════════════════════
//  NodeBlast — SEARCH
//  Debounced user + catalyst search with dropdown UI
// ══════════════════════════════════════

import { searchUsers } from './users.js';
import { searchCatalysts } from './catalysts.js';
import { navigate } from './router.js';
import { renderUsername, escapeHtml } from './ui-events.js';

const DEBOUNCE_MS = 300;

let _debounceT = null;
let _lastQuery = '';
let _results = { users: [], catalysts: [] };
let _active = { list: null, idx: -1 };

function open() {
  document.getElementById('search-wrap')?.classList.add('open');
  setTimeout(() => document.getElementById('search-input')?.focus(), 40);
}

export function closeSearch() {
  const wrap = document.getElementById('search-wrap');
  if (!wrap) return;
  wrap.classList.remove('open');
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const dropdown = document.getElementById('search-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
    dropdown.innerHTML = '';
  }
  _results = { users: [], catalysts: [] };
  _active = { list: null, idx: -1 };
  _lastQuery = '';
}

export function focusSearch() {
  open();
}

function navigateToUser(user) {
  const lower = (user.usernameLower || user.displayName || '').toLowerCase();
  if (!lower) return;
  navigate('/' + encodeURIComponent(lower));
  closeSearch();
}

function navigateToCatalyst(cat) {
  const owner = (cat.ownerName || 'anon').toLowerCase();
  const slug = cat.slug || '';
  if (slug) navigate(`/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`);
  else navigate('/' + encodeURIComponent(owner));
  closeSearch();
}

function renderResults() {
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown) return;
  const { users, catalysts } = _results;
  if (users.length === 0 && catalysts.length === 0) {
    dropdown.innerHTML = '<div class="search-empty">No results found</div>';
    dropdown.classList.add('visible');
    return;
  }

  let html = '';
  if (users.length > 0) {
    html += '<div class="search-section-title">Users</div>';
    users.forEach((u, i) => {
      const name = u.displayName || 'anon';
      const hex = u.hexCode || '5aaa72';
      const photo = u.photoURL ? `<img src="${escapeHtml(u.photoURL)}" alt="">` : escapeHtml(name.charAt(0).toUpperCase());
      html += `
        <div class="search-result" data-kind="user" data-idx="${i}">
          <div class="search-result-avatar" style="border-color:#${escapeHtml(hex)}">${photo}</div>
          <div class="search-result-body">
            <div class="search-result-name">${renderUsername(name, null, !!u.isAdmin)}<span style="color:var(--tx3)">#${escapeHtml(hex)}</span></div>
          </div>
        </div>
      `;
    });
  }
  if (catalysts.length > 0) {
    html += '<div class="search-section-title">Catalysts</div>';
    catalysts.forEach((c, i) => {
      const title = escapeHtml(c.title || '');
      const owner = renderUsername(c.ownerName || 'anon', null, !!c.ownerIsAdmin);
      const category = escapeHtml(c.category || 'sites');
      html += `
        <div class="search-result" data-kind="catalyst" data-idx="${i}">
          <div class="search-result-avatar" style="background:${escapeHtml(c.accentColor || '#5AAA72')};border-color:${escapeHtml(c.accentColor || '#5AAA72')}"></div>
          <div class="search-result-body">
            <div class="search-result-name">${title}</div>
            <div class="search-result-sub">by ${owner}</div>
          </div>
          <span class="search-result-badge">${category}</span>
        </div>
      `;
    });
  }
  dropdown.innerHTML = html;
  dropdown.classList.add('visible');

  dropdown.querySelectorAll('.search-result').forEach((el) => {
    el.addEventListener('click', () => {
      const kind = el.dataset.kind;
      const idx = Number(el.dataset.idx);
      if (kind === 'user') navigateToUser(_results.users[idx]);
      else navigateToCatalyst(_results.catalysts[idx]);
    });
  });
}

async function runSearch(q) {
  _lastQuery = q;
  try {
    const [users, catalysts] = await Promise.all([
      searchUsers(q),
      searchCatalysts(q),
    ]);
    // Ignore stale responses
    if (q !== _lastQuery) return;
    _results = { users, catalysts };
    renderResults();
  } catch (err) {
    console.warn('[search] failed:', err);
  }
}

function onInput() {
  const input = document.getElementById('search-input');
  const dropdown = document.getElementById('search-dropdown');
  if (!input || !dropdown) return;
  const q = input.value.trim();
  clearTimeout(_debounceT);
  if (!q) {
    dropdown.classList.remove('visible');
    _results = { users: [], catalysts: [] };
    _lastQuery = '';
    return;
  }
  _debounceT = setTimeout(() => runSearch(q), DEBOUNCE_MS);
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (_results.users.length > 0) navigateToUser(_results.users[0]);
    else if (_results.catalysts.length > 0) navigateToCatalyst(_results.catalysts[0]);
  }
}

export function initSearch() {
  const btn = document.getElementById('search-btn');
  const input = document.getElementById('search-input');
  const closeBtn = document.getElementById('search-close');
  const wrap = document.getElementById('search-wrap');

  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (wrap?.classList.contains('open')) closeSearch();
    else open();
  });
  closeBtn?.addEventListener('click', closeSearch);
  input?.addEventListener('input', onInput);
  input?.addEventListener('keydown', onKeydown);

  document.addEventListener('click', (e) => {
    if (!wrap?.classList.contains('open')) return;
    if (wrap.contains(e.target)) return;
    closeSearch();
  });
}

export function isSearchOpen() {
  return document.getElementById('search-wrap')?.classList.contains('open');
}
