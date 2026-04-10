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
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import State from './state.js';
import { normalizeUsername } from './users.js';

const auth = getAuth(app);
const db = getFirestore(app);

const readyCallbacks = [];
let authResolved = false;

function randomHex() {
  return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

function fallbackProfile(user, providerId) {
  const provider = providerId.includes('github') ? 'github' : 'google';
  const displayName = user.displayName || 'anon';
  return {
    displayName,
    usernameLower: normalizeUsername(displayName),
    hexCode: randomHex(),
    photoURL: user.photoURL || '',
    provider,
  };
}

async function loadOrCreateProfile(user, providerId) {
  const ref = doc(db, 'users', user.uid);
  const provider = providerId.includes('github') ? 'github' : 'google';

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (err) {
    console.warn('[auth] profile read failed, using fallback:', err);
    return fallbackProfile(user, providerId);
  }

  if (!snap.exists()) {
    const displayName = user.displayName || 'anon';
    const profile = {
      displayName,
      usernameLower: normalizeUsername(displayName),
      hexCode: randomHex(),
      photoURL: user.photoURL || '',
      provider,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    };
    try {
      await setDoc(ref, profile);
    } catch (err) {
      console.warn('[auth] profile create failed, using in-memory:', err);
    }
    return profile;
  }

  // Existing profile (may have been created by DexNote) — touch lastLogin and
  // backfill usernameLower if missing. Don't let a failed write block the
  // auth callbacks from firing.
  const existing = snap.data();
  const touchUpdates = { lastLogin: serverTimestamp() };
  const needsLower = normalizeUsername(existing.displayName);
  if (needsLower && existing.usernameLower !== needsLower) {
    touchUpdates.usernameLower = needsLower;
  }
  updateDoc(ref, touchUpdates).catch((err) => {
    console.warn('[auth] lastLogin/usernameLower update failed:', err);
  });
  return { ...existing, usernameLower: needsLower || existing.usernameLower };
}

export async function signIn(providerName = 'google') {
  const provider = providerName === 'github'
    ? new GithubAuthProvider()
    : new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error('Sign-in failed:', err);
    const errEl = document.getElementById('auth-error');
    if (errEl) {
      errEl.textContent = err.message || 'Sign-in failed';
      errEl.style.display = 'block';
    }
  }
}

export async function signOut() {
  await fbSignOut(auth);
}

export async function saveProfile(updates) {
  if (updates.displayName) {
    updates.usernameLower = normalizeUsername(updates.displayName);
  }
  if (!State.user) {
    State.profile = { ...State.profile, ...updates };
    return;
  }
  const ref = doc(db, 'users', State.user.uid);
  await updateDoc(ref, updates);
  State.profile = { ...State.profile, ...updates };
}

export function onAuthReady(cb) {
  readyCallbacks.push(cb);
  if (authResolved) cb(State.user, State.profile);
}

onAuthStateChanged(auth, async (user) => {
  State.user = user;
  try {
    if (user) {
      const providerId = user.providerData[0]?.providerId || 'google.com';
      State.profile = await loadOrCreateProfile(user, providerId);
    } else {
      State.profile = null;
    }
  } catch (err) {
    console.error('[auth] profile load threw unexpectedly:', err);
    State.profile = user ? fallbackProfile(user, user.providerData[0]?.providerId || 'google.com') : null;
  } finally {
    authResolved = true;
    readyCallbacks.forEach((cb) => {
      try { cb(State.user, State.profile); } catch (e) { console.error('[auth] ready callback threw:', e); }
    });
  }
});
