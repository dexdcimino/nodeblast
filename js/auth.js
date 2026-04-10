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
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import State from './state.js';
import { normalizeUsername } from './users.js';

const auth = getAuth(app);
const db = getFirestore(app);

const readyCallbacks = [];
let authResolved = false;
let _profileUnsub = null;

function fireReady() {
  readyCallbacks.forEach((cb) => {
    try { cb(State.user, State.profile); } catch (e) { console.error('[auth] ready callback threw:', e); }
  });
}

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
    // ".dev" is reserved for admin accounts — allow it only if the
    // current profile has isAdmin:true (set manually in the Firebase
    // console, no UI path to grant it).
    if (/\.dev/i.test(updates.displayName) && !State.profile?.isAdmin) {
      throw new Error('.dev usernames are reserved for admins');
    }
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
  // Tear down any existing profile subscription before we do anything else
  if (_profileUnsub) { try { _profileUnsub(); } catch {} _profileUnsub = null; }

  State.user = user;
  try {
    if (user) {
      const providerId = user.providerData[0]?.providerId || 'google.com';
      State.profile = await loadOrCreateProfile(user, providerId);

      // Live listener: catches cross-site edits (DexNote changing name/hex)
      // and keeps State.profile in sync without a page reload.
      const ref = doc(db, 'users', user.uid);
      _profileUnsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) return;
          const next = snap.data();
          const prev = State.profile || {};
          // Only re-notify if something actually changed on fields the UI cares about
          if (
            prev.displayName !== next.displayName ||
            prev.hexCode !== next.hexCode ||
            prev.photoURL !== next.photoURL ||
            prev.isAdmin !== next.isAdmin
          ) {
            State.profile = { ...prev, ...next };
            fireReady();
          } else {
            State.profile = { ...prev, ...next };
          }
        },
        (err) => console.warn('[auth] profile snapshot error:', err),
      );
    } else {
      State.profile = null;
    }
  } catch (err) {
    console.error('[auth] profile load threw unexpectedly:', err);
    State.profile = user ? fallbackProfile(user, user.providerData[0]?.providerId || 'google.com') : null;
  } finally {
    authResolved = true;
    fireReady();
  }
});
