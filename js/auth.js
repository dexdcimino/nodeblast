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

const auth = getAuth(app);
const db = getFirestore(app);

const readyCallbacks = [];
let authResolved = false;

function randomHex() {
  return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

async function loadOrCreateProfile(user, providerId) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  const provider = providerId.includes('github') ? 'github' : 'google';

  if (!snap.exists()) {
    const profile = {
      displayName: user.displayName || 'anon',
      hexCode: randomHex(),
      photoURL: user.photoURL || '',
      provider,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return profile;
  }

  await updateDoc(ref, { lastLogin: serverTimestamp() });
  return snap.data();
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
  if (user) {
    const providerId = user.providerData[0]?.providerId || 'google.com';
    State.profile = await loadOrCreateProfile(user, providerId);
  } else {
    State.profile = null;
  }
  authResolved = true;
  readyCallbacks.forEach((cb) => cb(State.user, State.profile));
});
