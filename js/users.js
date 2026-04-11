// ══════════════════════════════════════
//  NodeBlast — USERS
//  Username lookup and profile helpers
// ══════════════════════════════════════

import { app } from './firebase-config.js';
import {
  getFirestore,
  collection,
  query,
  where,
  limit,
  orderBy,
  getDocs,
  doc,
  getDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const db = getFirestore(app);

export function normalizeUsername(name) {
  return (name || '').toLowerCase().trim();
}

// Build the canonical userLookup document key: "name#hex" (both lowercase).
// The `userLookup` collection enforces that a given {displayName, hexCode}
// combo is owned by exactly one uid.
export function userLookupKey(username, hex) {
  const lower = normalizeUsername(username);
  const h = (hex || '').toLowerCase();
  if (!lower || !h) return '';
  return lower + '#' + h;
}

// Exact lookup via the userLookup collection when hex is provided; falls
// back to a username-only query otherwise (backwards compat for legacy
// `/username` URLs that have no hex suffix).
export async function getUserByUsernameHex(username, hex) {
  const lower = normalizeUsername(username);
  if (!lower) return null;
  try {
    if (hex) {
      const key = lower + '#' + hex.toLowerCase();
      const lookupSnap = await getDoc(doc(db, 'userLookup', key));
      if (lookupSnap.exists()) {
        const data = lookupSnap.data();
        const userSnap = await getDoc(doc(db, 'users', data.uid));
        const profile = userSnap.exists() ? userSnap.data() : {};
        return { uid: data.uid, ...profile };
      }
      // Fall through to username-only search if lookup missing.
      // This covers accounts that existed before the userLookup
      // collection was populated.
    }

    const q = query(
      collection(db, 'users'),
      where('usernameLower', '==', lower),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { uid: d.id, ...d.data() };
  } catch (err) {
    console.warn('[users] getUserByUsernameHex failed:', err);
    return null;
  }
}

// Back-compat wrapper used by code paths that don't yet pass the hex.
export async function getUserByUsername(username) {
  return getUserByUsernameHex(username, null);
}

// Prefix search on the users collection, used by the header search bar.
// Relies on the usernameLower field being populated (auth.js backfills it
// on every sign-in). Uses the standard Firestore prefix-range trick.
export async function searchUsers(prefix) {
  const lower = normalizeUsername(prefix);
  if (!lower) return [];
  try {
    const q = query(
      collection(db, 'users'),
      where('usernameLower', '>=', lower),
      where('usernameLower', '<', lower + '\uf8ff'),
      orderBy('usernameLower'),
      limit(8),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[users] searchUsers failed:', err);
    return [];
  }
}

// Called from auth.js on every sign-in to backfill `usernameLower` for
// pre-existing user docs (e.g. accounts created via DexNote) so profile
// lookups work.
export async function ensureUsernameLower(uid, displayName) {
  const lower = normalizeUsername(displayName);
  if (!uid || !lower) return;
  try {
    await updateDoc(doc(db, 'users', uid), { usernameLower: lower });
  } catch (err) {
    console.warn('[users] ensureUsernameLower failed:', err);
  }
}
