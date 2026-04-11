import State from './state.js';
import { signIn, signOut, onAuthReady, saveProfile, saveLogoColors } from './auth.js';
import {
  applyTheme,
  applyPalette,
  applyAccent,
  applyFavicon,
  initThemeToggle,
  initPalettePickers,
  LOGO_PALETTE,
  DEFAULT_LOGO_TOP,
  DEFAULT_LOGO_BOT,
} from './theme.js';
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
import { renderHexGrid, createCatalystTileElement } from './hex-grid.js';
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
  reorderCatalysts,
} from './catalysts.js';
import { getUserByUsernameHex } from './users.js';
import { initRouter, navigate, getRoute, setPageTitle, buildUserSlug } from './router.js';
import { initSearch, closeSearch, focusSearch, isSearchOpen } from './search.js';
import { initNotifications, initHelpPanel } from './notifications.js';
import { initFriends, setFriendsCurrentUser, isFriend, sendFriendRequest } from './friends.js';

let _currentCategory = 'all';
let _currentRoute = null;
let _currentTiles = [];
let _currentShowAdd = false;
let _currentEmptyMessage = '';
let _firstRender = true;
let _profileCache = new Map(); // "name#hex" or "name" -> { user, catalysts }
let _viewingOther = null;       // { uid, displayName, hexCode } for the profile currently shown

function profileCacheKey(username, hex) {
  const lower = (username || '').toLowerCase();
  return hex ? lower + '#' + hex.toLowerCase() : lower;
}

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
  document.getElementById('profile-bio')?.classList.remove('visible');
  document.getElementById('not-found').classList.remove('visible');
  const grid = document.getElementById('grid');
  grid.style.display = 'block';
  grid.classList.remove('with-filter', 'feed-mode');
  // Empty the community list so a previous render doesn't flash back
  // while a new subscription is warming up.
  const list = document.getElementById('community-list');
  if (list) list.innerHTML = '';
}

function showFilterBar() {
  document.getElementById('cat-filter-bar').classList.add('visible');
  document.getElementById('grid').classList.add('with-filter');
}

function showProfileBar(user, catalystCount, isOwn) {
  const bar = document.getElementById('profile-bar');
  bar.classList.add('visible');

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

  // Bio: show only if set. Empty bios render no placeholder at all
  // so the grid sits flush under the profile bar.
  const bioEl = document.getElementById('profile-bio');
  if (bioEl) {
    const bio = (user.bio || '').toString().trim();
    if (bio) {
      bioEl.textContent = bio;
      bioEl.classList.add('visible');
    } else {
      bioEl.textContent = '';
      bioEl.classList.remove('visible');
    }
  }

  const actionBtn = document.getElementById('profile-bar-action');
  const shareBtn = document.getElementById('profile-bar-share');
  if (isOwn) {
    _viewingOther = null;
    actionBtn.textContent = 'Edit Profile';
    actionBtn.disabled = false;
    actionBtn.classList.remove('is-friend');
    actionBtn.onclick = () => {
      openAccountMenuFromPill();
      setTimeout(() => document.getElementById('acct-edit-btn')?.click(), 80);
    };
    if (shareBtn) {
      shareBtn.style.display = 'inline-flex';
      const usernameLower = (user.usernameLower || (user.displayName || '').toLowerCase());
      const hex = user.hexCode || '';
      shareBtn.onclick = async () => {
        const slug = buildUserSlug(usernameLower, hex);
        const link = `${window.location.origin}/${slug}`;
        try {
          await navigator.clipboard.writeText(link);
          toast('Profile link copied!');
        } catch {
          toast(link);
        }
      };
    }
  } else {
    // Not our own profile — the action button becomes "Add Friend" /
    // "✓ Friends" so people can connect directly from a profile page.
    // The Friends check is driven by the live friends cache, so the
    // button can flip from "Add Friend" → "✓ Friends" automatically
    // the moment the Firestore write is mirrored back.
    _viewingOther = { uid: user.uid, displayName: user.displayName, hexCode: user.hexCode };
    _applyFriendButton(user);
    if (shareBtn) { shareBtn.style.display = 'none'; shareBtn.onclick = null; }
  }
}

function _applyFriendButton(user) {
  const actionBtn = document.getElementById('profile-bar-action');
  if (!actionBtn || !user) return;
  const signedIn = !!State.user;
  const already = signedIn && isFriend(user.uid);
  if (already) {
    actionBtn.textContent = '✓ Friends';
    actionBtn.disabled = true;
    actionBtn.classList.add('is-friend');
    actionBtn.onclick = null;
  } else {
    actionBtn.textContent = 'Add Friend';
    actionBtn.disabled = !signedIn;
    actionBtn.classList.remove('is-friend');
    actionBtn.onclick = async () => {
      if (!State.user) { toast('Sign in to add friends'); return; }
      actionBtn.disabled = true;
      actionBtn.textContent = 'Sending…';
      await sendFriendRequest(user.uid);
      // Reset label — the friends listener will flip us to "✓ Friends"
      // once the other side accepts.
      actionBtn.textContent = 'Request sent';
      setTimeout(() => {
        if (_viewingOther?.uid === user.uid) _applyFriendButton(user);
      }, 1800);
    };
  }
}

// Called by friends.js whenever the live friends list changes so the
// "Add Friend" button on the profile bar flips to "✓ Friends" without
// a manual refresh.
window._nbRefreshFriendBtn = () => {
  if (!_viewingOther) return;
  _applyFriendButton(_viewingOther);
};

// Paints the Community / My Profile segmented toggle in the header
// based on the current route + sign-in state. Safe to call any time
// — it only touches classes + the disabled flag.
function _updateViewToggle() {
  const community = document.getElementById('view-toggle-community');
  const profile = document.getElementById('view-toggle-profile');
  if (!community || !profile) return;
  const route = _currentRoute || getRoute();
  const signedIn = !!State.user;
  community.classList.toggle('selected', route.page === 'feed');

  // "My Profile" is the selected view only when we're on our OWN
  // profile route — visiting another user's profile should leave
  // both tabs inactive (we're viewing a third party).
  const myLower = (State.profile?.displayName || '').toLowerCase();
  const myHex = (State.profile?.hexCode || '').toLowerCase();
  const routeLower = (route.username || '').toLowerCase();
  const routeHex = (route.hex || '').toLowerCase();
  const isOwnProfile = route.page === 'profile'
    && signedIn
    && routeLower === myLower
    && (routeHex ? routeHex === myHex : true);
  profile.classList.toggle('selected', isOwnProfile);
  profile.disabled = !signedIn;
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
    const ownerHex = cat.ownerHex || '';
    const slug = cat.slug || '';
    if (slug) {
      const userPart = buildUserSlug(ownerName, ownerHex);
      history.pushState({}, '', `/${userPart}/${encodeURIComponent(slug)}`);
      setPageTitle([cat.title, cat.ownerName || 'anon']);
    }
    openCatalystDetail(cat);
  }
}

function handleCreatorClick(cat) {
  const name = (cat.ownerName || 'anon').toLowerCase();
  const hex = cat.ownerHex || '';
  navigate('/' + buildUserSlug(name, hex));
}

async function handleReorder(orderedIds) {
  if (!State.user) return;
  // Optimistically reorder the local tile list so subsequent renders
  // (resize, etc.) don't flash the old order while Firestore catches up.
  const byId = new Map(_currentTiles.map((t) => [t.id, t]));
  const next = [];
  orderedIds.forEach((id, i) => {
    const t = byId.get(id);
    if (!t) return;
    // Mirror the sortOrder the write will apply, so sortUserCatalysts
    // in the subscription callback produces the same order when the
    // snapshot fires.
    next.push({ ...t, sortOrder: i });
  });
  _currentTiles = next;
  try {
    await reorderCatalysts(State.user.uid, orderedIds);
  } catch (err) {
    console.warn('[init] reorder persist failed:', err);
    toast('Reorder failed');
  }
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
    onReorder: showAdd ? handleReorder : null,
  });
}

function renderSkeleton() {
  renderHexGrid({ loading: true });
}

/* ══════════════════════════════════════
   Community hub — per-creator cards
══════════════════════════════════════ */

// Group an array of catalysts by ownerId. Returns a Map of
// ownerId → { creator, catalysts } where creator captures the latest
// denormalized owner fields we can read from any of that creator's
// catalysts (all of their tiles should agree, so reading from the
// first one is fine; the freshest tile wins if there's drift).
function _groupCatalystsByCreator(catalysts) {
  const groups = new Map();
  for (const cat of catalysts) {
    const ownerId = cat.ownerId || 'anon';
    let g = groups.get(ownerId);
    if (!g) {
      g = {
        uid: ownerId,
        displayName: cat.ownerName || 'anon',
        hexCode: (cat.ownerHex || '5aaa72').toLowerCase(),
        photoURL: cat.ownerPhoto || '',
        isAdmin: !!cat.ownerIsAdmin,
        catalysts: [],
        latestCreatedAt: 0,
      };
      groups.set(ownerId, g);
    }
    g.catalysts.push(cat);
    const ts = cat.createdAt?.toMillis?.() ?? 0;
    if (ts > g.latestCreatedAt) g.latestCreatedAt = ts;
  }
  return groups;
}

// Sort comparator for tiles within a creator card. sortOrder (explicit
// drag-arranged position) wins when present; falls back to createdAt
// desc so fresh uploads bubble up. Mirrors sortUserCatalysts() in
// catalysts.js but is duplicated here to keep hex-grid.js → init.js
// dependencies one-way.
function _sortCardTiles(tiles) {
  return tiles.slice().sort((a, b) => {
    const aHas = a.sortOrder != null;
    const bHas = b.sortOrder != null;
    if (aHas && bHas) return a.sortOrder - b.sortOrder;
    if (aHas) return 1;
    if (bHas) return -1;
    const ta = a.createdAt?.toMillis?.() ?? 0;
    const tb = b.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
}

// Size for community-card tiles. Kept fixed rather than computed
// against container width so tiles stay visually consistent between
// cards no matter how many catalysts a creator has. 180px works well
// alongside the card's padding and the grid's side margins.
const COMMUNITY_TILE_W = 180;
const COMMUNITY_TILE_H = Math.round(COMMUNITY_TILE_W * 1.1547);

function _buildCommunityCard(group) {
  const hex = group.hexCode;
  const hexColor = '#' + hex;
  const card = document.createElement('div');
  card.className = 'community-card';
  card.style.setProperty('--card-hex', hexColor);

  // Header row — avatar + name + hex + count. Clicking anywhere in the
  // header navigates to the creator's full profile page.
  const hdr = document.createElement('div');
  hdr.className = 'community-card-hdr';

  const avatar = document.createElement('div');
  avatar.className = 'community-card-avatar';
  if (group.photoURL) {
    const img = document.createElement('img');
    img.src = group.photoURL;
    img.alt = '';
    avatar.appendChild(img);
  } else {
    avatar.textContent = (group.displayName || 'A').charAt(0).toUpperCase();
  }
  hdr.appendChild(avatar);

  const meta = document.createElement('div');
  meta.className = 'community-card-meta';
  const nameEl = document.createElement('span');
  nameEl.className = 'community-card-name';
  nameEl.innerHTML = renderUsername(group.displayName || 'anon', null, !!group.isAdmin);
  const hexRow = document.createElement('span');
  hexRow.className = 'community-card-hex-row';
  hexRow.innerHTML = `<span class="community-card-hex-dot"></span><span class="community-card-hex">#${escapeHtml(hex)}</span>`;
  meta.appendChild(nameEl);
  meta.appendChild(hexRow);
  hdr.appendChild(meta);

  const count = document.createElement('span');
  count.className = 'community-card-count';
  const n = group.catalysts.length;
  count.textContent = n + (n === 1 ? ' catalyst' : ' catalysts');
  hdr.appendChild(count);

  hdr.addEventListener('click', () => {
    const lower = (group.displayName || '').toLowerCase();
    navigate('/' + buildUserSlug(lower, hex));
  });

  card.appendChild(hdr);

  // Body — flex-wrap row of standalone hex tiles.
  const body = document.createElement('div');
  body.className = 'community-tiles';
  _sortCardTiles(group.catalysts).forEach((cat) => {
    const tile = createCatalystTileElement(
      cat,
      { width: COMMUNITY_TILE_W, height: COMMUNITY_TILE_H },
      { onTileClick: handleTileClick, onCreatorClick: handleCreatorClick },
    );
    body.appendChild(tile);
  });
  card.appendChild(body);

  return card;
}

function renderCommunityHub(catalysts, { emptyMessage } = {}) {
  const grid = document.getElementById('grid');
  const list = document.getElementById('community-list');
  if (!grid || !list) return;

  grid.classList.add('feed-mode');
  list.innerHTML = '';

  if (!catalysts || catalysts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'community-empty';
    empty.textContent = emptyMessage || 'No catalysts yet. Be the first to share what you\'re building.';
    list.appendChild(empty);
    return;
  }

  // Group, then sort creators by most recent activity (biggest
  // createdAt among their catalysts wins). Within each card, tiles
  // honor sortOrder → createdAt via _sortCardTiles.
  const groups = Array.from(_groupCatalystsByCreator(catalysts).values());
  groups.sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);
  groups.forEach((g) => list.appendChild(_buildCommunityCard(g)));
}

async function renderFeedRoute() {
  hideAllViews();
  showFilterBar();
  setPageTitle([]);
  // Skeleton briefly paints into #honeycomb before .feed-mode flips
  // over to the community list. Acceptable loading flash — swapping
  // to a community-shaped skeleton would double the code for a
  // sub-second difference.
  renderSkeleton();
  const emptyMessage = _currentCategory === 'all'
    ? 'No catalysts yet. Be the first to share what you\'re building.'
    : 'No catalysts in this category yet.';
  const unsub = subscribePublicFeed(_currentCategory, (catalysts) => {
    renderCommunityHub(catalysts, { emptyMessage });
  });
  trackSub(unsub);
}

async function renderProfileRoute(username, hex, { openSlug = null } = {}) {
  hideAllViews();
  setPageTitle([username]);

  const cacheKey = profileCacheKey(username, hex);

  // Paint cached view instantly if we have one
  const cached = _profileCache.get(cacheKey);
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
  const user = await getUserByUsernameHex(username, hex);
  if (!user) {
    if (!cached) show404();
    return;
  }
  const isOwn = State.user && user.uid === State.user.uid;
  setPageTitle([user.displayName || username]);

  // Live subscription for this user's catalysts. Replaces one-shot load.
  const unsub = subscribeUserCatalysts(user.uid, (catalysts) => {
    _profileCache.set(cacheKey, { user, catalysts });
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
  _updateViewToggle();
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
      await renderProfileRoute(route.username, route.hex);
    } else if (route.page === 'catalyst') {
      await renderProfileRoute(route.username, route.hex, { openSlug: route.slug });
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

  // Hide edit profile for guests
  document.getElementById('acct-edit-btn').style.display = 'none';
  _updateViewToggle();
}

function updateAuthUI(user, profile) {
  if (!user) {
    paintGuestProfilePill();
    _profileCache.clear();
    _viewingOther = null;
    setFriendsCurrentUser(null);
    renderRoute();
    return;
  }

  // Attach the friends/requests listeners to this user. Safe to call
  // on every auth resolution — setFriendsCurrentUser tears down the
  // previous subscription before starting a new one.
  setFriendsCurrentUser(user.uid);

  // Sync the saved logo colors across devices. If the signed-in
  // user has stored values in their profile doc, adopt them.
  // Otherwise leave whatever the guest-mode picker left behind.
  if (profile?.logoTopColor || profile?.logoBotColor) {
    const nextTop = profile.logoTopColor || _logoTop;
    const nextBot = profile.logoBotColor || _logoBot;
    if (nextTop !== _logoTop || nextBot !== _logoBot) {
      setLogoColors(nextTop, nextBot);
    }
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

  _updateViewToggle();

  // Invalidate my own profile cache so "+" tile visibility updates correctly
  if (profile?.displayName) {
    const lower = profile.displayName.toLowerCase();
    _profileCache.delete(lower);
    if (profile.hexCode) _profileCache.delete(lower + '#' + profile.hexCode.toLowerCase());
  }
  renderRoute();
}

/* ══════════════════════════════════════
   Boot
══════════════════════════════════════ */

// ══════════════════════════════════════════════════════════════
//  Logo color picker (two columns)
// ──────────────────────────────────────────────────────────────
//  Hovering the logo opens a 2-column dropdown. Both columns share
//  the same 10-color LOGO_PALETTE. The LEFT (top) column paints
//  the "top" half of the logo, the "blast" wordmark, and drives
//  the site-wide accent (--clr). The RIGHT (bot) column paints the
//  other half of the logo and the "node" wordmark. The favicon
//  rebuilds via applyFavicon() on every change.
//  Guests persist to localStorage; signed-in users also sync to
//  Firestore (logoTopColor / logoBotColor on users/{uid}).
// ══════════════════════════════════════════════════════════════

const LOGO_TOP_KEY = 'nb-logo-top-color';
const LOGO_BOT_KEY = 'nb-logo-bot-color';

let _logoTop = DEFAULT_LOGO_TOP;
let _logoBot = DEFAULT_LOGO_BOT;

function paintLogo(top, bot) {
  // The SVG IDs in index.html are confusingly named — the path data
  // doesn't match the names. Mapping by VISUAL intent:
  //
  //   Big top yin-yang half  → id="nodeblast_circle_bottom"
  //   Big bottom yin-yang half → id="nodeblast_logo_bottom"
  //   Small upper inner dot  → id="nodeblast_circle_top"
  //   Small lower inner dot  → id="nodeblast_logo_top"
  //
  // Spec: top half pairs with "node" + left column color, bottom
  // half pairs with "blast" + right column color, both small dots
  // are transparent negative space.

  // Left column (top color) → big top half + "node" wordmark.
  const bigTop = document.getElementById('nodeblast_circle_bottom');
  const nodeEl = document.getElementById('brand-node');
  if (bigTop) bigTop.setAttribute('fill', top);
  if (nodeEl) nodeEl.style.color = top;

  // Right column (bot color) → big bottom half + "blast" wordmark.
  const bigBot  = document.getElementById('nodeblast_logo_bottom');
  const blastEl = document.getElementById('brand-blast');
  if (bigBot)  bigBot.setAttribute('fill', bot);
  if (blastEl) blastEl.style.color = bot;

  // Both small inner dots → transparent (header bg shows through).
  const upperDot = document.getElementById('nodeblast_circle_top');
  const lowerDot = document.getElementById('nodeblast_logo_top');
  if (upperDot) upperDot.setAttribute('fill', 'transparent');
  if (lowerDot) lowerDot.setAttribute('fill', 'transparent');
}

function markSelectedSwatches() {
  const topLc = (_logoTop || '').toLowerCase();
  const botLc = (_logoBot || '').toLowerCase();
  document.querySelectorAll('#logo-picker .logo-picker-col[data-col="top"] .logo-swatch')
    .forEach((b) => b.classList.toggle('selected', b.dataset.color.toLowerCase() === topLc));
  document.querySelectorAll('#logo-picker .logo-picker-col[data-col="bot"] .logo-swatch')
    .forEach((b) => b.classList.toggle('selected', b.dataset.color.toLowerCase() === botLc));
}

// Apply both colors end-to-end: SVG paint, wordmark color, the
// site-wide accent (driven by the TOP color), favicon, swatch
// rings, and localStorage. Firestore persistence is layered on
// top by the picker click handler when a signed-in user clicks.
function setLogoColors(top, bot) {
  _logoTop = top || DEFAULT_LOGO_TOP;
  _logoBot = bot || DEFAULT_LOGO_BOT;
  paintLogo(_logoTop, _logoBot);
  applyAccent(_logoTop);            // site --clr follows the top color
  applyFavicon(_logoTop, _logoBot); // rebuild the browser tab icon
  markSelectedSwatches();
  try {
    localStorage.setItem(LOGO_TOP_KEY, _logoTop);
    localStorage.setItem(LOGO_BOT_KEY, _logoBot);
  } catch {}
}

function buildPickerColumn(col) {
  const wrap = document.createElement('div');
  wrap.className = 'logo-picker-col';
  wrap.dataset.col = col;
  LOGO_PALETTE.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'logo-swatch';
    btn.type = 'button';
    btn.dataset.color = c.hex;
    btn.style.background = c.hex;
    btn.title = c.name;
    wrap.appendChild(btn);
  });
  return wrap;
}

function initLogoPicker() {
  const picker = document.getElementById('logo-picker');
  const logoEl = document.getElementById('hdr-logo');
  if (!picker || !logoEl) return;

  picker.innerHTML = '';
  picker.appendChild(buildPickerColumn('top'));
  picker.appendChild(buildPickerColumn('bot'));

  // Initial paint — respect any cached values the user picked on a
  // previous visit, else fall back to the defaults.
  const initialTop = localStorage.getItem(LOGO_TOP_KEY) || DEFAULT_LOGO_TOP;
  const initialBot = localStorage.getItem(LOGO_BOT_KEY) || DEFAULT_LOGO_BOT;
  setLogoColors(initialTop, initialBot);

  let hideTimer = null;
  const show = () => {
    clearTimeout(hideTimer); hideTimer = null;
    picker.classList.add('open');
  };
  const hide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => picker.classList.remove('open'), 180);
  };
  logoEl.addEventListener('mouseenter', show);
  logoEl.addEventListener('mouseleave', hide);
  picker.addEventListener('mouseenter', show);
  picker.addEventListener('mouseleave', hide);

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.logo-swatch');
    if (!btn) return;
    e.stopPropagation();
    const col = btn.closest('.logo-picker-col')?.dataset.col;
    const newColor = btn.dataset.color;
    if (!col || !newColor) return;
    if (col === 'top') setLogoColors(newColor, _logoBot);
    else               setLogoColors(_logoTop, newColor);
    if (State.user) {
      saveLogoColors(col === 'top'
        ? { logoTopColor: newColor }
        : { logoBotColor: newColor });
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Palette first, accent second — applyPalette writes --clr, so the
  // logo accent must be applied *after* it to end up as the effective
  // site color.
  applyTheme(State.theme, true);
  applyPalette(State.palette);
  initLogoPicker();

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
      const oldHex = State.profile?.hexCode;
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

      // If we're on our own profile route and the name or hex changed,
      // replace the URL with the new username.hex combo before
      // renderRoute runs so the lookup resolves against the new values.
      const nameChanged = updates.displayName && updates.displayName !== oldName;
      const hexChanged = updates.hexCode && updates.hexCode !== oldHex;
      if (nameChanged || hexChanged) {
        const route = getRoute();
        const oldLower = (oldName || '').toLowerCase();
        if (route.page === 'profile' && route.username.toLowerCase() === oldLower) {
          const nextLower = (State.profile.displayName || '').toLowerCase();
          const nextHex = State.profile.hexCode || '';
          navigate('/' + buildUserSlug(nextLower, nextHex), { replace: true });
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
  initNotifications();
  initHelpPanel();
  initFriends();

  // Brand + logo → home
  document.getElementById('hdr-brand')?.addEventListener('click', () => navigate('/'));
  document.getElementById('hdr-logo')?.addEventListener('click', () => navigate('/'));

  // Community / My Profile view toggle in the header.
  document.getElementById('view-toggle-community')?.addEventListener('click', () => {
    navigate('/');
  });
  document.getElementById('view-toggle-profile')?.addEventListener('click', () => {
    if (!State.user) { toast('Sign in to view your profile'); return; }
    const name = (State.profile?.displayName || '').toLowerCase();
    const hex = State.profile?.hexCode || '';
    if (name) navigate('/' + buildUserSlug(name, hex));
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
      onReorder: _currentShowAdd ? handleReorder : null,
    });
  });
});
