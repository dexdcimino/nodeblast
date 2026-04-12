// ══════════════════════════════════════
//  NodeBlast — TRACKED (MD18)
//  Pin catalysts + follow alchemists.
//  Data model:
//    users/{uid}/tracked/catalysts   → { items: [ { catId, ownerId, title,
//      thumbURL, accentColor, ownerName, ownerHex, ownerPhoto, slug,
//      type, status, pinnedAt } ] }
//    users/{uid}/tracked/alchemists  → { items: [ { uid, username, hex,
//      photoURL, isAdmin, pinnedAt } ] }
//    users/{uid}.trackedPublic       → boolean (default false)
//
//  `pinnedAt` is stored as a numeric ms timestamp (Date.now()) rather
//  than serverTimestamp because Firestore does not permit sentinel
//  values inside array elements, and we need a stable sortable field
//  on each entry for the footer display.
// ══════════════════════════════════════

import { app } from './firebase-config.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import State from './state.js';
import { toast } from './ui-events.js';

const db = getFirestore(app);

const MAX_PINNED_CATALYSTS = 60;
const MAX_FOLLOWED_ALCHEMISTS = 60;

function _trackedCatalystsRef(uid) {
  return doc(db, 'users', uid, 'tracked', 'catalysts');
}
function _trackedAlchemistsRef(uid) {
  return doc(db, 'users', uid, 'tracked', 'alchemists');
}
function _userRef(uid) {
  return doc(db, 'users', uid);
}

// ══════════════════════════════════════════════════════════════
//  Snapshot builders — denormalize just enough fields to render
//  pinned/followed items instantly without a secondary fetch.
// ══════════════════════════════════════════════════════════════

function _catalystSnapshot(cat) {
  return {
    catId: cat.id,
    ownerId: cat.ownerId || '',
    title: cat.title || '',
    thumbURL: cat.thumbURL || '',
    accentColor: cat.accentColor || '#5AAA72',
    ownerName: cat.ownerName || '',
    ownerHex: (cat.ownerHex || '5aaa72').toLowerCase(),
    ownerPhoto: cat.ownerPhoto || '',
    slug: cat.slug || '',
    type: cat.type || 'external',
    status: cat.status || 'live',
    pinnedAt: Date.now(),
  };
}

function _alchemistSnapshot(group) {
  return {
    uid: group.uid,
    username: group.displayName || 'anon',
    hex: (group.hexCode || '5aaa72').toLowerCase(),
    photoURL: group.photoURL || '',
    isAdmin: !!group.isAdmin,
    pinnedAt: Date.now(),
  };
}

// ══════════════════════════════════════════════════════════════
//  Pin / unpin catalysts
// ══════════════════════════════════════════════════════════════

export async function pinCatalyst(cat) {
  if (!State.user) { toast('Sign in to pin'); return false; }
  if (!cat?.id) return false;
  if (cat.ownerId === State.user.uid) { toast("You can't pin your own catalyst"); return false; }

  const ref = _trackedCatalystsRef(State.user.uid);
  try {
    const snap = await getDoc(ref);
    const current = (snap.exists() && Array.isArray(snap.data().items)) ? snap.data().items : [];
    if (current.some((it) => it.catId === cat.id)) {
      return true; // already pinned — treat as success
    }
    if (current.length >= MAX_PINNED_CATALYSTS) {
      toast(`Pinned list is full (${MAX_PINNED_CATALYSTS} max)`);
      return false;
    }
    const next = current.concat([_catalystSnapshot(cat)]);
    await setDoc(ref, { items: next, updatedAt: Date.now() }, { merge: true });
    return true;
  } catch (err) {
    console.warn('[tracked] pinCatalyst failed:', err);
    toast('Pin failed');
    return false;
  }
}

export async function unpinCatalyst(catId) {
  if (!State.user) return false;
  if (!catId) return false;
  const ref = _trackedCatalystsRef(State.user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return true;
    const current = Array.isArray(snap.data().items) ? snap.data().items : [];
    const next = current.filter((it) => it.catId !== catId);
    if (next.length === current.length) return true;
    await updateDoc(ref, { items: next, updatedAt: Date.now() });
    return true;
  } catch (err) {
    console.warn('[tracked] unpinCatalyst failed:', err);
    toast('Unpin failed');
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
//  Follow / unfollow alchemists
// ══════════════════════════════════════════════════════════════

export async function followAlchemist(group) {
  if (!State.user) { toast('Sign in to follow'); return false; }
  if (!group?.uid) return false;
  if (group.uid === State.user.uid) { toast("You can't follow yourself"); return false; }

  const ref = _trackedAlchemistsRef(State.user.uid);
  try {
    const snap = await getDoc(ref);
    const current = (snap.exists() && Array.isArray(snap.data().items)) ? snap.data().items : [];
    if (current.some((it) => it.uid === group.uid)) {
      return true;
    }
    if (current.length >= MAX_FOLLOWED_ALCHEMISTS) {
      toast(`Following list is full (${MAX_FOLLOWED_ALCHEMISTS} max)`);
      return false;
    }
    const next = current.concat([_alchemistSnapshot(group)]);
    await setDoc(ref, { items: next, updatedAt: Date.now() }, { merge: true });
    return true;
  } catch (err) {
    console.warn('[tracked] followAlchemist failed:', err);
    toast('Follow failed');
    return false;
  }
}

export async function unfollowAlchemist(uid) {
  if (!State.user) return false;
  if (!uid) return false;
  const ref = _trackedAlchemistsRef(State.user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return true;
    const current = Array.isArray(snap.data().items) ? snap.data().items : [];
    const next = current.filter((it) => it.uid !== uid);
    if (next.length === current.length) return true;
    await updateDoc(ref, { items: next, updatedAt: Date.now() });
    return true;
  } catch (err) {
    console.warn('[tracked] unfollowAlchemist failed:', err);
    toast('Unfollow failed');
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
//  Privacy toggle — users/{uid}.trackedPublic
// ══════════════════════════════════════════════════════════════

export async function setTrackedPublic(flag) {
  if (!State.user) return false;
  try {
    await setDoc(_userRef(State.user.uid), {
      trackedPublic: !!flag,
      updatedAt: Date.now(),
    }, { merge: true });
    if (State.profile) State.profile.trackedPublic = !!flag;
    return true;
  } catch (err) {
    console.warn('[tracked] setTrackedPublic failed:', err);
    toast('Privacy save failed');
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
//  Live subscriptions
//
//  subscribeMyTracked — live view of the signed-in user's own pinned
//  + followed lists. The callback fires as soon as the first snapshot
//  lands, then on every change. Errors don't clobber the in-memory
//  cache — the pin UI relies on it and a transient error would
//  flash every tile back to "unpinned" for no reason.
//
//  subscribeUserTracked — one-shot read of someone else's tracked
//  lists, gated by their trackedPublic flag. Returns null for each
//  list when the viewer doesn't have access.
// ══════════════════════════════════════════════════════════════

export function subscribeMyTracked(callback) {
  if (!State.user) {
    callback({ catalysts: [], alchemists: [] });
    return () => {};
  }
  const uid = State.user.uid;
  let catalysts = [];
  let alchemists = [];
  let catsInit = false;
  let alchInit = false;

  const fire = () => {
    if (!catsInit || !alchInit) return;
    callback({ catalysts, alchemists });
  };

  const unsubCats = onSnapshot(
    _trackedCatalystsRef(uid),
    (snap) => {
      catsInit = true;
      catalysts = (snap.exists() && Array.isArray(snap.data().items)) ? snap.data().items : [];
      fire();
    },
    (err) => {
      console.warn('[tracked] my catalysts sub error:', err);
      if (!catsInit) { catsInit = true; fire(); }
    },
  );
  const unsubAlch = onSnapshot(
    _trackedAlchemistsRef(uid),
    (snap) => {
      alchInit = true;
      alchemists = (snap.exists() && Array.isArray(snap.data().items)) ? snap.data().items : [];
      fire();
    },
    (err) => {
      console.warn('[tracked] my alchemists sub error:', err);
      if (!alchInit) { alchInit = true; fire(); }
    },
  );

  return () => {
    try { unsubCats(); } catch {}
    try { unsubAlch(); } catch {}
  };
}

// Read another user's tracked lists. Returns { catalysts, alchemists,
// trackedPublic }. When trackedPublic is false, the lists return as
// empty arrays so viewers just see nothing (no error surface).
export async function loadUserTracked(uid) {
  if (!uid) return { catalysts: [], alchemists: [], trackedPublic: false };
  // Owner always sees their own tracked, regardless of flag.
  const isOwn = State.user?.uid === uid;
  try {
    const [userSnap, catsSnap, alchSnap] = await Promise.all([
      getDoc(_userRef(uid)),
      getDoc(_trackedCatalystsRef(uid)),
      getDoc(_trackedAlchemistsRef(uid)),
    ]);
    const trackedPublic = !!userSnap.data()?.trackedPublic;
    if (!isOwn && !trackedPublic) {
      return { catalysts: [], alchemists: [], trackedPublic: false };
    }
    const catalysts = (catsSnap.exists() && Array.isArray(catsSnap.data().items))
      ? catsSnap.data().items
      : [];
    const alchemists = (alchSnap.exists() && Array.isArray(alchSnap.data().items))
      ? alchSnap.data().items
      : [];
    return { catalysts, alchemists, trackedPublic };
  } catch (err) {
    console.warn('[tracked] loadUserTracked failed:', err);
    return { catalysts: [], alchemists: [], trackedPublic: false };
  }
}
