// ══════════════════════════════════════
//  NodeBlast — CATALYSTS
//  CRUD + voting + modal/detail UI
// ══════════════════════════════════════

import { app } from './firebase-config.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  onSnapshot,
  increment,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import State from './state.js';
import { uploadCatalystThumb, deleteCatalystThumb } from './storage.js';
import { openColorPopup, closeColorPopup } from './color.js';
import { toast, showModal, renderUsername, escapeHtml, safeHex } from './ui-events.js';
import { navigate, buildUserSlug } from './router.js';
import { searchUsers } from './users.js';
import { openDM } from './friends.js';
import { getLiveGames } from './game-registry.js';

const db = getFirestore(app);

export const CATEGORIES = ['games', 'tools', 'creative', 'ai', 'sites', 'wild'];
export const PLATFORMS = ['web', 'mobile', 'both'];
export const STATUSES = ['live', 'early', 'placeholder'];
const DEFAULT_STATUS = 'live';
// MD12: external = points to a URL off-site (existing behavior),
// internal = opens a dedicated on-site workspace at /name.hex/slug.
// Default is external so legacy catalysts keep working unchanged.
export const CATALYST_TYPES = ['external', 'internal'];
export const INTERNAL_SUBTYPES = ['scene', 'game', 'sim'];
const DEFAULT_TYPE = 'external';

function normalizeUrl(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

// Light validation: accept http/https or a bare domain containing at
// least one dot, no spaces. "coming soon" etc. fail here — callers
// should special-case those before submitting.
export function isValidUrl(raw) {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (/\s/.test(trimmed)) return false;
  try {
    const u = new URL(normalizeUrl(trimmed));
    if (!u.hostname.includes('.')) return false;
    return true;
  } catch {
    return false;
  }
}

export // Client-side sort for a user's own catalyst grid.
// Tiles with a sortOrder come first (ascending, as positioned by the
// user). Tiles without — freshly created, or legacy docs that predate
// drag-reordering — fall back to createdAt desc, just like before.
// The two groups are interleaved such that unordered tiles appear
// BEFORE ordered ones, so a newly created catalyst lands at the top
// of the grid without disrupting the arrangement below. The first
// reorder drag migrates every tile to have a sortOrder.
function sortUserCatalysts(list) {
  return [...list].sort((a, b) => {
    const aHas = a.sortOrder != null;
    const bHas = b.sortOrder != null;
    if (aHas && bHas) return a.sortOrder - b.sortOrder;
    if (aHas) return 1;
    if (bHas) return -1;
    const ta = a.createdAt?.toMillis?.() ?? 0;
    const tb = b.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
}

export function slugify(title) {
  return (title || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

async function uniqueSlugForUser(uid, baseSlug, ignoreId = null) {
  try {
    const q = query(
      collection(db, 'catalysts'),
      where('ownerId', '==', uid),
    );
    const snap = await getDocs(q);
    const taken = new Set();
    snap.docs.forEach((d) => {
      if (d.id === ignoreId) return;
      const s = d.data().slug;
      if (s) taken.add(s);
    });
    if (!taken.has(baseSlug)) return baseSlug;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${baseSlug}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return baseSlug + '-' + Date.now();
  } catch (err) {
    console.warn('[catalysts] uniqueSlugForUser failed:', err);
    return baseSlug;
  }
}

export async function getCatalystBySlug(ownerId, slug) {
  if (!ownerId || !slug) return null;
  try {
    const q = query(
      collection(db, 'catalysts'),
      where('ownerId', '==', ownerId),
      where('slug', '==', slug),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (err) {
    console.warn('[catalysts] getCatalystBySlug failed:', err);
    return null;
  }
}

function safeDomain(url) {
  try {
    return new URL(normalizeUrl(url)).host.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

// MD-LOCK-HASH (this batch): hash a plaintext lock password to a hex
// SHA-256 string before Firestore write. Lock passwords were stored
// plaintext historically; new writes hash. Unlock attempts hash the
// attempt and compare against either the stored hash (new format,
// 64 hex chars) or the stored plaintext (legacy, anything else).
async function _hashLockPassword(plaintext) {
  if (!plaintext) return '';
  const buf = new TextEncoder().encode(String(plaintext));
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// MD-LOCK-HASH: legacy detection — a real SHA-256 hex string is exactly
// 64 chars of [0-9a-f]. Anything else is treated as a legacy plaintext
// password and compared directly. Once the owner re-saves the catalyst,
// it gets stored as a hash going forward.
function _isHashedLockPassword(s) {
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
}

/* ══════════════════════════════════════
   CRUD
══════════════════════════════════════ */

export async function loadUserCatalysts(uid) {
  if (!uid) return [];
  const q = query(
    collection(db, 'catalysts'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  try {
    const snap = await getDocs(q);
    return sortUserCatalysts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.warn('[catalysts] loadUserCatalysts failed:', err);
    return [];
  }
}

export async function loadPublicFeed(category, max = 20) {
  const constraints = [
    where('isPublic', '==', true),
    orderBy('fireCount', 'desc'),
    limit(max),
  ];
  if (category && category !== 'all') {
    constraints.unshift(where('category', '==', category));
  }
  try {
    const snap = await getDocs(query(collection(db, 'catalysts'), ...constraints));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[catalysts] loadPublicFeed failed:', err);
    return [];
  }
}

/* ── Live subscriptions ── */

export function subscribeUserCatalysts(uid, callback) {
  if (!uid) return () => {};
  const q = query(
    collection(db, 'catalysts'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  // MD8: same flash-then-empty guard as subscribePublicFeed. Only fire
  // callback([]) on error if no successful snapshot has landed yet —
  // otherwise leave the existing tiles in place.
  let receivedAny = false;
  return onSnapshot(
    q,
    (snap) => {
      receivedAny = true;
      callback(sortUserCatalysts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    },
    (err) => {
      console.warn('[catalysts] user sub error:', err);
      if (!receivedAny) callback([]);
    },
  );
}

// Public feed subscription.
//
// MD3 switched this from `fireCount desc` (popular) to `createdAt desc`
// (recent activity) because the community hub groups catalysts by
// creator and sorts creators by most-recent activity. Ordering the
// underlying query by createdAt keeps the snapshot representative of
// "what's new" across the widest set of creators. Limit bumped from
// 24 → 60 so the hub has enough breadth for meaningful grouping.
//
// MD8 fix: track whether we've ever received data and refuse to fire
// callback([]) on subsequent errors. Firestore's onSnapshot fires the
// success callback first with cached data, then fires the error
// callback if the server query fails (e.g. missing composite index
// after the MD3 query change). Without this guard, a transient error
// after a successful snapshot wipes the rendered tiles and leaves the
// user staring at an empty state — the "flash then disappear" bug.
export function subscribePublicFeed(category, callback, max = 200) {
  const constraints = [
    orderBy('createdAt', 'desc'),
    limit(max),
  ];
  if (category && category !== 'all') {
    constraints.unshift(where('category', '==', category));
  }
  let receivedAny = false;
  return onSnapshot(
    query(collection(db, 'catalysts'), ...constraints),
    (snap) => {
      receivedAny = true;
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.warn('[catalysts] feed sub error:', err);
      // Only escape the skeleton state if we never got data — leave a
      // successful render in place rather than wiping it.
      if (!receivedAny) callback([]);
    },
  );
}

/* ── Search ── */

export async function searchCatalysts(term) {
  if (!term || term.length < 2) return [];
  const lower = term.toLowerCase();
  try {
    // Firestore has no substring search, so pull the most recent public
    // catalysts and filter client-side. Good enough for v1.
    const q = query(
      collection(db, 'catalysts'),
      where('isPublic', '==', true),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => (c.title || '').toLowerCase().includes(lower))
      .slice(0, 8);
  } catch (err) {
    console.warn('[catalysts] searchCatalysts failed:', err);
    return [];
  }
}

// Persist a new tile order for the given user's catalysts. `orderedIds`
// is the full list of catalyst document ids in their desired display
// order (index 0 = first tile). Only documents whose sortOrder differs
// from the new position are written, so a small rearrangement doesn't
// rewrite the entire grid.
export async function reorderCatalysts(ownerId, orderedIds) {
  if (!ownerId || !Array.isArray(orderedIds) || orderedIds.length === 0) return;
  try {
    const snap = await getDocs(query(
      collection(db, 'catalysts'),
      where('ownerId', '==', ownerId),
    ));
    const current = new Map();
    snap.docs.forEach((d) => current.set(d.id, d.data().sortOrder));

    const batch = writeBatch(db);
    let writes = 0;
    orderedIds.forEach((id, i) => {
      if (!current.has(id)) return;
      if (current.get(id) !== i) {
        batch.update(doc(db, 'catalysts', id), { sortOrder: i });
        writes++;
      }
    });
    if (writes > 0) await batch.commit();
    // MD24: snapshot after the reorder lands so the new sortOrder
    // values are captured in the backup. Skipped when a restore is
    // in flight so we don't overwrite the backup we just restored.
    if (!_restoring) saveCatalystBackup(ownerId).catch(() => {});
  } catch (err) {
    console.warn('[catalysts] reorderCatalysts failed:', err);
    throw err;
  }
}

/* ══════════════════════════════════════
   MD24: catalyst backup system
   ──────────────────────────────────────
   Every create/update/delete/reorder schedules a fire-and-forget
   snapshot write at `users/{uid}/catalyst_backups/{Date.now()}`
   containing the user's full catalyst list. We keep at most
   BACKUP_LIMIT docs per user, FIFO — the oldest is deleted before
   writing a new one when we're at capacity.

   Doc ids are millisecond timestamps cast to strings so simple
   string sorting on the id matches chronological order (good for
   ~9000 years). `createdAt` is still stored via serverTimestamp
   for display.

   The restore path is a scaffold: read the backup doc, delete every
   current catalyst owned by this user, then setDoc() each item from
   the backup back to `catalysts/{id}`. Thumbnails live in Storage
   and are NOT rewritten — we only restore the Firestore doc (the
   thumbURL in the backup still points at the old Storage path, so
   images survive as long as they weren't deleted by something else).
══════════════════════════════════════ */

const BACKUP_LIMIT = 10;

// Save a snapshot of every catalyst the user currently owns. Reads
// fresh from Firestore so a post-mutation call includes the change
// that just landed. Fire-and-forget — any failure is logged but
// never blocks the caller. Returns the new backup doc id on success.
export async function saveCatalystBackup(uid) {
  if (!uid) return null;
  try {
    const listSnap = await getDocs(query(
      collection(db, 'catalysts'),
      where('ownerId', '==', uid),
    ));
    const catalysts = listSnap.docs.map((d) => {
      const raw = d.data();
      // Strip Firestore sentinels (Timestamp, serverTimestamp) by
      // converting them to plain millis numbers so the backup doc is
      // self-contained and round-trippable.
      const snap = { id: d.id };
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v === 'object' && typeof v.toMillis === 'function') {
          snap[k] = v.toMillis();
        } else {
          snap[k] = v;
        }
      }
      return snap;
    });

    // FIFO cleanup: if we're at capacity, delete the oldest backup
    // before writing the new one. "Oldest" = smallest doc id (since
    // ids are stringified ms timestamps). We over-delete by 1 extra
    // so hitting capacity twice in quick succession still leaves
    // room for the new write.
    const backupsRef = collection(db, 'users', uid, 'catalyst_backups');
    const existing = await getDocs(query(backupsRef, orderBy('__name__', 'desc')));
    if (existing.size >= BACKUP_LIMIT) {
      const victims = existing.docs.slice(BACKUP_LIMIT - 1);
      await Promise.all(victims.map((d) => deleteDoc(d.ref)));
    }

    const id = Date.now().toString();
    await setDoc(doc(db, 'users', uid, 'catalyst_backups', id), {
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      catalystCount: catalysts.length,
      catalysts,
    });
    return id;
  } catch (err) {
    console.warn('[catalysts] saveCatalystBackup failed:', err);
    return null;
  }
}

// List the 10 most recent backups for a user, newest first. Returns
// lightweight metadata only — { id, createdAtMs, catalystCount } —
// so the UI list can paint without loading every full snapshot.
export async function listCatalystBackups(uid) {
  if (!uid) return [];
  try {
    const backupsRef = collection(db, 'users', uid, 'catalyst_backups');
    const snap = await getDocs(query(backupsRef, orderBy('__name__', 'desc'), limit(BACKUP_LIMIT)));
    return snap.docs.map((d) => {
      const data = d.data() || {};
      const ms = data.createdAtMs || Number(d.id) || 0;
      return {
        id: d.id,
        createdAtMs: ms,
        catalystCount: typeof data.catalystCount === 'number'
          ? data.catalystCount
          : (Array.isArray(data.catalysts) ? data.catalysts.length : 0),
      };
    });
  } catch (err) {
    console.warn('[catalysts] listCatalystBackups failed:', err);
    return [];
  }
}

// Restore a specific backup. Deletes every current catalyst owned by
// the user, then writes the backup's items back to `catalysts/{id}`.
// Thumbnails in Storage are left alone — the backup snapshot still
// carries the original thumbURL so image bindings survive as long as
// the Storage object hasn't been separately deleted. The _restoring
// guard flag lets callers suppress the normal post-mutation backup
// write during this operation (which would otherwise immediately
// overwrite the backup we just restored with a fresh snapshot).
let _restoring = false;
export async function restoreCatalystBackup(uid, backupId) {
  if (!uid || !backupId) return false;
  _restoring = true;
  try {
    const backupRef = doc(db, 'users', uid, 'catalyst_backups', backupId);
    const backupSnap = await getDoc(backupRef);
    if (!backupSnap.exists()) {
      console.warn('[catalysts] backup not found:', backupId);
      return false;
    }
    const items = backupSnap.data()?.catalysts;
    if (!Array.isArray(items)) {
      console.warn('[catalysts] backup has no catalysts array');
      return false;
    }

    // Delete every current catalyst doc. We only remove docs, not
    // Storage thumbnails — the restore path below rewrites those
    // same doc ids where possible (so the thumb binding is still
    // valid) and only creates net-new ids when an item in the
    // backup no longer has a matching doc.
    const currentSnap = await getDocs(query(
      collection(db, 'catalysts'),
      where('ownerId', '==', uid),
    ));
    const delBatch = writeBatch(db);
    currentSnap.docs.forEach((d) => delBatch.delete(d.ref));
    await delBatch.commit();

    // Write every backed-up item back. setDoc with the original id
    // reuses the slot. createdAtMs and other numeric timestamps are
    // restored as-is; updatedAt gets a fresh serverTimestamp so the
    // caller can tell a restore just happened.
    const writeB = writeBatch(db);
    items.forEach((item) => {
      if (!item?.id) return;
      const { id, ...rest } = item;
      writeB.set(doc(db, 'catalysts', id), {
        ...rest,
        // Force the current user as owner so a restore run under a
        // different account (unlikely but possible) can't write to
        // someone else's namespace.
        ownerId: uid,
        updatedAt: serverTimestamp(),
      });
    });
    await writeB.commit();
    return true;
  } catch (err) {
    console.warn('[catalysts] restoreCatalystBackup failed:', err);
    return false;
  } finally {
    _restoring = false;
  }
}

// Refresh owner-denormalized fields on every catalyst owned by the
// current user. Called after saveProfile() when displayName or hexCode
// changed, so existing tiles immediately reflect the new profile
// without needing to edit each catalyst by hand.
export async function refreshOwnerOnAllCatalysts() {
  if (!State.user || !State.profile) return;
  try {
    const snap = await getDocs(query(
      collection(db, 'catalysts'),
      where('ownerId', '==', State.user.uid),
    ));
    if (snap.empty) return;
    const batch = writeBatch(db);
    const name = State.profile.displayName || 'anon';
    snap.docs.forEach((d) => {
      batch.update(d.ref, {
        ownerName: name,
        ownerUsernameLower: name.toLowerCase(),
        ownerHex: State.profile.hexCode || '5aaa72',
        ownerPhoto: State.profile.photoURL || '',
        ownerIsAdmin: !!State.profile.isAdmin,
        ownerSocialLinks: Array.isArray(State.profile.socialLinks) ? State.profile.socialLinks : [],
      });
    });
    await batch.commit();
  } catch (err) {
    console.warn('[catalysts] refreshOwnerOnAllCatalysts failed:', err);
  }
}

export async function createCatalyst(data, file) {
  if (!State.user) throw new Error('Not signed in');
  const catRef = doc(collection(db, 'catalysts'));
  const catId = catRef.id;

  let thumbURL = '';
  if (file) {
    try { thumbURL = await uploadCatalystThumb(State.user.uid, catId, file); }
    catch (err) { console.warn('[catalysts] thumb upload failed:', err); }
  }

  const slug = await uniqueSlugForUser(State.user.uid, slugify(data.title));

  // MD7 collaborator scaffold: empty array on create. The OWNER is
  // implicit and never lives in this list — the array stores ADDITIONAL
  // collaborators only. collaboratorCount denormalizes (1 + extras) so
  // the hex tile can render without scanning the array.
  const collaborators = Array.isArray(data.collaborators) ? data.collaborators : [];

  const doc1 = {
    ownerId: State.user.uid,
    ownerName: State.profile?.displayName || 'anon',
    ownerUsernameLower: (State.profile?.displayName || 'anon').toLowerCase(),
    ownerHex: State.profile?.hexCode || '5aaa72',
    ownerPhoto: State.profile?.photoURL || '',
    ownerIsAdmin: !!State.profile?.isAdmin,
    // MD10 denormalize: copy the owner's social links onto every
    // catalyst doc so community cards can render icons without
    // N extra user-doc fetches. refreshOwnerOnAllCatalysts propagates
    // changes after the user edits their links.
    ownerSocialLinks: Array.isArray(State.profile?.socialLinks) ? State.profile.socialLinks : [],
    title: data.title.slice(0, 40),
    slug,
    url: data.url ? normalizeUrl(data.url) : '',
    description: (data.description || '').slice(0, 500),
    category: CATEGORIES.includes(data.category) ? data.category : 'sites',
    platform: PLATFORMS.includes(data.platform) ? data.platform : 'web',
    status: STATUSES.includes(data.status) ? data.status : DEFAULT_STATUS,
    type: CATALYST_TYPES.includes(data.type) ? data.type : DEFAULT_TYPE,
    internalSubtype: INTERNAL_SUBTYPES.includes(data.internalSubtype) ? data.internalSubtype : 'scene',
    gameId: typeof data.gameId === 'string' ? data.gameId : '',
    sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : '',
    thumbURL,
    logoURL: '',
    accentColor: data.accentColor || '#5AAA72',
    logoColor: data.logoColor || '',
    fireCount: 0,
    frostCount: 0,
    viewCount: 0,
    isPublic: true,
    collaborators,
    collaboratorCount: 1 + collaborators.length,
    // MD23: password lock. Client-side deterrent only — see the
    // security note in MD23. Empty string when locking is off so the
    // doc shape stays stable.
    isLocked: !!data.isLocked && !!data.lockPassword,
    // MD-LOCK-HASH: hash before write. Empty when locking is off.
    // Guarded against double-hash for the case where the save handler
    // forwarded an already-hashed value (user kept lock on without
    // typing a new password).
    lockPassword: data.isLocked && data.lockPassword
      ? (_isHashedLockPassword(data.lockPassword)
          ? data.lockPassword
          : await _hashLockPassword(data.lockPassword))
      : '',
    // MD28: solo/co-dev + developer count. devCount defaults to 1
    // for solo and 1+collabs for co when the caller doesn't pass it.
    devMode: data.devMode === 'co' ? 'co' : 'solo',
    devCount: typeof data.devCount === 'number' && data.devCount >= 1
      ? data.devCount
      : 1 + collaborators.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(catRef, doc1);
  // MD24: fire-and-forget backup write after the create lands.
  if (!_restoring) saveCatalystBackup(State.user.uid).catch(() => {});
  return { id: catId, ...doc1 };
}

export async function updateCatalyst(id, data, file) {
  if (!State.user) throw new Error('Not signed in');
  const ref = doc(db, 'catalysts', id);

  const title = data.title.slice(0, 40);
  const updates = {
    title,
    url: data.url ? normalizeUrl(data.url) : '',
    description: (data.description || '').slice(0, 500),
    category: CATEGORIES.includes(data.category) ? data.category : 'sites',
    platform: PLATFORMS.includes(data.platform) ? data.platform : 'web',
    status: STATUSES.includes(data.status) ? data.status : DEFAULT_STATUS,
    type: CATALYST_TYPES.includes(data.type) ? data.type : DEFAULT_TYPE,
    internalSubtype: INTERNAL_SUBTYPES.includes(data.internalSubtype) ? data.internalSubtype : 'scene',
    gameId: typeof data.gameId === 'string' ? data.gameId : '',
    sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : '',
    accentColor: data.accentColor || '#5AAA72',
    logoColor: data.logoColor || '',
    // Refresh the owner-denormalized fields in case the editor changed
    // their profile between catalyst creation and this edit.
    ownerName: State.profile?.displayName || 'anon',
    ownerUsernameLower: (State.profile?.displayName || 'anon').toLowerCase(),
    ownerHex: State.profile?.hexCode || '5aaa72',
    ownerPhoto: State.profile?.photoURL || '',
    ownerIsAdmin: !!State.profile?.isAdmin,
    ownerSocialLinks: Array.isArray(State.profile?.socialLinks) ? State.profile.socialLinks : [],
    updatedAt: serverTimestamp(),
  };

  // Collaborators only get written when the editor actually included
  // a list. Avoids clobbering an existing value with `undefined` from
  // a caller that doesn't care about collaborators.
  if (Array.isArray(data.collaborators)) {
    updates.collaborators = data.collaborators;
    updates.collaboratorCount = 1 + data.collaborators.length;
  }

  // MD23: password lock state. Both fields are always written so
  // that disabling the lock from the edit modal clears the password
  // on the doc (not just flips isLocked). Writing empty string
  // rather than deleting the field keeps doc shape consistent.
  if (typeof data.isLocked === 'boolean') {
    const pw = (data.lockPassword || '').toString();
    updates.isLocked = data.isLocked && !!pw;
    // MD-LOCK-HASH: hash before write, with double-hash guard for an
    // already-hashed value forwarded by the save handler.
    updates.lockPassword = data.isLocked && pw
      ? (_isHashedLockPassword(pw) ? pw : await _hashLockPassword(pw))
      : '';
  }

  // MD28: solo/co-dev + developer count.
  if (data.devMode) {
    updates.devMode = data.devMode === 'co' ? 'co' : 'solo';
    updates.devCount = typeof data.devCount === 'number' && data.devCount >= 1
      ? data.devCount : 1;
  }

  // Re-slug only if the title actually changed
  try {
    const existing = await getDoc(ref);
    const current = existing.data();
    if (current && current.title !== title) {
      updates.slug = await uniqueSlugForUser(State.user.uid, slugify(title), id);
    }
  } catch (err) {
    console.warn('[catalysts] slug recompute skipped:', err);
  }

  if (file) {
    try { updates.thumbURL = await uploadCatalystThumb(State.user.uid, id, file); }
    catch (err) { console.warn('[catalysts] thumb re-upload failed:', err); }
  }
  await updateDoc(ref, updates);
  // MD24: snapshot after the edit lands.
  if (!_restoring) saveCatalystBackup(State.user.uid).catch(() => {});
}

export async function deleteCatalyst(id) {
  if (!State.user) throw new Error('Not signed in');
  await deleteCatalystThumb(State.user.uid, id);
  await deleteDoc(doc(db, 'catalysts', id));
  // MD24: snapshot the post-delete state.
  if (!_restoring) saveCatalystBackup(State.user.uid).catch(() => {});
}

// MD6 NOTE ON NAMING: the vote type value `'frost'` and the document
// field `frostCount` are kept as-is for zero-migration compatibility
// with existing catalyst + vote docs. The UI displays a 💩 emoji
// instead — "poop" is a DISPLAY concept, not a storage concept. Any
// vote cast before MD6 still highlights the poop button correctly
// because the internal value is unchanged.
export async function voteCatalyst(catalystId, type) {
  if (!State.user) { toast('Sign in to vote'); return null; }
  if (type !== 'fire' && type !== 'frost') return null;
  const uid = State.user.uid;
  const catRef = doc(db, 'catalysts', catalystId);
  const voteRef = doc(db, 'votes', `${catalystId}_${uid}`);

  try {
    return await runTransaction(db, async (tx) => {
      const [catSnap, voteSnap] = await Promise.all([tx.get(catRef), tx.get(voteRef)]);
      if (!catSnap.exists()) throw new Error('Catalyst missing');
      const cat = catSnap.data();
      // Block self-voting. Users can't bump their own stuff.
      if (cat.ownerId === uid) throw new Error("Can't vote on your own catalyst");
      let fire = cat.fireCount || 0;
      let frost = cat.frostCount || 0;
      let newState = null;

      if (!voteSnap.exists()) {
        if (type === 'fire') fire++; else frost++;
        tx.set(voteRef, { odcId: uid, catalystId, type, createdAt: serverTimestamp() });
        newState = type;
      } else {
        const prev = voteSnap.data().type;
        if (prev === type) {
          if (type === 'fire') fire = Math.max(0, fire - 1);
          else frost = Math.max(0, frost - 1);
          tx.delete(voteRef);
          newState = null;
        } else {
          if (prev === 'fire') { fire = Math.max(0, fire - 1); frost++; }
          else { frost = Math.max(0, frost - 1); fire++; }
          tx.update(voteRef, { type, createdAt: serverTimestamp() });
          newState = type;
        }
      }
      tx.update(catRef, { fireCount: fire, frostCount: frost });
      return { type: newState, fireCount: fire, frostCount: frost };
    });
  } catch (err) {
    console.warn('[catalysts] voteCatalyst failed:', err);
    toast(err?.message?.includes("your own") ? err.message : 'Vote failed');
    return null;
  }
}

export async function getMyVote(catalystId) {
  if (!State.user) return null;
  try {
    const voteRef = doc(db, 'votes', `${catalystId}_${State.user.uid}`);
    const snap = await getDoc(voteRef);
    return snap.exists() ? snap.data().type : null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════
   MODAL — create/edit catalyst
══════════════════════════════════════ */

let _editingId = null;
let _pendingFile = null;
let _accentColor = '#5AAA72';
let _logoColor = '';
let _status = DEFAULT_STATUS;
let _type = DEFAULT_TYPE;
// Working set of collaborators while the edit modal is open. Each
// entry: { uid, displayName, hexCode, photoURL, isAdmin }. Owner is
// NOT included (it's implicit). Reset on every modal open.
let _editingCollabs = [];
let _collabSearchT = null;
// MD-LOCK-HASH: stashes the existing catalyst's stored lockPassword
// value (hash or legacy plaintext) when the edit modal opens, so the
// save handler can preserve it across re-saves where the user keeps
// the lock toggle on but doesn't type a new password.
let _editingLockExisting = '';

function _setPills(containerId, value) {
  document.querySelectorAll(`#${containerId} .cat-pill`).forEach((b) => {
    b.classList.toggle('selected', b.dataset.val === value);
  });
}
function _getPill(containerId) {
  return document.querySelector(`#${containerId} .cat-pill.selected`)?.dataset.val;
}

function _applyStatus(status) {
  _status = STATUSES.includes(status) ? status : DEFAULT_STATUS;
  document.querySelectorAll('#cat-status-pick .cat-status-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.status === _status);
  });
  // URL is optional when status is "placeholder"
  const urlInput = document.getElementById('cat-url');
  if (urlInput) {
    urlInput.placeholder = _status === 'placeholder'
      ? 'URL (optional for WIP)'
      : 'https://...';
  }
}

// MD12: toggle the modal between external (URL-backed) and internal
// (on-site workspace). When internal, we hide the URL field because
// there's nothing to link — the catalyst's own page is its content.
let _internalSubtype = 'scene';
let _gameId = '';
let _sourceUrl = ''; // DS-04: future hook for user-hosted game modules

function _applyType(type) {
  _type = CATALYST_TYPES.includes(type) ? type : DEFAULT_TYPE;
  document.querySelectorAll('#cat-type-pick .cat-type-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.type === _type);
  });
  const urlField = document.getElementById('cat-url-field');
  const internalMsg = document.getElementById('cat-internal-msg');
  const subtypePick = document.getElementById('cat-internal-subtype-pick');
  if (urlField)    urlField.style.display    = _type === 'internal' ? 'none' : '';
  if (internalMsg) internalMsg.style.display = _type === 'internal' ? 'block' : 'none';
  if (subtypePick) subtypePick.style.display = _type === 'internal' ? '' : 'none';
}

function _applyInternalSubtype(sub, gameId) {
  _internalSubtype = INTERNAL_SUBTYPES.includes(sub) ? sub : 'scene';
  _gameId = gameId || '';
  document.querySelectorAll('#cat-internal-subtype-pick .cat-subtype-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.sub === _internalSubtype);
  });
  const gamePick = document.getElementById('cat-game-pick');
  const gameCards = document.getElementById('cat-game-cards');
  if (gamePick) gamePick.style.display = _internalSubtype === 'game' ? '' : 'none';
  if (_internalSubtype === 'game' && gameCards) {
    const games = getLiveGames();
    gameCards.innerHTML = games.map(g => `
      <div class="cat-game-card ${_gameId === g.id ? 'selected' : ''}" data-game-id="${g.id}">
        <div class="cat-game-card-badge">${g.badge}</div>
        <div class="cat-game-card-info">
          <div class="cat-game-card-name" style="color:${g.color}">${g.name}</div>
          <div class="cat-game-card-desc">${g.description}</div>
        </div>
        ${g.status === 'beta' ? '<span class="cat-game-badge-beta">BETA</span>' : ''}
      </div>
    `).join('');
    gameCards.querySelectorAll('.cat-game-card').forEach(el => {
      el.addEventListener('click', () => {
        _gameId = el.dataset.gameId;
        gameCards.querySelectorAll('.cat-game-card').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
  }
}

function _updateAccentBtn() {
  const btn = document.getElementById('cat-accent-preview');
  if (btn) btn.style.background = _accentColor;
}

// MD21: yin-yang placeholder SVG shown inside the edit modal thumb
// preview when no image is uploaded. Mirrors the grid placeholder so
// the two stay visually consistent — same 90° rotation, same
// currentColor fill, same faded watermark vibe.
const THUMB_PLACEHOLDER_SVG = `<svg class="cat-thumb-placeholder-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 234.6" aria-hidden="true">
  <g fill="currentColor">
    <path d="M0,117.3s.7,28.6,19,46c18.3,17.4,45.1,18.1,45.1,18.1,35.3,0,64-28.7,64-64s28.6-64,64-64h.6c15.1,0,24.6-16.1,17.1-29.2C201.1,9.2,185.2,0,167.9,0h-79.7c-17.3,0-33.3,9.2-41.9,24.2,0,0-22.5,38.9-27.8,48.1C13.2,81.5,0,99.7,0,117.3ZM40,115.8c.8-12,10.5-21.6,22.4-22.4,14.5-.9,26.4,11,25.5,25.5-.8,12-10.5,21.6-22.4,22.4-14.5.9-26.4-11-25.5-25.5Z"/>
    <path fill-opacity="0.5" d="M46.2,210.4c8.7,15,24.6,24.2,41.9,24.2h79.7c17.3,0,33.3-9.2,41.9-24.2,0,0,22.5-38.9,27.8-48.1,5.3-9.2,18.5-27.4,18.5-45,0,0,.2-28.5-19.8-46.7-20-18.2-44.3-17.4-44.3-17.4-35.3,0-64,28.7-64,64s-28.6,64-64,64h-.6c-15.1,0-24.6,16.1-17.1,29.2h0ZM168.1,115.7c.8-12,10.5-21.6,22.4-22.4,14.5-.9,26.4,11,25.5,25.5-.8,12-10.5,21.6-22.4,22.4-14.5.9-26.4-11-25.5-25.5Z"/>
  </g>
</svg>`;

function _setThumbPreview(src) {
  const drop = document.getElementById('cat-thumb-drop');
  if (!drop) return;
  if (src) {
    drop.classList.add('has-img');
    drop.classList.remove('no-thumb');
    drop.style.backgroundImage = `url("${src}")`;
    drop.innerHTML = '<div class="cat-thumb-hint">Click to replace</div>';
  } else {
    drop.classList.remove('has-img');
    drop.classList.add('no-thumb');
    drop.style.backgroundImage = '';
    // MD21: faded logo watermark behind the hint text so the "drop
    // image" area isn't a solid gray blob.
    drop.innerHTML = '<div class="cat-thumb-placeholder">' + THUMB_PLACEHOLDER_SVG + '</div><div class="cat-thumb-hint">Drop image or click to upload</div>';
  }
}

// Render the working collaborators list as a chip stack. The owner
// gets a non-removable chip first; each working collaborator gets a
// removable chip after.
// Generic person-silhouette SVG used for basic (unregistered) collab
// pills. currentColor fill so it adapts to the theme.
const _PERSON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M20 21c0-3.87-3.58-7-8-7s-8 3.13-8 7z"/></svg>';

function _renderCollabChips() {
  const list = document.getElementById('cat-collab-list');
  if (!list) return;
  list.innerHTML = '';

  // Owner chip — always first, cannot be removed. Has a "copy
  // username" button in its toolbar instead of the ✕.
  const ownerName = State.profile?.displayName || 'anon';
  const ownerHex = State.profile?.hexCode || '5aaa72';
  const ownerPhoto = State.profile?.photoURL || '';
  list.appendChild(_buildRichPill({
    displayName: ownerName,
    hexCode: ownerHex,
    photoURL: ownerPhoto,
    isAdmin: !!State.profile?.isAdmin,
  }, -1, true));

  _editingCollabs.forEach((c, i) => {
    if (c.type === 'unregistered') {
      list.appendChild(_buildBasicPill(c, i));
    } else {
      list.appendChild(_buildRichPill(c, i, false));
    }
  });
}

function _buildRichPill(c, idx, isOwner) {
  const chip = document.createElement('span');
  chip.className = 'cat-collab-chip rich' + (isOwner ? ' owner' : '');
  const hex = c.hexCode || '5aaa72';
  chip.style.setProperty('--chip-hex', '#' + hex);
  const initial = escapeHtml((c.displayName || 'A').charAt(0).toUpperCase());
  const avatarInner = c.photoURL
    ? `<img src="${escapeHtml(c.photoURL)}" alt="">`
    : initial;
  const hexDot = `<span class="cat-collab-hex-dot" data-tip="#${escapeHtml(hex)}"></span>`;
  chip.innerHTML = `
    <span class="cat-collab-chip-avatar">${avatarInner}</span>
    <span class="cat-collab-chip-name">${escapeHtml(c.displayName || 'anon')}</span>
    ${hexDot}
    <span class="cat-collab-chip-hex" style="display:none">#${escapeHtml(hex)}</span>
  `;
  // Click hex dot to toggle hex code visibility
  chip.querySelector('.cat-collab-hex-dot')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const hexEl = chip.querySelector('.cat-collab-chip-hex');
    if (hexEl) hexEl.style.display = hexEl.style.display === 'none' ? '' : 'none';
  });
  // Toolbar
  const toolbar = document.createElement('span');
  toolbar.className = 'cat-collab-toolbar';
  if (isOwner) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'cat-collab-tool';
    copyBtn.setAttribute('data-tip', 'Copy username');
    copyBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(c.displayName || '');
      toast('Copied');
    });
    toolbar.appendChild(copyBtn);
  } else {
    // Message button (registered only, not owner)
    if (c.uid) {
      const dmBtn = document.createElement('button');
      dmBtn.type = 'button';
      dmBtn.className = 'cat-collab-tool';
      dmBtn.setAttribute('data-tip', 'Message');
      dmBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
      dmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDM({ uid: c.uid, username: c.displayName, hexColor: '#' + hex });
      });
      toolbar.appendChild(dmBtn);
    }
    // Remove button
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'cat-collab-tool cat-collab-remove';
    rmBtn.setAttribute('data-tip', 'Remove');
    rmBtn.dataset.idx = idx;
    rmBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    toolbar.appendChild(rmBtn);
  }
  chip.appendChild(toolbar);
  return chip;
}

function _buildBasicPill(c, idx) {
  const chip = document.createElement('span');
  chip.className = 'cat-collab-chip basic';
  chip.innerHTML = `
    <span class="cat-collab-chip-avatar basic-avatar">${_PERSON_SVG}</span>
    <span class="cat-collab-chip-name">${escapeHtml(c.name || c.displayName || 'anon')}</span>
  `;
  const toolbar = document.createElement('span');
  toolbar.className = 'cat-collab-toolbar';
  const rmBtn = document.createElement('button');
  rmBtn.type = 'button';
  rmBtn.className = 'cat-collab-tool cat-collab-remove';
  rmBtn.setAttribute('data-tip', 'Remove');
  rmBtn.dataset.idx = idx;
  rmBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  toolbar.appendChild(rmBtn);
  chip.appendChild(toolbar);
  return chip;
}

function _hideCollabResults() {
  const results = document.getElementById('cat-collab-results');
  if (results) {
    results.classList.remove('visible');
    results.innerHTML = '';
  }
}

// MD29: add a collaborator by the typed name. Tries a registered
// lookup first; if nothing matches, falls back to an unregistered
// basic pill. Deduplicates against existing entries.
async function _addCollabByName() {
  const input = document.getElementById('cat-collab-input');
  if (!input) return;
  const raw = input.value.replace(/ /g, '_').trim().slice(0, 16);
  if (!raw) return;

  // Check for duplicate
  const lower = raw.toLowerCase();
  const ownerName = (State.profile?.displayName || '').toLowerCase();
  if (lower === ownerName) { toast("That's you — you're the owner"); return; }
  const already = _editingCollabs.some((c) => {
    if (c.type === 'unregistered') return (c.name || '').toLowerCase() === lower;
    return (c.displayName || '').toLowerCase() === lower;
  });
  if (already) { toast('Already added'); return; }

  // Try registered lookup
  const users = await searchUsers(raw);
  const match = users.find((u) =>
    (u.displayName || '').toLowerCase() === lower
    || (u.usernameLower || '') === lower
  );
  if (match && match.uid !== State.user?.uid) {
    _editingCollabs.push({
      uid: match.uid,
      displayName: match.displayName || raw,
      hexCode: match.hexCode || '5aaa72',
      photoURL: match.photoURL || '',
      isAdmin: !!match.isAdmin,
      type: 'registered',
    });
  } else if (!match || match.uid === State.user?.uid) {
    // Unregistered basic pill
    _editingCollabs.push({
      name: raw,
      type: 'unregistered',
    });
  }
  input.value = '';
  _hideCollabResults();
  _renderCollabChips();
  _syncDevModeWithCollabs();
}

async function _runCollabSearch(prefix) {
  const results = document.getElementById('cat-collab-results');
  if (!results) return;
  if (!prefix || prefix.length < 1) {
    _hideCollabResults();
    return;
  }
  const users = await searchUsers(prefix);
  const ownerUid = State.user?.uid;
  // Filter out the owner + anyone already in the working list. Cap
  // to 6 hits — the dropdown is short by design.
  const filtered = users
    .filter((u) => u.uid !== ownerUid)
    .filter((u) => !_editingCollabs.some((c) => c.uid === u.uid))
    .slice(0, 6);
  results.innerHTML = '';
  if (filtered.length === 0) {
    results.innerHTML = '<div class="cat-collab-result-empty">No matching users</div>';
    results.classList.add('visible');
    return;
  }
  filtered.forEach((u) => {
    const name = u.displayName || 'anon';
    const hex = u.hexCode || '5aaa72';
    const photo = u.photoURL || '';
    const initial = escapeHtml((name || 'A').charAt(0).toUpperCase());
    const avatarInner = photo
      ? `<img src="${escapeHtml(photo)}" alt="">`
      : initial;
    const row = document.createElement('div');
    row.className = 'cat-collab-result';
    row.innerHTML = `
      <div class="cat-collab-result-avatar" style="border-color:${safeHex(hex.startsWith('#') ? hex : '#' + hex)}">${avatarInner}</div>
      <div class="cat-collab-result-body">
        <span class="cat-collab-result-name">${escapeHtml(name)}</span>
        <span class="cat-collab-result-hex">#${escapeHtml(hex)}</span>
      </div>
    `;
    row.addEventListener('click', () => {
      // Append to the working list, re-render chips, clear input.
      _editingCollabs.push({
        uid: u.uid,
        displayName: name,
        hexCode: hex,
        photoURL: photo,
        isAdmin: !!u.isAdmin,
        type: 'registered',
      });
      _renderCollabChips();
      _syncDevModeWithCollabs();
      const input = document.getElementById('cat-collab-input');
      if (input) input.value = '';
      _hideCollabResults();
    });
    results.appendChild(row);
  });
  results.classList.add('visible');
}

export function openCatalystModal(existing = null) {
  const modal = document.getElementById('cat-modal');
  if (!modal) return;
  // MD22: the account dropdown stays open while the edit modal is up.
  // The dropdown is the user's control panel — closing it throws away
  // context. The modal's z-index (25000) sits far above the dropdown's
  // (9000) and the modal's own backdrop dims the page behind it, so
  // the dropdown is visually obscured but its state is preserved.
  // When the modal closes, the dropdown is still where the user left
  // it. The body scroll lock stays (MD19) so the page behind can't
  // scroll while the modal is captured.
  document.body.classList.add('cat-modal-open');
  _editingId = existing?.id || null;
  _pendingFile = null;
  _accentColor = existing?.accentColor || '#' + (State.profile?.hexCode || '5AAA72');
  _logoColor = existing?.logoColor || '';

  document.getElementById('cat-modal-title').textContent = existing ? 'Edit Catalyst' : 'New Catalyst';
  _applyStatus(existing?.status || DEFAULT_STATUS);
  _applyType(existing?.type || DEFAULT_TYPE);
  _applyInternalSubtype(existing?.internalSubtype || 'scene', existing?.gameId || '');
  document.getElementById('cat-title').value = existing?.title || '';
  document.getElementById('cat-url').value = existing?.url || '';
  document.getElementById('cat-desc').value = existing?.description || '';
  _setPills('cat-category-pills', existing?.category || 'sites');
  _setPills('cat-platform-pills', existing?.platform || 'web');
  _setThumbPreview(existing?.thumbURL || '');
  _updateAccentBtn();

  // Seed the collaborators working set. New catalysts start empty;
  // edits clone the existing array so a Cancel doesn't mutate the
  // catalyst doc that the rest of the app may still be referencing.
  _editingCollabs = Array.isArray(existing?.collaborators)
    ? existing.collaborators.map((c) => ({ ...c }))
    : [];
  _renderCollabChips();
  _hideCollabResults();
  const collabInput = document.getElementById('cat-collab-input');
  if (collabInput) collabInput.value = '';

  // MD28: seed the dev-mode toggle + count from the existing doc.
  // Missing fields (legacy catalysts) default to 'solo' / 1.
  _applyDevMode(existing?.devMode === 'co' ? 'co' : 'solo');
  const devCountInput = document.getElementById('cat-dev-count');
  if (devCountInput) {
    const min = 1 + _editingCollabs.length;
    devCountInput.value = Math.max(existing?.devCount || 1, min);
    devCountInput.min = min;
  }

  // MD23: seed the password lock toggle + input from the existing
  // doc. Missing fields (older catalysts predating MD23) fall back
  // to unlocked. _applyLockState handles the visual toggle state
  // and input visibility.
  const lockedNow = !!existing?.isLocked && !!existing?.lockPassword;
  _applyLockState(lockedNow);
  const pwInput = document.getElementById('cat-lock-password');
  // MD-LOCK-HASH: don't pre-fill the input with a hashed value (user
  // would see 64 hex chars). Empty input means "keep existing lock if
  // toggle stays on, else clear." Save logic re-hashes only when the
  // user types a fresh password.
  if (pwInput) {
    pwInput.value = (existing?.lockPassword && !_isHashedLockPassword(existing.lockPassword))
      ? existing.lockPassword
      : '';
  }
  // MD-LOCK-HASH: stash the existing stored value (hash or legacy
  // plaintext) so the save handler can preserve it when the user
  // re-saves without typing a new password.
  _editingLockExisting = existing?.lockPassword || '';

  document.getElementById('cat-submit-btn').textContent = existing ? 'Save Changes' : 'Create Catalyst';
  document.getElementById('cat-delete-btn').style.display = existing ? 'inline-flex' : 'none';

  modal.classList.add('open');
  setTimeout(() => document.getElementById('cat-title')?.focus(), 50);
}

// MD23: drive the lock toggle button + password input visibility.
// Called from openCatalystModal (to hydrate) and from the toggle's
// click handler (to flip). Kept as a standalone helper so both
// paths stay consistent — the button's aria-pressed attribute is
// the source of truth the submit handler reads.
// MD28: drive the solo-dev / co-dev toggle visual state + dev count
// visibility. Called from hydration and from the toggle click handlers.
function _applyDevMode(mode) {
  const soloBtn = document.getElementById('cat-dev-solo');
  const coBtn = document.getElementById('cat-dev-co');
  const countRow = document.getElementById('cat-dev-count-row');
  if (soloBtn) soloBtn.classList.toggle('selected', mode === 'solo');
  if (coBtn) coBtn.classList.toggle('selected', mode === 'co');
  if (countRow) countRow.style.display = mode === 'co' ? '' : 'none';
}

// MD28: sync dev-mode UI state with the current collabs list. Auto-
// switches to co-dev when collaborators are added, refreshes the
// count input's min value so the user can't type below it, and
// clamps the displayed value when the floor rises above the current
// input value.
function _syncDevModeWithCollabs() {
  const hasCollabs = _editingCollabs.length > 0;
  const soloBtn = document.getElementById('cat-dev-solo');
  const coBtn = document.getElementById('cat-dev-co');
  const countInput = document.getElementById('cat-dev-count');
  if (hasCollabs) {
    _applyDevMode('co');
    if (soloBtn) soloBtn.disabled = true;
  } else {
    if (soloBtn) soloBtn.disabled = false;
  }
  if (countInput) {
    const floor = 1 + _editingCollabs.length;
    countInput.min = floor;
    if (Number(countInput.value) < floor) countInput.value = floor;
  }
}

function _applyLockState(locked) {
  const btn = document.getElementById('cat-lock-toggle');
  const field = document.getElementById('cat-lock-field');
  const pwInput = document.getElementById('cat-lock-password');
  if (!btn) return;
  btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
  btn.classList.toggle('on', locked);
  const label = btn.querySelector('.cat-lock-label');
  if (label) label.textContent = locked ? 'On' : 'Off';
  if (field) field.classList.toggle('locked', locked);
  if (pwInput) {
    // Clear the field when turning off so a subsequent save doesn't
    // leave a stale password in memory. Turning on leaves whatever
    // the owner previously typed (or hydrated from Firestore).
    if (!locked) pwInput.value = '';
  }
}

export function closeCatalystModal() {
  document.getElementById('cat-modal')?.classList.remove('open');
  // MD19: release the body scroll lock so the page behind scrolls
  // normally again after the modal dismisses.
  document.body.classList.remove('cat-modal-open');
  closeColorPopup();
  _editingId = null;
  _pendingFile = null;
  _editingCollabs = [];
  _editingLockExisting = '';
  _hideCollabResults();
  clearTimeout(_collabSearchT);
}

export function initCatalystModal(onSaved) {
  const modal = document.getElementById('cat-modal');
  if (!modal) return;

  // MD23: wire the password unlock modal at the same time. One-time
  // wiring; the modal element is always in the DOM (declared in
  // index.html), so this is safe to call during boot.
  initUnlockModal();

  document.getElementById('cat-modal-close')?.addEventListener('click', closeCatalystModal);
  document.getElementById('cat-cancel-btn')?.addEventListener('click', closeCatalystModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeCatalystModal(); });

  document.querySelectorAll('#cat-category-pills .cat-pill').forEach((b) => {
    b.addEventListener('click', () => _setPills('cat-category-pills', b.dataset.val));
  });
  document.querySelectorAll('#cat-platform-pills .cat-pill').forEach((b) => {
    b.addEventListener('click', () => _setPills('cat-platform-pills', b.dataset.val));
  });
  document.querySelectorAll('#cat-status-pick .cat-status-btn').forEach((b) => {
    b.addEventListener('click', () => _applyStatus(b.dataset.status));
  });
  document.querySelectorAll('#cat-type-pick .cat-type-btn').forEach((b) => {
    b.addEventListener('click', () => _applyType(b.dataset.type));
  });
  // DS-03: internal subtype picker (scene / game)
  document.querySelectorAll('#cat-internal-subtype-pick .cat-subtype-btn').forEach((b) => {
    b.addEventListener('click', () => _applyInternalSubtype(b.dataset.sub, _gameId));
  });

  // MD28: solo / co-dev toggle buttons. Clicking solo-dev while
  // collabs exist gets blocked with a toast; otherwise it just flips
  // the mode and shows/hides the dev-count row.
  document.getElementById('cat-dev-solo')?.addEventListener('click', () => {
    if (_editingCollabs.length > 0) {
      toast(`You have ${_editingCollabs.length} collaborator${_editingCollabs.length > 1 ? 's' : ''}`);
      return;
    }
    _applyDevMode('solo');
  });
  document.getElementById('cat-dev-co')?.addEventListener('click', () => {
    _applyDevMode('co');
    const countInput = document.getElementById('cat-dev-count');
    if (countInput) {
      const floor = 1 + _editingCollabs.length;
      if (Number(countInput.value) < floor) countInput.value = floor;
    }
  });
  // Clamp the dev-count input on every change so the value never
  // drops below the mandatory floor (owner + named collabs).
  document.getElementById('cat-dev-count')?.addEventListener('input', (e) => {
    const floor = 1 + _editingCollabs.length;
    if (Number(e.target.value) < floor) {
      toast(`You have ${_editingCollabs.length} collaborator${_editingCollabs.length > 1 ? 's' : ''}`);
      e.target.value = floor;
    }
  });

  // MD23: password lock toggle. Clicking the button flips the
  // aria-pressed state and shows/hides the password input. Pressing
  // Enter inside the password field fires the submit handler via
  // the form's default click on the primary button.
  document.getElementById('cat-lock-toggle')?.addEventListener('click', () => {
    const btn = document.getElementById('cat-lock-toggle');
    const next = btn.getAttribute('aria-pressed') !== 'true';
    _applyLockState(next);
    if (next) {
      // Small UX nicety — auto-focus the password field when the
      // user enables the lock so they can type immediately.
      setTimeout(() => document.getElementById('cat-lock-password')?.focus(), 30);
    }
  });

  const drop = document.getElementById('cat-thumb-drop');
  const fileInput = document.getElementById('cat-thumb-file');
  drop?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    _pendingFile = f;
    _setThumbPreview(URL.createObjectURL(f));
  });
  drop?.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop?.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop?.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f && /^image\//.test(f.type)) {
      _pendingFile = f;
      _setThumbPreview(URL.createObjectURL(f));
    }
  });

  document.getElementById('cat-accent-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openColorPopup(e.currentTarget, _accentColor, (hex) => {
      _accentColor = hex;
      _updateAccentBtn();
    });
  });

  // Logo color picker — dynamically created beside accent button
  const _accentRow = document.getElementById('cat-accent-btn')?.parentElement;
  if (_accentRow) {
    const logoBtn = document.createElement('button');
    logoBtn.type = 'button';
    logoBtn.id = 'cat-logo-color-btn';
    logoBtn.className = 'cat-accent-btn';
    logoBtn.setAttribute('data-tip', 'Logo color (auto if empty)');
    const _updateLogoBtn = () => {
      logoBtn.style.background = _logoColor || 'transparent';
      logoBtn.style.border = _logoColor ? '' : '2px dashed var(--bdr)';
      logoBtn.innerHTML = _logoColor ? '' : '<span style="font-size:10px;color:var(--tx3)">Auto</span>';
    };
    _updateLogoBtn();
    _accentRow.appendChild(logoBtn);
    logoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorPopup(e.currentTarget, _logoColor || _accentColor, (hex) => {
        _logoColor = hex;
        _updateLogoBtn();
      });
    });
    logoBtn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      _logoColor = '';
      _updateLogoBtn();
    });
  }

  const urlInput = document.getElementById('cat-url');
  const urlErr = document.getElementById('cat-url-error');
  function _clearUrlError() {
    urlInput?.classList.remove('invalid');
    if (urlErr) { urlErr.textContent = ''; urlErr.classList.remove('visible'); }
  }
  function _showUrlError(msg) {
    urlInput?.classList.add('invalid');
    if (urlErr) { urlErr.textContent = msg; urlErr.classList.add('visible'); }
  }
  urlInput?.addEventListener('input', _clearUrlError);

  // Copy-link button next to the URL input. Copies the live input value
  // (not the saved catalyst URL) so users can verify what they're about
  // to save. Empty input toasts instead of writing an empty clipboard.
  const copyBtn = document.getElementById('cat-url-copy-btn');
  copyBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    const value = (urlInput?.value || '').trim();
    if (!value) { toast('No URL to copy'); return; }
    try {
      await navigator.clipboard.writeText(value);
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 1200);
    } catch {
      toast(value);
    }
  });

  // Collaborator search input — debounced username prefix search.
  // Results dropdown is populated by _runCollabSearch.
  // MD29: spaces → underscores live, 16 char max (enforced by
  // maxlength in HTML too).
  const collabInput = document.getElementById('cat-collab-input');
  collabInput?.addEventListener('input', () => {
    // Live space→underscore transform
    const cursor = collabInput.selectionStart;
    collabInput.value = collabInput.value.replace(/ /g, '_');
    collabInput.selectionStart = collabInput.selectionEnd = cursor;
    clearTimeout(_collabSearchT);
    const q = (collabInput.value || '').trim();
    if (!q) { _hideCollabResults(); return; }
    _collabSearchT = setTimeout(() => _runCollabSearch(q), 220);
  });
  collabInput?.addEventListener('blur', () => {
    // Delay so a click on a result row registers before the dropdown
    // disappears.
    setTimeout(_hideCollabResults, 160);
  });
  collabInput?.addEventListener('focus', () => {
    const q = (collabInput.value || '').trim();
    if (q) _runCollabSearch(q);
  });
  // MD29: Enter key adds the typed name as an unregistered collab
  // if no search-result row was clicked. If the dropdown has results
  // visible, Enter selects the first one instead (like autocomplete).
  collabInput?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const firstResult = document.querySelector('#cat-collab-results.visible .cat-collab-result');
    if (firstResult) { firstResult.click(); return; }
    _addCollabByName();
  });
  // MD29: "+" button adds by the typed name (unregistered fallback
  // or registered lookup).
  document.getElementById('cat-collab-add-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _addCollabByName();
  });

  // Chip remove buttons (event delegation on the list).
  document.getElementById('cat-collab-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-collab-remove');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (!Number.isInteger(idx)) return;
    _editingCollabs.splice(idx, 1);
    _renderCollabChips();
    _syncDevModeWithCollabs();
  });

  document.getElementById('cat-submit-btn')?.addEventListener('click', async () => {
    const title = document.getElementById('cat-title').value.trim();
    const url = document.getElementById('cat-url').value.trim();
    _clearUrlError();
    if (!title) { toast('Title required'); return; }
    // URL is required for external catalysts (unless they're WIP/placeholder)
    // and NEVER required for internal catalysts — internal projects live
    // on-site so there's no external URL to validate against.
    const urlRequired = _type === 'external' && _status !== 'placeholder';
    if (urlRequired && !url) { _showUrlError('URL required'); return; }
    if (_type === 'external' && url && !isValidUrl(url)) {
      _showUrlError('Enter a valid URL (e.g. example.com)');
      return;
    }
    // MD23: pull lock state out of the form. Toggle button carries
    // the boolean as an aria-pressed attribute; password lives in a
    // sibling text input. We don't force the caller to enter a
    // password — toggling on with an empty field just clears the
    // lock on save (handled in createCatalyst/updateCatalyst).
    const lockToggleBtn = document.getElementById('cat-lock-toggle');
    const isLocked = lockToggleBtn?.getAttribute('aria-pressed') === 'true';
    const lockPasswordInput = document.getElementById('cat-lock-password')?.value?.trim() || '';
    // MD-LOCK-HASH: keep the existing hash when the user re-saves with
    // the lock on but didn't type a new password. Without this branch,
    // they'd have to retype the password every save. Only the hashed
    // form is preserved — a legacy plaintext value gets re-hashed on
    // first re-save by createCatalyst/updateCatalyst.
    const existingHash = (_editingLockExisting && _isHashedLockPassword(_editingLockExisting))
      ? _editingLockExisting
      : '';
    const lockPassword = lockPasswordInput || existingHash;
    if (isLocked && !lockPassword) {
      toast('Enter a password or turn the lock off');
      return;
    }

    // MD28: read dev-mode toggle state + count. The toggle's selected
    // class is the source of truth (same pattern as the lock toggle).
    const devMode = document.getElementById('cat-dev-co')?.classList.contains('selected') ? 'co' : 'solo';
    const devCountRaw = Number(document.getElementById('cat-dev-count')?.value) || 1;
    const devCountFloor = 1 + _editingCollabs.length;
    const devCount = devMode === 'co' ? Math.max(devCountRaw, devCountFloor) : 1;

    // DS-03: game subtype requires a game selection
    if (_type === 'internal' && _internalSubtype === 'game' && !_gameId) {
      toast('Select a game for this catalyst');
      return;
    }

    const data = {
      title,
      url: _type === 'internal' ? '' : url,
      description: document.getElementById('cat-desc').value.trim(),
      category: _getPill('cat-category-pills') || 'sites',
      platform: _getPill('cat-platform-pills') || 'web',
      status: _status,
      type: _type,
      internalSubtype: _internalSubtype,
      gameId: _type === 'internal' && _internalSubtype === 'game' ? _gameId : '',
      sourceUrl: _type === 'internal' && _internalSubtype === 'game' ? _sourceUrl : '',
      accentColor: _accentColor,
      logoColor: _logoColor || null,
      collaborators: _editingCollabs.slice(),
      isLocked,
      lockPassword,
      devMode,
      devCount,
    };
    const submitBtn = document.getElementById('cat-submit-btn');
    submitBtn.disabled = true; submitBtn.textContent = 'Saving...';
    try {
      if (_editingId) {
        await updateCatalyst(_editingId, data, _pendingFile);
        toast('Catalyst saved');
      } else {
        await createCatalyst(data, _pendingFile);
        toast('Catalyst created!');
      }
      closeCatalystModal();
      onSaved?.();
    } catch (err) {
      console.error(err);
      toast('Failed to save. ' + (err?.message || 'Check your connection.'));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = _editingId ? 'Save Changes' : 'Create Catalyst';
    }
  });

  document.getElementById('cat-delete-btn')?.addEventListener('click', () => {
    if (!_editingId) return;
    const id = _editingId;
    showModal({
      title: 'Delete catalyst?',
      msg: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await deleteCatalyst(id);
          toast('Catalyst deleted');
          closeCatalystModal();
          // LIVE-SYNC-MD: do NOT call onSaved?.() here. The
          // subscribeUserCatalysts listener (running for both the
          // account-panel mini grid AND the profile route's main grid)
          // already fires when the doc disappears, removing the tile
          // smoothly without tearing down the route.
        } catch (err) {
          toast('Delete failed');
        }
      },
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeCatalystModal();
  });
}

/* ══════════════════════════════════════
   DETAIL POPUP — view someone else's catalyst
══════════════════════════════════════ */

let _detailCatalyst = null;
let _myVote = null;
// MD03: callbacks injected by init.js so the detail popup can pin/unpin
// without importing tracked.js directly.
let _pinCallbacks = { onPin: null, onUnpin: null, isPinned: null };

function _renderVoteButtons() {
  const fire = document.getElementById('cat-vote-fire');
  const frost = document.getElementById('cat-vote-frost');
  if (!fire || !frost || !_detailCatalyst) return;
  fire.classList.toggle('active', _myVote === 'fire');
  frost.classList.toggle('active', _myVote === 'frost');
  fire.querySelector('.vote-count').textContent = _detailCatalyst.fireCount || 0;
  frost.querySelector('.vote-count').textContent = _detailCatalyst.frostCount || 0;

  // Disabled states:
  //   - Guest viewers can't vote → "Sign in to vote" tooltip.
  //   - Owners can't self-vote → "Can't vote on your own catalyst".
  // The transaction in voteCatalyst is still the source of truth;
  // these UI states just short-circuit the click before we hit it.
  const isGuest = !State.user;
  const isOwner = !!(State.user && _detailCatalyst.ownerId === State.user.uid);
  const disabled = isGuest || isOwner;
  [fire, frost].forEach((btn) => {
    btn.disabled = disabled;
    if (isGuest) btn.dataset.tip = 'Sign in to vote';
    else if (isOwner) btn.dataset.tip = "Can't vote on your own catalyst";
    else if (btn === fire) btn.dataset.tip = 'Fire it up';
    else btn.dataset.tip = 'Not a fan';
  });
}

export async function openCatalystDetail(catalyst) {
  const pop = document.getElementById('cat-detail-popup');
  if (!pop || !catalyst) return;

  // MD23: gate locked catalysts. Owners always bypass — their UID
  // matches ownerId so we skip the prompt entirely. Anyone else gets
  // the unlock modal; the success callback hands the unlocked
  // catalyst to _paintCatalystDetail so the detail popup finally
  // paints.
  const isOwner = !!(State.user && catalyst.ownerId === State.user.uid);
  if (catalyst.isLocked && catalyst.lockPassword && !isOwner) {
    openUnlockModal(catalyst, () => {
      _paintCatalystDetail(catalyst);
    });
    return;
  }

  _paintCatalystDetail(catalyst);
}

// MD23: password-gate modal. Public entry point so init.js can also
// trigger it from handleTileClick for internal catalysts (which
// navigate to a route instead of opening the detail popup). On
// success we call `onSuccess` and close the modal; on failure we
// shake the input and leave the modal open for another try.
let _unlockTarget = null;
let _unlockSuccess = null;
export function openUnlockModal(catalyst, onSuccess) {
  const modal = document.getElementById('unlock-modal');
  if (!modal || !catalyst) return;
  _unlockTarget = catalyst;
  _unlockSuccess = typeof onSuccess === 'function' ? onSuccess : null;
  const sub = document.getElementById('unlock-modal-sub');
  if (sub) sub.textContent = catalyst.title ? '"' + catalyst.title + '"' : '';
  const input = document.getElementById('unlock-modal-input');
  const err = document.getElementById('unlock-modal-error');
  if (input) { input.value = ''; input.classList.remove('shake'); }
  if (err) { err.textContent = ''; err.classList.remove('visible'); }
  modal.classList.add('open');
  setTimeout(() => input?.focus(), 50);
}

export function closeUnlockModal() {
  document.getElementById('unlock-modal')?.classList.remove('open');
  _unlockTarget = null;
  _unlockSuccess = null;
}

async function _attemptUnlock() {
  if (!_unlockTarget) return;
  const input = document.getElementById('unlock-modal-input');
  const err = document.getElementById('unlock-modal-error');
  const attempt = (input?.value || '').trim();
  const stored = (_unlockTarget.lockPassword || '').trim();
  // MD-LOCK-HASH: stored value is either a hash (new) or plaintext
  // (legacy). Hash the attempt and compare against the hash branch;
  // fall back to direct plaintext compare for legacy locks.
  const attemptHash = attempt ? await _hashLockPassword(attempt) : '';
  const matched = attempt && stored && (
    _isHashedLockPassword(stored)
      ? attemptHash === stored
      : attempt === stored
  );
  if (matched) {
    const cb = _unlockSuccess;
    closeUnlockModal();
    try { cb?.(); } catch (e) { console.warn('[unlock] success callback threw:', e); }
    return;
  }
  // Wrong password — shake + error message. Leave the modal open so
  // the user can try again. We re-focus the input after the shake
  // animation clears.
  if (err) {
    err.textContent = 'Incorrect password';
    err.classList.add('visible');
  }
  if (input) {
    input.classList.remove('shake');
    // Force reflow so the animation restarts on repeat attempts.
    void input.offsetWidth;
    input.classList.add('shake');
    input.select();
  }
}

function initUnlockModal() {
  const modal = document.getElementById('unlock-modal');
  if (!modal) return;
  document.getElementById('unlock-modal-close')?.addEventListener('click', closeUnlockModal);
  document.getElementById('unlock-modal-cancel')?.addEventListener('click', closeUnlockModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeUnlockModal(); });
  const form = document.getElementById('unlock-modal-form');
  form?.addEventListener('submit', (e) => { e.preventDefault(); _attemptUnlock(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeUnlockModal();
  });
}

async function _paintCatalystDetail(catalyst) {
  const pop = document.getElementById('cat-detail-popup');
  if (!pop || !catalyst) return;
  _detailCatalyst = catalyst;

  const thumbEl = document.getElementById('cat-detail-thumb');
  if (catalyst.thumbURL) {
    thumbEl.style.backgroundImage = `url("${catalyst.thumbURL}")`;
    thumbEl.classList.remove('no-thumb');
    thumbEl.innerHTML = '';
  } else {
    // MD09: branded fallback — accent gradient background + NodeBlast
    // logo watermark instead of a hidden thumb rectangle.
    thumbEl.style.backgroundImage = '';
    thumbEl.classList.add('no-thumb');
    thumbEl.innerHTML = '<svg class="cat-detail-thumb-placeholder" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 234.6" aria-hidden="true">'
      + '<g fill="currentColor">'
      + '<path d="M0,117.3s.7,28.6,19,46c18.3,17.4,45.1,18.1,45.1,18.1,35.3,0,64-28.7,64-64s28.6-64,64-64h.6c15.1,0,24.6-16.1,17.1-29.2C201.1,9.2,185.2,0,167.9,0h-79.7c-17.3,0-33.3,9.2-41.9,24.2,0,0-22.5,38.9-27.8,48.1C13.2,81.5,0,99.7,0,117.3ZM40,115.8c.8-12,10.5-21.6,22.4-22.4,14.5-.9,26.4,11,25.5,25.5-.8,12-10.5,21.6-22.4,22.4-14.5.9-26.4-11-25.5-25.5Z"/>'
      + '<path fill-opacity="0.5" d="M46.2,210.4c8.7,15,24.6,24.2,41.9,24.2h79.7c17.3,0,33.3-9.2,41.9-24.2,0,0,22.5-38.9,27.8-48.1,5.3-9.2,18.5-27.4,18.5-45,0,0,.2-28.5-19.8-46.7-20-18.2-44.3-17.4-44.3-17.4-35.3,0-64,28.7-64,64s-28.6,64-64,64h-.6c-15.1,0-24.6,16.1-17.1,29.2h0ZM168.1,115.7c.8-12,10.5-21.6,22.4-22.4,14.5-.9,26.4,11,25.5,25.5-.8,12-10.5,21.6-22.4,22.4-14.5.9-26.4-11-25.5-25.5Z"/>'
      + '</g></svg>';
  }
  thumbEl.style.display = 'block';
  const accent = catalyst.accentColor || '#5AAA72';
  thumbEl.style.setProperty('--accent', accent);
  // MD03/MD05: tint the detail card with the catalyst's accent so
  // primary actions (Open button, active vote pill, status dot, top
  // border) reflect the catalyst's color rather than the global theme.
  const cardEl = document.getElementById('cat-detail-card');
  if (cardEl) {
    cardEl.style.setProperty('--cat-accent', accent);
    cardEl.style.borderTopColor = accent;
  }

  document.getElementById('cat-detail-title').textContent = catalyst.title;
  // MD09: empty state handled purely via CSS (#cat-detail-desc:empty::before)
  document.getElementById('cat-detail-desc').textContent = catalyst.description || '';

  // Status badge next to the title. Legacy catalysts without a status
  // default to 'live' so they don't suddenly render as WIP.
  const status = STATUSES.includes(catalyst.status) ? catalyst.status : DEFAULT_STATUS;
  const statusEl = document.getElementById('cat-detail-status');
  if (statusEl) {
    const labelMap = { live: 'Live', early: 'Early', placeholder: 'WIP' };
    // MD05: live dot now picks up the catalyst's accent color.
    // MD#1-NB (this batch): accent comes from catalyst.accentColor (remote).
    // safeHex rejects CSS-injection payloads. var(--tx3) is intentionally
    // outside the safeHex check — it's a hardcoded var ref, not a hex.
    const colorMap = { live: safeHex(accent), early: '#E8853A', placeholder: 'var(--tx3)' };
    statusEl.dataset.status = status;
    statusEl.innerHTML = `<span class="cat-status-dot" style="background:${colorMap[status]}"></span>${labelMap[status]}`;
    statusEl.classList.add('visible');
  }

  const creator = document.getElementById('cat-detail-creator');
  const hex = catalyst.ownerHex || '5aaa72';
  const isOwnCatalyst = !!(State.user && catalyst.ownerId === State.user.uid);
  if (isOwnCatalyst) {
    // MD10: for your own catalyst, show a compact "Your Catalyst" chip
    // instead of the full creator row (no point rendering your own
    // avatar + hex back at yourself).
    creator.innerHTML = '<span class="cat-detail-own-badge">'
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
      + 'Your Catalyst'
      + '</span>';
    creator.style.cursor = 'default';
    creator.onclick = null;
  } else {
    const unameHtml = renderUsername(catalyst.ownerName || 'anon', '#' + hex, !!catalyst.ownerIsAdmin);
    // MD04: hex-shaped owner avatar (matches the design language used on
    // community cards and profile bars). Falls back to the initial on the
    // hex-color fill when there's no profile photo.
    const ownerInitial = (catalyst.ownerName || 'A').charAt(0).toUpperCase();
    const ownerAvatarContent = catalyst.ownerPhoto
      ? `<img src="${catalyst.ownerPhoto}" alt="" class="cat-detail-creator-photo">`
      : `<span class="cat-detail-creator-initial">${ownerInitial}</span>`;
    creator.innerHTML = `
      <div class="cat-detail-creator-hex-wrap">
        <svg class="cat-detail-creator-hex-bg" viewBox="0 0 100 115" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <polygon points="50,2 98,26.5 98,88.5 50,113 2,88.5 2,26.5" fill="#${hex}" stroke="none"/>
        </svg>
        <div class="cat-detail-creator-hex-inner">
          ${ownerAvatarContent}
        </div>
      </div>
      <div class="cat-detail-creator-info">
        <span class="cat-detail-creator-name">${unameHtml}</span>
        <span class="cat-detail-creator-hex-label" style="color:#${hex}">#${hex}</span>
      </div>
    `;
    creator.style.cursor = 'pointer';
    creator.onclick = () => {
      const ownerName = (catalyst.ownerName || 'anon').toLowerCase();
      closeCatalystDetail();
      navigate('/' + buildUserSlug(ownerName, catalyst.ownerHex || ''));
    };
  }

  document.getElementById('cat-detail-category').textContent = catalyst.category || 'sites';
  document.getElementById('cat-detail-platform').textContent = catalyst.platform || 'web';

  // Collaborator row + expandable list. Owner is implicit (always
  // shows first); the catalyst doc's collaborators array stores the
  // additional contributors. Click the row to toggle the list.
  // MD30: use devCount when devMode is 'co' so the label reflects
  // the user-stated headcount (which can exceed the named collabs).
  // Pill rendering reuses the rich/basic split from MD29.
  const collabRow = document.getElementById('cat-detail-collab');
  const collabText = document.getElementById('cat-detail-collab-text');
  const collabList = document.getElementById('cat-detail-collab-list');
  const extras = Array.isArray(catalyst.collaborators) ? catalyst.collaborators : [];
  const totalCollabs = (catalyst.devMode === 'co' && typeof catalyst.devCount === 'number' && catalyst.devCount > 1)
    ? catalyst.devCount
    : 1 + extras.length;
  if (collabText) {
    collabText.textContent = totalCollabs === 1 ? '1 contributor' : totalCollabs + ' contributors';
  }
  if (collabRow) {
    collabRow.dataset.expanded = 'false';
    collabRow.style.cursor = totalCollabs > 1 ? 'pointer' : 'default';
  }
  if (collabList) {
    collabList.classList.remove('visible');
    if (totalCollabs > 1) {
      const ownerName = catalyst.ownerName || 'anon';
      const ownerHex = catalyst.ownerHex || '5aaa72';
      const ownerPhoto = catalyst.ownerPhoto || '';
      const buildAv = (photo, initial, borderHex) => {
        const inner = photo
          ? `<img src="${escapeHtml(photo)}" alt="">`
          : escapeHtml(initial);
        return `<div class="cat-detail-collab-avatar" style="border-color:#${escapeHtml(borderHex)}">${inner}</div>`;
      };
      const personSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="8" r="4"/><path d="M20 21c0-3.87-3.58-7-8-7s-8 3.13-8 7z"/></svg>';
      const rows = [
        // Owner — always first, rich pill style
        `<div class="cat-detail-collab-item owner">
           ${buildAv(ownerPhoto, (ownerName||'A').charAt(0).toUpperCase(), ownerHex)}
           <div class="cat-detail-collab-name">${escapeHtml(ownerName)}<span class="cat-detail-collab-role">owner</span></div>
         </div>`,
        ...extras.map((c) => {
          if (c.type === 'unregistered') {
            const nm = c.name || c.displayName || 'anon';
            return `<div class="cat-detail-collab-item basic">
              <div class="cat-detail-collab-avatar basic-avatar">${personSvg}</div>
              <div class="cat-detail-collab-name">${escapeHtml(nm)}</div>
            </div>`;
          }
          const name = c.displayName || 'anon';
          const hex = c.hexCode || '5aaa72';
          const photo = c.photoURL || '';
          return `<div class="cat-detail-collab-item">
            ${buildAv(photo, (name||'A').charAt(0).toUpperCase(), hex)}
            <div class="cat-detail-collab-name">${escapeHtml(name)}<span class="cat-detail-collab-hex">#${escapeHtml(hex)}</span></div>
          </div>`;
        }),
      ];
      collabList.innerHTML = rows.join('');
    } else {
      collabList.innerHTML = '';
    }
  }

  // URL display row with copy button. Shows domain text (linking to
  // the full URL) + a small clipboard button. Hidden entirely for
  // placeholder catalysts with no URL.
  const urlRow = document.getElementById('cat-detail-url-row');
  const urlLink = document.getElementById('cat-detail-url-text');
  const urlCopy = document.getElementById('cat-detail-url-copy');
  if (urlRow && urlLink) {
    if (catalyst.url) {
      urlRow.style.display = '';
      urlLink.textContent = safeDomain(catalyst.url);
      urlLink.href = catalyst.url;
    } else {
      urlRow.style.display = 'none';
      urlLink.textContent = '';
      urlLink.removeAttribute('href');
    }
  }
  if (urlCopy) {
    urlCopy.onclick = async (e) => {
      e.preventDefault();
      if (!catalyst.url) return;
      try {
        await navigator.clipboard.writeText(catalyst.url);
        urlCopy.classList.add('copied');
        setTimeout(() => urlCopy.classList.remove('copied'), 1200);
      } catch {
        toast(catalyst.url);
      }
    };
  }

  // Open button: hidden entirely for placeholder catalysts with no URL,
  // "Open (Early — may have bugs)" for early-stage catalysts, standard
  // text otherwise.
  const openBtn = document.getElementById('cat-detail-open');
  if (!catalyst.url) {
    openBtn.style.display = 'none';
    openBtn.onclick = null;
  } else {
    openBtn.style.display = '';
    if (status === 'early') {
      openBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Open (Early — may have bugs)
      `;
    } else {
      openBtn.innerHTML = `
        Open Project
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      `;
    }
    openBtn.onclick = () => window.open(catalyst.url, '_blank', 'noopener');
  }

  _myVote = await getMyVote(catalyst.id);
  _renderVoteButtons();
  _renderViewCount();

  // MD03: pin button — hidden on own catalysts + for guests. For every
  // other viewer, reflect the current pin state.
  const pinBtn = document.getElementById('cat-detail-pin-btn');
  const pinLabel = document.getElementById('cat-detail-pin-label');
  if (pinBtn) {
    const isOwnCatalyst = !!(State.user && catalyst.ownerId === State.user.uid);
    const isGuest = !State.user;
    if (isOwnCatalyst || isGuest) {
      pinBtn.style.display = 'none';
    } else {
      pinBtn.style.display = '';
      const alreadyPinned = !!(_pinCallbacks.isPinned && _pinCallbacks.isPinned(catalyst.id));
      pinBtn.classList.toggle('pinned', alreadyPinned);
      if (pinLabel) pinLabel.textContent = alreadyPinned ? 'Pinned' : 'Pin Catalyst';
      pinBtn.setAttribute('data-tip', alreadyPinned ? 'Unpin from your profile' : 'Pin to your profile');
    }
  }

  pop.classList.add('open');

  // Fire-and-forget view count increment
  try {
    updateDoc(doc(db, 'catalysts', catalyst.id), { viewCount: increment(1) })
      .catch((err) => console.warn('[catalysts] viewCount increment failed:', err));
    catalyst.viewCount = (catalyst.viewCount || 0) + 1;
    _renderViewCount();
  } catch {}
}

function _renderViewCount() {
  if (!_detailCatalyst) return;
  const el = document.getElementById('cat-detail-view-count');
  const labelEl = document.getElementById('cat-detail-view-label');
  const count = _detailCatalyst.viewCount || 0;
  if (el) el.textContent = count;
  if (labelEl) labelEl.textContent = count === 1 ? 'view' : 'views';
}

export function closeCatalystDetail() {
  document.getElementById('cat-detail-popup')?.classList.remove('open');
  _detailCatalyst = null;
  _myVote = null;
}

export function initCatalystDetail(callbacks = {}) {
  // MD03: store pin/unpin/isPinned callbacks so the detail popup can
  // toggle pinned state without a direct tracked.js import.
  _pinCallbacks = {
    onPin: callbacks.onPin || null,
    onUnpin: callbacks.onUnpin || null,
    isPinned: callbacks.isPinned || null,
  };
  const pop = document.getElementById('cat-detail-popup');
  if (!pop) return;
  document.getElementById('cat-detail-close')?.addEventListener('click', closeCatalystDetail);

  // MD03: pin button inside the detail popup.
  document.getElementById('cat-detail-pin-btn')?.addEventListener('click', () => {
    if (!_detailCatalyst) return;
    if (!State.user) { toast('Sign in to pin catalysts'); return; }
    const btn = document.getElementById('cat-detail-pin-btn');
    const label = document.getElementById('cat-detail-pin-label');
    const isPinned = btn?.classList.contains('pinned');
    if (isPinned) {
      _pinCallbacks.onUnpin?.(_detailCatalyst.id);
      btn?.classList.remove('pinned');
      if (label) label.textContent = 'Pin Catalyst';
      btn?.setAttribute('data-tip', 'Pin to your profile');
      toast('Catalyst unpinned');
    } else {
      _pinCallbacks.onPin?.(_detailCatalyst);
      btn?.classList.add('pinned');
      if (label) label.textContent = 'Pinned';
      btn?.setAttribute('data-tip', 'Unpin from your profile');
      toast('Catalyst pinned!');
    }
  });
  pop.addEventListener('click', (e) => { if (e.target === pop) closeCatalystDetail(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop.classList.contains('open')) closeCatalystDetail();
  });

  // Collaborator row click → toggle the chip list visibility. Only
  // expandable when there's more than just the owner.
  document.getElementById('cat-detail-collab')?.addEventListener('click', (e) => {
    const row = e.currentTarget;
    const list = document.getElementById('cat-detail-collab-list');
    if (!row || !list || !list.children.length) return;
    const isOpen = row.dataset.expanded === 'true';
    row.dataset.expanded = isOpen ? 'false' : 'true';
    list.classList.toggle('visible', !isOpen);
  });

  document.getElementById('cat-vote-fire')?.addEventListener('click', async (e) => {
    if (!_detailCatalyst) return;
    // Guest tap → toast instead of silent failure. Owner self-votes
    // are blocked at the button-disabled level + inside the transaction.
    if (!State.user) { toast('Sign in to vote'); return; }
    if (e.currentTarget.disabled) return;
    const result = await voteCatalyst(_detailCatalyst.id, 'fire');
    if (result) {
      _myVote = result.type;
      _detailCatalyst.fireCount = result.fireCount;
      _detailCatalyst.frostCount = result.frostCount;
      _renderVoteButtons();
    }
  });
  document.getElementById('cat-vote-frost')?.addEventListener('click', async (e) => {
    if (!_detailCatalyst) return;
    if (!State.user) { toast('Sign in to vote'); return; }
    if (e.currentTarget.disabled) return;
    const result = await voteCatalyst(_detailCatalyst.id, 'frost');
    if (result) {
      _myVote = result.type;
      _detailCatalyst.fireCount = result.fireCount;
      _detailCatalyst.frostCount = result.frostCount;
      _renderVoteButtons();
    }
  });
}

export { safeDomain };
