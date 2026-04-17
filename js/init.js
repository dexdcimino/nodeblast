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
  getThemeAdjustedLogoColor,
  onThemeChange,
  buildMonoLogoSvg,
  buildLogoSvg,
} from './theme.js';
import { initColorPicker, syncSlotsFromFirestore } from './color.js';
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
import { renderHexGrid, createCatalystTileElement, renderMiniHexGrid, getEmbeddedCols } from './hex-grid.js';
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
  openUnlockModal,
  listCatalystBackups,
  restoreCatalystBackup,
} from './catalysts.js';
import { getUserByUsernameHex } from './users.js';
import { initRouter, navigate, getRoute, setPageTitle, buildUserSlug } from './router.js';
import { initSearch, closeSearch, focusSearch, isSearchOpen } from './search.js';
import { initNotifications, initHelpPanel } from './notifications.js';
import { initFriends, setFriendsCurrentUser, isFriend, sendFriendRequest, applyInviteButtonStates, openDM } from './friends.js';
import { renderSocialIconsHTML } from './social.js';
import { renderPlayRoute, destroyPlayRoute } from './play-mode.js';
import { getGame, SYSTEM_PROFILE, getGamesAsCatalysts, GAME_REGISTRY } from './game-registry.js';
import { openDotSim } from './dot-sim-modal.js';
import { openNodeSplit } from './nodesplit-modal.js';
import {
  pinCatalyst,
  unpinCatalyst,
  followAlchemist,
  unfollowAlchemist,
  setTrackedPublic,
  subscribeMyTracked,
  loadUserTracked,
  loadFollowedAlchemistCatalysts,
  refreshTrackedOwnerData,
} from './tracked.js';
import { voteCreator, getMyCreatorVotes } from './creator-votes.js';

let _currentCategory = 'all';
// Feed view mode — 'catalysts' (flat hex flow) or 'alchemists' (grouped
// per-creator cards). MD17 flipped the default to 'alchemists'.
// Signed-out users always land on Alchemists (no persistence). When a
// user signs in, updateAuthUI() reads their per-account preference
// from localStorage (key `nb-feed-mode-{uid}`) and applies it.
let _feedViewMode = 'alchemists';
function _feedModeKey(uid) { return 'nb-feed-mode-' + uid; }
// Feed sort mode — 'popular' (fireCount desc), 'latest' (createdAt
// desc), 'oldest' (createdAt asc). MD20 flipped this from sitewide
// persistence to per-account persistence, mirroring the feed-mode
// pattern: guests always land on Popular (no memory), signed-in
// users restore their last choice via `nb-feed-sort-{uid}` on
// sign-in. Module-load default is always 'popular'.
const _FEED_SORT_MODES = new Set(['popular', 'latest', 'oldest']);
let _feedSortMode = 'popular';
function _feedSortKey(uid) { return 'nb-feed-sort-' + uid; }
let _currentFeedSnapshot = [];
let _currentRoute = null;
let _currentTiles = [];
let _currentShowAdd = false;
let _currentEmptyMessage = '';
let _firstRender = true;
let _suppressNextDetailOpen = false;
// NB-MD04: profile tab state — which columns are currently active
const _profileActiveTabs = (() => {
  try {
    const raw = localStorage.getItem('nb-profile-tabs');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        // MD#48: ensure pinned + following are always included
        const set = new Set(arr);
        set.add('pinned');
        set.add('following');
        return set;
      }
    }
  } catch {}
  return new Set(['catalysts', 'pinned', 'following']);
})();
// NB-MD05: collapsed community cards — session-only, keyed by creator UID
const _collapsedCards = new Set();
// MD#16: undo/redo stack for card collapse/expand actions.
const _collapseUndoStack = [];
const _collapseRedoStack = [];
const MAX_UNDO = 30;

function _applyCollapseAction(uid, action) {
  const card = [...document.querySelectorAll('.community-card')].find(c => {
    const btn = c.querySelector('.community-vote-pill[data-creator-uid]');
    return btn && btn.dataset.creatorUid === uid;
  });
  if (!card) return false;
  const collapseBtn = card.querySelector('.community-card-collapse');
  if (!collapseBtn) return false;
  const isCollapsed = card.classList.contains('collapsed');
  if ((action === 'collapse' && isCollapsed) || (action === 'expand' && !isCollapsed)) return false;
  collapseBtn.click();
  return true;
}
// NB-MD08: tracked data for the currently-viewed non-own profile. Null when
// viewing own profile (use _myTrackedAlchemists directly) or no profile open.
let _viewedUserTracked = null;
let _currentProfileView = null; // { user, catalysts, isOwn } — last rendered profile
let _profileCache = new Map(); // "name#hex" or "name" -> { user, catalysts }
let _viewingOther = null;       // { uid, displayName, hexCode } for the profile currently shown

// MD14: mini catalyst grid in the profile dropdown. Persistent
// subscription to the current user's catalysts so the dropdown is
// always fresh, independent of which route they're viewing.
let _myCatalysts = [];
let _myCatalystsUnsub = null;

// MD18: tracked catalysts + alchemists cache. Live-synced for the
// signed-in user so the pin button on community tiles and the pinned
// mini-row in the account dropdown reflect the latest state without
// a reload. _myTrackedCatIds / _myTrackedAlchUids are O(1) lookup sets
// rebuilt from the snapshot arrays on every tick.
let _myTrackedCatalysts = [];
let _myTrackedAlchemists = [];
let _myTrackedCatIds = new Set();
let _myTrackedAlchUids = new Set();
let _myTrackedUnsub = null;

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
  document.getElementById('profile-bar')?.classList.remove('has-grid');
  const barCats = document.getElementById('profile-bar-catalysts');
  if (barCats) { barCats.style.display = 'none'; barCats.classList.remove('visible'); barCats.innerHTML = ''; }
  document.getElementById('profile-bio')?.classList.remove('visible');
  document.getElementById('not-found').classList.remove('visible');
  // MD12: internal catalyst view hidden by default on every route.
  document.getElementById('internal-catalyst-view')?.classList.remove('visible');
  // MD01: play view hidden on every non-play route.
  document.getElementById('play-view')?.classList.remove('visible');
  // MD18: tracked footer is a profile-route-only feature.
  _hideTrackedFooter();
  // NB-MD04: profile tabs + columns are profile-route-only
  const tabsEl = document.getElementById('profile-tabs');
  const colsEl = document.getElementById('profile-columns');
  const honeyEl = document.getElementById('honeycomb');
  if (tabsEl) tabsEl.style.display = 'none';
  if (colsEl) colsEl.style.display = 'none';
  if (honeyEl) { honeyEl.style.display = ''; honeyEl.innerHTML = ''; }
  _currentProfileView = null;
  const grid = document.getElementById('grid');
  grid.style.display = 'block';
  grid.classList.remove('with-filter', 'feed-mode');
  // Empty the community list so a previous render doesn't flash back
  // while a new subscription is warming up.
  const list = document.getElementById('community-list');
  if (list) list.innerHTML = '';
}

function showFilterBar() {
  // MD8 fix: add `feed-mode` synchronously here (not asynchronously
  // inside the subscription callback) so #community-list is
  // display:flex the moment renderFeedRoute starts setting up the
  // subscription. Without this, there's a gap between hideAllViews()
  // stripping the class and the async snapshot callback re-adding it,
  // which manifested as a "flash then disappear" on feed page loads.
  document.getElementById('cat-filter-bar').classList.add('visible');
  document.getElementById('grid').classList.add('with-filter', 'feed-mode');
}

// Copy or share a profile link. Uses navigator.share (native share
// sheet on mobile, share-target on desktop Chrome) when available,
// otherwise falls back to navigator.clipboard.writeText. Final
// fallback is a toast of the raw link text for browsers that block
// both APIs. Shared by the profile-bar button and the community-card
// share button so the UX stays identical across surfaces.
async function shareProfileLink({ displayName, hexCode, usernameLower }) {
  const name = (usernameLower || (displayName || '').toLowerCase());
  const hex = (hexCode || '').toLowerCase();
  const slug = buildUserSlug(name, hex);
  const link = `${window.location.origin}/${slug}`;
  const title = (displayName || 'Profile') + ' on NodeBlast';

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url: link });
      return;
    } catch (err) {
      // User cancelled share sheet (AbortError) — don't fall through
      // to clipboard since they explicitly dismissed. Any other error
      // falls through to clipboard below.
      if (err?.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied!');
  } catch {
    toast(link);
  }
}

// ══════════════════════════════════════════════════════════════
// MD02: QR share modal — lazy-loaded qrcode-generator + modal UI
// ══════════════════════════════════════════════════════════════
let _qrLib = null;
function _loadQrLib() {
  if (_qrLib) return Promise.resolve(_qrLib);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-qr-lib]');
    if (existing) {
      existing.addEventListener('load', () => { _qrLib = window.qrcode; resolve(_qrLib); });
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    s.dataset.qrLib = '1';
    s.onload = () => { _qrLib = window.qrcode; resolve(_qrLib); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function openQrShareModal({ displayName, hexCode, usernameLower }) {
  const modal = document.getElementById('qr-share-modal');
  if (!modal) return;

  const name = (usernameLower || (displayName || '').toLowerCase());
  const hex = (hexCode || '').toLowerCase();
  const slug = buildUserSlug(name, hex);
  const link = `${window.location.origin}/${slug}`;

  const nameEl = document.getElementById('qr-share-name');
  if (nameEl) nameEl.textContent = displayName || name;

  const urlLink = document.getElementById('qr-share-url-link');
  if (urlLink) {
    urlLink.textContent = link;
    urlLink.href = link;
  }

  const copyInline = document.getElementById('qr-share-copy-inline');
  if (copyInline) {
    copyInline.onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast('Link copied!');
      } catch { toast(link); }
    };
  }

  document.querySelectorAll('.qr-share-link[data-platform]').forEach((btn) => {
    btn.onclick = () => {
      const p = btn.dataset.platform;
      const encoded = encodeURIComponent(link);
      const title = encodeURIComponent((displayName || 'Profile') + ' on NodeBlast');
      const urls = {
        x: `https://x.com/intent/tweet?url=${encoded}&text=${title}`,
        linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
        reddit: `https://www.reddit.com/submit?url=${encoded}&title=${title}`,
        email: `mailto:?subject=${title}&body=${encoded}`,
        whatsapp: `https://wa.me/?text=${title}%20${encoded}`,
      };
      if (p === 'native') {
        if (navigator.share) navigator.share({ title: decodeURIComponent(title), url: link }).catch(() => {});
        return;
      }
      if (urls[p]) window.open(urls[p], '_blank', 'noopener,width=600,height=500');
    };
  });

  const nativeBtn = document.getElementById('qr-share-native-btn');
  if (nativeBtn) nativeBtn.style.display = (typeof navigator.share === 'function') ? '' : 'none';

  modal.classList.add('open');

  try {
    const qrFn = await _loadQrLib();
    const qr = qrFn(0, 'M');
    qr.addData(link);
    qr.make();
    const canvas = document.getElementById('qr-share-canvas');
    if (canvas) {
      const cellSize = 5;
      const count = qr.getModuleCount();
      const size = count * cellSize;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) {
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[qr-share] QR generation failed:', err);
  }
}

function closeQrShareModal() {
  document.getElementById('qr-share-modal')?.classList.remove('open');
}

function initQrShareModal() {
  const modal = document.getElementById('qr-share-modal');
  if (!modal) return;
  document.getElementById('qr-share-close')?.addEventListener('click', closeQrShareModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeQrShareModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeQrShareModal();
  });
}

function showProfileBar(user, catalystCount, isOwn) {
  const bar = document.getElementById('profile-bar');
  bar.classList.add('visible');

  // ── System account (virtual /games profile) ──
  if (user.isSystem) {
    const hexColor = '#' + (user.hexCode || '000000');
    bar.style.setProperty('--acct-hex', hexColor);
    const avatar = document.getElementById('profile-bar-avatar');
    avatar.innerHTML = '<svg width="28" height="26" viewBox="0 0 256 234.6" style="margin:auto"><path fill="var(--clr-adj)" d="M0,117.3s.7,28.6,19,46c18.3,17.4,45.1,18.1,45.1,18.1,35.3,0,64-28.7,64-64s28.6-64,64-64h.6c15.1,0,24.6-16.1,17.1-29.2C201.1,9.2,185.2,0,167.9,0h-79.7c-17.3,0-33.3,9.2-41.9,24.2,0,0-22.5,38.9-27.8,48.1C13.2,81.5,0,99.7,0,117.3Z"/><path fill="var(--clr-adj)" opacity="0.5" d="M46.2,210.4c8.7,15,24.6,24.2,41.9,24.2h79.7c17.3,0,33.3-9.2,41.9-24.2,0,0,22.5-38.9,27.8-48.1,5.3-9.2,18.5-27.4,18.5-45,0,0,.2-28.5-19.8-46.7-20-18.2-44.3-17.4-44.3-17.4-35.3,0-64,28.7-64,64s-28.6,64-64,64h-.6c-15.1,0-24.6,16.1-17.1,29.2h0Z"/></svg>';
    avatar.style.borderColor = 'var(--clr-adj)';
    document.getElementById('profile-bar-name').innerHTML = escapeHtml(user.displayName) + ' <span style="color:var(--clr-adj);font-size:14px;vertical-align:middle">⬡</span>';
    document.getElementById('profile-bar-hex-dot').style.background = hexColor;
    document.getElementById('profile-bar-hex-label').textContent = '#' + user.hexCode;
    _updateProfileBarCountHex(catalystCount, 'game');
    const socialEl = document.getElementById('profile-bar-socials');
    if (socialEl) { socialEl.innerHTML = ''; socialEl.classList.remove('visible'); }
    const bioEl = document.getElementById('profile-bio');
    if (bioEl && user.bio) { bioEl.textContent = user.bio; bioEl.classList.add('visible'); }
    else if (bioEl) { bioEl.textContent = ''; bioEl.classList.remove('visible'); }
    const actionBtn = document.getElementById('profile-bar-action');
    if (actionBtn) actionBtn.style.display = 'none';
    const shareBtn = document.getElementById('profile-bar-share');
    if (shareBtn) shareBtn.style.display = 'none';
    const copyBtnHide = document.getElementById('profile-bar-copy');
    if (copyBtnHide) copyBtnHide.style.display = 'none';
    const msgBtnHide = document.getElementById('profile-bar-msg');
    if (msgBtnHide) msgBtnHide.style.display = 'none';
    const addLinksBtnHide = document.getElementById('profile-bar-add-links');
    if (addLinksBtnHide) addLinksBtnHide.style.display = 'none';
    _viewingOther = null;
    return;
  }

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
  _updateProfileBarCountHex(catalystCount, 'catalyst');

  // Social links row — empty array renders nothing at all (renderSocialIconsHTML
  // returns '' for 0-length input), which keeps the profile bar tight
  // when the user hasn't added any links yet.
  const socialEl = document.getElementById('profile-bar-socials');
  if (socialEl) {
    const html = renderSocialIconsHTML(user.socialLinks || []);
    socialEl.innerHTML = html;
    socialEl.classList.toggle('visible', !!html);
  }

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

  // Share button is visible on BOTH own and other-user profiles.
  // MD02: opens the QR share modal (QR + URL + copy/native share buttons).
  if (shareBtn) {
    shareBtn.style.display = 'inline-flex';
    shareBtn.onclick = () => openQrShareModal({
      displayName: user.displayName,
      hexCode: user.hexCode,
      usernameLower: user.usernameLower,
    });
  }

  const copyBtn = document.getElementById('profile-bar-copy');
  if (copyBtn) {
    copyBtn.style.display = 'inline-flex';
    const slug = buildUserSlug((user.displayName || '').toLowerCase(), user.hexCode);
    const link = `${window.location.origin}/${slug}`;
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast(`${user.displayName || 'Profile'} link copied!`);
      } catch { toast(link); }
    };
  }

  const msgBtn = document.getElementById('profile-bar-msg');
  if (msgBtn) {
    msgBtn.style.display = 'inline-flex';
    if (isOwn) {
      msgBtn.onclick = () => {
        openAccountMenuFromPill();
        setTimeout(() => {
          const peopleTab = document.querySelector('#acct-menu [data-tab="people"]');
          if (peopleTab) peopleTab.click();
        }, 100);
      };
    } else {
      msgBtn.onclick = () => openDM(user);
    }
  }

  const addLinksBtn = document.getElementById('profile-bar-add-links');
  if (addLinksBtn) {
    if (isOwn) {
      addLinksBtn.style.display = 'inline-flex';
      addLinksBtn.onclick = (e) => {
        e.stopPropagation();
        const acctMenu = document.getElementById('acct-menu');
        const acctBtn = document.getElementById('acct-btn');
        if (acctMenu && acctBtn) {
          if (acctMenu.style.display === 'none' || !acctMenu.style.display || getComputedStyle(acctMenu).display === 'none') {
            acctBtn.click();
          }
          setTimeout(() => {
            const editBtn = document.getElementById('acct-edit-btn');
            if (editBtn) {
              editBtn.click();
              setTimeout(() => {
                const linksWrap = document.getElementById('acct-links-wrap');
                if (linksWrap) {
                  linksWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  const addBtn = document.getElementById('acct-links-add-btn');
                  if (addBtn) addBtn.focus();
                }
              }, 400);
            }
          }, 250);
        }
      };
    } else {
      addLinksBtn.style.display = 'none';
    }
  }

  if (isOwn) {
    _viewingOther = null;
    actionBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    actionBtn.setAttribute('data-tip', 'Edit Profile');
    actionBtn.className = 'icon-btn';
    actionBtn.disabled = false;
    actionBtn.classList.remove('is-friend');
    actionBtn.onclick = () => {
      openAccountMenuFromPill();
      setTimeout(() => {
        const editBtn = document.getElementById('acct-edit-btn');
        if (editBtn) editBtn.click();
      }, 150);
    };
  } else {
    // Not our own profile — the action button becomes "Add Friend" /
    // "✓ Friends" so people can connect directly from a profile page.
    // The Friends check is driven by the live friends cache, so the
    // button can flip from "Add Friend" → "✓ Friends" automatically
    // the moment the Firestore write is mirrored back.
    _viewingOther = { uid: user.uid, displayName: user.displayName, hexCode: user.hexCode };
    _applyFriendButton(user);
  }

  // MD#15: collapse toggle — own profile only (others have no embedded grid).
  const toggleBtn = document.getElementById('profile-bar-toggle');
  const profileBar = document.getElementById('profile-bar');
  if (toggleBtn && profileBar) {
    if (isOwn) {
      toggleBtn.style.display = 'inline-flex';
      const collapsed = localStorage.getItem('nb-profile-collapsed') === '1';
      profileBar.classList.toggle('collapsed', collapsed);
      toggleBtn.setAttribute('data-tip', collapsed ? 'Expand' : 'Collapse');
      const _doToggleCollapse = () => {
        const nowCollapsed = !profileBar.classList.contains('collapsed');
        profileBar.classList.toggle('collapsed', nowCollapsed);
        if (nowCollapsed) {
          profileBar.classList.remove('has-grid');
        } else {
          const gridEl = document.getElementById('profile-bar-catalysts');
          if (gridEl && gridEl.children.length > 0) profileBar.classList.add('has-grid');
        }
        toggleBtn.setAttribute('data-tip', nowCollapsed ? 'Expand' : 'Collapse');
        try { localStorage.setItem('nb-profile-collapsed', nowCollapsed ? '1' : '0'); } catch {}
      };
      toggleBtn.onclick = _doToggleCollapse;

      // MD#19: click blank space in the header row toggles collapse too.
      // Attached once per page load; cached function replaced on re-render.
      profileBar._nbToggleCollapse = _doToggleCollapse;
      if (!profileBar._nbHeaderClickWired) {
        profileBar._nbHeaderClickWired = true;
        profileBar.addEventListener('click', (e) => {
          const fn = profileBar._nbToggleCollapse;
          if (!fn) return;
          const target = e.target;
          if (target.closest('button, a, input, .hex-tile, .icon-btn, #profile-bar-catalysts, #profile-bar-socials, .social-icon')) return;
          if (target === profileBar ||
              target.id === 'profile-bar-left' ||
              target.id === 'profile-bar-right' ||
              target.id === 'profile-bar-info' ||
              target.id === 'profile-bar-name' ||
              target.id === 'profile-bar-hex-row' ||
              target.id === 'profile-bar-hex-label' ||
              target.id === 'profile-bar-hex-dot') {
            fn();
          }
        });
      }
    } else {
      // MD#54: other user profiles also get a collapse toggle; always start expanded.
      toggleBtn.style.display = 'inline-flex';
      profileBar.classList.remove('collapsed');
      toggleBtn.setAttribute('data-tip', 'Collapse');
      const _otherToggle = () => {
        const nowCollapsed = !profileBar.classList.contains('collapsed');
        profileBar.classList.toggle('collapsed', nowCollapsed);
        if (nowCollapsed) {
          profileBar.classList.remove('has-grid');
        } else {
          const gridEl = document.getElementById('profile-bar-catalysts');
          if (gridEl && gridEl.children.length > 0) profileBar.classList.add('has-grid');
        }
        toggleBtn.setAttribute('data-tip', nowCollapsed ? 'Expand' : 'Collapse');
      };
      toggleBtn.onclick = _otherToggle;
      if (profileBar) profileBar._nbToggleCollapse = _otherToggle;
    }
  }
}

function _applyFriendButton(user) {
  const actionBtn = document.getElementById('profile-bar-action');
  if (!actionBtn || !user) return;
  // Reset to text-style button for friend actions (icon is own-profile only).
  actionBtn.className = 'cat-btn';
  actionBtn.removeAttribute('data-tip');
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

function _updateProfileBarCountHex(count, word) {
  const n = Number(count) || 0;
  const numEl = document.getElementById('profile-bar-count-num');
  if (numEl) numEl.textContent = String(n);
  const hexEl = document.getElementById('profile-bar-count-hex');
  if (hexEl) hexEl.setAttribute('data-tip', n + ' ' + (n === 1 ? word : word + 's'));
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
  // Own tile → edit modal, regardless of type. Editing an internal
  // catalyst still happens via the same modal; the full-page view is
  // for viewers, not the editor.
  if (State.user && cat.ownerId === State.user.uid) {
    openCatalystModal(cat);
    return;
  }
  const ownerName = (cat.ownerName || 'anon').toLowerCase();
  const ownerHex = cat.ownerHex || '';
  const slug = cat.slug || '';

  // MD23: password gate. For non-owners, a locked catalyst has to
  // clear the unlock modal before any routing or popup happens. The
  // external path eventually hits openCatalystDetail which also
  // checks, but we gate here so locked INTERNAL catalysts (which go
  // via navigate() and never touch openCatalystDetail) are covered
  // too. Once the password is correct, the success callback replays
  // the original click path without the lock flag.
  if (cat.isLocked && cat.lockPassword) {
    openUnlockModal(cat, () => {
      const unlocked = { ...cat, isLocked: false, lockPassword: '' };
      handleTileClick(unlocked);
    });
    return;
  }

  // MD12: internal catalysts navigate to their full-page view.
  // DS-03: game-subtype catalysts look up the GAME_REGISTRY to
  // decide whether to navigate (route) or open a modal overlay.
  if (cat.type === 'internal' && slug) {
    if (cat.internalSubtype === 'game' && cat.gameId) {
      const gameDef = getGame(cat.gameId);
      if (!gameDef) { toast('Game not found'); return; }
      if (gameDef.launchMode === 'route') { navigate('/game/' + cat.slug); return; }
      if (gameDef.launchMode === 'modal') {
        if (gameDef.id === 'dot_sim') { openDotSim(cat.title || gameDef.name); return; }
        if (gameDef.id === 'nodesplit') { openNodeSplit(cat.title || gameDef.name); return; }
      }
    }
    const userPart = buildUserSlug(ownerName, ownerHex);
    navigate(`/${userPart}/${encodeURIComponent(slug)}`);
    return;
  }

  if (slug) {
    const userPart = buildUserSlug(ownerName, ownerHex);
    history.pushState({}, '', `/${userPart}/${encodeURIComponent(slug)}`);
    setPageTitle([cat.title, cat.ownerName || 'anon']);
  }
  openCatalystDetail(cat);
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

function renderGrid(tiles, { showAdd = false, emptyMessage = '', container = null } = {}) {
  _currentTiles = tiles;
  _currentShowAdd = showAdd;
  _currentEmptyMessage = emptyMessage;
  renderHexGrid({
    tiles,
    showAdd,
    emptyMessage,
    container,
    onTileClick: handleTileClick,
    onAddClick: _handleAddCatalystClick,
    onCreatorClick: handleCreatorClick,
    onReorder: showAdd ? handleReorder : null,
  });
}

// ══════════════════════════════════════════════════════════════
// NB-MD04: Profile view tabs — My Catalysts / Pinned / Following
// ══════════════════════════════════════════════════════════════
function initProfileTabs() {
  document.querySelectorAll('.profile-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (_profileActiveTabs.has(tab)) {
        // Don't allow deselecting the last active tab
        if (_profileActiveTabs.size === 1) return;
        _profileActiveTabs.delete(tab);
      } else {
        _profileActiveTabs.add(tab);
      }
      try { localStorage.setItem('nb-profile-tabs', JSON.stringify([..._profileActiveTabs])); } catch {}
      _updateProfileColumns();
      // Re-render the currently shown profile so the newly-revealed
      // column actually gets populated.
      if (_currentProfileView) {
        _renderProfileView(_currentProfileView.user, _currentProfileView.catalysts, _currentProfileView.isOwn);
      }
    });
  });
}

function _updateProfileColumns() {
  ['catalysts', 'pinned', 'following'].forEach((tab) => {
    const col = document.getElementById('profile-col-' + tab);
    if (!col) return;
    // MD#54: catalysts always render in profile-bar-catalysts, never in this column.
    if (tab === 'catalysts') return;
    col.style.display = _profileActiveTabs.has(tab) ? '' : 'none';
  });
  document.querySelectorAll('.profile-tab').forEach((btn) => {
    btn.classList.toggle('active', _profileActiveTabs.has(btn.dataset.tab));
  });
}

function _renderProfileView(user, catalysts, isOwn) {
  console.log('[profile-view] rendering', { user: user?.displayName, isOwn, catalystsCount: catalysts?.length });
  _currentProfileView = { user, catalysts, isOwn };
  // Columns always visible; tabs hidden (MD#13).
  const tabsEl = document.getElementById('profile-tabs');
  const colsEl = document.getElementById('profile-columns');
  const honeyEl = document.getElementById('honeycomb');
  if (tabsEl) tabsEl.style.display = 'none';
  if (colsEl) colsEl.style.display = 'flex';
  if (honeyEl) { honeyEl.style.display = 'none'; honeyEl.innerHTML = ''; }
  console.log('[profile-view] colsEl display:', colsEl?.style.display, 'exists:', !!colsEl);
  // Defensive: ensure both pinned columns are visible (MD#2 patch).
  const _pCol = document.getElementById('profile-col-pinned');
  const _fCol = document.getElementById('profile-col-following');
  if (_pCol) _pCol.style.display = '';
  if (_fCol) _fCol.style.display = '';

  // My Catalysts — embed grid inside #profile-bar when viewing own
  // profile (MD#14); otherwise render into #profile-col-catalysts.
  _currentTiles = catalysts;
  _currentShowAdd = isOwn;
  _currentEmptyMessage = isOwn
    ? 'Create your first catalyst'
    : "This alchemist hasn't created any catalysts yet.";
  const gridTarget = 'profile-bar-catalysts'; // MD#54: always embed in the profile bar
  const barCats = document.getElementById('profile-bar-catalysts');
  const catCol = document.getElementById('profile-col-catalysts');
  const _profileBarEl = document.getElementById('profile-bar');
  const _wasCollapsed = _profileBarEl?.classList.contains('collapsed');
  // MD#33: temporarily uncollapse so the grid container is measurable
  if (_wasCollapsed) _profileBarEl?.classList.remove('collapsed');
  if (barCats) { barCats.style.position = 'relative'; barCats.style.display = ''; barCats.classList.add('visible'); }
  _profileBarEl?.classList.add('has-grid');
  if (catCol) catCol.style.display = 'none';
  renderHexGrid({
    tiles: catalysts,
    showAdd: isOwn,
    emptyMessage: _currentEmptyMessage,
    container: gridTarget,
    getColsFn: getEmbeddedCols,
    gap: 24,
    onTileClick: handleTileClick,
    onAddClick: isOwn ? _handleAddCatalystClick : undefined,
    onCreatorClick: handleCreatorClick,
    onReorder: isOwn ? handleReorder : null,
  });
  // MD#33: restore collapsed state now that the grid has measured
  if (_wasCollapsed) {
    _profileBarEl?.classList.add('collapsed');
    _profileBarEl?.classList.remove('has-grid');
  }

  // Pinned column — always visible
  const pinnedCol = document.getElementById('profile-col-pinned');
  if (pinnedCol) {
    pinnedCol.style.display = '';
    pinnedCol.innerHTML = '';
    const pinnedTitle = document.createElement('div');
    pinnedTitle.className = 'profile-col-title';
    pinnedTitle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg> Catalysts';
    pinnedCol.appendChild(pinnedTitle);
    // MD#56: search bar
    const pinnedSearch = document.createElement('input');
    pinnedSearch.type = 'text';
    pinnedSearch.className = 'profile-col-search';
    pinnedSearch.placeholder = 'Search catalysts...';
    pinnedSearch.addEventListener('input', () => {
      const q = pinnedSearch.value.toLowerCase();
      pinnedCol.querySelectorAll('.hex-tile, .community-card').forEach((el) => {
        const text = el.textContent.toLowerCase();
        el.style.display = text.includes(q) || !q ? '' : 'none';
      });
    });
    pinnedCol.appendChild(pinnedSearch);
    console.log('[profile-view] rendering pinned col, isOwn:', isOwn, 'tracked:', _myTrackedCatalysts?.length);
    if (isOwn && _myTrackedCatalysts.length > 0) {
      const tilesWrap = document.createElement('div');
      tilesWrap.className = 'profile-col-tiles';
      _myTrackedCatalysts.forEach((pinned) => {
        const tile = createCatalystTileElement(
          {
            id: pinned.catId,
            title: pinned.title,
            thumbURL: pinned.thumbURL,
            accentColor: pinned.accentColor,
            status: pinned.status,
            ownerName: pinned.ownerName,
            ownerHex: pinned.ownerHex,
            slug: pinned.slug,
          },
          { width: COMMUNITY_TILE_W, height: COMMUNITY_TILE_H, isPinned: true },
          { onTileClick: handleTileClick }
        );
        // MD#51: unpin button on each pinned tile
        const unpinBtn = document.createElement('button');
        unpinBtn.className = 'profile-col-unpin';
        unpinBtn.type = 'button';
        unpinBtn.setAttribute('data-tip', 'Unpin');
        unpinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        unpinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          unpinCatalyst(pinned.catId).then(() => toast('Catalyst unpinned')).catch(() => toast('Failed to unpin'));
        });
        // MD#59: wrap tile + unpin button so the button isn't clipped by hex clip-path
        const tileWrap = document.createElement('div');
        tileWrap.className = 'pinned-tile-wrap';
        tileWrap.appendChild(tile);
        tileWrap.appendChild(unpinBtn);
        tilesWrap.appendChild(tileWrap);
      });
      pinnedCol.appendChild(tilesWrap);
    } else {
      const empty = document.createElement('div');
      empty.className = 'profile-col-empty';
      empty.textContent = isOwn ? 'Pin catalysts from the community hub' : 'No catalysts yet';
      pinnedCol.appendChild(empty);
    }
  }

  // Following column — always visible
  const followingCol = document.getElementById('profile-col-following');
  if (followingCol) {
    followingCol.style.display = '';
    followingCol.innerHTML = '';
    const followingTitle = document.createElement('div');
    followingTitle.className = 'profile-col-title';
    followingTitle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg> Alchemists';
    followingCol.appendChild(followingTitle);
    // MD#56: search bar
    const alchSearch = document.createElement('input');
    alchSearch.type = 'text';
    alchSearch.className = 'profile-col-search';
    alchSearch.placeholder = 'Search alchemists...';
    alchSearch.addEventListener('input', () => {
      const q = alchSearch.value.toLowerCase();
      followingCol.querySelectorAll('.community-card').forEach((el) => {
        const text = el.textContent.toLowerCase();
        el.style.display = text.includes(q) || !q ? '' : 'none';
      });
    });
    followingCol.appendChild(alchSearch);
    const alchemistsToShow = isOwn
      ? _myTrackedAlchemists
      : (_viewedUserTracked?.alchemists || []);

    if (alchemistsToShow.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'profile-col-empty';
      empty.textContent = isOwn ? 'Follow alchemists from the community hub' : 'No alchemists yet';
      followingCol.appendChild(empty);
    } else {
      const loading = document.createElement('div');
      loading.className = 'profile-col-empty';
      loading.textContent = 'Loading...';
      followingCol.appendChild(loading);

      // Capture user identity so we don't paint into a stale column
      // after a route change.
      const requestUid = user.uid;
      loadFollowedAlchemistCatalysts(alchemistsToShow, 5).then((catMap) => {
        // Abort if the profile view has moved on.
        if (!_currentProfileView || _currentProfileView.user?.uid !== requestUid) return;
        followingCol.innerHTML = '';
        const t = document.createElement('div');
        t.className = 'profile-col-title';
        t.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg> Alchemists';
        followingCol.appendChild(t);
        alchemistsToShow.forEach((alch) => {
          const cats = catMap.get(alch.uid) || [];
          // INFRA-MD01: canonical-first read with legacy fallback
          const alchName = alch.displayName || alch.username || 'anon';
          const alchHex = (alch.hexCode || alch.hex || '5aaa72').replace('#', '').toLowerCase();
          const group = {
            uid: alch.uid,
            displayName: alchName,
            hexCode: alchHex,
            photoURL: alch.photoURL || '',
            isAdmin: !!alch.isAdmin,
            socialLinks: [],
            catalysts: cats,
            latestCreatedAt: 0,
            oldestCreatedAt: 0,
            totalFireCount: cats.reduce((s, c) => s + (c.fireCount || 0), 0),
            totalFrostCount: cats.reduce((s, c) => s + (c.frostCount || 0), 0),
          };
          const card = _buildCommunityCard(group);
          followingCol.appendChild(card);
        });
        if (followingCol.children.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'profile-col-empty';
          empty.textContent = 'No catalysts from pinned alchemists yet';
          followingCol.appendChild(empty);
        }
      });
    }
  }

  _updateProfileColumns();

  // MD#38: force-ensure honeycomb hidden and columns visible on profile routes
  const _honeyForce = document.getElementById('honeycomb');
  if (_honeyForce) _honeyForce.style.display = 'none';
  const _colsForce = document.getElementById('profile-columns');
  if (_colsForce) _colsForce.style.display = 'flex';
}

// MD13: guarded add-catalyst click. Opens the create modal only
// when signed in; otherwise toasts + prompts sign-in. Shared by
// the main renderGrid call + the resize-handler renderHexGrid call
// so the gating lives in one place.
function _handleAddCatalystClick() {
  if (!State.user) {
    toast('Sign in to create a catalyst');
    openSigninModal();
    return;
  }
  openCatalystModal(null);
}

/* ══════════════════════════════════════
   MD14: mini catalyst grid in the profile dropdown
══════════════════════════════════════ */

// Subscription lifecycle for "my catalysts". Fires on sign-in, tears
// down on sign-out. Independent of route — the dropdown is always
// fresh regardless of whether the user is on the feed, their own
// profile, or someone else's.
function _startMyCatalystsSub(uid) {
  _stopMyCatalystsSub();
  if (!uid) return;
  _myCatalystsUnsub = subscribeUserCatalysts(uid, (catalysts) => {
    _myCatalysts = catalysts || [];
    // Update the count next to the "Catalysts" label.
    const countEl = document.getElementById('acct-catalysts-count');
    if (countEl) countEl.textContent = String(_myCatalysts.length);
    // Re-render the mini grid. If the section is currently closed,
    // the container has clientWidth=0 and renderMiniHexGrid bails —
    // we'll re-fire on the next section-open event.
    _renderMyCatalystsMini();
  });
}

function _stopMyCatalystsSub() {
  if (_myCatalystsUnsub) {
    try { _myCatalystsUnsub(); } catch {}
    _myCatalystsUnsub = null;
  }
  _myCatalysts = [];
}

/* ══════════════════════════════════════
   MD18: tracked lists — pin/follow lifecycle
══════════════════════════════════════ */

function _startMyTrackedSub() {
  _stopMyTrackedSub();
  if (!State.user) return;
  _myTrackedUnsub = subscribeMyTracked(({ catalysts, alchemists }) => {
    _myTrackedCatalysts = catalysts || [];
    _myTrackedAlchemists = alchemists || [];
    _myTrackedCatIds = new Set(_myTrackedCatalysts.map((c) => c.catId));
    _myTrackedAlchUids = new Set(_myTrackedAlchemists.map((a) => a.uid));

    // MD#10: seed defaults for new accounts — auto-follow nodeblast.dev
    // and auto-pin the three original games on first visit.
    if (State.user && _myTrackedCatalysts.length === 0 && _myTrackedAlchemists.length === 0) {
      const seededKey = 'nb-tracked-seeded-' + State.user.uid;
      if (!localStorage.getItem(seededKey)) {
        try { localStorage.setItem(seededKey, '1'); } catch {}
        followAlchemist(SYSTEM_PROFILE).catch(() => {});
        const gameCats = getGamesAsCatalysts();
        for (const cat of gameCats) pinCatalyst(cat).catch(() => {});
      }
    }
    // Update counts in the dropdown header.
    const countEl = document.getElementById('acct-pinned-count');
    if (countEl) {
      countEl.textContent = String(_myTrackedCatalysts.length + _myTrackedAlchemists.length);
    }
    // Re-paint anything that shows live pin state. Community tiles
    // repaint on the next feed tick anyway, but doing it here keeps
    // the UI in sync after a pin/unpin click without waiting for the
    // feed snapshot to bounce.
    if (_currentRoute?.page === 'feed') _repaintFeed();
    // Mini pinned grid in the profile dropdown.
    _renderMyPinnedMini();
    // If the current profile route is the signed-in user's own
    // profile, re-render the tracked footer so removals/additions
    // reflect instantly. _viewingOther is null on your own profile
    // (by design in showProfileBar) so we match against the route
    // + our own profile slug instead.
    if (_currentRoute && (_currentRoute.page === 'profile' || _currentRoute.page === 'catalyst')) {
      const routeLower = (_currentRoute.username || '').toLowerCase();
      const myLower = (State.profile?.usernameLower || State.profile?.displayName || '').toLowerCase();
      const routeHex = (_currentRoute.hex || '').toLowerCase();
      const myHex = (State.profile?.hexCode || '').toLowerCase();
      if (routeLower && routeLower === myLower && routeHex === myHex) {
        // NB-MD04: refresh Pinned + Following profile columns if visible
        if (_currentProfileView) {
          _renderProfileView(_currentProfileView.user, _currentProfileView.catalysts, _currentProfileView.isOwn);
        }
      }
    }
  });
}

function _stopMyTrackedSub() {
  if (_myTrackedUnsub) {
    try { _myTrackedUnsub(); } catch {}
    _myTrackedUnsub = null;
  }
  _myTrackedCatalysts = [];
  _myTrackedAlchemists = [];
  _myTrackedCatIds = new Set();
  _myTrackedAlchUids = new Set();
}

// Handler passed to community tiles so the pin button toggles the
// correct Firestore entry. `nowPinned` is the optimistic state the
// button just flipped to — we translate that into a pin or unpin.
function handlePinToggle(cat, nowPinned) {
  if (!State.user) {
    toast('Sign in to pin');
    return;
  }
  if (nowPinned) pinCatalyst(cat);
  else unpinCatalyst(cat.id);
}

// Handler for the follow/unfollow button on community-hub creator cards.
function handleFollowToggle(group, nowFollowing) {
  if (!State.user) {
    toast('Sign in to follow');
    return;
  }
  if (nowFollowing) followAlchemist(group);
  else unfollowAlchemist(group.uid);
}

// Paints the mini grid into #acct-catalysts-list. Guest state is
// handled at the dropdown level (MD13 grays the whole section), so
// this function assumes we're signed in when called.
function _renderMyCatalystsMini() {
  const container = document.getElementById('acct-catalysts-list');
  if (!container) return;
  if (!State.user) {
    container.innerHTML = '<div class="mini-hex-empty">Sign in to create catalysts</div>';
    container.style.height = '';
    return;
  }
  renderMiniHexGrid({
    container,
    tiles: _myCatalysts,
    showAdd: true,
    // MD19: tile click opens the edit modal as a full-screen overlay
    // anywhere on the site. openCatalystModal now closes the account
    // menu itself, so there's no need for a setTimeout here — the
    // modal + dropdown swap happens in the same tick. Any route is
    // supported because the modal is fixed-position, z-indexed above
    // every other layer, and performs no navigation.
    onTileClick: (cat) => openCatalystModal(cat),
    onAddClick: () => _handleAddCatalystClick(),
    // Drag reorder — writes to the same sortOrder field the main
    // profile grid reads. Uses its own handler so the optimistic
    // cache update lands on _myCatalysts (the source of truth for
    // the mini grid) instead of _currentTiles, which is stale or
    // empty on any route other than the user's own profile.
    onReorder: handleMiniReorder,
  });
}

// MD19: dedicated reorder handler for the dropdown mini grid. Same
// persistence path as handleReorder (reorderCatalysts + shared
// Firestore doc), but the optimistic local cache update operates on
// _myCatalysts so the mini grid doesn't flash back to the old order
// when the user drags from any route other than their own profile.
async function handleMiniReorder(orderedIds) {
  if (!State.user) return;
  const byId = new Map(_myCatalysts.map((t) => [t.id, t]));
  const next = [];
  orderedIds.forEach((id, i) => {
    const t = byId.get(id);
    if (!t) return;
    next.push({ ...t, sortOrder: i });
  });
  _myCatalysts = next;
  // If the user is currently on their own profile page, also update
  // _currentTiles so the main grid stays in sync until the Firestore
  // snapshot lands. Harmless otherwise.
  if (_currentTiles.length && _currentTiles.every((t) => byId.has(t.id))) {
    _currentTiles = next;
  }
  try {
    await reorderCatalysts(State.user.uid, orderedIds);
  } catch (err) {
    console.warn('[init] mini reorder persist failed:', err);
    toast('Reorder failed');
  }
}

function renderSkeleton() {
  renderHexGrid({ loading: true });
}

/* ══════════════════════════════════════
   MD18: tracked rendering — pinned mini-row + profile footer
══════════════════════════════════════ */

// Mirror of _renderMyCatalystsMini for the dropdown's pinned row.
// Reuses the same renderMiniHexGrid helper; each tile is wired to
// navigate to the source catalyst's profile/detail view when clicked.
function _renderMyPinnedMini() {
  const container = document.getElementById('acct-pinned-list');
  const row = document.getElementById('acct-pinned-row');
  if (!container || !row) return;
  if (!State.user || _myTrackedCatalysts.length === 0) {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  // Pinned snapshots use the same field names as full catalyst docs
  // where it matters for mini rendering (thumbURL, accentColor, title,
  // status, id). Fake an `id` from catId so the mini helper's tile
  // identity key is set.
  const tiles = _myTrackedCatalysts.map((p) => ({
    id: p.catId,
    title: p.title,
    thumbURL: p.thumbURL,
    accentColor: p.accentColor,
    status: p.status,
    type: p.type,
    slug: p.slug,
    ownerId: p.ownerId,
    ownerName: p.ownerName,
    ownerHex: p.ownerHex,
    ownerPhoto: p.ownerPhoto,
  }));
  renderMiniHexGrid({
    container,
    tiles,
    showAdd: false,
    // MD19: pinned tiles navigate to the source catalyst (different
    // from the user's own tiles which overlay the edit modal in place).
    // Close the menu first so navigation isn't visually stacked under
    // the dropdown.
    onTileClick: (cat) => {
      closeAccountMenu();
      const lower = (cat.ownerName || '').toLowerCase();
      const hex = (cat.ownerHex || '').toLowerCase();
      const slug = cat.slug || '';
      if (lower && hex && slug) {
        navigate('/' + buildUserSlug(lower, hex) + '/' + slug);
      } else if (lower && hex) {
        navigate('/' + buildUserSlug(lower, hex));
      }
    },
  });
}

// Builds a single small pinned-catalyst tile for the profile footer.
// Clicks navigate to the source catalyst's slug route (which opens the
// detail view on the owner's profile). Own-profile viewers also get a
// remove "×" button in the top-right corner.
function _buildPinnedFooterTile(pinned, { canRemove }) {
  const FOOTER_TILE_W = 120;
  const FOOTER_TILE_H = Math.round(FOOTER_TILE_W * 1.1547);
  const fakeCat = {
    id: pinned.catId,
    title: pinned.title,
    thumbURL: pinned.thumbURL,
    accentColor: pinned.accentColor,
    status: pinned.status,
    ownerName: pinned.ownerName,
    ownerHex: pinned.ownerHex,
    ownerPhoto: pinned.ownerPhoto,
  };
  const tile = createCatalystTileElement(
    fakeCat,
    { width: FOOTER_TILE_W, height: FOOTER_TILE_H, showCreatorAvatar: true },
    {
      onTileClick: () => {
        const lower = (pinned.ownerName || '').toLowerCase();
        const hex = (pinned.ownerHex || '').toLowerCase();
        if (lower && hex && pinned.slug) {
          navigate('/' + buildUserSlug(lower, hex) + '/' + pinned.slug);
        } else if (lower && hex) {
          navigate('/' + buildUserSlug(lower, hex));
        }
      },
      onCreatorClick: () => {
        const lower = (pinned.ownerName || '').toLowerCase();
        const hex = (pinned.ownerHex || '').toLowerCase();
        if (lower && hex) navigate('/' + buildUserSlug(lower, hex));
      },
    },
  );
  if (canRemove) {
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'tracked-remove-btn';
    rm.setAttribute('data-tip', 'Unpin');
    rm.setAttribute('aria-label', 'Unpin');
    rm.textContent = '×';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      unpinCatalyst(pinned.catId);
    });
    tile.appendChild(rm);
  }
  return tile;
}

// Small circular avatar chip used in the profile footer's "Alchemists"
// row. Clicking navigates to that alchemist's profile. Own-profile
// viewers get a remove "×" in the corner.
function _buildFollowedChip(alch, { canRemove }) {
  // INFRA-MD01: canonical-first read with legacy fallback
  const aName = alch.displayName || alch.username || 'anon';
  const aHex = alch.hexCode || alch.hex || '5aaa72';
  const chip = document.createElement('div');
  chip.className = 'tracked-alch-chip';
  chip.style.setProperty('--chip-hex', '#' + aHex);
  const avatar = document.createElement('div');
  avatar.className = 'tracked-alch-avatar';
  if (alch.photoURL) {
    const img = document.createElement('img');
    img.src = alch.photoURL;
    img.alt = '';
    avatar.appendChild(img);
  } else {
    avatar.textContent = aName.charAt(0).toUpperCase();
  }
  chip.appendChild(avatar);
  const nameEl = document.createElement('span');
  nameEl.className = 'tracked-alch-name';
  nameEl.innerHTML = renderUsername(aName, null, !!alch.isAdmin);
  chip.appendChild(nameEl);
  chip.addEventListener('click', () => {
    const lower = aName.toLowerCase();
    if (lower && aHex) navigate('/' + buildUserSlug(lower, aHex));
  });
  if (canRemove) {
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'tracked-remove-btn';
    rm.setAttribute('data-tip', 'Unpin Alchemist');
    rm.setAttribute('aria-label', 'Unpin Alchemist');
    rm.textContent = '×';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      unfollowAlchemist(alch.uid);
    });
    chip.appendChild(rm);
  }
  return chip;
}

// Tracked footer was removed — profile columns are the single source.
function _hideTrackedFooter() {}

/* ══════════════════════════════════════
   Community hub — per-creator cards
══════════════════════════════════════ */

// Group an array of catalysts by ownerId. Returns a Map of
// ownerId → { creator, catalysts } where creator captures the latest
// denormalized owner fields we can read from any of that creator's
// catalysts (all of their tiles should agree, so reading from the
// first one is fine; the freshest tile wins if there's drift).
// NB-MD06: compact vote count formatter for community card totals.
function _formatVoteCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

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
        socialLinks: Array.isArray(cat.ownerSocialLinks) ? cat.ownerSocialLinks : [],
        catalysts: [],
        latestCreatedAt: 0,
        oldestCreatedAt: Number.POSITIVE_INFINITY,
        totalFireCount: 0,
        totalFrostCount: 0,
        // NB-MD09: creator-level vote totals (live on users/{uid}).
        // Defaulted to 0; populated opportunistically if the catalyst
        // doc carries denormalized owner fields.
        fireVoteCount: 0,
        frostVoteCount: 0,
      };
      groups.set(ownerId, g);
    }
    g.catalysts.push(cat);
    const ts = cat.createdAt?.toMillis?.() ?? 0;
    if (ts > g.latestCreatedAt) g.latestCreatedAt = ts;
    if (ts && ts < g.oldestCreatedAt) g.oldestCreatedAt = ts;
    g.totalFireCount += (cat.fireCount || 0);
    g.totalFrostCount += (cat.frostCount || 0);
    if (typeof cat.ownerFireVoteCount === 'number') g.fireVoteCount = cat.ownerFireVoteCount;
    if (typeof cat.ownerFrostVoteCount === 'number') g.frostVoteCount = cat.ownerFrostVoteCount;
  }
  // Normalize groups that had no dated catalysts so the oldest sort
  // doesn't leave +Infinity sentinels in place.
  for (const g of groups.values()) {
    if (g.oldestCreatedAt === Number.POSITIVE_INFINITY) g.oldestCreatedAt = 0;
  }
  return groups;
}

// Sort a flat catalyst snapshot according to the current feed sort
// mode. Returns a new array — never mutates the input. Used by the
// Catalysts view directly and also feeds tile ordering inside an
// Alchemist card.
function _sortCatalysts(catalysts, mode) {
  const copy = catalysts.slice();
  if (mode === 'latest') {
    copy.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  } else if (mode === 'oldest') {
    copy.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
  } else {
    // 'popular' — fireCount desc, createdAt desc as tiebreaker so
    // newer tiles float above older ones at the same vote count.
    copy.sort((a, b) => {
      const diff = (b.fireCount || 0) - (a.fireCount || 0);
      if (diff !== 0) return diff;
      return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
    });
  }
  return copy;
}

// Sort the grouped-creator array used by the Alchemists view. For
// 'popular' we rank by summed fireCount across each creator's tiles;
// for 'latest' / 'oldest' we rank by the respective createdAt extreme.
function _sortCreatorGroups(groups, mode) {
  const copy = groups.slice();
  if (mode === 'latest') {
    copy.sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);
  } else if (mode === 'oldest') {
    copy.sort((a, b) => a.oldestCreatedAt - b.oldestCreatedAt);
  } else {
    copy.sort((a, b) => {
      const diff = b.totalFireCount - a.totalFireCount;
      if (diff !== 0) return diff;
      return b.latestCreatedAt - a.latestCreatedAt;
    });
  }
  return copy;
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
const COMMUNITY_TILE_BASE_W = 180;
const COMMUNITY_TILE_W = COMMUNITY_TILE_BASE_W;
const COMMUNITY_TILE_H = Math.round(COMMUNITY_TILE_BASE_W * 1.1547);
function getCommunityTileSize(count) {
  let w = COMMUNITY_TILE_BASE_W;
  if (count > 8) w = 120;
  else if (count > 6) w = 140;
  else if (count > 5) w = 160;
  return { w, h: Math.round(w * 1.1547) };
}

// NB-MD09: reflect the user's current creator-vote (or lack thereof)
// on every matching card in the DOM. Called both after pre-fetching
// votes for the feed and after the authoritative vote RPC resolves.
function _updateCreatorVoteUI(creatorUid, activeType) {
  document
    .querySelectorAll(`.community-vote-pill[data-creator-uid="${creatorUid}"]`)
    .forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.voteType === activeType);
    });
}

function _buildCommunityCard(group) {
  const hex = group.hexCode;
  const hexColor = '#' + hex;
  const card = document.createElement('div');
  card.className = 'community-card';
  // MD10: flag own card so CSS can give it a subtle hex-colored glow.
  if (State.user && group.uid === State.user.uid) card.classList.add('own-card');
  // NB-MD07: size tier based on catalyst count (6+ → full row)
  const catCount = group.catalysts.length;
  card.dataset.count = catCount >= 10 ? 'max' : String(Math.max(1, Math.min(catCount, 9)));
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

  // MD#53: wrap meta + count hex in a group so they stay together.
  const metaGroup = document.createElement('div');
  metaGroup.className = 'community-card-meta-group';
  metaGroup.appendChild(meta);

  const countN = group.catalysts.length;
  const countHex = document.createElement('div');
  countHex.className = 'community-card-count-hex';
  countHex.setAttribute('data-tip', countN + (countN === 1 ? ' catalyst' : ' catalysts'));
  countHex.innerHTML = `<svg viewBox="0 0 100 115" width="36" height="42">
    <polygon points="50,3 97,30 97,85 50,112 3,85 3,30" fill="${hexColor}" opacity="0.12" stroke="${hexColor}" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="50" y="57.5" text-anchor="middle" dominant-baseline="central" fill="${hexColor}" font-family="var(--fn)" font-size="42" font-weight="800">${countN}</text>
  </svg>`;
  metaGroup.appendChild(countHex);

  hdr.appendChild(metaGroup);

  // Social icons — placed between meta and spacer, mirroring the
  // profile-bar layout. Clicks are stopped from bubbling.
  const socialHTML = renderSocialIconsHTML(group.socialLinks, { extraClass: 'social-icons--sm' });
  if (socialHTML) {
    const socialWrap = document.createElement('div');
    socialWrap.className = 'community-card-socials';
    socialWrap.innerHTML = socialHTML;
    socialWrap.addEventListener('click', (e) => e.stopPropagation());
    hdr.appendChild(socialWrap);
  }

  // Flexible spacer — floats the icon cluster to the right.
  const hdrSpacer = document.createElement('div');
  hdrSpacer.className = 'community-card-hdr-spacer';
  hdr.appendChild(hdrSpacer);

  const qrBtn = document.createElement('button');
  qrBtn.type = 'button';
  qrBtn.className = 'community-card-share';
  qrBtn.setAttribute('data-tip', 'Share');
  qrBtn.setAttribute('aria-label', 'Share profile');
  qrBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
  qrBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openQrShareModal({ displayName: group.displayName, hexCode: hex });
  });
  hdr.appendChild(qrBtn);

  // NB-MD05: collapse / expand button — shrinks the card to just the
  // header + first tile. State is session-only (Set keyed by uid).
  const COLLAPSE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="21" y2="3"/><line x1="3" y1="21" x2="14" y2="10"/></svg>';
  const EXPAND_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'community-card-collapse';
  collapseBtn.setAttribute('aria-label', 'Collapse card');
  const startCollapsed = _collapsedCards.has(group.uid);
  if (startCollapsed) {
    card.classList.add('collapsed');
    card.dataset.count = '1';
    collapseBtn.setAttribute('data-tip', 'Expand');
    collapseBtn.innerHTML = EXPAND_ICON;
    // Defer pin icon shrink until after followBtn is appended
    requestAnimationFrame(() => {
      const _initPin = card.querySelector('.community-card-follow');
      if (_initPin) {
        _initPin.dataset.fullText = _initPin.textContent;
        _initPin.classList.add('icon-only');
        _initPin.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>';
      }
    });
  } else {
    collapseBtn.setAttribute('data-tip', 'Collapse');
    collapseBtn.innerHTML = COLLAPSE_ICON;
  }
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const nowCollapsed = !card.classList.contains('collapsed');
    _collapseUndoStack.push({ uid: group.uid, action: nowCollapsed ? 'collapse' : 'expand' });
    if (_collapseUndoStack.length > MAX_UNDO) _collapseUndoStack.shift();
    _collapseRedoStack.length = 0;
    if (nowCollapsed) {
      _collapsedCards.add(group.uid);
      card.classList.add('collapsed');
      card.dataset.count = '1';
      collapseBtn.setAttribute('data-tip', 'Expand');
      collapseBtn.innerHTML = EXPAND_ICON;
      const _pinBtn = card.querySelector('.community-card-follow');
      if (_pinBtn) {
        _pinBtn.dataset.fullText = _pinBtn.textContent;
        _pinBtn.classList.add('icon-only');
        _pinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>';
      }
    } else {
      _collapsedCards.delete(group.uid);
      card.classList.remove('collapsed');
      const _pinBtn2 = card.querySelector('.community-card-follow');
      if (_pinBtn2) {
        _pinBtn2.classList.remove('icon-only');
        const _isFollowing = _pinBtn2.classList.contains('following');
        _pinBtn2.textContent = _isFollowing ? 'Pinned' : '+ Pin';
      }
      // Restore original size tier so the card resizes back correctly.
      const originalCount = group.catalysts.length >= 10
        ? 'max'
        : String(Math.max(1, Math.min(group.catalysts.length, 9)));
      card.dataset.count = originalCount;
      collapseBtn.setAttribute('data-tip', 'Collapse');
      collapseBtn.innerHTML = COLLAPSE_ICON;
    }
  });
  hdr.appendChild(collapseBtn);

  // MD18: follow / unfollow button. Hidden on your own creator card
  // (you can't follow yourself). The button is optimistic: the class
  // flips instantly on click, and the tracked snapshot authoritatively
  // re-renders the card on the next tick if the write fails.
  const isOwnCard = State.user && group.uid === State.user.uid;
  if (!isOwnCard) {
    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    const isFollowing = _myTrackedAlchUids.has(group.uid);
    followBtn.className = 'community-card-follow' + (isFollowing ? ' following' : '');
    followBtn.setAttribute('data-tip', isFollowing ? 'Unpin Alchemist' : 'Pin Alchemist');
    followBtn.setAttribute('aria-label', isFollowing ? 'Unpin Alchemist' : 'Pin Alchemist');
    followBtn.textContent = isFollowing ? 'Pinned' : '+ Pin';
    followBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowFollowing = !followBtn.classList.contains('following');
      followBtn.classList.toggle('following', nowFollowing);
      followBtn.textContent = nowFollowing ? 'Pinned' : '+ Pin';
      followBtn.setAttribute('data-tip', nowFollowing ? 'Unpin Alchemist' : 'Pin Alchemist');
      handleFollowToggle(group, nowFollowing);
    });
    hdr.appendChild(followBtn);
  }

  hdr.addEventListener('click', (e) => {
    // Clicks on the follow/share buttons already stop propagation,
    // but guard again in case a future button is added without one.
    if (e.target.closest('.community-card-follow')) return;
    const lower = (group.displayName || '').toLowerCase();
    navigate('/' + buildUserSlug(lower, hex));
  });

  card.appendChild(hdr);

  // Body — flex-wrap row of standalone hex tiles.
  const body = document.createElement('div');
  body.className = 'community-tiles';
  // Pin button hidden on own tiles (you can't pin yourself), shown
  // everywhere else in the community hub.
  const hideOwnPin = State.user && group.uid === State.user.uid;
  const isOwnCardForReorder = State.user && group.uid === State.user.uid;
  const MAX_VISIBLE_TILES = 12;
  const sortedTiles = _sortCardTiles(group.catalysts);
  const tilesToShow = sortedTiles.slice(0, MAX_VISIBLE_TILES);
  const tileSize = getCommunityTileSize(tilesToShow.length);
  tilesToShow.forEach((cat) => {
    const tile = createCatalystTileElement(
      cat,
      {
        width: tileSize.w,
        height: tileSize.h,
        showCreatorAvatar: true,
        showPinButton: !hideOwnPin,
        isPinned: _myTrackedCatIds.has(cat.id),
      },
      { onTileClick: handleTileClick, onCreatorClick: handleCreatorClick, onPinClick: handlePinToggle },
    );

    if (isOwnCardForReorder) {
      tile.draggable = true;
      tile.style.cursor = 'grab';
      tile.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', cat.id);
        tile.style.opacity = '0.5';

        // MD#22: hex-clipped drag ghost so the preview isn't a square.
        const ghost = tile.cloneNode(true);
        ghost.style.position = 'absolute';
        ghost.style.top = '-9999px';
        ghost.style.left = '-9999px';
        ghost.style.width = tile.offsetWidth + 'px';
        ghost.style.height = tile.offsetHeight + 'px';
        ghost.style.clipPath = 'url(#hex-clip)';
        ghost.style.webkitClipPath = 'url(#hex-clip)';
        ghost.style.opacity = '0.85';
        ghost.style.pointerEvents = 'none';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, tile.offsetWidth / 2, tile.offsetHeight / 2);
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
          }, 0);
        });
      });
      tile.addEventListener('dragend', () => { tile.style.opacity = '1'; });
      tile.addEventListener('dragover', (e) => {
        e.preventDefault();
        tile.style.borderLeft = '3px solid var(--clr-adj)';
      });
      tile.addEventListener('dragleave', () => { tile.style.borderLeft = ''; });
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        tile.style.borderLeft = '';
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId === cat.id) return;
        const allTiles = [...body.querySelectorAll('[data-cat-id]')];
        const ids = allTiles.map(t => t.dataset.catId);
        const fromIdx = ids.indexOf(draggedId);
        const toIdx = ids.indexOf(cat.id);
        if (fromIdx === -1 || toIdx === -1) return;
        ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, draggedId);
        reorderCatalysts(State.user.uid, ids);
        toast('Catalysts reordered');
      });
    }

    body.appendChild(tile);
  });

  // NB-MD09 / MD#1 / MD#12: creator-level vote pills — absolute-positioned
  // inside the body. Render for all cards (including own); own-card pills
  // are read-only (click is toast-gated).
  const isOwnCardForVote = State.user && group.uid === State.user.uid;
  {
    const frostPill = document.createElement('button');
    frostPill.type = 'button';
    frostPill.className = 'community-vote-pill frost';
    frostPill.dataset.voteType = 'frost';
    frostPill.dataset.creatorUid = group.uid;
    frostPill.setAttribute('data-tip', 'Poop');
    const frostCount = group.frostVoteCount || 0;
    frostPill.innerHTML = `💩${frostCount > 0 ? `<span class="community-vote-count">${frostCount}</span>` : ''}`;
    card.appendChild(frostPill);

    const firePill = document.createElement('button');
    firePill.type = 'button';
    firePill.className = 'community-vote-pill fire';
    firePill.dataset.voteType = 'fire';
    firePill.dataset.creatorUid = group.uid;
    firePill.setAttribute('data-tip', 'Fire');
    const fireCount = group.fireVoteCount || 0;
    firePill.innerHTML = `🔥${fireCount > 0 ? `<span class="community-vote-count">${fireCount}</span>` : ''}`;
    card.appendChild(firePill);

    [firePill, frostPill].forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!State.user) { toast('Sign in to vote'); openSigninModal(); return; }
        const voteType = btn.dataset.voteType;
        const sibling = btn === firePill ? frostPill : firePill;
        const wasActive = btn.classList.contains('active');
        const sibWasActive = sibling.classList.contains('active');
        btn.classList.toggle('active', !wasActive);
        sibling.classList.remove('active');
        let countEl = btn.querySelector('.community-vote-count');
        const sibCountEl = sibling.querySelector('.community-vote-count');
        const n = countEl ? (parseInt(countEl.textContent, 10) || 0) : 0;
        const sibN = sibCountEl ? (parseInt(sibCountEl.textContent, 10) || 0) : 0;
        if (wasActive) {
          if (countEl) {
            const next = Math.max(0, n - 1);
            if (next === 0) countEl.remove();
            else countEl.textContent = String(next);
          }
        } else {
          if (!countEl) {
            countEl = document.createElement('span');
            countEl.className = 'community-vote-count';
            btn.appendChild(countEl);
          }
          countEl.textContent = String(n + 1);
        }
        if (sibWasActive && sibCountEl) {
          const nextSib = Math.max(0, sibN - 1);
          if (nextSib === 0) sibCountEl.remove();
          else sibCountEl.textContent = String(nextSib);
        }
        const result = await voteCreator(group.uid, voteType);
        if (result !== null) _updateCreatorVoteUI(group.uid, result.type);
      });
    });
  }

  card.appendChild(body);
  return card;
}

function renderCommunityHub(catalysts, { emptyMessage } = {}) {
  const grid = document.getElementById('grid');
  const list = document.getElementById('community-list');
  if (!grid || !list) return;

  // feed-mode class is applied synchronously by showFilterBar() before
  // the subscription is even set up, so no need to re-add it here.
  list.innerHTML = '';

  if (!catalysts || catalysts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'community-empty';
    empty.textContent = emptyMessage || 'No catalysts yet. Be the first to share what you\'re building.';
    list.appendChild(empty);
    return;
  }

  // Group creators, then sort according to the current feed sort mode
  // (popular / latest / oldest). Within each card tiles honor
  // sortOrder → createdAt via _sortCardTiles regardless of the outer
  // ranking — tile order inside a card is owner-controlled.
  const groups = Array.from(_groupCatalystsByCreator(catalysts).values());
  const ranked = _sortCreatorGroups(groups, _feedSortMode);
  ranked.forEach((g) => list.appendChild(_buildCommunityCard(g)));

  // NB-MD09: pre-fetch the signed-in user's creator votes for every
  // visible creator so their buttons render in the active state. Runs
  // async after cards are in the DOM — no layout blocking.
  if (State.user) {
    const creatorUids = ranked.map((g) => g.uid).filter((uid) => uid && uid !== State.user.uid);
    getMyCreatorVotes(creatorUids).then((votesMap) => {
      votesMap.forEach((voteType, uid) => _updateCreatorVoteUI(uid, voteType));
    });
  }
}

// "Catalysts" view: a single flow of hex tiles, sorted by createdAt
// desc, with each tile carrying its creator avatar (per MD5). Renders
// directly into #community-list via .community-flat — keeps the same
// container so the feed-mode visibility flag still works.
function renderCatalystsFlow(catalysts, { emptyMessage } = {}) {
  const grid = document.getElementById('grid');
  const list = document.getElementById('community-list');
  if (!grid || !list) return;

  // feed-mode class is applied synchronously by showFilterBar() before
  // the subscription is even set up, so no need to re-add it here.
  list.innerHTML = '';

  if (!catalysts || catalysts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'community-empty';
    empty.textContent = emptyMessage || 'No catalysts yet. Be the first to share what you\'re building.';
    list.appendChild(empty);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'community-flat';
  // Sort order comes from the active feed sort mode so flipping
  // Popular / Latest / Oldest reorders the tile flow live.
  const sorted = _sortCatalysts(catalysts, _feedSortMode);
  sorted.forEach((cat) => {
    const isOwn = State.user && cat.ownerId === State.user.uid;
    const tile = createCatalystTileElement(
      cat,
      {
        width: COMMUNITY_TILE_W,
        height: COMMUNITY_TILE_H,
        showCreatorAvatar: true,
        showPinButton: !isOwn,
        isPinned: _myTrackedCatIds.has(cat.id),
      },
      { onTileClick: handleTileClick, onCreatorClick: handleCreatorClick, onPinClick: handlePinToggle },
    );
    wrap.appendChild(tile);
  });
  list.appendChild(wrap);
}

// Re-renders the feed view from the latest snapshot. Called by the
// feed mode toggle so flipping between Catalysts and Alchemists is
// instant — no Firestore round-trip.
function _repaintFeed() {
  const emptyMessage = _currentCategory === 'all'
    ? 'No catalysts yet. Be the first to share what you\'re building.'
    : 'No catalysts in this category yet.';
  if (_feedViewMode === 'alchemists') {
    renderCommunityHub(_currentFeedSnapshot, { emptyMessage });
  } else {
    renderCatalystsFlow(_currentFeedSnapshot, { emptyMessage });
  }
}

// ── /games route — system profile showing all internal games ──

function handleGameTileClick(cat) {
  if (!cat.gameId) return;
  const gameDef = getGame(cat.gameId);
  if (!gameDef) return;
  if (gameDef.status === 'coming_soon') { toast('Coming soon — stay tuned'); return; }
  if (gameDef.launchMode === 'route') { navigate('/game/' + (cat.slug || cat.gameId)); return; }
  if (gameDef.launchMode === 'modal') {
    if (gameDef.id === 'dot_sim') { openDotSim(cat.title); return; }
    if (gameDef.id === 'nodesplit') { openNodeSplit(cat.title); return; }
  }
}

async function renderGamesRoute() {
  hideAllViews();
  setPageTitle(['games']);
  showProfileBar(SYSTEM_PROFILE, GAME_REGISTRY.length, false);
  const gameCatalysts = getGamesAsCatalysts();

  // Embed games into the same container used on own profile.
  const gridEl = document.getElementById('profile-bar-catalysts');
  if (gridEl) {
    gridEl.style.position = 'relative';
    gridEl.style.display = '';
    gridEl.classList.add('visible');
    document.getElementById('profile-bar')?.classList.add('has-grid');
  }

  renderHexGrid({
    tiles: gameCatalysts,
    showAdd: false,
    emptyMessage: 'No games yet.',
    container: 'profile-bar-catalysts',
    getColsFn: getEmbeddedCols,
    gap: 24,
    onTileClick: handleGameTileClick,
    showCreatorAvatar: false,
  });

  const _honeyEl = document.getElementById('honeycomb');
  if (_honeyEl) { _honeyEl.style.display = 'none'; _honeyEl.innerHTML = ''; }

  const colsEl = document.getElementById('profile-columns');
  if (colsEl) colsEl.style.display = 'flex';

  // Hide "My Catalysts" — not relevant on /games
  const catCol = document.getElementById('profile-col-catalysts');
  if (catCol) catCol.style.display = 'none';

  // Left column — system games as pinned catalysts
  const pinnedCol = document.getElementById('profile-col-pinned');
  if (pinnedCol) {
    pinnedCol.style.display = '';
    pinnedCol.innerHTML = '';
    const pTitle = document.createElement('div');
    pTitle.className = 'profile-col-title';
    pTitle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg> Catalysts';
    pinnedCol.appendChild(pTitle);
    const pinned = getGamesAsCatalysts();
    if (pinned.length > 0) {
      const tilesWrap = document.createElement('div');
      tilesWrap.className = 'profile-col-tiles';
      pinned.forEach((cat) => {
        const tile = createCatalystTileElement(
          cat,
          { width: COMMUNITY_TILE_W, height: COMMUNITY_TILE_H, isPinned: true },
          { onTileClick: handleGameTileClick }
        );
        tilesWrap.appendChild(tile);
      });
      pinnedCol.appendChild(tilesWrap);
    } else {
      const empty = document.createElement('div');
      empty.className = 'profile-col-empty';
      empty.textContent = 'No pinned catalysts';
      pinnedCol.appendChild(empty);
    }
  }

  // Right column — dex.dev as a pinned alchemist
  const followingCol = document.getElementById('profile-col-following');
  if (followingCol) {
    followingCol.style.display = '';
    followingCol.innerHTML = '';
    const fTitle = document.createElement('div');
    fTitle.className = 'profile-col-title';
    fTitle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg> Alchemists';
    followingCol.appendChild(fTitle);

    const loading = document.createElement('div');
    loading.className = 'profile-col-empty';
    loading.textContent = 'Loading...';
    followingCol.appendChild(loading);

    (async () => {
      try {
        const dexUser = await getUserByUsernameHex('dex', null);
        followingCol.innerHTML = '';
        const t = document.createElement('div');
        t.className = 'profile-col-title';
        t.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg> Alchemists';
        followingCol.appendChild(t);
        if (dexUser) {
          const card = document.createElement('div');
          card.className = 'community-card';
          card.style.setProperty('--card-hex', '#' + (dexUser.hexCode || '5aaa72'));
          card.dataset.count = '1';
          const hdr = document.createElement('div');
          hdr.className = 'community-card-hdr';
          hdr.style.cursor = 'pointer';
          hdr.style.borderBottom = 'none';
          hdr.style.marginBottom = '0';
          hdr.style.paddingBottom = '0';
          const avatar = document.createElement('div');
          avatar.className = 'community-card-avatar';
          if (dexUser.photoURL) {
            const img = document.createElement('img');
            img.src = dexUser.photoURL;
            img.alt = '';
            avatar.appendChild(img);
          } else {
            avatar.textContent = (dexUser.displayName || 'D').charAt(0).toUpperCase();
          }
          hdr.appendChild(avatar);
          const meta = document.createElement('div');
          meta.className = 'community-card-meta';
          const name = document.createElement('div');
          name.className = 'community-card-name';
          name.textContent = dexUser.displayName || 'dex';
          meta.appendChild(name);
          const hexRow = document.createElement('div');
          hexRow.className = 'community-card-hex-row';
          hexRow.innerHTML = '<div class="community-card-hex-dot"></div><span class="community-card-hex">#' + (dexUser.hexCode || '5aaa72') + '</span>';
          meta.appendChild(hexRow);
          hdr.appendChild(meta);
          card.appendChild(hdr);
          hdr.addEventListener('click', () => {
            const slug = buildUserSlug((dexUser.displayName || '').toLowerCase(), dexUser.hexCode);
            navigate('/' + slug);
          });
          followingCol.appendChild(card);
        } else {
          const empty = document.createElement('div');
          empty.className = 'profile-col-empty';
          empty.textContent = 'No alchemists pinned yet';
          followingCol.appendChild(empty);
        }
      } catch (err) {
        console.warn('[games] failed to load dex alchemist:', err);
      }
    })();
  }
}

async function renderFeedRoute() {
  console.log('[feed] renderFeedRoute called', { category: _currentCategory, mode: _feedViewMode });
  hideAllViews();
  showFilterBar();
  setPageTitle([]);
  // MD#14: apply mode from URL route if present
  if (_currentRoute?.mode === 'catalysts' || _currentRoute?.mode === 'alchemists') {
    _feedViewMode = _currentRoute.mode;
    document.querySelectorAll('.feed-mode-btn').forEach((b) => {
      b.classList.toggle('selected', b.dataset.mode === _feedViewMode);
    });
  }
  // Skeleton briefly paints into #honeycomb before .feed-mode flips
  // over to the community list.
  renderSkeleton();
  _currentFeedSnapshot = [];
  const unsub = subscribePublicFeed(_currentCategory, (catalysts) => {
    console.log('[feed] subscription fired', { count: catalysts?.length ?? 0 });
    _currentFeedSnapshot = catalysts || [];
    _repaintFeed();
  });
  trackSub(unsub);
}

// MD12: full-page internal catalyst view. Pivots away from the
// profile bar + hex grid and paints the #internal-catalyst-view
// container with the catalyst's header + placeholder body. The back
// button returns the user to the owning profile page.
function renderInternalCatalyst(user, cat) {
  const view = document.getElementById('internal-catalyst-view');
  if (!view) return;

  // Reset everything first, then hide the grid entirely so only the
  // internal view is visible. hideAllViews already strips the profile
  // bar, feed mode, community list, etc.
  hideAllViews();
  const grid = document.getElementById('grid');
  if (grid) grid.style.display = 'none';
  view.classList.add('visible');

  setPageTitle([cat.title || 'project', user?.displayName || cat.ownerName || '']);

  // Thumbnail
  const thumbEl = document.getElementById('internal-catalyst-thumb');
  if (thumbEl) {
    thumbEl.style.backgroundImage = cat.thumbURL ? `url("${cat.thumbURL}")` : '';
    thumbEl.style.background = cat.thumbURL
      ? thumbEl.style.background
      : 'var(--bg3)';
  }

  // Title + status badge
  const titleEl = document.getElementById('internal-catalyst-title');
  if (titleEl) titleEl.textContent = cat.title || 'Untitled';
  const statusEl = document.getElementById('internal-catalyst-status');
  if (statusEl) {
    const status = cat.status || 'live';
    const labelMap = { live: 'Live', early: 'Early', placeholder: 'WIP' };
    const colorMap = { live: 'var(--clr)', early: '#E8853A', placeholder: 'var(--tx3)' };
    statusEl.dataset.status = status;
    statusEl.innerHTML = `<span class="cat-status-dot" style="background:${colorMap[status]}"></span>${labelMap[status] || 'Live'}`;
    statusEl.classList.add('visible');
  }

  // Creator row — clickable → navigate to the owner's profile.
  const creatorEl = document.getElementById('internal-catalyst-creator');
  if (creatorEl) {
    const ownerHex = cat.ownerHex || '5aaa72';
    const ownerName = cat.ownerName || 'anon';
    const unameHtml = renderUsername(ownerName, '#' + ownerHex, !!cat.ownerIsAdmin);
    creatorEl.innerHTML = `
      <div class="cat-detail-creator-avatar" style="border-color:#${escapeHtml(ownerHex)}">
        ${cat.ownerPhoto ? `<img src="${escapeHtml(cat.ownerPhoto)}" alt="">` : ''}
      </div>
      <span>${unameHtml} <span style="color:#${escapeHtml(ownerHex)}">#${escapeHtml(ownerHex)}</span></span>
    `;
    creatorEl.onclick = () => {
      _suppressNextDetailOpen = true;
      closeCatalystDetail();
      navigate('/' + buildUserSlug(ownerName.toLowerCase(), ownerHex));
    };
  }

  // Description
  const descEl = document.getElementById('internal-catalyst-desc');
  if (descEl) descEl.textContent = cat.description || '';

  // Collaborators — owner + extras. Matches the detail modal's
  // count semantics (1 = solo owner).
  const collabEl = document.getElementById('internal-catalyst-collab');
  if (collabEl) {
    const extras = Array.isArray(cat.collaborators) ? cat.collaborators : [];
    const total = 1 + extras.length;
    collabEl.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <span>${total === 1 ? '1 contributor' : total + ' contributors'}</span>
    `;
  }
}

// Used by the three catalyst-match branches inside renderProfileRoute.
// Returns true if the catalyst was routed to the internal view (caller
// should NOT also open the detail modal).
function _routeInternalIfNeeded(user, cat) {
  if (cat?.type !== 'internal') return false;
  renderInternalCatalyst(user, cat);
  return true;
}

async function renderProfileRoute(username, hex, { openSlug = null } = {}) {
  // MD#54: scroll to top on profile navigation
  document.getElementById('grid')?.scrollTo(0, 0);
  // Reset suppress flag if we're landing on a plain profile (no slug to open)
  if (!openSlug) _suppressNextDetailOpen = false;
  // NB-MD08: clear stale viewed-user tracked data; will be populated for
  // non-own profiles below when loadUserTracked resolves.
  _viewedUserTracked = null;
  hideAllViews();
  setPageTitle([username]);

  const cacheKey = profileCacheKey(username, hex);

  // Paint cached view instantly if we have one. If the openSlug
  // matches an internal catalyst in the cache, we pivot straight to
  // the internal view and skip profile-bar painting entirely so the
  // viewer sees only the project page.
  const cached = _profileCache.get(cacheKey);
  if (cached) {
    const cachedMatch = openSlug ? cached.catalysts.find((c) => c.slug === openSlug) : null;
    if (openSlug && !cachedMatch) {
      // Slug requested but not in cache — don't render the profile,
      // fall through to the live lookup below which will show 404 if
      // the slug genuinely doesn't exist.
    } else if (cachedMatch && _routeInternalIfNeeded(cached.user, cachedMatch)) {
      // Internal view is now painted from cache. Still continue below
      // to resolve the live user + subscription so the page updates if
      // something changes server-side.
    } else {
      const isOwn = State.user && cached.user.uid === State.user.uid;
      showProfileBar(cached.user, cached.catalysts.length, isOwn);
      _renderProfileView(cached.user, cached.catalysts, isOwn);
      if (cachedMatch && !_suppressNextDetailOpen) openCatalystDetail(cachedMatch);
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
    const match = openSlug ? catalysts.find((c) => c.slug === openSlug) : null;
    // If a slug was requested but doesn't exist in the subscription
    // snapshot, render the profile anyway — the slug may have been
    // deleted, or this is a stale URL from back nav. The fallback
    // lookup below will call show404() if the catalyst genuinely
    // doesn't exist.
    if (openSlug && !match) {
      showProfileBar(user, catalysts.length, isOwn);
      _renderProfileView(user, catalysts, isOwn);
      return;
    }
    // MD12: route internal matches to the full-page view before
    // touching the profile bar / grid so the project page takes over.
    if (match && _routeInternalIfNeeded(user, match)) {
      setPageTitle([match.title, user.displayName || username]);
      return;
    }
    showProfileBar(user, catalysts.length, isOwn);
    _renderProfileView(user, catalysts, isOwn);
    if (match) {
      setPageTitle([match.title, user.displayName || username]);
      if (!_suppressNextDetailOpen) openCatalystDetail(match);
      _suppressNextDetailOpen = false; // always reset after checking
    }
  });
  trackSub(unsub);

  // MD18: load + render the tracked footer for this profile. Own
  // profile uses the live cache so edits reflect instantly; visiting
  // someone else's profile falls back to a one-shot read, gated by
  // their trackedPublic flag.
  if (!isOwn) {
    const targetUid = user.uid;
    loadUserTracked(targetUid).then(({ catalysts, alchemists, trackedPublic }) => {
      const route = _currentRoute;
      if (!route || (route.page !== 'profile' && route.page !== 'catalyst')) return;
      const routeLower = (route.username || '').toLowerCase();
      const userLower = (user.usernameLower || user.displayName || '').toLowerCase();
      const hexMatch = (route.hex || '').toLowerCase() === (user.hexCode || '').toLowerCase();
      if (routeLower !== userLower || !hexMatch) return;
      // Cache the viewed user's tracked data so the Following column renders.
      _viewedUserTracked = { catalysts, alchemists, trackedPublic };
      if (_currentProfileView && _profileActiveTabs.has('following')) {
        _renderProfileView(_currentProfileView.user, _currentProfileView.catalysts, _currentProfileView.isOwn);
      }
    });
  }

  // If the subscription can't find the slug (possibly an old link to a
  // deleted catalyst or a fresh fetch race), fall back to a direct lookup.
  // If that also fails, the catalyst genuinely doesn't exist — show 404.
  if (openSlug) {
    const direct = await getCatalystBySlug(user.uid, openSlug);
    if (direct) {
      setPageTitle([direct.title, user.displayName || username]);
      if (!_routeInternalIfNeeded(user, direct)) openCatalystDetail(direct);
    } else {
      show404();
    }
  }
}

async function renderRoute({ force = false } = {}) {
  const route = getRoute();
  console.log('[route] renderRoute', { from: _currentRoute?.page, to: route.page, force });

  // MD8 idempotency: if we're already on the feed route and a new
  // renderRoute call comes in (commonly from auth resolution firing
  // updateAuthUI → renderRoute), don't tear down the live feed
  // subscription. The public catalyst feed is auth-independent, so
  // there's nothing to re-render. Just refresh ancillary UI and bail.
  // Profile/catalyst routes do not get this short-circuit because the
  // "+ Add" tile depends on whether the viewer is the owner.
  if (!force && route.page === 'feed' && _currentRoute?.page === 'feed') {
    _currentRoute = route;
    // MD#14: if URL mode changed, swap view modes and repaint from cache.
    if ((route.mode === 'catalysts' || route.mode === 'alchemists') && route.mode !== _feedViewMode) {
      _feedViewMode = route.mode;
      document.querySelectorAll('.feed-mode-btn').forEach((b) => {
        b.classList.toggle('selected', b.dataset.mode === _feedViewMode);
      });
      _repaintFeed();
    }
    _updateViewToggle();
    return;
  }

  // Tear down any listeners from the previous route
  clearSubs();

  // MD01: tear down play mode when navigating away from /play.
  if (_currentRoute?.page === 'play' && route.page !== 'play') {
    destroyPlayRoute();
  }

  // Capture whether this is a same-page re-render BEFORE we mutate
  // _currentRoute below — used to skip the fade-out when force-
  // re-rendering the same page (e.g. feed → feed on auth resolution).
  const sameRoute = _currentRoute?.page === route.page;
  _currentRoute = route;
  _updateViewToggle();

  // MD01: play route is fully self-contained — skip the honeycomb
  // fade and the normal page rendering.
  if (route.page === 'play') {
    await renderPlayRoute(route.gameId);
    return;
  }

  const honey = document.getElementById('honeycomb');

  // Smooth fade between routes. Skipped on the very first render and
  // also when we're re-rendering the same route (no visible page change
  // to fade across — would just flash blank for 150ms).
  if (!_firstRender && !sameRoute && honey) {
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
    } else if (route.page === 'games') {
      await renderGamesRoute();
    } else if (route.page === 'nodesplit') {
      await renderGamesRoute();
      setTimeout(() => openNodeSplit('NodeSplit'), 100);
    } else if (route.page === 'dotsim') {
      await renderGamesRoute();
      setTimeout(() => openDotSim('Dot-Sim'), 100);
    } else {
      show404();
    }
  } finally {
    if (honey) honey.style.opacity = '1';
    // NB-MD11: refresh Invite-to-game button states since /play toggled.
    applyInviteButtonStates();
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

  // MD13: label the guest pill "Sign in" so the entry point is
  // explicit. Clicking it opens the sign-in modal (see acct-btn
  // handler override below).
  document.getElementById('acct-name-short').textContent = 'Sign in';
  document.getElementById('acct-name').textContent = 'Alchemist';
  document.getElementById('acct-hex-label').innerHTML = '';
  document.getElementById('acct-hex-dot').style.background = 'var(--tx3)';
  document.documentElement.style.setProperty('--acct-hex', 'var(--bdr)');

  // Swap footers
  document.getElementById('acct-footer').style.display = 'none';
  document.getElementById('acct-signin-footer').classList.add('visible');

  // Hide edit profile for guests
  document.getElementById('acct-edit-btn').style.display = 'none';

  // MD13: gray out the Catalysts dropdown section — guests can't
  // create catalysts, so tapping it prompts the sign-in modal
  // instead of expanding the dropdown (handler wired at boot).
  const catSection = document.getElementById('acct-catalysts-section');
  if (catSection) {
    catSection.classList.add('guest-locked');
    catSection.classList.remove('open');
  }

  _updateViewToggle();
}

function updateAuthUI(user, profile) {
  if (!user) {
    paintGuestProfilePill();
    _profileCache.clear();
    _viewingOther = null;
    setFriendsCurrentUser(null);
    // MD14: tear down the my-catalysts subscription + reset count.
    _stopMyCatalystsSub();
    const countEl = document.getElementById('acct-catalysts-count');
    if (countEl) countEl.textContent = '0';
    _renderMyCatalystsMini();
    // MD18: tear down tracked lists on sign-out too.
    _stopMyTrackedSub();
    const pinnedCountEl = document.getElementById('acct-pinned-count');
    if (pinnedCountEl) pinnedCountEl.textContent = '0';
    _renderMyPinnedMini();
    // MD17: guests always land on Alchemists. Force-reset so a
    // previously signed-in session's choice doesn't leak across.
    // MD20: same for the sort — guests always see Popular.
    _feedViewMode = 'alchemists';
    _feedSortMode = 'popular';
    document.querySelectorAll('.feed-mode-btn').forEach((b) => {
      b.classList.toggle('selected', b.dataset.mode === _feedViewMode);
    });
    document.querySelectorAll('.feed-sort-btn').forEach((b) => {
      b.classList.toggle('selected', b.dataset.sort === _feedSortMode);
    });
    renderRoute();
    return;
  }

  // MD17: load this account's last-selected feed tab. Missing key →
  // default Alchemists. Only apply if it differs from current state.
  let stored = null;
  try { stored = localStorage.getItem(_feedModeKey(user.uid)); } catch {}
  const nextMode = (stored === 'catalysts' || stored === 'alchemists') ? stored : 'alchemists';
  if (nextMode !== _feedViewMode) {
    _feedViewMode = nextMode;
    document.querySelectorAll('.feed-mode-btn').forEach((b) => {
      b.classList.toggle('selected', b.dataset.mode === _feedViewMode);
    });
  }

  // MD20: restore per-account sort. Missing/invalid key → Popular.
  let storedSort = null;
  try { storedSort = localStorage.getItem(_feedSortKey(user.uid)); } catch {}
  const nextSort = _FEED_SORT_MODES.has(storedSort) ? storedSort : 'popular';
  if (nextSort !== _feedSortMode) {
    _feedSortMode = nextSort;
    document.querySelectorAll('.feed-sort-btn').forEach((b) => {
      b.classList.toggle('selected', b.dataset.sort === _feedSortMode);
    });
  }

  // Attach the friends/requests listeners to this user. Safe to call
  // on every auth resolution — setFriendsCurrentUser tears down the
  // previous subscription before starting a new one.
  setFriendsCurrentUser(user.uid);

  // MD14: persistent subscription to the signed-in user's catalysts
  // so the dropdown mini grid + count stay fresh across routes.
  _startMyCatalystsSub(user.uid);

  // MD18: live subscription to this user's tracked (pinned + followed)
  // lists so the pin button state on community tiles + the dropdown
  // pinned mini-row stay current without a route refresh.
  _startMyTrackedSub();

  // Sync the saved logo colors across devices. If the signed-in
  // user has stored values in their profile doc, adopt them.
  // Validate against the current palette — if a saved color was
  // removed from the palette in a code update, reset to default.
  if (profile?.logoTopColor || profile?.logoBotColor) {
    const _ps = new Set(LOGO_PALETTE.map((c) => c.hex.toLowerCase()));
    const nextTop = (profile.logoTopColor && _ps.has(profile.logoTopColor.toLowerCase()))
      ? profile.logoTopColor : DEFAULT_LOGO_TOP;
    const nextBot = (profile.logoBotColor && _ps.has(profile.logoBotColor.toLowerCase()))
      ? profile.logoBotColor : DEFAULT_LOGO_BOT;
    const nextMode = profile?.logoMode || 'dual';
    if (nextTop !== _logoTop || nextBot !== _logoBot || nextMode !== _logoMode) {
      setLogoColors(nextTop, nextBot, nextMode);
    }
  }

  // MD27: push Firestore-synced custom color slots into the picker.
  // The prefs subdoc (users/{uid}/prefs/profile) is the cross-site
  // bridge — when NodeBlast or a future DexNote update writes
  // customColorSlots, the snapshot callback re-fires updateAuthUI
  // so this push runs automatically and the picker stays in sync.
  // Null = never seeded → leave whatever localStorage had.
  if (profile?.customColorSlots) {
    syncSlotsFromFirestore(profile.customColorSlots);
  }

  const acctBtn = document.getElementById('acct-btn');
  acctBtn.style.display = 'flex';

  // Swap footers: signed-in footer visible, guest footer hidden
  document.getElementById('acct-footer').style.display = '';
  document.getElementById('acct-signin-footer').classList.remove('visible');

  // Unhide edit profile button
  const editBtn = document.getElementById('acct-edit-btn');
  if (editBtn) editBtn.style.display = '';

  // MD13: un-gray the Catalysts section (signed-in users can create)
  document.getElementById('acct-catalysts-section')?.classList.remove('guest-locked');

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

  // Always re-render on auth change. The boot block now defers the
  // first renderRoute call until this point, so the feed route has
  // never actually rendered yet — only a skeleton placeholder is on
  // screen. force:true bypasses the renderRoute idempotency guard so
  // the deferred initial subscription actually fires now that auth has
  // resolved and Firestore queries can succeed.
  renderRoute({ force: true });
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
const LOGO_MODE_KEY = 'nb-logo-mode';

let _logoTop = DEFAULT_LOGO_TOP;
let _logoBot = DEFAULT_LOGO_BOT;
let _logoMode = 'dual';

function paintLogo(top, bot, mode) {
  const topAdj = getThemeAdjustedLogoColor(top);
  const botAdj = getThemeAdjustedLogoColor(bot);
  const leftHalf = document.getElementById('nodeblast_logo_left');
  const rightHalf = document.getElementById('nodeblast_logo_right');
  const nodeEl = document.getElementById('brand-node');
  const blastEl = document.getElementById('brand-blast');

  if (mode === 'mono') {
    if (leftHalf) leftHalf.setAttribute('fill', topAdj);
    if (rightHalf) rightHalf.setAttribute('fill', topAdj);
    if (nodeEl) nodeEl.style.color = topAdj;
    if (blastEl) blastEl.style.color = topAdj;
  } else {
    if (leftHalf) leftHalf.setAttribute('fill', topAdj);
    if (nodeEl) nodeEl.style.color = topAdj;
    if (rightHalf) rightHalf.setAttribute('fill', botAdj);
    if (blastEl) blastEl.style.color = botAdj;
  }

  const circL = document.getElementById('nodeblast_circle_left');
  const circR = document.getElementById('nodeblast_circle_right');
  if (circL) circL.setAttribute('fill', 'transparent');
  if (circR) circR.setAttribute('fill', 'transparent');

  const loadTop = document.getElementById('loading-path-top');
  const loadBot = document.getElementById('loading-path-bot');
  if (loadTop) loadTop.setAttribute('fill', topAdj);
  if (loadBot) loadBot.setAttribute('fill', mode === 'mono' ? topAdj : botAdj);
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
function _applyBotClrVars() {
  const isDark = State.theme === 'dark';
  const botAdj = isDark ? _logoBot : getThemeAdjustedLogoColor(_logoBot);
  document.documentElement.style.setProperty('--clr-bot', botAdj);
  const bh = botAdj.replace('#', '');
  const br = parseInt(bh.slice(0, 2), 16);
  const bg = parseInt(bh.slice(2, 4), 16);
  const bb = parseInt(bh.slice(4, 6), 16);
  const botYiq = (br * 299 + bg * 587 + bb * 114) / 1000;
  document.documentElement.style.setProperty('--clr-bot-on', botYiq >= 150 ? '#111111' : '#ffffff');
}

function setLogoColors(top, bot, mode) {
  _logoTop = top || DEFAULT_LOGO_TOP;
  _logoBot = bot || DEFAULT_LOGO_BOT;
  _logoMode = mode || 'dual';
  paintLogo(_logoTop, _logoBot, _logoMode);
  applyAccent(_logoTop);
  _applyBotClrVars();
  applyFavicon(_logoTop, _logoBot, _logoMode);
  markSelectedSwatches();
  _updateVariantToggle();
  try {
    localStorage.setItem(LOGO_TOP_KEY, _logoTop);
    localStorage.setItem(LOGO_BOT_KEY, _logoBot);
    localStorage.setItem(LOGO_MODE_KEY, _logoMode);
  } catch {}
}

function _buildVariantToggle(picker) {
  const wrap = document.createElement('div');
  wrap.className = 'logo-variant-toggle';
  wrap.id = 'logo-variant-toggle';
  wrap.title = 'Switch logo style';
  picker.appendChild(wrap);
  _updateVariantToggle();
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    const newMode = _logoMode === 'dual' ? 'mono' : 'dual';
    setLogoColors(_logoTop, _logoBot, newMode);
    if (State.user) saveLogoColors({ logoTopColor: _logoTop, logoBotColor: _logoBot, logoMode: newMode });
  });
}

function _updateVariantToggle() {
  const wrap = document.getElementById('logo-variant-toggle');
  if (!wrap) return;
  if (_logoMode === 'dual') {
    const c = getThemeAdjustedLogoColor(_logoTop);
    wrap.innerHTML = buildMonoLogoSvg(c);
  } else {
    wrap.innerHTML = buildLogoSvg(
      getThemeAdjustedLogoColor(_logoTop),
      getThemeAdjustedLogoColor(_logoBot)
    );
  }
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
    btn.style.setProperty('--swatch-color', c.hex);
    btn.title = c.name;
    // MD#42: splat shape for dark-mode selected animation
    const splat = document.createElement('div');
    splat.className = 'swatch-splat';
    splat.innerHTML = `<svg viewBox="0 0 40 40" width="100%" height="100%"><circle cx="20" cy="20" r="8" fill="${c.hex}"/><circle cx="12" cy="14" r="4" fill="${c.hex}"/><circle cx="28" cy="13" r="3.5" fill="${c.hex}"/><circle cx="14" cy="27" r="3" fill="${c.hex}"/><circle cx="27" cy="26" r="4" fill="${c.hex}"/><circle cx="20" cy="10" r="2.5" fill="${c.hex}"/><circle cx="10" cy="20" r="2" fill="${c.hex}"/><circle cx="30" cy="20" r="2.5" fill="${c.hex}"/><circle cx="20" cy="30" r="2" fill="${c.hex}"/></svg>`;
    btn.appendChild(splat);
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
  _buildVariantToggle(picker);

  // Initial paint — respect any cached values the user picked on a
  // previous visit, else fall back to the defaults. If the saved
  // color no longer exists in the current palette (e.g. we swapped
  // out accent colors in a code update), auto-migrate to the default
  // so users don't keep orphaned colors.
  const paletteSet = new Set(LOGO_PALETTE.map((c) => c.hex.toLowerCase()));
  const rawTop = localStorage.getItem(LOGO_TOP_KEY);
  const rawBot = localStorage.getItem(LOGO_BOT_KEY);
  const topValid = rawTop && paletteSet.has(rawTop.toLowerCase());
  const botValid = rawBot && paletteSet.has(rawBot.toLowerCase());
  const initialTop = topValid ? rawTop : DEFAULT_LOGO_TOP;
  const initialBot = botValid ? rawBot : DEFAULT_LOGO_BOT;
  // Persist the migration so it only runs once per palette change.
  if (rawTop && !topValid) {
    try { localStorage.setItem(LOGO_TOP_KEY, initialTop); } catch {}
  }
  if (rawBot && !botValid) {
    try { localStorage.setItem(LOGO_BOT_KEY, initialBot); } catch {}
  }
  const savedMode = localStorage.getItem(LOGO_MODE_KEY) || 'dual';
  setLogoColors(initialTop, initialBot, savedMode);

  // Re-paint the logo whenever the theme toggles so the light-mode
  // darkening is recomputed against the current _logoTop/_logoBot.
  // applyFavicon uses the raw (unadjusted) colors intentionally — a
  // darkened favicon would look worse on dark OS chrome.
  onThemeChange(() => {
    paintLogo(_logoTop, _logoBot, _logoMode);
    _applyBotClrVars();
    _updateVariantToggle();
  });

  let hideTimer = null;
  const show = () => {
    clearTimeout(hideTimer); hideTimer = null;
    // MD#65: pre-selected swatches show splat instantly on open (no animation)
    picker.querySelectorAll('.logo-swatch.selected').forEach((s) => s.classList.add('instant'));
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
    // MD#65: clicked swatch drops .instant so the click animation plays
    btn.classList.remove('instant');

    let nextTop = _logoTop, nextBot = _logoBot;
    if (col === 'top') {
      nextTop = newColor;
    } else {
      nextBot = newColor;
    }
    setLogoColors(nextTop, nextBot, _logoMode);
    if (State.user) saveLogoColors({ logoTopColor: nextTop, logoBotColor: nextBot, logoMode: _logoMode });
  });
}

/* ══════════════════════════════════════
   MD13: sign-in modal
══════════════════════════════════════ */

// Open the centered sign-in modal. Safe to call from anywhere —
// `initSigninModal` below wires the close button + backdrop + escape.
function openSigninModal() {
  const m = document.getElementById('signin-modal');
  const err = document.getElementById('signin-modal-error');
  if (!m) return;
  if (err) err.textContent = '';
  m.classList.add('open');
}

function closeSigninModal() {
  document.getElementById('signin-modal')?.classList.remove('open');
}

// One-time wiring for the sign-in modal. Provider buttons route
// through the same signIn() export that the original guest footer
// uses so there's only one auth code path to reason about.
function initSigninModal() {
  const modal = document.getElementById('signin-modal');
  if (!modal) return;
  document.getElementById('signin-modal-close')?.addEventListener('click', closeSigninModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeSigninModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeSigninModal();
  });
  document.getElementById('signin-modal-google')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await signIn('google'); closeSigninModal(); }
    catch (err) {
      const el = document.getElementById('signin-modal-error');
      if (el) el.textContent = err?.message || 'Sign-in failed';
    }
  });
  document.getElementById('signin-modal-github')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await signIn('github'); closeSigninModal(); }
    catch (err) {
      const el = document.getElementById('signin-modal-error');
      if (el) el.textContent = err?.message || 'Sign-in failed';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // EMERGENCY DEBUG: wrap the whole boot sequence so any thrown
  // error during initialization surfaces to the console AND paints
  // the stack trace directly into the page instead of leaving the
  // user with a silent blank screen. Remove once the site is stable.
  console.log('[BOOT] DOMContentLoaded fired');
  // Safety net: force-hide the loading screen after 6s if boot stalls
  // (e.g. hard refresh on a catalyst URL races with auth resolve).
  setTimeout(() => {
    const ls = document.getElementById('loading-screen');
    if (ls && !ls.classList.contains('hidden')) {
      console.warn('[boot] Loading screen timeout — forcing hide');
      ls.classList.add('hidden');
      const err = document.getElementById('loading-error');
      if (err) err.style.display = 'block';
    }
  }, 6000);
  try {
  // Palette first, accent second — applyPalette writes --clr, so the
  // logo accent must be applied *after* it to end up as the effective
  // site color.
  console.log('[BOOT] 1 - applyTheme');
  applyTheme(State.theme, true);
  console.log('[BOOT] 2 - applyPalette');
  applyPalette(State.palette);
  console.log('[BOOT] 3 - initLogoPicker');
  initLogoPicker();

  console.log('[BOOT] 4 - initTooltips');
  initTooltips();
  console.log('[BOOT] 5 - initThemeToggle');
  initThemeToggle();
  console.log('[BOOT] 6 - initPalettePickers');
  initPalettePickers();
  console.log('[BOOT] 7 - initColorPicker');
  initColorPicker();
  console.log('[BOOT] 8 - initAudioSettings');
  initAudioSettings();
  console.log('[BOOT] 9 - initSigninModal');
  initSigninModal();

  // MD13: intercept the account pill click BEFORE initAccountMenu
  // wires its own listener. When a guest clicks, we open the sign-in
  // modal instead of the dropdown. stopImmediatePropagation blocks
  // the later same-phase listener so the dropdown never opens.
  document.getElementById('acct-btn')?.addEventListener('click', (e) => {
    if (State.user) return; // signed in → let the dropdown handler run
    e.preventDefault();
    e.stopImmediatePropagation();
    openSigninModal();
  });

  // MD13: intercept the catalysts-dropdown toggle for guests so
  // tapping "Catalysts" in the account menu surfaces the sign-in
  // modal instead of expanding an empty list.
  document.querySelector('#acct-catalysts-section .acct-dropdown-toggle')
    ?.addEventListener('click', (e) => {
      if (State.user) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toast('Sign in to create a catalyst');
      openSigninModal();
    });
  console.log('[BOOT] 10 - initAccountMenu');
  initAccountMenu({
    onSignOut: () => {
      showModal({
        title: 'Sign out?',
        msg: 'You will need to sign in again to access your account.',
        confirmLabel: 'Sign out',
        danger: true,
        onConfirm: async () => {
          await signOut();
          // MD13: land the user on the public community feed after
          // sign-out instead of a profile page they can no longer edit.
          navigate('/');
        },
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
      _currentFeedSnapshot = [];

      // Propagate profile changes to denormalized catalyst fields so
      // existing tiles reflect the new username/hex/photo/socialLinks
      // immediately. socialLinks trigger a refresh too because the
      // community cards render them from the denormalized copy.
      if (updates.displayName || updates.hexCode || updates.photoURL || Array.isArray(updates.socialLinks)) {
        await refreshOwnerOnAllCatalysts();
      }
      if (updates.displayName || updates.hexCode || updates.photoURL) {
        await refreshTrackedOwnerData(State.user.uid, State.profile);
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
      renderRoute({ force: true });
    },
  });

  console.log('[BOOT] 11 - initCatalystModal');
  initCatalystModal(() => {
    _profileCache.clear();
    renderRoute();
  });
  console.log('[BOOT] 12 - initCatalystDetail');
  // MD03: inject pin/unpin/isPinned callbacks so the detail popup can
  // drive the tracked pin state without importing tracked.js itself.
  initCatalystDetail({
    onPin: (cat) => handlePinToggle(cat, true),
    onUnpin: (catId) => handlePinToggle({ id: catId }, false),
    isPinned: (catId) => _myTrackedCatIds.has(catId),
  });
  // MD02: QR share modal (lazy-loads QR lib on first open)
  initQrShareModal();
  console.log('[BOOT] 13 - initRouter');
  initRouter(renderRoute);

  // MD#47: welcome notification — once per account, once per guest session.
  const welcomeKey = State.user?.uid ? 'nb-welcomed-' + State.user.uid : 'nb-welcomed-guest';
  if (!localStorage.getItem(welcomeKey)) {
    try { localStorage.setItem(welcomeKey, '1'); } catch {}
    setTimeout(() => {
      toast("Welcome to nodeblast! 🎉 Explore what others have built, share your own creations, and push boundaries.");
    }, 1500);
  }
  console.log('[BOOT] 14 - initSearch');
  initSearch();
  console.log('[BOOT] 15 - initNotifications');
  initNotifications();
  console.log('[BOOT] 16 - initHelpPanel');
  initHelpPanel();
  console.log('[BOOT] 17 - initFriends');
  initFriends();

  // MD14: re-render the mini catalyst grid AFTER the default toggle
  // handler (registered inside initAccountMenu above) has flipped
  // .open on the section. rAF gives the body a tick to become
  // display:block so clientWidth is non-zero when renderMiniHexGrid
  // reads it.
  document.querySelector('#acct-catalysts-section .acct-dropdown-toggle')
    ?.addEventListener('click', () => {
      if (!State.user) return;
      requestAnimationFrame(() => {
        const section = document.getElementById('acct-catalysts-section');
        if (section?.classList.contains('open')) _renderMyCatalystsMini();
      });
    });

  // Brand + logo → home
  document.getElementById('hdr-brand')?.addEventListener('click', () => navigate('/'));
  document.getElementById('hdr-logo')?.addEventListener('click', () => navigate('/'));

  // MD01: Play button → /play route
  document.getElementById('play-btn')?.addEventListener('click', () => navigate('/games'));

  // Community / My Profile view toggle in the header.
  document.getElementById('view-toggle-community')?.addEventListener('click', () => {
    const modePath = _feedViewMode === 'catalysts' ? '/catalysts' : '/alchemists';
    navigate(modePath);
  });
  document.getElementById('view-toggle-profile')?.addEventListener('click', () => {
    if (!State.user) { toast('Sign in to view your profile'); return; }
    const name = (State.profile?.displayName || '').toLowerCase();
    const hex = State.profile?.hexCode || '';
    if (name) navigate('/' + buildUserSlug(name, hex));
  });

  // 404 → home
  document.getElementById('not-found-home')?.addEventListener('click', () => navigate('/'));

  // MD12: internal catalyst back button — navigates to the owning
  // profile page. The owner info is read from the route so this
  // works even if the user refreshed directly on the project URL.
  document.getElementById('internal-catalyst-back')?.addEventListener('click', () => {
    const route = _currentRoute || getRoute();
    if (route?.username) {
      navigate('/' + buildUserSlug(route.username.toLowerCase(), route.hex || ''));
    } else {
      navigate('/');
    }
  });

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

  console.log('[BOOT] 18 - paintGuestProfilePill');
  // Guest mode by default — paint the pill immediately so the account
  // menu is usable before auth resolves (or if the user never signs in).
  paintGuestProfilePill();

  // NB-MD04: wire up profile view tabs (My Catalysts / Pinned / Following)
  initProfileTabs();

  // Category filter pills (feed route)
  document.querySelectorAll('.cat-filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cat-filter-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      _currentCategory = pill.dataset.cat;
      if (_currentRoute?.page === 'feed') renderFeedRoute();
    });
  });

  // Feed view-mode toggle (Catalysts vs Alchemists). Switching mode
  // re-renders from the cached snapshot — no Firestore round-trip.
  // Initial selected state mirrors the persisted _feedViewMode.
  document.querySelectorAll('.feed-mode-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.mode === _feedViewMode);
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode !== 'catalysts' && mode !== 'alchemists') return;
      if (mode === _feedViewMode) return;
      _feedViewMode = mode;
      // MD#14: reflect current mode in URL (replaceState so toggling
      // doesn't flood browser history).
      const newPath = mode === 'alchemists' ? '/alchemists' : '/catalysts';
      if (window.location.pathname !== newPath) {
        history.replaceState({}, '', newPath);
      }
      // Per-account persistence — signed-out users get no memory,
      // so their next visit always reverts to Alchemists (MD17).
      if (State.user?.uid) {
        try { localStorage.setItem(_feedModeKey(State.user.uid), mode); } catch {}
      }
      document.querySelectorAll('.feed-mode-btn').forEach((b) => {
        b.classList.toggle('selected', b.dataset.mode === mode);
      });
      if (_currentRoute?.page === 'feed') _repaintFeed();
    });
  });

  // Feed sort toggle (Popular / Latest / Oldest). Mirrors the feed
  // mode pattern — state is persisted in localStorage and changing
  // the sort repaints from the cached snapshot.
  document.querySelectorAll('.feed-sort-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.sort === _feedSortMode);
    btn.addEventListener('click', () => {
      const sort = btn.dataset.sort;
      if (!_FEED_SORT_MODES.has(sort)) return;
      if (sort === _feedSortMode) return;
      _feedSortMode = sort;
      // MD20: per-account persistence. Guests get no memory so their
      // next visit always reverts to Popular.
      if (State.user?.uid) {
        try { localStorage.setItem(_feedSortKey(State.user.uid), sort); } catch {}
      }
      document.querySelectorAll('.feed-sort-btn').forEach((b) => {
        b.classList.toggle('selected', b.dataset.sort === sort);
      });
      if (_currentRoute?.page === 'feed') _repaintFeed();
    });
  });

  // MD24: backup restore modal wiring. Settings → "Restore catalysts
  // from backup" opens a dedicated modal that lists the 10 most
  // recent backups (metadata only). Clicking a row fires a confirm
  // via showModal, and on confirm we call restoreCatalystBackup.
  const backupModal = document.getElementById('backup-modal');
  const backupList = document.getElementById('backup-modal-list');
  const closeBackupModal = () => backupModal?.classList.remove('open');
  document.getElementById('backup-modal-close')?.addEventListener('click', closeBackupModal);
  backupModal?.addEventListener('click', (e) => { if (e.target === backupModal) closeBackupModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backupModal?.classList.contains('open')) closeBackupModal();
  });

  document.getElementById('settings-restore-backup-btn')?.addEventListener('click', async () => {
    if (!State.user) { toast('Sign in first'); return; }
    if (!backupModal || !backupList) return;
    backupList.innerHTML = '<div class="backup-empty">Loading…</div>';
    backupModal.classList.add('open');
    const rows = await listCatalystBackups(State.user.uid);
    if (!rows.length) {
      backupList.innerHTML = '<div class="backup-empty">No backups yet. Create or edit a catalyst to make your first snapshot.</div>';
      return;
    }
    backupList.innerHTML = '';
    rows.forEach((row) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'backup-row';
      const when = row.createdAtMs
        ? new Date(row.createdAtMs).toLocaleString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit',
          })
        : 'Unknown';
      const countText = row.catalystCount === 1 ? '1 catalyst' : `${row.catalystCount} catalysts`;
      btn.innerHTML = `
        <div class="backup-row-when">${escapeHtml(when)}</div>
        <div class="backup-row-count">${escapeHtml(countText)}</div>
      `;
      btn.addEventListener('click', () => {
        showModal({
          title: 'Restore this backup?',
          msg: `Your catalysts will be replaced with the snapshot from <b>${escapeHtml(when)}</b> (${escapeHtml(countText)}). This cannot be undone.`,
          confirmLabel: 'Restore',
          danger: true,
          onConfirm: async () => {
            const ok = await restoreCatalystBackup(State.user.uid, row.id);
            if (ok) {
              toast('Catalysts restored');
              closeBackupModal();
            } else {
              toast('Restore failed');
            }
          },
        });
      });
      backupList.appendChild(btn);
    });
  });

  // When the catalyst detail popup closes via back button, strip the slug
  // from the URL so a refresh lands on the profile page, not the catalyst.
  window.addEventListener('popstate', () => {
    // If a detail popup is currently open, mark that we don't want
    // the next renderRoute to re-open it (user is navigating back).
    const pop = document.getElementById('cat-detail-popup');
    if (pop?.classList.contains('open')) {
      _suppressNextDetailOpen = true;
    }
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

    // MD#16: Ctrl/Cmd+Z undo / Ctrl/Cmd+Shift+Z redo for card collapse.
    if (!isTyping) {
      const isMac = navigator.platform?.includes('Mac');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          const entry = _collapseRedoStack.pop();
          if (!entry) return;
          e.preventDefault();
          _applyCollapseAction(entry.uid, entry.action);
        } else {
          const entry = _collapseUndoStack.pop();
          if (!entry) return;
          e.preventDefault();
          const reverseAction = entry.action === 'collapse' ? 'expand' : 'collapse';
          _collapseRedoStack.push(entry);
          const stackLen = _collapseUndoStack.length;
          _applyCollapseAction(entry.uid, reverseAction);
          // The triggered click re-pushed to undo — remove that entry.
          if (_collapseUndoStack.length > stackLen) _collapseUndoStack.pop();
        }
        return;
      }
    }
    if (e.key === 'Escape') {
      // MD04: exit modal toggle in play mode (takes priority)
      if (_currentRoute?.page === 'play') {
        e.preventDefault();
        e.stopPropagation();
        if (window._nbPlayExitModalOpen) {
          window._nbCloseExitModal?.();
        } else {
          window._nbOpenExitModal?.();
        }
        return;
      }
      // Let individual components handle their own Escape first (they all
      // listen on document). This block is a catchall for the search
      // dropdown in case something slips through.
      if (isSearchOpen()) { closeSearch(); return; }
    }
  });

  // Show a skeleton + filter bar for the feed route immediately so the
  // page isn't blank while auth resolves. Other routes (profile,
  // catalyst) get nothing here — onAuthReady → updateAuthUI will fire
  // renderRoute and that handler will paint its own skeleton.
  // Route-gated to avoid flashing the feed filter bar on a hard-refresh
  // of /name.hex (profile) or /name.hex/slug (catalyst).
  if (getRoute().page === 'feed') {
    showFilterBar();
    renderSkeleton();
  }

  console.log('[BOOT] 19 - onAuthReady(updateAuthUI)');
  // Do NOT call renderRoute() directly here. The catalysts collection's
  // Firestore security rules require an authenticated user, so any
  // subscription set up before auth resolves will fail with a permission
  // error and render an empty state. updateAuthUI fires renderRoute()
  // once auth resolves — that's the first real render.
  onAuthReady(updateAuthUI);

  // MD8 defensive: re-apply the logo paint after the next animation
  // frame. If anything in the boot block (theme/palette/etc.) re-mounts
  // the SVG or interferes with the initial paintLogo call, this catches
  // it. paintLogo is idempotent — calling it again with the same colors
  // is a no-op visually.
  requestAnimationFrame(() => paintLogo(_logoTop, _logoBot));

  window.addEventListener('resize', () => {
    // On profile routes, re-render the catalysts column; otherwise
    // re-render the default #honeycomb grid.
    const onProfile = !!_currentProfileView;
    renderHexGrid({
      tiles: _currentTiles,
      showAdd: _currentShowAdd,
      container: onProfile ? 'profile-col-catalysts' : null,
      onTileClick: handleTileClick,
      onAddClick: _handleAddCatalystClick,
      onCreatorClick: handleCreatorClick,
      onReorder: _currentShowAdd ? handleReorder : null,
    });
  });
  console.log('[BOOT] 20 - boot complete');
  // Hide loading screen — boot succeeded
  const ls = document.getElementById('loading-screen');
  if (ls) {
    ls.classList.add('hidden');
    ls.addEventListener('transitionend', () => { ls.style.display = 'none'; }, { once: true });
  }
  } catch (err) {
    console.error('[BOOT] Fatal error during initialization:', err);
    // Keep loading screen visible + show error message after 5s
    const le = document.getElementById('loading-error');
    if (le) setTimeout(() => { le.style.display = ''; }, 5000);
  }
});
