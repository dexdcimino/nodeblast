import { app } from './firebase-config.js';
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import State from './state.js';
import { normalizeUsername } from './users.js';
import { setSigningIn } from './ui-events.js';

const auth = getAuth(app);
const db = getFirestore(app);

const readyCallbacks = [];
let authResolved = false;
let _profileUnsubTop = null;
let _profileUnsubPrefs = null;

function fireReady() {
  readyCallbacks.forEach((cb) => {
    try { cb(State.user, State.profile); } catch (e) { console.error('[auth] ready callback threw:', e); }
  });
}

function randomHex() {
  return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

function stripHash(h) {
  return (h || '').toString().replace(/^#/, '').toLowerCase();
}

// ══════════════════════════════════════════════════════════════
//  Profile schema compatibility with DexNote
// ──────────────────────────────────────────────────────────────
//  DexNote writes the canonical profile at:
//    users/{uid}/prefs/profile  →  { username, hexColor }
//
//  NodeBlast additionally keeps a top-level mirror at:
//    users/{uid}  →  { displayName, hexCode (without '#'),
//                      usernameLower, photoURL, provider, isAdmin? }
//
//  usernameLower is how NodeBlast resolves /username routes, so the
//  top-level doc must exist for profile lookup to work. The DexNote
//  subdoc is authoritative for displayName + hex, so if both exist
//  the subdoc wins on merge (this is how cross-site edits propagate).
// ══════════════════════════════════════════════════════════════

function mergeProfileDocs(topData, prefsData, user, providerId) {
  const provider = (providerId || '').includes('github') ? 'github' : 'google';
  // DexNote subdoc wins for displayName + hexCode
  const displayName =
    prefsData?.username ||
    topData?.displayName ||
    user.displayName ||
    'anon';
  const hexCode =
    stripHash(prefsData?.hexColor) ||
    stripHash(topData?.hexCode) ||
    null;
  const photoURL = topData?.photoURL || user.photoURL || '';
  return {
    displayName,
    hexCode,
    photoURL,
    provider,
    usernameLower: normalizeUsername(displayName),
    isAdmin: topData?.isAdmin || false,
  };
}

async function loadOrCreateProfile(user, providerId) {
  const topRef = doc(db, 'users', user.uid);
  const prefsRef = doc(db, 'users', user.uid, 'prefs', 'profile');

  let topSnap, prefsSnap;
  try {
    [topSnap, prefsSnap] = await Promise.all([
      getDoc(topRef),
      getDoc(prefsRef),
    ]);
  } catch (err) {
    console.warn('[auth] profile read failed, using fallback:', err);
    return {
      displayName: user.displayName || 'anon',
      hexCode: randomHex(),
      photoURL: user.photoURL || '',
      provider: (providerId || '').includes('github') ? 'github' : 'google',
      usernameLower: normalizeUsername(user.displayName || 'anon'),
    };
  }

  const topData = topSnap.exists() ? topSnap.data() : null;
  const prefsData = prefsSnap.exists() ? prefsSnap.data() : null;
  const merged = mergeProfileDocs(topData, prefsData, user, providerId);

  // If neither doc has a hex, this is a truly fresh account — generate one
  // and persist it to both locations so DexNote sees it too.
  const isFirstEver = !merged.hexCode;
  if (isFirstEver) merged.hexCode = randomHex();

  // Backfill the top-level mirror. setDoc with merge:true creates the doc
  // if it's missing and never clobbers fields we didn't touch.
  const topUpdate = {
    displayName: merged.displayName,
    hexCode: merged.hexCode,
    photoURL: merged.photoURL,
    usernameLower: merged.usernameLower,
    provider: merged.provider,
    lastLogin: serverTimestamp(),
  };
  if (!topData?.createdAt) topUpdate.createdAt = serverTimestamp();
  setDoc(topRef, topUpdate, { merge: true }).catch((err) => {
    console.error('[auth] top-level profile write failed:', err);
  });

  // Backfill the DexNote subdoc only if it's missing, so we never overwrite
  // DexNote's own live data.
  if (!prefsData) {
    setDoc(prefsRef, {
      username: merged.displayName,
      hexColor: '#' + merged.hexCode,
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }

  return merged;
}

function teardownProfileSubs() {
  if (_profileUnsubTop) { try { _profileUnsubTop(); } catch {} _profileUnsubTop = null; }
  if (_profileUnsubPrefs) { try { _profileUnsubPrefs(); } catch {} _profileUnsubPrefs = null; }
}

function startProfileSubs(user, providerId) {
  teardownProfileSubs();
  const topRef = doc(db, 'users', user.uid);
  const prefsRef = doc(db, 'users', user.uid, 'prefs', 'profile');

  // Shared re-merge step. Whenever either doc updates, we re-read the other
  // side's cached view, merge, and fire ready callbacks if something the UI
  // cares about actually changed.
  let topCache = null;
  let prefsCache = null;

  function reapply() {
    const next = mergeProfileDocs(topCache, prefsCache, user, providerId);
    if (!next.hexCode) next.hexCode = State.profile?.hexCode || randomHex();
    const prev = State.profile || {};
    const changed =
      prev.displayName !== next.displayName ||
      prev.hexCode !== next.hexCode ||
      prev.photoURL !== next.photoURL ||
      prev.isAdmin !== next.isAdmin ||
      prev.usernameLower !== next.usernameLower;
    State.profile = { ...prev, ...next };
    if (changed) fireReady();
  }

  _profileUnsubTop = onSnapshot(
    topRef,
    (snap) => { topCache = snap.exists() ? snap.data() : null; reapply(); },
    (err) => console.warn('[auth] top profile snapshot error:', err),
  );
  _profileUnsubPrefs = onSnapshot(
    prefsRef,
    (snap) => { prefsCache = snap.exists() ? snap.data() : null; reapply(); },
    (err) => console.warn('[auth] prefs profile snapshot error:', err),
  );
}

export async function signIn(providerName = 'google') {
  const provider = providerName === 'github'
    ? new GithubAuthProvider()
    : new GoogleAuthProvider();
  setSigningIn(true);
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error('Sign-in failed:', err);
    const errEl = document.getElementById('auth-error');
    if (errEl) {
      errEl.textContent = err.message || 'Sign-in failed';
      errEl.classList.add('visible');
      errEl.style.display = 'block';
    }
  } finally {
    setTimeout(() => setSigningIn(false), 500);
  }
}

export async function signOut() {
  teardownProfileSubs();
  await fbSignOut(auth);
}

export async function saveProfile(updates) {
  if (updates.displayName) {
    if (/\.dev/i.test(updates.displayName) && !State.profile?.isAdmin) {
      throw new Error('.dev usernames are reserved for admins');
    }
    updates.usernameLower = normalizeUsername(updates.displayName);
  }
  if (!State.user) {
    State.profile = { ...State.profile, ...updates };
    return;
  }
  const topRef = doc(db, 'users', State.user.uid);
  const prefsRef = doc(db, 'users', State.user.uid, 'prefs', 'profile');

  // Mirror writes: top-level gets NodeBlast shape, subdoc gets DexNote shape.
  const topUpdates = { ...updates, updatedAt: serverTimestamp() };
  const prefsUpdates = { updatedAt: serverTimestamp() };
  if (updates.displayName) prefsUpdates.username = updates.displayName;
  if (updates.hexCode) prefsUpdates.hexColor = '#' + stripHash(updates.hexCode);

  await Promise.all([
    setDoc(topRef, topUpdates, { merge: true }),
    (updates.displayName || updates.hexCode)
      ? setDoc(prefsRef, prefsUpdates, { merge: true })
      : Promise.resolve(),
  ]);
  State.profile = { ...State.profile, ...updates };
}

export function onAuthReady(cb) {
  readyCallbacks.push(cb);
  if (authResolved) cb(State.user, State.profile);
}

onAuthStateChanged(auth, async (user) => {
  teardownProfileSubs();
  State.user = user;
  try {
    if (user) {
      const providerId = user.providerData[0]?.providerId || 'google.com';
      State.profile = await loadOrCreateProfile(user, providerId);
      startProfileSubs(user, providerId);
    } else {
      State.profile = null;
    }
  } catch (err) {
    console.error('[auth] profile load threw unexpectedly:', err);
    State.profile = user
      ? {
          displayName: user.displayName || 'anon',
          hexCode: randomHex(),
          photoURL: user.photoURL || '',
          provider: 'google',
          usernameLower: normalizeUsername(user.displayName || 'anon'),
        }
      : null;
  } finally {
    authResolved = true;
    fireReady();
  }
});
