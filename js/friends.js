// ══════════════════════════════════════════════════════════════
//  NodeBlast — FRIENDS
//  Cross-site friends list shared with DexNote.
//
//  This module does NOT define a new data model — every read and
//  write targets the same Firestore paths DexNote already uses:
//
//    users/{uid}/friends/{friendUid}
//      { uid, username, hexColor, addedAt, favorite }
//
//    users/{uid}/friend_requests/{fromUid}
//      { fromUid, fromUsername, fromHex, status, createdAt }
//
//  Keeping the shapes byte-for-byte identical is what lets a
//  friend added on DexNote show up in NodeBlast's People list
//  (and vice versa) with zero migration code.
//
//  DexNote stores `hexColor`/`fromHex` WITH a leading '#'. NodeBlast
//  internally strips the '#' (see auth.js stripHash), so this
//  module normalizes both directions: reads tolerate either form,
//  writes always include the '#' so DexNote stays happy.
// ══════════════════════════════════════════════════════════════

import { app } from './firebase-config.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import State from './state.js';
import { toast, renderUsername, escapeHtml } from './ui-events.js';
import { navigate, buildUserSlug } from './router.js';
import { userLookupKey } from './users.js';

const db = getFirestore(app);

let _friendsUnsub = null;
let _requestsUnsub = null;
let _friends = [];              // live cache of the current user's friends
let _seenRequestIds = new Set(); // suppress duplicate notifications for the same request

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
  return {
    uid: State.user?.uid || '',
    username: name,
    hexColor: _withHash(State.profile?.hexCode || '5aaa72'),
  };
}

export function isFriend(uid) {
  if (!uid) return false;
  return _friends.some((f) => f.uid === uid);
}

export function getFriends() {
  return _friends.slice();
}

// ══════════════════════════════════════════════════════════════
//  Rendering — account menu "People" list
// ══════════════════════════════════════════════════════════════

function _friendCardHTML(f) {
  const hex = _noHash(f.hexColor);
  const color = '#' + hex;
  const name = f.username || 'anon';
  const nameHtml = renderUsername(name, color, false);
  return `
    <div class="friend-card" data-uid="${escapeHtml(f.uid)}" style="--friend-hex:${color}">
      <div class="friend-avatar" style="border-color:${color}">${escapeHtml((name[0] || '?').toUpperCase())}</div>
      <div class="friend-body">
        <div class="friend-name">${nameHtml}</div>
        <div class="friend-hex">#${escapeHtml(hex)}</div>
      </div>
      <button class="friend-remove-btn" data-action="remove" title="Remove friend">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
}

function _renderFriendsList() {
  const list = document.getElementById('acct-friends-list');
  const countEl = document.getElementById('acct-friends-count');
  if (countEl) countEl.textContent = String(_friends.length);
  if (!list) return;
  if (_friends.length === 0) {
    list.innerHTML = '<div class="friend-empty">No friends yet. Add one with username#hexcode.</div>';
    return;
  }
  const sorted = [..._friends].sort((a, b) => (a.username || '').localeCompare(b.username || ''));
  list.innerHTML = sorted.map(_friendCardHTML).join('');
}

// ══════════════════════════════════════════════════════════════
//  Live subscriptions
// ══════════════════════════════════════════════════════════════

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
      // Re-check the currently visible profile bar so the
      // "Add Friend" / "Friends" button can flip if needed.
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

// Listen for incoming friend requests and push each new pending
// one into the notification panel. Only fires for `type === 'added'`
// so an accept/decline that deletes the doc doesn't re-notify.
function _startRequestsSub(uid) {
  _stopRequestsSub();
  _seenRequestIds = new Set();
  _requestsUnsub = onSnapshot(
    collection(db, 'users', uid, 'friend_requests'),
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const req = change.doc.data() || {};
        if (req.status && req.status !== 'pending') return;
        const id = change.doc.id;
        if (_seenRequestIds.has(id)) return;
        _seenRequestIds.add(id);
        _pushRequestNotif(id, req);
      });
    },
    (err) => console.warn('[friends] requests sub error:', err),
  );
}

function _stopRequestsSub() {
  if (_requestsUnsub) { try { _requestsUnsub(); } catch {} _requestsUnsub = null; }
}

function _pushRequestNotif(requestId, req) {
  if (typeof window._nbAddNotif !== 'function') return;
  const fromName = req.fromUsername || 'Someone';
  const fromHex = _noHash(req.fromHex || '5aaa72');
  const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#${fromHex}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="3.5"/><path d="M2 21c0-3.5 3-6.5 7-6.5s7 3 7 6.5"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>`;
  window._nbAddNotif({
    text: `<b>${escapeHtml(fromName)}</b> wants to be friends <span style="color:#${escapeHtml(fromHex)}">#${escapeHtml(fromHex)}</span>
           <div class="notif-actions">
             <button class="notif-btn-primary" data-fr-accept="${escapeHtml(requestId)}">Accept</button>
             <button class="notif-btn-secondary" data-fr-decline="${escapeHtml(requestId)}">Decline</button>
           </div>`,
    icon,
    type: 'friends',
  });
}

// ══════════════════════════════════════════════════════════════
//  Writes — send / accept / decline / remove
// ══════════════════════════════════════════════════════════════

export async function sendFriendRequest(targetUid) {
  if (!State.user) { toast('Sign in to add friends'); return false; }
  if (!targetUid) return false;
  if (targetUid === State.user.uid) { toast("Can't add yourself"); return false; }
  try {
    const alreadySnap = await getDoc(doc(db, 'users', State.user.uid, 'friends', targetUid));
    if (alreadySnap.exists()) { toast('Already friends'); return false; }

    // Clear any stale request this user may have previously sent so
    // the "pending" listener on the target refires cleanly.
    await deleteDoc(doc(db, 'users', targetUid, 'friend_requests', State.user.uid)).catch(() => {});

    const me = _mySelf();
    await setDoc(doc(db, 'users', targetUid, 'friend_requests', State.user.uid), {
      fromUid: me.uid,
      fromUsername: me.username,
      fromHex: me.hexColor,          // always '#rrggbb' — matches DexNote exactly
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

// Look up a user by "name#hex" string (used by the account-menu input).
// Returns the matching uid, or null. Normalizes the separator so the
// format is the same one DexNote uses.
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
    // Re-read the request to pick up the latest from-user profile.
    const reqRef = doc(db, 'users', State.user.uid, 'friend_requests', requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) { toast('Request not found'); return; }
    const req = reqSnap.data() || {};
    const fromUid = req.fromUid || requestId;
    const fromUsername = req.fromUsername || 'anon';
    const fromHex = _withHash(req.fromHex || '#5aaa72');

    // Write both halves of the friendship + mark the request accepted.
    await setDoc(doc(db, 'users', State.user.uid, 'friends', fromUid), {
      uid: fromUid,
      username: fromUsername,
      hexColor: fromHex,
      addedAt: serverTimestamp(),
      favorite: false,
    });
    const me = _mySelf();
    await setDoc(doc(db, 'users', fromUid, 'friends', State.user.uid), {
      uid: me.uid,
      username: me.username,
      hexColor: me.hexColor,
      addedAt: serverTimestamp(),
      favorite: false,
    });
    // DexNote merges { status: 'accepted' } rather than deleting, so
    // we do the same — both sites then prune via their own listeners.
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

// ══════════════════════════════════════════════════════════════
//  Lifecycle
// ══════════════════════════════════════════════════════════════

export function initFriends() {
  // People list click: remove button or navigate to profile.
  const list = document.getElementById('acct-friends-list');
  list?.addEventListener('click', async (e) => {
    const rmBtn = e.target.closest('[data-action="remove"]');
    const card = e.target.closest('.friend-card');
    if (!card) return;
    const uid = card.dataset.uid;
    if (rmBtn) {
      e.stopPropagation();
      await removeFriend(uid);
      return;
    }
    // Card click → open that friend's profile page.
    const friend = _friends.find((f) => f.uid === uid);
    if (!friend) return;
    navigate('/' + buildUserSlug(friend.username.toLowerCase(), _noHash(friend.hexColor)));
  });

  // Account menu "Add" button — uses DexNote's username#hex input format.
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

  // Notification panel accept/decline buttons — event-delegated on
  // document because the notif items live under #notif-list and are
  // re-created by the notifications module, not by this file.
  document.addEventListener('click', (e) => {
    const accept = e.target.closest('[data-fr-accept]');
    if (accept) {
      e.stopPropagation();
      const id = accept.getAttribute('data-fr-accept');
      acceptFriendRequest(id);
      accept.closest('.notif-item')?.remove();
      return;
    }
    const decline = e.target.closest('[data-fr-decline]');
    if (decline) {
      e.stopPropagation();
      const id = decline.getAttribute('data-fr-decline');
      declineFriendRequest(id);
      decline.closest('.notif-item')?.remove();
    }
  });

  _renderFriendsList();
}

// Called from init.js on every auth state change so subscriptions
// follow the signed-in user (or tear down on sign-out).
export function setFriendsCurrentUser(uid) {
  _stopFriendsSub();
  _stopRequestsSub();
  _friends = [];
  _renderFriendsList();
  if (!uid) return;
  _startFriendsSub(uid);
  _startRequestsSub(uid);
}
