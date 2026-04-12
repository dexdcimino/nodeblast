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
import { toast, showModal, renderUsername, escapeHtml } from './ui-events.js';
import { navigate, buildUserSlug } from './router.js';
import { searchUsers } from './users.js';

const db = getFirestore(app);

export const CATEGORIES = ['games', 'tools', 'creative', 'ai', 'sites', 'wild'];
export const PLATFORMS = ['web', 'mobile', 'both'];
export const STATUSES = ['live', 'early', 'placeholder'];
const DEFAULT_STATUS = 'live';
// MD12: external = points to a URL off-site (existing behavior),
// internal = opens a dedicated on-site workspace at /name.hex/slug.
// Default is external so legacy catalysts keep working unchanged.
export const CATALYST_TYPES = ['external', 'internal'];
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
export function subscribePublicFeed(category, callback, max = 60) {
  const constraints = [
    where('isPublic', '==', true),
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
  } catch (err) {
    console.warn('[catalysts] reorderCatalysts failed:', err);
    throw err;
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
    thumbURL,
    logoURL: '',
    accentColor: data.accentColor || '#5AAA72',
    fireCount: 0,
    frostCount: 0,
    viewCount: 0,
    isPublic: true,
    collaborators,
    collaboratorCount: 1 + collaborators.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(catRef, doc1);
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
    accentColor: data.accentColor || '#5AAA72',
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
}

export async function deleteCatalyst(id) {
  if (!State.user) throw new Error('Not signed in');
  await deleteCatalystThumb(State.user.uid, id);
  await deleteDoc(doc(db, 'catalysts', id));
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
let _status = DEFAULT_STATUS;
let _type = DEFAULT_TYPE;
// Working set of collaborators while the edit modal is open. Each
// entry: { uid, displayName, hexCode, photoURL, isAdmin }. Owner is
// NOT included (it's implicit). Reset on every modal open.
let _editingCollabs = [];
let _collabSearchT = null;

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
function _applyType(type) {
  _type = CATALYST_TYPES.includes(type) ? type : DEFAULT_TYPE;
  document.querySelectorAll('#cat-type-pick .cat-type-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.type === _type);
  });
  const urlField = document.getElementById('cat-url-field');
  const internalMsg = document.getElementById('cat-internal-msg');
  if (urlField)    urlField.style.display    = _type === 'internal' ? 'none' : '';
  if (internalMsg) internalMsg.style.display = _type === 'internal' ? 'block' : 'none';
}

function _updateAccentBtn() {
  const btn = document.getElementById('cat-accent-preview');
  if (btn) btn.style.background = _accentColor;
}

function _setThumbPreview(src) {
  const drop = document.getElementById('cat-thumb-drop');
  if (!drop) return;
  if (src) {
    drop.classList.add('has-img');
    drop.style.backgroundImage = `url("${src}")`;
    drop.innerHTML = '<div class="cat-thumb-hint">Click to replace</div>';
  } else {
    drop.classList.remove('has-img');
    drop.style.backgroundImage = '';
    drop.innerHTML = '<div class="cat-thumb-hint">Drop image or click to upload</div>';
  }
}

// Render the working collaborators list as a chip stack. The owner
// gets a non-removable chip first; each working collaborator gets a
// removable chip after.
function _renderCollabChips() {
  const list = document.getElementById('cat-collab-list');
  if (!list) return;
  list.innerHTML = '';

  // Owner chip — pulled from State.profile, since the owner is always
  // the editing user (only owners can open this modal in edit mode).
  const ownerName = State.profile?.displayName || 'anon';
  const ownerHex = State.profile?.hexCode || '5aaa72';
  const ownerPhoto = State.profile?.photoURL || '';
  const ownerInitial = escapeHtml((ownerName || 'A').charAt(0).toUpperCase());
  const ownerAvatarInner = ownerPhoto
    ? `<img src="${escapeHtml(ownerPhoto)}" alt="">`
    : ownerInitial;
  const ownerChip = document.createElement('span');
  ownerChip.className = 'cat-collab-chip owner';
  ownerChip.style.setProperty('--chip-hex', '#' + ownerHex);
  ownerChip.innerHTML = `
    <span class="cat-collab-chip-avatar">${ownerAvatarInner}</span>
    <span class="cat-collab-chip-name">${escapeHtml(ownerName)}</span>
    <span class="cat-collab-chip-hex">#${escapeHtml(ownerHex)}</span>
  `;
  list.appendChild(ownerChip);

  _editingCollabs.forEach((c, i) => {
    const initial = escapeHtml((c.displayName || 'A').charAt(0).toUpperCase());
    const avatarInner = c.photoURL
      ? `<img src="${escapeHtml(c.photoURL)}" alt="">`
      : initial;
    const chip = document.createElement('span');
    chip.className = 'cat-collab-chip';
    chip.style.setProperty('--chip-hex', '#' + (c.hexCode || '5aaa72'));
    chip.innerHTML = `
      <span class="cat-collab-chip-avatar">${avatarInner}</span>
      <span class="cat-collab-chip-name">${escapeHtml(c.displayName || 'anon')}</span>
      <span class="cat-collab-chip-hex">#${escapeHtml(c.hexCode || '5aaa72')}</span>
      <button type="button" class="cat-collab-remove" data-idx="${i}" aria-label="Remove collaborator">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    list.appendChild(chip);
  });
}

function _hideCollabResults() {
  const results = document.getElementById('cat-collab-results');
  if (results) {
    results.classList.remove('visible');
    results.innerHTML = '';
  }
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
      <div class="cat-collab-result-avatar" style="border-color:#${escapeHtml(hex)}">${avatarInner}</div>
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
      });
      _renderCollabChips();
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
  _editingId = existing?.id || null;
  _pendingFile = null;
  _accentColor = existing?.accentColor || '#' + (State.profile?.hexCode || '5AAA72');

  document.getElementById('cat-modal-title').textContent = existing ? 'Edit Catalyst' : 'New Catalyst';
  _applyStatus(existing?.status || DEFAULT_STATUS);
  _applyType(existing?.type || DEFAULT_TYPE);
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

  document.getElementById('cat-submit-btn').textContent = existing ? 'Save Changes' : 'Create Catalyst';
  document.getElementById('cat-delete-btn').style.display = existing ? 'inline-flex' : 'none';

  modal.classList.add('open');
  setTimeout(() => document.getElementById('cat-title')?.focus(), 50);
}

export function closeCatalystModal() {
  document.getElementById('cat-modal')?.classList.remove('open');
  closeColorPopup();
  _editingId = null;
  _pendingFile = null;
  _editingCollabs = [];
  _hideCollabResults();
  clearTimeout(_collabSearchT);
}

export function initCatalystModal(onSaved) {
  const modal = document.getElementById('cat-modal');
  if (!modal) return;

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
  const collabInput = document.getElementById('cat-collab-input');
  collabInput?.addEventListener('input', () => {
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

  // Chip remove buttons (event delegation on the list).
  document.getElementById('cat-collab-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-collab-remove');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (!Number.isInteger(idx)) return;
    _editingCollabs.splice(idx, 1);
    _renderCollabChips();
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
    const data = {
      title,
      // Internal catalysts don't carry an external URL — always store
      // empty string so stale UI state can't leak into the doc.
      url: _type === 'internal' ? '' : url,
      description: document.getElementById('cat-desc').value.trim(),
      category: _getPill('cat-category-pills') || 'sites',
      platform: _getPill('cat-platform-pills') || 'web',
      status: _status,
      type: _type,
      accentColor: _accentColor,
      collaborators: _editingCollabs.slice(),
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
          onSaved?.();
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
  _detailCatalyst = catalyst;

  const thumbEl = document.getElementById('cat-detail-thumb');
  if (catalyst.thumbURL) {
    thumbEl.style.backgroundImage = `url("${catalyst.thumbURL}")`;
    thumbEl.style.display = 'block';
  } else {
    thumbEl.style.backgroundImage = '';
    thumbEl.style.display = 'none';
  }
  thumbEl.style.setProperty('--accent', catalyst.accentColor || '#5AAA72');

  document.getElementById('cat-detail-title').textContent = catalyst.title;
  document.getElementById('cat-detail-desc').textContent = catalyst.description || '';

  // Status badge next to the title. Legacy catalysts without a status
  // default to 'live' so they don't suddenly render as WIP.
  const status = STATUSES.includes(catalyst.status) ? catalyst.status : DEFAULT_STATUS;
  const statusEl = document.getElementById('cat-detail-status');
  if (statusEl) {
    const labelMap = { live: 'Live', early: 'Early', placeholder: 'WIP' };
    const colorMap = { live: 'var(--clr)', early: '#E8853A', placeholder: 'var(--tx3)' };
    statusEl.dataset.status = status;
    statusEl.innerHTML = `<span class="cat-status-dot" style="background:${colorMap[status]}"></span>${labelMap[status]}`;
    statusEl.classList.add('visible');
  }

  const creator = document.getElementById('cat-detail-creator');
  const hex = catalyst.ownerHex || '5aaa72';
  const unameHtml = renderUsername(catalyst.ownerName || 'anon', '#' + hex, !!catalyst.ownerIsAdmin);
  creator.innerHTML = `
    <div class="cat-detail-creator-avatar" style="border-color:#${hex}">
      ${catalyst.ownerPhoto ? `<img src="${catalyst.ownerPhoto}" alt="">` : ''}
    </div>
    <span>${unameHtml}<span style="color:#${hex}">#${hex}</span></span>
  `;
  creator.style.cursor = 'pointer';
  creator.onclick = () => {
    const ownerName = (catalyst.ownerName || 'anon').toLowerCase();
    closeCatalystDetail();
    navigate('/' + buildUserSlug(ownerName, catalyst.ownerHex || ''));
  };

  document.getElementById('cat-detail-category').textContent = catalyst.category || 'sites';
  document.getElementById('cat-detail-platform').textContent = catalyst.platform || 'web';

  // Collaborator row + expandable list. Owner is implicit (always
  // shows first); the catalyst doc's collaborators array stores the
  // additional contributors. Click the row to toggle the list.
  const collabRow = document.getElementById('cat-detail-collab');
  const collabText = document.getElementById('cat-detail-collab-text');
  const collabList = document.getElementById('cat-detail-collab-list');
  const extras = Array.isArray(catalyst.collaborators) ? catalyst.collaborators : [];
  const totalCollabs = 1 + extras.length;
  if (collabText) {
    collabText.textContent = totalCollabs === 1 ? '1 contributor' : totalCollabs + ' contributors';
  }
  if (collabRow) {
    // Reset to collapsed each time the modal opens.
    collabRow.dataset.expanded = 'false';
    collabRow.style.cursor = totalCollabs > 1 ? 'pointer' : 'default';
  }
  if (collabList) {
    collabList.classList.remove('visible');
    if (totalCollabs > 1) {
      const ownerName = catalyst.ownerName || 'anon';
      const ownerHex = catalyst.ownerHex || '5aaa72';
      const ownerPhoto = catalyst.ownerPhoto || '';
      const ownerInitial = (ownerName || 'A').charAt(0).toUpperCase();
      const buildAvatar = (photo, initial) => photo
        ? `<img src="${escapeHtml(photo)}" alt="">`
        : escapeHtml(initial);
      const rows = [
        `<div class="cat-detail-collab-item owner">
           <div class="cat-detail-collab-avatar" style="border-color:#${escapeHtml(ownerHex)}">${buildAvatar(ownerPhoto, ownerInitial)}</div>
           <div class="cat-detail-collab-name">${escapeHtml(ownerName)}<span class="cat-detail-collab-role">owner</span></div>
         </div>`,
        ...extras.map((c) => {
          const name = c.displayName || 'anon';
          const hex = c.hexCode || '5aaa72';
          const photo = c.photoURL || '';
          return `<div class="cat-detail-collab-item">
            <div class="cat-detail-collab-avatar" style="border-color:#${escapeHtml(hex)}">${buildAvatar(photo, (name || 'A').charAt(0).toUpperCase())}</div>
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

export function initCatalystDetail() {
  const pop = document.getElementById('cat-detail-popup');
  if (!pop) return;
  document.getElementById('cat-detail-close')?.addEventListener('click', closeCatalystDetail);
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
