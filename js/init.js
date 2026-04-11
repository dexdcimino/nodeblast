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
  refreshOwnerOnAllCatalysts,
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
  document.getElementById('cat-filter-bar').classList.remove('visible');
  document.getElementById('profile-bar').classList.remove('visible');
  document.getElementById('not-found').classList.remove('visible');
  const grid = document.getElementById('grid');
  grid.style.display = 'block';
  grid.classList.remove('with-filter', 'with-profile-bar');
}

function showFilterBar() {
  document.getElementById('cat-filter-bar').classList.add('visible');
  document.getElementById('grid').classList.add('with-filter');
}

function showProfileBar(user, catalystCount, isOwn) {
  const bar = document.getElementById('profile-bar');
  bar.classList.add('visible');
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

  document.getElementById('profile-bar-name').innerHTML = renderUsername(user.displayName || 'anon', null, !!user.isAdmin);
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
  document.getElementById('not-found').classList.add('visible');
  document.getElementById('grid').style.display = 'none';
  document.getElementById('cat-filter-bar').classList.remove('visible');
  document.getElementById('profile-bar').classList.remove('visible');
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

function paintGuestProfilePill() {
  // Default gray avatar, "Alchemist" label, guest footer visible, signed-in
  // footer hidden. Called on boot before auth resolves, and whenever the
  // user is signed out.
  const acctBtn = document.getElementById('acct-btn');
  acctBtn.style.display = 'flex';

  const avatarSm = document.getElementById('acct-avatar-sm');
  const avatarLg = document.getElementById('acct-avatar');
  if (avatarSm) { avatarSm.innerHTML = ''; avatarSm.classList.add('guest'); avatarSm.style.borderColor = ''; }
  if (avatarLg) { avatarLg.innerHTML = ''; avatarLg.classList.add('guest'); avatarLg.style.borderColor = ''; }

  document.getElementById('acct-name-short').textContent = 'Alchemist';
  document.getElementById('acct-name').textContent = 'Alchemist';
  document.getElementById('acct-hex-label').innerHTML = '';
  document.getElementById('acct-hex-dot').style.background = 'var(--tx3)';
  document.documentElement.style.setProperty('--acct-hex', 'var(--bdr)');

  // Swap footers
  document.getElementById('acct-footer').style.display = 'none';
  document.getElementById('acct-signin-footer').classList.add('visible');

  // Hide edit profile + view profile link for guests
  document.getElementById('acct-edit-btn').style.display = 'none';
  const viewProfileLink = document.getElementById('acct-view-profile');
  if (viewProfileLink) viewProfileLink.style.display = 'none';
}

function updateAuthUI(user, profile) {
  if (!user) {
    paintGuestProfilePill();
    _profileCache.clear();
    renderRoute();
    return;
  }

  const acctBtn = document.getElementById('acct-btn');
  acctBtn.style.display = 'flex';

  // Swap footers: signed-in footer visible, guest footer hidden
  document.getElementById('acct-footer').style.display = '';
  document.getElementById('acct-signin-footer').classList.remove('visible');

  // Unhide edit profile button
  const editBtn = document.getElementById('acct-edit-btn');
  if (editBtn) editBtn.style.display = '';

  // Paint avatars — guest class must come off first
  const avatarSm = document.getElementById('acct-avatar-sm');
  const avatarLg = document.getElementById('acct-avatar');
  if (avatarSm) avatarSm.classList.remove('guest');
  if (avatarLg) avatarLg.classList.remove('guest');
  setAvatarEl(avatarSm, profile, user);
  setAvatarEl(avatarLg, profile, user);

  const name = profile?.displayName || user.displayName || 'Account';
  const hex = profile?.hexCode || '5aaa72';
  const hexColor = '#' + hex;

  const isAdmin = !!profile?.isAdmin;
  const unameHtml = renderUsername(name, null, isAdmin);
  const shortName = name.length > 14 ? name.slice(0, 14) + '…' : name;
  document.getElementById('acct-name-short').innerHTML = renderUsername(shortName, null, isAdmin);
  document.getElementById('acct-name').innerHTML = unameHtml;
  // Toggle the static .dev badge next to the edit username input so the
  // user understands the suffix is automatic.
  const usernameDevBadge = document.getElementById('acct-username-dev-badge');
  if (usernameDevBadge) usernameDevBadge.style.display = isAdmin ? 'inline' : 'none';
  document.getElementById('acct-hex-label').innerHTML = `<span>#</span>${escapeHtml(hex)}`;

  // Paint the account hex everywhere via --acct-hex cascade
  document.documentElement.style.setProperty('--acct-hex', hexColor);
  if (avatarSm) avatarSm.style.borderColor = hexColor;
  if (avatarLg) avatarLg.style.borderColor = hexColor;
  document.getElementById('acct-hex-dot').style.background = hexColor;
  document.getElementById('acct-edit-color-preview').style.background = hexColor;

  const viewProfileLink = document.getElementById('acct-view-profile');
  if (viewProfileLink) {
    viewProfileLink.style.display = 'inline-block';
    viewProfileLink.dataset.username = name.toLowerCase();
  }

  // Invalidate my own profile cache so "+" tile visibility updates correctly
  if (profile?.displayName) {
    _profileCache.delete(profile.displayName.toLowerCase());
  }
  renderRoute();
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
      const oldName = State.profile?.displayName;
      // When the username is changing, paint the skeleton grid before
      // the async save so the user sees a loading state instead of a
      // brief 404 flash while Firestore catches up to the new
      // usernameLower and the URL swap happens.
      if (updates.displayName && updates.displayName !== oldName) {
        renderSkeleton();
      }
      await saveProfile(updates);
      _profileCache.clear();

      // Propagate profile changes to denormalized catalyst fields so
      // existing tiles reflect the new username/hex/photo immediately.
      if (updates.displayName || updates.hexCode || updates.photoURL) {
        await refreshOwnerOnAllCatalysts();
      }

      // If we're on our own profile route and the display name changed,
      // replace the URL with the new one before renderRoute runs so
      // getUserByUsername doesn't 404 against the old usernameLower.
      if (updates.displayName && updates.displayName !== oldName) {
        const route = getRoute();
        const oldLower = (oldName || '').toLowerCase();
        if (route.page === 'profile' && route.username.toLowerCase() === oldLower) {
          navigate(
            '/' + encodeURIComponent((State.profile.displayName || '').toLowerCase()),
            { replace: true },
          );
          // navigate() already fired renderRoute(); just refresh the
          // pill/menu/profile-bar and bail.
          updateAuthUI(State.user, State.profile);
          return;
        }
      }

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

  // Sign-in buttons live inside the account menu footer (guest mode).
  // signIn() flips the _signingIn flag so the menu's outside-click
  // handler doesn't dismiss during popup focus transitions.
  document.getElementById('google-signin-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    signIn('google');
  });
  document.getElementById('github-signin-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    signIn('github');
  });

  // Guest mode by default — paint the pill immediately so the account
  // menu is usable before auth resolves (or if the user never signs in).
  paintGuestProfilePill();

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
