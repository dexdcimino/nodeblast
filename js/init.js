import State, { BRAND } from './state.js';
import { signIn, signOut, onAuthReady, saveProfile } from './auth.js';
import { applyTheme, applyPalette, initThemeToggle, initPalettePickers } from './theme.js';
import { initColorPicker } from './color.js';
import {
  initTooltips,
  initAccountMenu,
  initAudioSettings,
  showModal,
  closeAccountMenu,
  renderUsername,
  escapeHtml,
  toast,
} from './ui-events.js';
import { renderHexGrid } from './hex-grid.js';
import {
  openCatalystModal,
  openCatalystDetail,
  closeCatalystDetail,
  initCatalystModal,
  initCatalystDetail,
  getCatalystBySlug,
  subscribeUserCatalysts,
  subscribePublicFeed,
} from './catalysts.js';
import { getUserByUsername } from './users.js';
import { initRouter, navigate, getRoute, setPageTitle } from './router.js';
import { initSearch, closeSearch, focusSearch, isSearchOpen } from './search.js';

let _currentCategory = 'all';
let _currentRoute = null;
let _currentTiles = [];
let _currentShowAdd = false;
let _currentEmptyMessage = '';
let _firstRender = true;
let _profileCache = new Map(); // usernameLower -> { user, catalysts }

// Active Firestore listeners for the current route. Cleared on every
// renderRoute() so we don't leak listeners across navigation.
let _routeSubs = [];
function trackSub(unsub) { if (typeof unsub === 'function') _routeSubs.push(unsub); }
function clearSubs() {
  _routeSubs.forEach((u) => { try { u(); } catch {} });
  _routeSubs = [];
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function setAvatarEl(el, profile, user) {
  if (!el) return;
  el.innerHTML = '';
  const src = profile?.photoURL || user?.photoURL || '';
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    el.appendChild(img);
  } else {
    el.textContent = (profile?.displayName || 'A').charAt(0).toUpperCase();
  }
}

/* ══════════════════════════════════════
   View switching
══════════════════════════════════════ */

function hideAllViews() {
  document.getElementById('cat-filter-bar').style.display = 'none';
  document.getElementById('profile-bar').style.display = 'none';
  document.getElementById('not-found').style.display = 'none';
  const grid = document.getElementById('grid');
  grid.style.display = 'block';
  grid.classList.remove('with-filter', 'with-profile-bar');
}

function showFilterBar() {
  document.getElementById('cat-filter-bar').style.display = 'flex';
  document.getElementById('grid').classList.add('with-filter');
}

function showProfileBar(user, catalystCount, isOwn) {
  const bar = document.getElementById('profile-bar');
  bar.style.display = 'flex';
  document.getElementById('grid').classList.add('with-profile-bar');

  const hexColor = '#' + (user.hexCode || '5aaa72');
  bar.style.setProperty('--acct-hex', hexColor);

  const avatar = document.getElementById('profile-bar-avatar');
  avatar.innerHTML = '';
  if (user.photoURL) {
    const img = document.createElement('img');
    img.src = user.photoURL;
    img.alt = '';
    avatar.appendChild(img);
  } else {
    avatar.textContent = (user.displayName || 'A').charAt(0).toUpperCase();
  }
  avatar.style.borderColor = hexColor;

  document.getElementById('profile-bar-name').innerHTML = renderUsername(user.displayName || 'anon');
  document.getElementById('profile-bar-hex-dot').style.background = hexColor;
  document.getElementById('profile-bar-hex-label').textContent = '#' + (user.hexCode || '5aaa72');
  document.getElementById('profile-bar-count').textContent =
    catalystCount + (catalystCount === 1 ? ' catalyst' : ' catalysts');

  const actionBtn = document.getElementById('profile-bar-action');
  const shareBtn = document.getElementById('profile-bar-share');
  if (isOwn) {
    actionBtn.textContent = 'Edit Profile';
    actionBtn.disabled = false;
    actionBtn.onclick = () => {
      openAccountMenuFromPill();
      setTimeout(() => document.getElementById('acct-edit-btn')?.click(), 80);
    };
    if (shareBtn) {
      shareBtn.style.display = 'inline-flex';
      const usernameLower = (user.usernameLower || (user.displayName || '').toLowerCase());
      shareBtn.onclick = async () => {
        const link = `${window.location.origin}/${encodeURIComponent(usernameLower)}`;
        try {
          await navigator.clipboard.writeText(link);
          toast('Profile link copied!');
        } catch {
          toast(link);
        }
      };
    }
  } else {
    actionBtn.textContent = 'Message';
    actionBtn.disabled = true;
    actionBtn.onclick = null;
    if (shareBtn) { shareBtn.style.display = 'none'; shareBtn.onclick = null; }
  }
}

function openAccountMenuFromPill() {
  document.getElementById('acct-btn')?.click();
}

function show404() {
  document.getElementById('not-found').style.display = 'flex';
  document.getElementById('grid').style.display = 'none';
  document.getElementById('cat-filter-bar').style.display = 'none';
  document.getElementById('profile-bar').style.display = 'none';
  setPageTitle(['404']);
}

/* ══════════════════════════════════════
   Route renderers
══════════════════════════════════════ */

function handleTileClick(cat) {
  if (State.user && cat.ownerId === State.user.uid) {
    openCatalystModal(cat);
  } else {
    const ownerName = (cat.ownerName || 'anon').toLowerCase();
    const slug = cat.slug || '';
    if (slug) {
      history.pushState({}, '', `/${encodeURIComponent(ownerName)}/${encodeURIComponent(slug)}`);
      setPageTitle([cat.title, cat.ownerName || 'anon']);
    }
    openCatalystDetail(cat);
  }
}

function handleCreatorClick(cat) {
  const name = (cat.ownerName || 'anon');
  navigate('/' + encodeURIComponent(name.toLowerCase()));
}

function renderGrid(tiles, { showAdd = false, emptyMessage = '' } = {}) {
  _currentTiles = tiles;
  _currentShowAdd = showAdd;
  _currentEmptyMessage = emptyMessage;
  renderHexGrid({
    tiles,
    showAdd,
    emptyMessage,
    onTileClick: handleTileClick,
    onAddClick: () => openCatalystModal(null),
    onCreatorClick: handleCreatorClick,
  });
}

function renderSkeleton() {
  renderHexGrid({ loading: true });
}

async function renderFeedRoute() {
  hideAllViews();
  showFilterBar();
  setPageTitle([]);
  renderSkeleton();
  const emptyMessage = _currentCategory === 'all'
    ? 'No catalysts yet. Be the first to share what you\'re building.'
    : 'No catalysts in this category yet.';
  // Live feed subscription — updates as new catalysts are added or votes change.
  const unsub = subscribePublicFeed(_currentCategory, (tiles) => {
    renderGrid(tiles, { showAdd: false, emptyMessage });
  });
  trackSub(unsub);
}

async function renderProfileRoute(username, { openSlug = null } = {}) {
  hideAllViews();
  setPageTitle([username]);

  const lower = username.toLowerCase();

  // Paint cached view instantly if we have one
  const cached = _profileCache.get(lower);
  if (cached) {
    const isOwn = State.user && cached.user.uid === State.user.uid;
    showProfileBar(cached.user, cached.catalysts.length, isOwn);
    renderGrid(cached.catalysts, {
      showAdd: isOwn,
      emptyMessage: isOwn
        ? 'Create your first catalyst'
        : 'This alchemist hasn\'t created any catalysts yet.',
    });
    if (openSlug) {
      const match = cached.catalysts.find((c) => c.slug === openSlug);
      if (match) openCatalystDetail(match);
    }
  } else {
    renderSkeleton();
  }

  // Resolve the user doc (always fresh — cheap enough, and we need the uid
  // for the subscription).
  const user = await getUserByUsername(username);
  if (!user) {
    if (!cached) show404();
    return;
  }
  const isOwn = State.user && user.uid === State.user.uid;
  setPageTitle([user.displayName || username]);

  // Live subscription for this user's catalysts. Replaces one-shot load.
  const unsub = subscribeUserCatalysts(user.uid, (catalysts) => {
    _profileCache.set(lower, { user, catalysts });
    showProfileBar(user, catalysts.length, isOwn);
    renderGrid(catalysts, {
      showAdd: isOwn,
      emptyMessage: isOwn
        ? 'Create your first catalyst'
        : 'This alchemist hasn\'t created any catalysts yet.',
    });
    if (openSlug) {
      const match = catalysts.find((c) => c.slug === openSlug);
      if (match) {
        setPageTitle([match.title, user.displayName || username]);
        openCatalystDetail(match);
      }
    }
  });
  trackSub(unsub);

  // If the subscription can't find the slug (possibly an old link to a
  // deleted catalyst or a fresh fetch race), fall back to a direct lookup.
  if (openSlug) {
    const direct = await getCatalystBySlug(user.uid, openSlug);
    if (direct) {
      setPageTitle([direct.title, user.displayName || username]);
      openCatalystDetail(direct);
    }
  }
}

async function renderRoute() {
  // Tear down any listeners from the previous route
  clearSubs();

  const route = getRoute();
  _currentRoute = route;
  const honey = document.getElementById('honeycomb');

  // Smooth fade between routes (skip the very first render)
  if (!_firstRender && honey) {
    honey.style.opacity = '0';
    await wait(150);
  }
  _firstRender = false;

  try {
    if (route.page === 'feed') {
      await renderFeedRoute();
    } else if (route.page === 'profile') {
      await renderProfileRoute(route.username);
    } else if (route.page === 'catalyst') {
      await renderProfileRoute(route.username, { openSlug: route.slug });
    } else {
      show404();
    }
  } finally {
    if (honey) honey.style.opacity = '1';
  }
}

/* ══════════════════════════════════════
   Auth UI
══════════════════════════════════════ */

function updateAuthUI(user, profile) {
  const signinBtn = document.getElementById('signin-btn');
  const acctBtn = document.getElementById('acct-btn');
  const viewProfileLink = document.getElementById('acct-view-profile');
  const hexColor = '#' + (profile?.hexCode || '5AAA72');

  if (user) {
    closeSigninMenu();
    signinBtn.style.display = 'none';
    acctBtn.style.display = 'flex';

    setAvatarEl(document.getElementById('acct-avatar-sm'), profile, user);
    setAvatarEl(document.getElementById('acct-avatar'), profile, user);

    const name = profile?.displayName || user.displayName || 'Account';
    const hex = profile?.hexCode || '5aaa72';
    const unameHtml = renderUsername(name);
    document.getElementById('acct-name-short').innerHTML =
      `${unameHtml}<span class="acct-name-hex">#${escapeHtml(hex)}</span>`;
    document.getElementById('acct-name').innerHTML = unameHtml;
    document.getElementById('acct-hex-label').textContent = '#' + hex;

    document.getElementById('acct-avatar-sm').style.borderColor = hexColor;
    document.getElementById('acct-avatar').style.borderColor = hexColor;
    document.getElementById('acct-hex-dot').style.background = hexColor;
    document.getElementById('acct-edit-color-preview').style.background = hexColor;

    if (viewProfileLink) {
      viewProfileLink.style.display = 'inline-block';
      viewProfileLink.dataset.username = name.toLowerCase();
    }
  } else {
    signinBtn.style.display = 'inline-flex';
    acctBtn.style.display = 'none';
    if (viewProfileLink) viewProfileLink.style.display = 'none';
  }

  // Invalidate my own profile cache so "+" tile visibility updates correctly
  if (profile?.displayName) {
    _profileCache.delete(profile.displayName.toLowerCase());
  }
  // Re-render the current route — auth state affects owner detection
  renderRoute();
}

function openSigninMenu() {
  const menu = document.getElementById('signin-menu');
  const btn = document.getElementById('signin-btn');
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.style.left = 'auto';
  menu.classList.add('open');
}
function closeSigninMenu() {
  document.getElementById('signin-menu')?.classList.remove('open');
  const err = document.getElementById('auth-error');
  if (err) err.style.display = 'none';
}

/* ══════════════════════════════════════
   Boot
══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('hdr-brand').textContent = BRAND;

  applyTheme(State.theme, true);
  applyPalette(State.palette);

  initTooltips();
  initThemeToggle();
  initPalettePickers();
  initColorPicker();
  initAudioSettings();
  initAccountMenu({
    onSignOut: () => {
      showModal({
        title: 'Sign out?',
        msg: 'You will need to sign in again to access your account.',
        confirmLabel: 'Sign out',
        danger: true,
        onConfirm: () => signOut(),
      });
    },
    onSaveProfile: async (updates) => {
      await saveProfile(updates);
      _profileCache.clear();
      updateAuthUI(State.user, State.profile);
    },
  });

  initCatalystModal(() => {
    _profileCache.clear();
    renderRoute();
  });
  initCatalystDetail();
  initRouter(renderRoute);
  initSearch();

  // Brand + logo → home
  document.getElementById('hdr-brand')?.addEventListener('click', () => navigate('/'));
  document.getElementById('hdr-logo')?.addEventListener('click', () => navigate('/'));

  // "View my profile" link in account menu
  document.getElementById('acct-view-profile')?.addEventListener('click', (e) => {
    e.preventDefault();
    const username = e.currentTarget.dataset.username;
    if (username) {
      navigate('/' + encodeURIComponent(username));
      closeAccountMenu();
    }
  });

  // 404 → home
  document.getElementById('not-found-home')?.addEventListener('click', () => navigate('/'));

  // Header sign-in button → open dropdown
  document.getElementById('signin-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('signin-menu');
    if (menu?.classList.contains('open')) closeSigninMenu();
    else openSigninMenu();
  });
  document.getElementById('google-signin-btn')?.addEventListener('click', async () => {
    await signIn('google');
    closeSigninMenu();
  });
  document.getElementById('github-signin-btn')?.addEventListener('click', async () => {
    await signIn('github');
    closeSigninMenu();
  });
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('signin-menu');
    if (!menu?.classList.contains('open')) return;
    if (menu.contains(e.target)) return;
    if (document.getElementById('signin-btn')?.contains(e.target)) return;
    closeSigninMenu();
  });

  // Category filter pills (feed route)
  document.querySelectorAll('.cat-filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cat-filter-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      _currentCategory = pill.dataset.cat;
      if (_currentRoute?.page === 'feed') renderFeedRoute();
    });
  });

  // When the catalyst detail popup closes via back button, strip the slug
  // from the URL so a refresh lands on the profile page, not the catalyst.
  window.addEventListener('popstate', () => {
    closeCatalystDetail();
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (e.key === '/' && !isTyping) {
      e.preventDefault();
      focusSearch();
      return;
    }
    if (e.key === 'Escape') {
      // Let individual components handle their own Escape first (they all
      // listen on document). This block is a catchall for the search
      // dropdown in case something slips through.
      if (isSearchOpen()) { closeSearch(); return; }
    }
  });

  onAuthReady(updateAuthUI);
  renderRoute();
  window.addEventListener('resize', () => {
    renderHexGrid({
      tiles: _currentTiles,
      showAdd: _currentShowAdd,
      onTileClick: handleTileClick,
      onAddClick: () => openCatalystModal(null),
      onCreatorClick: handleCreatorClick,
    });
  });
});
