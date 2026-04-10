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
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const db = getFirestore(app);

export function normalizeUsername(name) {
  return (name || '').toLowerCase().trim();
}

export async function getUserByUsername(username) {
  const lower = normalizeUsername(username);
  if (!lower) return null;
  try {
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
    console.warn('[users] getUserByUsername failed:', err);
    return null;
  }
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
