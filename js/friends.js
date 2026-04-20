// ══════════════════════════════════════════════════════════════
//  NodeBlast — FRIENDS + DMs + PRESENCE + SESSION INVITES (MD15)
//
//  Cross-site parity with DexNote. Every Firestore path below
//  mirrors what DexNote reads/writes, so:
//
//    users/{uid}/friends/{friendUid}
//      { uid, username, hexColor, addedAt, favorite }
//
//    users/{uid}/friend_requests/{fromUid}
//      { fromUid, fromUsername, fromHex, status, createdAt }
//
//    users/{uid}/session_invites/{inviteId}
//      { fromUid, fromUsername, fromHex, sessionId, sessionName,
//        sessionColor, sessionIcon, status }
//      — NodeBlast only RECEIVES these. Accept opens dexnote.dev.
//
//    dms/{convoId}                                  ← convoId = _getDmConvoId(uid1, uid2)
//      { participants, lastMessage, lastMessageAt, lastMessageBy,
//        lastMessageByName, lastMessageByHex, hex_<uid>... }
//
//    dms/{convoId}/messages/{autoId}
//      { fromUid, fromHex, text, createdAt, node? }  ← `node` is
//        a DexNote rich-chip attachment. NodeBlast sends text-only
//        messages but renders incoming messages with a `node` field
//        as plain text in the bubble (fallback path).
//
//    users/{uid}/presence/current                   ← Firestore-based
//      { state: 'online' | 'offline', lastChanged }
//      — DexNote uses RTDB presence at `presence/{uid}`. NodeBlast
//      doesn't bundle RTDB, so cross-site presence WILL NOT sync
//      between DexNote and NodeBlast. This module only reflects
//      presence for users who were last seen on NodeBlast.
//
//  DexNote stores `hexColor`/`fromHex` WITH a leading '#'. NodeBlast
//  internally strips the '#' (see auth.js stripHash), so this module
//  normalizes both directions: reads tolerate either form, writes
//  always include the '#' so DexNote stays happy.
// ══════════════════════════════════════════════════════════════

import { app } from './firebase-config.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import State from './state.js';
import { toast, renderUsername, escapeHtml, showModal } from './ui-events.js';
import { navigate, buildUserSlug } from './router.js';
import { userLookupKey } from './users.js';

const db = getFirestore(app);

// ── Friend list + request subscriptions ─────────────────────────
let _friendsUnsub = null;
let _requestsUnsub = null;
let _friends = [];
let _seenRequestIds = new Set();

// ── Presence ────────────────────────────────────────────────────
// Per-friend onSnapshot listeners on users/{uid}/presence/current.
// Keyed by friend uid so we can tear down individually when the
// friends list changes.
const _presenceUnsubs = new Map(); // uid → unsub
const _presenceState = new Map();  // uid → 'online' | 'offline'
let _selfPresenceTimer = null;

// ── DM state (a single panel, one convo open at a time) ─────────
let _dmUnsub = null;
let _dmConvoId = null;
let _dmRecipient = null; // { uid, name, hex (with #) }
// Top-level DM listener — watches every convo the user is part of
// so incoming messages from OTHER convos trigger a notification.
let _dmTopListUnsub = null;
// Track the last seen message timestamp per convo so we don't
// re-notify on initial listener mount.
const _lastDmSeenAt = new Map();

// ── Session invites ────────────────────────────────────────────
let _sessionInviteUnsub = null;
const _shownInviteIds = new Set();

/* ── helpers ────────────────────────────────────────────── */

function _withHash(h) {
  const s = (h || '').toString().trim();
  if (!s) return '';
  return s.startsWith('#') ? s.toLowerCase() : '#' + s.toLowerCase();
}
function _noHash(h) {
  return (h || '').toString().replace(/^#/, '').toLowerCase();
}

function _mySelf() {
  const name = State.profile?.displayName || 'anon';
  const hexNoHash = _noHash(State.profile?.hexCode || '5aaa72');
  return {
    uid: State.user?.uid || '',
    // CANONICAL cross-site fields (INFRA-MD01).
    displayName: name,
    hexCode: hexNoHash,
    // Legacy NodeBlast-internal aliases — kept so any lingering readers
    // work. Remove in a future cleanup once all stored data is refreshed.
    username: name,
    hexColor: _withHash(hexNoHash),
  };
}

// Deterministic convo ID matching DexNote (dm_{smallerUid}_{largerUid}).
function _getDmConvoId(uid1, uid2) {
  return uid1 < uid2 ? `dm_${uid1}_${uid2}` : `dm_${uid2}_${uid1}`;
}

// Pick a readable foreground color for a given background hex
// (same perceived-luminance formula DexNote uses).
function _contrastColor(hex) {
  const h = _noHash(hex);
  if (h.length !== 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#111' : '#fff';
}

export function isFriend(uid) {
  if (!uid) return false;
  return _friends.some((f) => f.uid === uid);
}

export function getFriends() {
  return _friends.slice();
}

/* ══════════════════════════════════════════════════════════════
 *  RENDERING — account-menu People list
 * ══════════════════════════════════════════════════════════════ */

function _friendCardHTML(f) {
  // INFRA-MD01: prefer canonical displayName/hexCode; fall back to the
  // legacy username/hexColor for docs written before the schema flip.
  const hex = _noHash(f.hexCode || f.hexColor || '5aaa72');
  const color = '#' + hex;
  const name = f.displayName || f.username || 'anon';
  const nameHtml = renderUsername(name, color, false);
  const presence = _presenceState.get(f.uid) || 'offline';
  const favClass = f.favorite ? 'active' : '';
  return `
    <div class="friend-card" data-uid="${escapeHtml(f.uid)}" style="--friend-hex:${color}">
      <div class="friend-avatar" style="border-color:${color}">
        ${escapeHtml((name[0] || '?').toUpperCase())}
        <span class="friend-presence ${presence}" data-presence></span>
      </div>
      <div class="friend-body">
        <div class="friend-name">${nameHtml}</div>
        <div class="friend-hex">#${escapeHtml(hex)}</div>
      </div>
      <div class="friend-actions">
        <button class="friend-util-btn friend-remove-btn" data-action="remove" title="Remove friend" data-tip="Remove">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <button class="friend-util-btn" data-action="message" title="Message" data-tip="Message">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button class="friend-util-btn friend-invite-btn" data-action="invite" title="Invite to game" data-tip="Invite to game">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg>
        </button>
        <button class="friend-util-btn friend-star-btn${favClass ? ' active' : ''}" data-action="favorite" title="Favorite" data-tip="Favorite">
          <svg class="friend-star ${favClass}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
        <button class="friend-util-btn friend-copy-btn" data-action="copy" title="Copy ID" data-tip="Copy ID">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
    </div>
  `;
}

// MD28: refresh online count from _presenceState (not DOM)
function _refreshOnlineCount() {
  const countEl = document.getElementById('acct-friends-count');
  if (!countEl) return;
  let onCount = 0;
  for (const f of _friends) {
    if (_presenceState.get(f.uid) === 'online') onCount++;
  }
  countEl.textContent = onCount + ' on';
}

function _renderFriendsList() {
  const list = document.getElementById('acct-friends-list');
  _refreshOnlineCount();
  if (!list) return;
  if (_friends.length === 0) {
    list.innerHTML = '<div class="friend-empty" style="text-align:center">No connections yet</div>';
    return;
  }
  // Favorites first, then alphabetic by username.
  const sorted = [..._friends].sort((a, b) => {
    if ((b.favorite ? 1 : 0) !== (a.favorite ? 1 : 0)) return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    return (a.username || '').localeCompare(b.username || '');
  });
  list.innerHTML = sorted.map(_friendCardHTML).join('');
  _applyInviteButtonStates();
}

// NB-MD11: grey out every Invite-to-game button unless the user is on
// the /play route. Exported so init.js can call this on route change.
function _applyInviteButtonStates() {
  const inGame = window.location.pathname === '/play';
  document.querySelectorAll('.friend-invite-btn').forEach((btn) => {
    btn.style.opacity = inGame ? '1' : '0.35';
    btn.style.cursor = inGame ? 'pointer' : 'default';
    btn.setAttribute('data-tip', inGame ? 'Invite to game' : 'Enter a game first');
    btn.disabled = !inGame;
  });
}
export { _applyInviteButtonStates as applyInviteButtonStates };

// Live presence indicator update — called by the per-friend
// presence snapshot listener so we can touch just one card rather
// than re-rendering the whole list on every heartbeat.
function _applyPresenceDot(uid, presence) {
  _presenceState.set(uid, presence);
  const dot = document.querySelector(`.friend-card[data-uid="${CSS.escape(uid)}"] [data-presence]`);
  if (dot) {
    dot.classList.remove('online', 'offline');
    dot.classList.add(presence === 'online' ? 'online' : 'offline');
  }
  _refreshOnlineCount(); // MD28: update badge on every presence change
}

/* ══════════════════════════════════════════════════════════════
 *  SUBSCRIPTIONS — friends + requests
 * ══════════════════════════════════════════════════════════════ */

function _startFriendsSub(uid) {
  _stopFriendsSub();
  _friendsUnsub = onSnapshot(
    query(collection(db, 'users', uid, 'friends')),
    (snap) => {
      _friends = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          uid: data.uid || d.id,
          username: data.username || '',
          hexColor: _withHash(data.hexColor || ''),
          favorite: !!data.favorite,
        };
      });
      _renderFriendsList();
      _syncPresenceSubscriptions();
      if (typeof window._nbRefreshFriendBtn === 'function') {
        try { window._nbRefreshFriendBtn(); } catch {}
      }
    },
    (err) => console.warn('[friends] friends sub error:', err),
  );
}

function _stopFriendsSub() {
  if (_friendsUnsub) { try { _friendsUnsub(); } catch {} _friendsUnsub = null; }
}

function _startRequestsSub(uid) {
  _stopRequestsSub();
  _seenRequestIds = new Set();
  // MD-B5 DIAG: log listener attach with uid for cross-app comparison
  console.log('[NB friend-req] attaching listener for uid:', uid);
  _requestsUnsub = onSnapshot(
    query(
      collection(db, 'users', uid, 'friend_requests'),
      where('status', '==', 'pending'),
    ),
    (snap) => {
      console.log('[NB friend-req] snapshot fired. changes:',
        snap.docChanges().length, 'docs in view:', snap.size);
      snap.docChanges().forEach((change) => {
        const id = change.doc.id;
        const _d = change.doc.data() || {};
        console.log('[NB friend-req]', change.type, 'docId:', id,
          'fromUid:', _d.fromUid, 'status:', _d.status);
        if (change.type === 'modified' || change.type === 'removed') {
          _removeFriendReqNotif(id);
          return;
        }
        if (change.type !== 'added') return;
        const req = change.doc.data() || {};
        if (_seenRequestIds.has(id)) return;
        _seenRequestIds.add(id);
        _pushRequestNotif(id, req);
      });
    },
    (err) => {
      console.error('[NB friend-req] onSnapshot error:', err.code, err.message, err);
    },
  );
}

function _stopRequestsSub() {
  if (_requestsUnsub) { try { _requestsUnsub(); } catch {} _requestsUnsub = null; }
}

// MD-R3-nb: remove bell-list notif for a request that left 'pending'
function _removeFriendReqNotif(requestId) {
  if (!requestId) return;
  try {
    document.querySelectorAll('.notif-item').forEach((n) => {
      if (n.querySelector(`[data-fr-accept="${requestId}"]`) ||
          n.querySelector(`[data-fr-decline="${requestId}"]`)) {
        n.remove();
      }
    });
  } catch (e) { /* noop */ }
  try { window._nbSyncNotifBadge?.(); } catch {} // MD-BUG15-nb
}

// MD-B2: clamp hex brightness into a readable band for notification popups
function _readableHex(hex) {
  const raw = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return '5aaa72';
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const v = Math.max(r, g, b) / 255;
  if (v >= 0.30 && v <= 0.85) return raw;
  const target = v < 0.30 ? 0.55 : 0.70;
  const scale = v === 0 ? 1 : target / v;
  const rr = Math.round(Math.max(0, Math.min(255, r * scale)));
  const gg = Math.round(Math.max(0, Math.min(255, g * scale)));
  const bb = Math.round(Math.max(0, Math.min(255, b * scale)));
  if (rr === 0 && gg === 0 && bb === 0) return '808080';
  return rr.toString(16).padStart(2, '0') + gg.toString(16).padStart(2, '0') + bb.toString(16).padStart(2, '0');
}

function _pushRequestNotif(requestId, req) {
  if (typeof window._nbAddNotif !== 'function') return;
  // INFRA-MD01: canonical-first, legacy fallback
  const fromName = req.fromDisplayName || req.fromUsername || 'Someone';
  const fromHex = _noHash(req.fromHexCode || req.fromHex || '5aaa72');
  // MD-B1: waving hand emoji — parity with dex friend-request popup
  const icon = `<span style="font-size:28px;line-height:1;">\u{1F44B}</span>`;
  const iconLarge = `<span style="font-size:48px;line-height:1;">\u{1F44B}</span>`;
  window._nbAddNotif({
    text: `<b>${escapeHtml(fromName)}</b> wants to be friends <span style="color:#${escapeHtml(_readableHex(fromHex))}">#${escapeHtml(fromHex).toUpperCase()}</span>
           <div class="notif-actions">
             <button class="notif-btn-primary" data-fr-accept="${escapeHtml(requestId)}">Accept</button>
             <button class="notif-btn-secondary" data-fr-decline="${escapeHtml(requestId)}">Decline</button>
           </div>`,
    icon,
    type: 'friends',
  });
  // MD23: super overlay for immediate visibility
  if (typeof window._nbShowSuperNotif === 'function') {
    window._nbShowSuperNotif({
      icon: iconLarge,
      title: fromName,
      subtitle: 'wants to be friends',
      body: `<span style="color:#${escapeHtml(_readableHex(fromHex))}">#${escapeHtml(fromHex).toUpperCase()}</span>`,
      actions: [
        { label: 'Accept', onClick: () => acceptFriendRequest(requestId) },
        { label: 'Decline', onClick: () => declineFriendRequest(requestId) },
      ],
      type: 'friends',
    });
  }
}

/* ══════════════════════════════════════════════════════════════
 *  PRESENCE (Firestore-based — see MD15 module header note)
 * ══════════════════════════════════════════════════════════════ */

// Heartbeat every 45s. Firestore sees the update via the listener
// on users/{uid}/presence/current; there's no onDisconnect like
// RTDB provides, so we rely on a stale-timestamp check at read time.
async function _beatSelfPresence() {
  if (!State.user) return;
  try {
    // MD-B4: dual-field write so DexNote (reads lastBeat) and NB
    // (reads lastChanged) both recognize this user as online.
    const ts = serverTimestamp();
    await setDoc(
      doc(db, 'users', State.user.uid, 'presence', 'current'),
      { state: 'online', lastChanged: ts, lastBeat: ts },
      { merge: true },
    );
  } catch (err) {
    // Permissions/offline — silent so we don't spam the console.
  }
}

function _startSelfPresence() {
  _stopSelfPresence();
  _beatSelfPresence();
  _selfPresenceTimer = setInterval(_beatSelfPresence, 45000);
  // Best-effort mark offline when the tab closes. Firestore
  // writes on unload are not guaranteed to land, but worth a try.
  window.addEventListener('beforeunload', _markSelfOfflineBestEffort);
}

function _stopSelfPresence() {
  if (_selfPresenceTimer) { clearInterval(_selfPresenceTimer); _selfPresenceTimer = null; }
  window.removeEventListener('beforeunload', _markSelfOfflineBestEffort);
}

function _markSelfOfflineBestEffort() {
  if (!State.user) return;
  try {
    // MD-B4: dual-field — see _beatSelfPresence comment.
    const ts = serverTimestamp();
    setDoc(
      doc(db, 'users', State.user.uid, 'presence', 'current'),
      { state: 'offline', lastChanged: ts, lastBeat: ts },
      { merge: true },
    );
  } catch {}
}

// Spin up / down per-friend presence listeners to match the
// current friend list. Called from the friends snapshot handler.
function _syncPresenceSubscriptions() {
  const wantedUids = new Set(_friends.map((f) => f.uid));
  // Tear down any listener for a uid that's no longer a friend.
  for (const uid of _presenceUnsubs.keys()) {
    if (!wantedUids.has(uid)) {
      try { _presenceUnsubs.get(uid)(); } catch {}
      _presenceUnsubs.delete(uid);
      _presenceState.delete(uid);
    }
  }
  // Spin up listeners for new friends.
  for (const uid of wantedUids) {
    if (_presenceUnsubs.has(uid)) continue;
    const unsub = onSnapshot(
      doc(db, 'users', uid, 'presence', 'current'),
      (snap) => {
        const data = snap.data();
        // MD-B4: accept either lastChanged (NB) or lastBeat (dex).
        // Stale check: treat as offline if > 2min old.
        let presence = 'offline';
        if (data?.state === 'online') {
          const ts = (data.lastChanged?.toMillis?.() ?? data.lastBeat?.toMillis?.() ?? 0);
          if (ts > 0 && Date.now() - ts < 2 * 60 * 1000) presence = 'online';
        }
        _applyPresenceDot(uid, presence);
      },
      () => { /* silent */ },
    );
    _presenceUnsubs.set(uid, unsub);
  }
}

function _stopAllPresenceSubs() {
  for (const unsub of _presenceUnsubs.values()) {
    try { unsub(); } catch {}
  }
  _presenceUnsubs.clear();
  _presenceState.clear();
}

/* ══════════════════════════════════════════════════════════════
 *  WRITES — send / accept / decline / remove / favorite
 * ══════════════════════════════════════════════════════════════ */

export async function sendFriendRequest(targetUid) {
  if (!State.user) { toast('Sign in to add friends'); return false; }
  if (!targetUid) return false;
  if (targetUid === State.user.uid) { toast("Can't add yourself"); return false; }
  try {
    const alreadySnap = await getDoc(doc(db, 'users', State.user.uid, 'friends', targetUid));
    if (alreadySnap.exists()) { toast('Already friends'); return false; }

    // MD26: removed the pre-check read on target's friend_requests —
    // Firestore rules don't allow the sender to read the target's inbox.
    // Doc ID is sender's uid, so duplicate sends are idempotent overwrites.
    const me = _mySelf();
    await setDoc(doc(db, 'users', targetUid, 'friend_requests', State.user.uid), {
      fromUid: me.uid,
      // INFRA-MD01: canonical + legacy dual-write
      fromDisplayName: me.displayName,
      fromHexCode: me.hexCode,
      fromUsername: me.username,
      fromHex: me.hexColor,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    toast('Friend request sent');
    return true;
  } catch (err) {
    console.warn('[friends] sendFriendRequest failed:', err);
    toast('Failed to send request');
    return false;
  }
}

export async function sendFriendRequestByHandle(raw) {
  if (!State.user) { toast('Sign in to add friends'); return false; }
  const match = (raw || '').trim().match(/^(.+)#([0-9a-fA-F]{6})$/);
  if (!match) { toast('Use format: username#hexcode'); return false; }
  const [, name, hex] = match;
  try {
    const key = userLookupKey(name, hex);
    if (!key) { toast('User not found'); return false; }
    const lookupSnap = await getDoc(doc(db, 'userLookup', key));
    if (!lookupSnap.exists()) { toast('User not found'); return false; }
    const uid = lookupSnap.data().uid;
    return await sendFriendRequest(uid);
  } catch (err) {
    console.warn('[friends] lookup failed:', err);
    toast('Failed to send request');
    return false;
  }
}

export async function acceptFriendRequest(requestId) {
  if (!State.user || !requestId) return;
  try {
    const reqRef = doc(db, 'users', State.user.uid, 'friend_requests', requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) { toast('Request not found'); return; }
    const req = reqSnap.data() || {};
    const fromUid = req.fromUid || requestId;
    // INFRA-MD01: prefer canonical displayName/hexCode from the request.
    const fromUsername = req.fromDisplayName || req.fromUsername || 'anon';
    const fromHexRaw = req.fromHexCode || _noHash(req.fromHex || '5aaa72');
    const fromHex = _withHash(fromHexRaw);

    await setDoc(doc(db, 'users', State.user.uid, 'friends', fromUid), {
      uid: fromUid,
      // INFRA-MD01: canonical + legacy dual-write
      displayName: fromUsername,
      hexCode: _noHash(fromHex),
      username: fromUsername,
      hexColor: fromHex,
      addedAt: serverTimestamp(),
      favorite: false,
    });
    const me = _mySelf();
    await setDoc(doc(db, 'users', fromUid, 'friends', State.user.uid), {
      uid: me.uid,
      displayName: me.displayName,
      hexCode: me.hexCode,
      username: me.username,
      hexColor: me.hexColor,
      addedAt: serverTimestamp(),
      favorite: false,
    });
    await setDoc(reqRef, { status: 'accepted' }, { merge: true });
    toast('Added ' + fromUsername);
  } catch (err) {
    console.warn('[friends] acceptFriendRequest failed:', err);
    toast('Failed to accept');
  }
}

export async function declineFriendRequest(requestId) {
  if (!State.user || !requestId) return;
  try {
    await deleteDoc(doc(db, 'users', State.user.uid, 'friend_requests', requestId));
    toast('Request declined');
  } catch (err) {
    console.warn('[friends] declineFriendRequest failed:', err);
  }
}

// MD15: remove-friend confirmation. Spec calls out that the current
// behavior (instant remove on click) needs a modal — match DexNote's
// "Remove Friend" modal via the shared showModal helper.
export function confirmRemoveFriend(friendUid) {
  const friend = _friends.find((f) => f.uid === friendUid);
  const name = friend?.username || 'this friend';
  showModal({
    title: 'Remove Friend',
    msg: `Are you sure you want to remove <strong>${escapeHtml(name)}</strong>?`,
    sub: 'They will also be removed from your list on DexNote. You can re-add them later.',
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: () => removeFriend(friendUid),
  });
}

export async function removeFriend(friendUid) {
  if (!State.user || !friendUid) return;
  try {
    await deleteDoc(doc(db, 'users', State.user.uid, 'friends', friendUid)).catch(() => {});
    await deleteDoc(doc(db, 'users', friendUid, 'friends', State.user.uid)).catch(() => {});
    toast('Removed friend');
  } catch (err) {
    console.warn('[friends] removeFriend failed:', err);
  }
}

// MD16: propagate my own username/hexColor changes into every
// friend's `users/{friendUid}/friends/{myUid}` doc so their People
// panel shows my updated profile without a page refresh. Mirrors
// DexNote's _setAccountHex which does the same thing for hex.
// We also propagate `username` here because DexNote doesn't —
// shared bug fix, NB→any direction only.
//
// Caller passes the already-normalized values (hexColor WITH '#',
// username as stored). Reads the current user's friend list from
// Firestore directly so it works even when the live friends
// subscription hasn't populated yet (e.g. immediately after sign-in).
export async function propagateProfileToFriends({ username, hexColor } = {}) {
  if (!State.user) return;
  const patch = {};
  // INFRA-MD01: write both canonical (displayName/hexCode) and legacy
  // (username/hexColor) so new NodeBlast reads and any old code paths
  // both render correctly without a migration script.
  if (typeof username === 'string' && username) {
    patch.displayName = username;
    patch.username = username;
  }
  if (typeof hexColor === 'string' && hexColor) {
    patch.hexCode = _noHash(hexColor);
    patch.hexColor = _withHash(hexColor);
  }
  if (Object.keys(patch).length === 0) return;
  try {
    const snap = await getDocs(collection(db, 'users', State.user.uid, 'friends'));
    const myUid = State.user.uid;
    const writes = [];
    snap.forEach((d) => {
      const friendUid = d.id;
      if (!friendUid) return;
      writes.push(
        setDoc(doc(db, 'users', friendUid, 'friends', myUid), patch, { merge: true })
          .catch((err) => console.warn('[friends] propagate failed for', friendUid, err)),
      );
    });
    await Promise.all(writes);
  } catch (err) {
    console.warn('[friends] propagateProfileToFriends failed:', err);
  }
}

async function _toggleFavorite(friendUid) {
  if (!State.user || !friendUid) return;
  const friend = _friends.find((f) => f.uid === friendUid);
  if (!friend) return;
  const next = !friend.favorite;
  // Optimistic local update so the list re-sorts immediately.
  friend.favorite = next;
  _renderFriendsList();
  try {
    await setDoc(
      doc(db, 'users', State.user.uid, 'friends', friendUid),
      { favorite: next },
      { merge: true },
    );
  } catch (err) {
    console.warn('[friends] favorite toggle failed:', err);
  }
}

/* ══════════════════════════════════════════════════════════════
 *  DM PANEL (MD15)
 * ══════════════════════════════════════════════════════════════ */

function _updateDmHeader() {
  const avatar = document.getElementById('dm-avatar');
  const nameEl = document.getElementById('dm-recipient-name');
  const hexEl = document.getElementById('dm-recipient-hex');
  if (!_dmRecipient) return;
  const hex = _withHash(_dmRecipient.hex || '#5aaa72');
  const hexShort = _noHash(hex).slice(0, 6);
  const initial = (_dmRecipient.name || '?').charAt(0).toUpperCase();
  if (avatar) {
    avatar.textContent = initial;
    avatar.style.background = hex;
    avatar.style.color = _contrastColor(hex);
  }
  if (nameEl) {
    nameEl.textContent = _dmRecipient.name || 'User';
    nameEl.style.color = hex;
  }
  if (hexEl) {
    hexEl.textContent = '#' + hexShort;
    hexEl.style.color = hex;
  }
}

function _renderDmMessage(msg, isMine) {
  const msgArea = document.getElementById('dm-messages');
  if (!msgArea) return;
  const myHex = _withHash(State.profile?.hexCode || '5aaa72');
  const theirHex = _withHash(_dmRecipient?.hex || '5aaa72');
  const bubbleHex = isMine ? myHex : theirHex;
  const bubbleClr = _contrastColor(bubbleHex);
  const bubble = document.createElement('div');
  bubble.className = 'dm-bubble ' + (isMine ? 'mine' : 'theirs');
  bubble.style.background = bubbleHex;
  bubble.style.color = bubbleClr;
  // DexNote messages can carry a rich `node` chip attachment.
  // We don't have the chip system on NodeBlast so render the
  // text fallback. If there's no text AND a node, show a
  // minimal placeholder so the bubble still renders.
  if (msg.text) {
    bubble.textContent = msg.text;
  } else if (msg.node) {
    bubble.textContent = '[' + (msg.node.type || 'attachment') + ']';
    bubble.style.fontStyle = 'italic';
    bubble.style.opacity = '0.85';
  }
  msgArea.appendChild(bubble);
}

export function openDM(friend) {
  if (!State.user || !friend) return;
  _dmRecipient = {
    uid: friend.uid,
    name: friend.username,
    hex: _withHash(friend.hexColor),
  };
  _dmConvoId = _getDmConvoId(State.user.uid, friend.uid);
  _updateDmHeader();

  const panel = document.getElementById('dm-panel');
  const msgArea = document.getElementById('dm-messages');
  if (!panel || !msgArea) return;
  msgArea.innerHTML = '';
  panel.classList.add('open');
  setTimeout(() => document.getElementById('dm-input')?.focus(), 80);

  // Subscribe to messages. Replace any prior subscription.
  if (_dmUnsub) { try { _dmUnsub(); } catch {} _dmUnsub = null; }
  _dmUnsub = onSnapshot(
    query(
      collection(db, 'dms', _dmConvoId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200),
    ),
    (snap) => {
      msgArea.innerHTML = '';
      snap.forEach((d) => {
        const msg = d.data() || {};
        const isMine = msg.fromUid === State.user.uid;
        _renderDmMessage(msg, isMine);
      });
      msgArea.scrollTop = msgArea.scrollHeight;
    },
    (err) => console.warn('[dm] message sub error:', err),
  );
}

export function closeDM() {
  const panel = document.getElementById('dm-panel');
  panel?.classList.remove('open');
  if (_dmUnsub) { try { _dmUnsub(); } catch {} _dmUnsub = null; }
  _dmConvoId = null;
  _dmRecipient = null;
}

async function _sendDmMessage() {
  const input = document.getElementById('dm-input');
  if (!input || !_dmConvoId || !State.user || !_dmRecipient) return;
  const text = (input.value || '').trim();
  if (!text) return;
  input.value = '';
  const me = _mySelf();
  try {
    await addDoc(collection(db, 'dms', _dmConvoId, 'messages'), {
      fromUid: me.uid,
      fromHex: me.hexColor,
      text,
      createdAt: serverTimestamp(),
    });
    // Update convo doc so cross-site conversation listings + the
    // hex mirror fields both stay fresh (matches DexNote's schema).
    await setDoc(
      doc(db, 'dms', _dmConvoId),
      {
        participants: [State.user.uid, _dmRecipient.uid].sort(),
        lastMessage: text.slice(0, 100),
        lastMessageAt: serverTimestamp(),
        lastMessageBy: State.user.uid,
        lastMessageByName: me.username,
        lastMessageByHex: me.hexColor,
        ['hex_' + State.user.uid]: me.hexColor,
      },
      { merge: true },
    );
  } catch (err) {
    console.warn('[dm] sendMessage failed:', err);
    toast('Failed to send message');
  }
}

// Top-level watcher on every convo the user is part of. Fires a
// notification when a new incoming message arrives for a convo
// that ISN'T currently open in the panel.
function _startDmTopList(uid) {
  _stopDmTopList();
  _dmTopListUnsub = onSnapshot(
    query(collection(db, 'dms'), where('participants', 'array-contains', uid)),
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'removed') return;
        const data = change.doc.data() || {};
        const convoId = change.doc.id;
        const lastBy = data.lastMessageBy;
        if (!lastBy || lastBy === uid) return; // my own send, skip
        const ts = data.lastMessageAt?.toMillis?.() ?? 0;
        const prev = _lastDmSeenAt.get(convoId) || 0;
        if (ts <= prev) return;
        _lastDmSeenAt.set(convoId, ts);
        // Skip the initial snapshot (when we first mount, every
        // convo fires `added`) — only notify on genuinely new
        // messages after a baseline is established.
        if (change.type === 'added' && prev === 0) return;
        // Suppress if the recipient has the DM panel open to the
        // sender's convo already (user is actively reading).
        if (_dmConvoId === convoId) return;
        _pushDmNotif(data);
      });
    },
    (err) => console.warn('[dm] top-list sub error:', err),
  );
}

function _stopDmTopList() {
  if (_dmTopListUnsub) { try { _dmTopListUnsub(); } catch {} _dmTopListUnsub = null; }
  _lastDmSeenAt.clear();
}

function _pushDmNotif(convoData) {
  if (typeof window._nbAddNotif !== 'function') return;
  const fromName = convoData.lastMessageByName || 'Someone';
  const fromHex = _noHash(convoData.lastMessageByHex || '5aaa72');
  const preview = (convoData.lastMessage || '').toString().slice(0, 80);
  const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#${fromHex}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  window._nbAddNotif({
    text: `<b>${escapeHtml(fromName)}</b>: ${escapeHtml(preview)}`,
    icon,
    type: 'dms',
  });
  // MD23: super overlay for DMs
  if (typeof window._nbShowSuperNotif === 'function') {
    const senderUid = convoData.lastMessageBy;
    window._nbShowSuperNotif({
      icon,
      title: fromName,
      subtitle: 'sent you a message',
      body: escapeHtml(preview),
      actions: [
        { label: 'Open', onClick: () => { if (senderUid) openDM({ uid: senderUid, username: fromName, hexColor: '#' + fromHex }); } },
      ],
      type: 'dms',
    });
  }
}

/* ══════════════════════════════════════════════════════════════
 *  SESSION INVITES (MD15 — receive only)
 * ══════════════════════════════════════════════════════════════ */

function _startSessionInvitesSub(uid) {
  _stopSessionInvitesSub();
  _shownInviteIds.clear();
  _sessionInviteUnsub = onSnapshot(
    query(collection(db, 'users', uid, 'session_invites'), where('status', '==', 'pending')),
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'removed') { _shownInviteIds.delete(change.doc.id); return; }
        const inv = change.doc.data() || {};
        if (inv.status !== 'pending') return;
        const id = change.doc.id;
        if (_shownInviteIds.has(id)) return;
        _shownInviteIds.add(id);
        _pushSessionInviteNotif(id, inv);
      });
    },
    (err) => console.warn('[invites] session invites sub error:', err),
  );
}

function _stopSessionInvitesSub() {
  if (_sessionInviteUnsub) { try { _sessionInviteUnsub(); } catch {} _sessionInviteUnsub = null; }
}

function _pushSessionInviteNotif(inviteId, inv) {
  if (typeof window._nbAddNotif !== 'function') return;
  const sessColor = inv.sessionColor || '#6BAADC';
  const fromName = inv.fromUsername || 'Unknown';
  const fromHex = _noHash(inv.fromHex || '5aaa72');
  const sessName = inv.sessionName || 'Session';
  const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${sessColor}" stroke="${sessColor}" stroke-width="1.5"><circle cx="12" cy="12" r="9"/></svg>`;
  window._nbAddNotif({
    text: `<b>${escapeHtml(fromName)}</b> invited you to <span style="color:${escapeHtml(sessColor)}">${escapeHtml(sessName)}</span>
           <div class="notif-actions">
             <button class="notif-btn-primary" data-si-accept="${escapeHtml(inviteId)}" data-si-sess="${escapeHtml(inv.sessionId || '')}">Open on DexNote</button>
             <button class="notif-btn-secondary" data-si-decline="${escapeHtml(inviteId)}">Decline</button>
           </div>`,
    icon,
    type: 'invites',
  });
  // MD23: super overlay for session invites
  if (typeof window._nbShowSuperNotif === 'function') {
    window._nbShowSuperNotif({
      icon,
      title: fromName,
      subtitle: 'invited you to a session',
      body: `<span style="color:${escapeHtml(sessColor)}">${escapeHtml(sessName)}</span>`,
      actions: [
        { label: 'Open on DexNote', onClick: () => _acceptSessionInvite(inviteId, inv.sessionId) },
        { label: 'Decline', onClick: () => _declineSessionInvite(inviteId) },
      ],
      type: 'invites',
    });
  }
  void fromHex;
}

async function _acceptSessionInvite(inviteId, sessionId) {
  if (!State.user || !inviteId) return;
  try {
    // Mark accepted in the user's own session_invites doc so DexNote
    // sees the state change and stops re-notifying.
    await setDoc(
      doc(db, 'users', State.user.uid, 'session_invites', inviteId),
      { status: 'accepted' },
      { merge: true },
    );
  } catch (err) {
    console.warn('[invites] accept failed:', err);
  }
  // Open DexNote in a new tab. NodeBlast can't join a DexNote
  // session directly — the user continues over there.
  const url = sessionId
    ? `https://dexnote.dev/?invite=${encodeURIComponent(sessionId)}`
    : 'https://dexnote.dev/';
  window.open(url, '_blank', 'noopener');
}

async function _declineSessionInvite(inviteId) {
  if (!State.user || !inviteId) return;
  try {
    await deleteDoc(doc(db, 'users', State.user.uid, 'session_invites', inviteId));
  } catch (err) {
    console.warn('[invites] decline failed:', err);
  }
}

/* ══════════════════════════════════════════════════════════════
 *  LIFECYCLE
 * ══════════════════════════════════════════════════════════════ */

export function initFriends() {
  // People list click delegation — star / copy / message / remove / card.
  const list = document.getElementById('acct-friends-list');
  list?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    const card = e.target.closest('.friend-card');
    if (!card) return;
    const uid = card.dataset.uid;
    const friend = _friends.find((f) => f.uid === uid);
    if (!friend) return;

    if (!btn) {
      // Bare card body click → navigate to profile.
      e.stopPropagation();
      navigate('/' + buildUserSlug((friend.username || '').toLowerCase(), _noHash(friend.hexColor)));
      return;
    }

    e.stopPropagation();
    const action = btn.dataset.action;
    if (action === 'remove') {
      confirmRemoveFriend(uid);
    } else if (action === 'favorite') {
      _toggleFavorite(uid);
    } else if (action === 'copy') {
      const id = (friend.username || 'anon') + '#' + _noHash(friend.hexColor);
      try {
        await navigator.clipboard.writeText(id);
        toast('Copied ' + id);
      } catch {
        toast(id);
      }
    } else if (action === 'message') {
      openDM(friend);
    } else if (action === 'invite') {
      const inGame = window.location.pathname === '/play';
      if (!inGame) { toast('Start a game first'); return; }
      // TODO: wire up multiplayer invite logic
      toast('Invite sent to ' + (friend.username || 'anon'));
    }
  });

  // Add button / Enter in the input
  const addBtn = document.getElementById('acct-friends-add-btn');
  const addInput = document.getElementById('acct-friends-add-input');
  const doAdd = async () => {
    if (!addInput) return;
    const raw = addInput.value;
    const ok = await sendFriendRequestByHandle(raw);
    if (ok) addInput.value = '';
  };
  addBtn?.addEventListener('click', doAdd);
  addInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
  });

  // MD32: the old "invite by email — coming soon" stub is gone;
  // the hint row (#acct-friends-hint) is purely informational
  // and needs no click handler.

  // Notification panel button delegation — friends + session invites.
  document.addEventListener('click', (e) => {
    const fa = e.target.closest('[data-fr-accept]');
    if (fa) {
      e.stopPropagation();
      acceptFriendRequest(fa.getAttribute('data-fr-accept'));
      fa.closest('.notif-item')?.remove();
      try { window._nbSyncNotifBadge?.(); } catch {} // MD-BUG15-nb
      return;
    }
    const fd = e.target.closest('[data-fr-decline]');
    if (fd) {
      e.stopPropagation();
      declineFriendRequest(fd.getAttribute('data-fr-decline'));
      fd.closest('.notif-item')?.remove();
      try { window._nbSyncNotifBadge?.(); } catch {} // MD-BUG15-nb
      return;
    }
    const sa = e.target.closest('[data-si-accept]');
    if (sa) {
      e.stopPropagation();
      _acceptSessionInvite(sa.getAttribute('data-si-accept'), sa.getAttribute('data-si-sess') || '');
      sa.closest('.notif-item')?.remove();
      return;
    }
    const sd = e.target.closest('[data-si-decline]');
    if (sd) {
      e.stopPropagation();
      _declineSessionInvite(sd.getAttribute('data-si-decline'));
      sd.closest('.notif-item')?.remove();
    }
  });

  // DM panel controls
  document.getElementById('dm-close')?.addEventListener('click', closeDM);
  document.getElementById('dm-send')?.addEventListener('click', _sendDmMessage);
  document.getElementById('dm-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _sendDmMessage(); }
  });

  _renderFriendsList();
}

// Called from init.js on every auth state change so subscriptions
// follow the signed-in user (or tear down on sign-out).
export function setFriendsCurrentUser(uid) {
  _stopFriendsSub();
  _stopRequestsSub();
  _stopAllPresenceSubs();
  _stopSelfPresence();
  _stopDmTopList();
  _stopSessionInvitesSub();
  closeDM();
  _friends = [];
  _renderFriendsList();
  if (!uid) {
    _markSelfOfflineBestEffort();
    return;
  }
  _startFriendsSub(uid);
  _startRequestsSub(uid);
  _startSelfPresence();
  _startDmTopList(uid);
  _startSessionInvitesSub(uid);
}
