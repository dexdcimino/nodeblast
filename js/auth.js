import { app } from './firebase-config.js';
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import State from './state.js';
import { normalizeUsername, userLookupKey } from './users.js';
import { setSigningIn, stripDevSuffix } from './ui-events.js';
import { sanitizeSocialLinks } from './social.js';
import { propagateProfileToFriends } from './friends.js';

// PRIVACY-MD01: UID-based admin allowlist. Mirrors firestore.rules.
// Email-based detection was removed because email is no longer stored
// in Firestore (privacy fix — users/{uid} is public-readable).
const ADMIN_UIDS = new Set([
  'y6sLULTTnFc6B1f9qmjMCl3WUix1',  // Dex (primary)
  '3RlnflogEiYQ6mfuSOr4ZyIlCAj1',  // NodeBlast official admin
]);

const auth = getAuth(app);
const db = getFirestore(app);

const readyCallbacks = [];
const profileLightCallbacks = [];
let authResolved = false;
let _profileUnsubTop = null;
let _profileUnsubPrefs = null;

function fireReady() {
  readyCallbacks.forEach((cb) => {
    try { cb(State.user, State.profile); } catch (e) { console.error('[auth] ready callback threw:', e); }
  });
}

// LIVE-SYNC-MD: lighter-weight broadcast for bio/socialLinks/etc. updates
// that don't need the full auth-UI repaint. Called from reapply() on every
// profile snapshot so subscribers can refresh just the bits they own.
function fireProfileLight() {
  profileLightCallbacks.forEach((cb) => {
    try { cb(State.profile); } catch (e) { console.error('[auth] profile-light callback threw:', e); }
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
  // INFRA-MD01: CANONICAL top-level users/{uid} doc uses `displayName`
  // + `hexCode` (no #). DexNote mirrors here from its internal
  // prefs/profile subdoc (username/hexColor WITH #); we read the prefs
  // subdoc first so a rapid DexNote edit wins before Firestore eventual
  // consistency settles the top-level doc.
  // ".dev" is an admin display badge, never part of the stored name —
  // strip any legacy value that still has it baked in.
  const rawName =
    prefsData?.username ||      // DexNote internal format (legacy fallback)
    topData?.displayName ||     // CANONICAL cross-site field
    user.displayName ||
    'anon';
  const displayName = stripDevSuffix(rawName) || 'anon';
  const hexCode =
    stripHash(prefsData?.hexColor) ||   // DexNote internal format (legacy fallback)
    stripHash(topData?.hexCode) ||      // CANONICAL cross-site field
    null;
  const photoURL = topData?.photoURL || user.photoURL || '';
  const uidIsAdmin = !!(user?.uid && ADMIN_UIDS.has(user.uid));
  // Bio: DexNote subdoc wins, top-level doc is the fallback. Either
  // undefined → empty string so the UI can treat "no bio" uniformly.
  const bio = (prefsData?.bio ?? topData?.bio ?? '').toString();
  // Social links: prefs subdoc wins ONLY when it actually has entries.
  // Using `??` here was a bug — a stale/empty `socialLinks: []` left in
  // the prefs subdoc would shadow real links written to the top-level
  // doc, so links saved in NodeBlast (top-level) never rendered. Prefer
  // whichever doc has a non-empty array; fall back to [] if both empty.
  const _prefsLinks = Array.isArray(prefsData?.socialLinks) ? prefsData.socialLinks : [];
  const _topLinks = Array.isArray(topData?.socialLinks) ? topData.socialLinks : [];
  const socialLinksRaw = _prefsLinks.length ? _prefsLinks : _topLinks;
  const socialLinks = sanitizeSocialLinks(socialLinksRaw);
  return {
    displayName,
    hexCode,
    photoURL,
    provider,
    usernameLower: normalizeUsername(displayName),
    isAdmin: !!topData?.isAdmin || uidIsAdmin,
    logoTopColor: topData?.logoTopColor || null,
    logoBotColor: topData?.logoBotColor || null,
    logoMode: topData?.logoMode || 'dual',
    logoAck: topData?.logoAck === true,
    bio,
    socialLinks,
    // MD18: tracked (pinned/followed) privacy flag. Default false
    // so newly created accounts are private until the user opts in.
    trackedPublic: !!topData?.trackedPublic,
    // DS-04: dev badge. Admin-only — never written by client code.
    isDev: prefsData?.isDev === true || topData?.isDev === true,
    // MD27: custom color slots synced via the prefs subdoc. Array of
    // 16 nullable hex strings. Falls back to null (= use localStorage
    // only) when the subdoc hasn't been seeded yet.
    customColorSlots: Array.isArray(prefsData?.customColorSlots)
      ? prefsData.customColorSlots
      : null,
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
  // Persist isAdmin if the email match promoted a user that Firestore
  // didn't have flagged yet.
  if (merged.isAdmin && !topData?.isAdmin) topUpdate.isAdmin = true;
  setDoc(topRef, topUpdate, { merge: true }).catch((err) => {
    console.error('[auth] top-level profile write failed:', err);
  });

  // Mirror the {name, hex} pair into the userLookup collection so that
  // /name.hex URL lookups can resolve to this uid in O(1).
  writeUserLookup(user.uid, merged.displayName, merged.hexCode);

  // If the stored DexNote subdoc username has a legacy ".dev" baked in,
  // rewrite it to the stripped form so both sites stay consistent.
  const prefsNeedsStrip = prefsData && prefsData.username && prefsData.username !== merged.displayName;
  if (!prefsData) {
    setDoc(prefsRef, {
      username: merged.displayName,
      hexColor: '#' + merged.hexCode,
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
  } else if (prefsNeedsStrip) {
    setDoc(prefsRef, {
      username: merged.displayName,
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }

  return merged;
}

// Write (or refresh) the userLookup entry that binds "name#hex" →
// { uid }. Fire-and-forget — failures are logged but never block the
// caller. When called with a previous key, the stale entry is removed
// iff it still belongs to this uid (avoids nuking an entry that
// another user has since claimed).
async function writeUserLookup(uid, username, hex, oldKey = null) {
  const key = userLookupKey(username, hex);
  if (!uid || !key) return;
  try {
    await setDoc(doc(db, 'userLookup', key), {
      uid,
      usernameLower: normalizeUsername(username),
      hexCode: (hex || '').toLowerCase(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    if (oldKey && oldKey !== key) {
      try {
        const prev = await getDoc(doc(db, 'userLookup', oldKey));
        if (prev.exists() && prev.data().uid === uid) {
          await deleteDoc(doc(db, 'userLookup', oldKey));
        }
      } catch (err) {
        console.warn('[auth] stale userLookup cleanup failed:', err);
      }
    }
  } catch (err) {
    console.warn('[auth] userLookup write failed:', err);
  }
}

// Persist the user's chosen logo colors to the top-level users doc.
// Fire-and-forget from the caller's perspective — callers already
// update the UI synchronously. Safe to call while signed out (no-op).
// Pass either or both of { logoTopColor, logoBotColor }.
export async function saveLogoColors(updates) {
  if (!State.user || !updates) return;
  const patch = {};
  if (updates.logoTopColor) patch.logoTopColor = updates.logoTopColor;
  if (updates.logoBotColor) patch.logoBotColor = updates.logoBotColor;
  if (updates.logoMode) patch.logoMode = updates.logoMode;
  if (updates.logoAck === true) patch.logoAck = true;
  if (Object.keys(patch).length === 0) return;
  try {
    await setDoc(doc(db, 'users', State.user.uid), {
      ...patch,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    State.profile = { ...State.profile, ...patch };
  } catch (err) {
    console.warn('[auth] saveLogoColors failed:', err);
  }
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
    // LIVE-SYNC-MD: always fire the light callback — bio/socialLinks
    // changes don't trigger `changed` above, but UI bound to those
    // fields still needs to know to repaint.
    fireProfileLight();
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
  let provider;
  if (providerName === 'github') {
    provider = new GithubAuthProvider();
  } else if (providerName === 'discord') {
    provider = new OAuthProvider('oidc.discord');
    provider.addScope('identify');
    provider.addScope('email');
  } else {
    provider = new GoogleAuthProvider();
  }
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
  // MD#11: if user called signOut() without going through the UI button
  // (e.g. session expired, programmatic sign-out), still reset to defaults.
  // The UI button path in init.js already does this — this is the safety net.
  try { localStorage.removeItem('nb-logo-top-color'); } catch {}
  try { localStorage.removeItem('nb-logo-bot-color'); } catch {}
  try { localStorage.removeItem('nb-logo-mode'); } catch {}
  try { localStorage.removeItem('nb-logo-acknowledged'); } catch {}
  teardownProfileSubs();
  await fbSignOut(auth);
}

export async function saveProfile(updates) {
  if (updates.displayName) {
    // ".dev" is an admin badge, not user-controlled text. Strip any
    // suffix the user typed (or legacy data still carries) so the
    // stored value is always the base name.
    updates.displayName = stripDevSuffix(updates.displayName) || 'anon';
    updates.usernameLower = normalizeUsername(updates.displayName);
  }
  if (updates.hexCode) {
    updates.hexCode = stripHash(updates.hexCode);
  }
  if (!State.user) {
    State.profile = { ...State.profile, ...updates };
    return;
  }

  // Uniqueness check on {displayName, hexCode}. Two users can share a
  // name OR a hex, but never both at once. We only need to enforce
  // this when either field is actually changing.
  const nextName = updates.displayName || State.profile?.displayName || '';
  const nextHex = updates.hexCode || State.profile?.hexCode || '';
  const prevName = State.profile?.displayName || '';
  const prevHex = State.profile?.hexCode || '';
  const comboChanged = (updates.displayName && nextName !== prevName) ||
                       (updates.hexCode && nextHex !== prevHex);

  if (comboChanged && nextName && nextHex) {
    const newKey = userLookupKey(nextName, nextHex);
    if (newKey) {
      const lookupSnap = await getDoc(doc(db, 'userLookup', newKey));
      if (lookupSnap.exists() && lookupSnap.data().uid !== State.user.uid) {
        throw new Error('This username + hex combination is already taken');
      }
    }
  }

  // Clamp bio length + trim, in case a caller forgot.
  if (typeof updates.bio === 'string') {
    updates.bio = updates.bio.slice(0, 280).trim();
  }
  // Sanitize socialLinks so the stored array is always well-formed:
  // drops missing URLs, caps at 8 entries, re-detects platform if omitted.
  if (Array.isArray(updates.socialLinks)) {
    updates.socialLinks = sanitizeSocialLinks(updates.socialLinks);
  }

  const topRef = doc(db, 'users', State.user.uid);
  const prefsRef = doc(db, 'users', State.user.uid, 'prefs', 'profile');

  // Mirror writes: top-level gets NodeBlast shape, subdoc gets DexNote shape.
  const topUpdates = { ...updates, updatedAt: serverTimestamp() };
  const prefsUpdates = { updatedAt: serverTimestamp() };
  if (updates.displayName) prefsUpdates.username = updates.displayName;
  if (updates.hexCode) prefsUpdates.hexColor = '#' + updates.hexCode;
  // Bio mirrors directly with the same field name on both docs.
  if (typeof updates.bio === 'string') prefsUpdates.bio = updates.bio;
  // Social links mirror to the prefs subdoc with the same field name
  // so DexNote sees the change if it ever reads socialLinks too.
  if (Array.isArray(updates.socialLinks)) prefsUpdates.socialLinks = updates.socialLinks;

  const writePrefs = updates.displayName || updates.hexCode
    || typeof updates.bio === 'string'
    || Array.isArray(updates.socialLinks);
  await Promise.all([
    setDoc(topRef, topUpdates, { merge: true }),
    writePrefs ? setDoc(prefsRef, prefsUpdates, { merge: true }) : Promise.resolve(),
  ]);
  State.profile = { ...State.profile, ...updates };

  // Refresh the userLookup entry (and clean up the stale one) whenever
  // the combo changed. Fire-and-forget — non-blocking.
  if (comboChanged && nextName && nextHex) {
    const oldKey = userLookupKey(prevName, prevHex);
    writeUserLookup(State.user.uid, nextName, nextHex, oldKey || null);
  }

  // MD16: propagate my new username / hex into every friend's
  // `friends/{myUid}` doc so their People panel updates without a
  // refresh. DexNote does this for hex via _setAccountHex — we
  // mirror that here AND also propagate username (DexNote doesn't,
  // so username sync is NB→any only until DexNote is patched).
  // Fire-and-forget so the UI save path stays fast.
  const nameActuallyChanged = updates.displayName && updates.displayName !== prevName;
  const hexActuallyChanged = updates.hexCode && updates.hexCode !== prevHex;
  if (nameActuallyChanged || hexActuallyChanged) {
    const patch = {};
    if (nameActuallyChanged) patch.username = updates.displayName;
    if (hexActuallyChanged) patch.hexColor = '#' + updates.hexCode;
    propagateProfileToFriends(patch).catch(() => {});
  }
}

export function onProfileLightUpdate(cb) {
  profileLightCallbacks.push(cb);
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
