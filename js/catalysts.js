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
import { toast, showModal, renderUsername } from './ui-events.js';
import { navigate, buildUserSlug } from './router.js';

const db = getFirestore(app);

export const CATEGORIES = ['games', 'tools', 'creative', 'ai', 'sites', 'wild'];
export const PLATFORMS = ['web', 'mobile', 'both'];
export const STATUSES = ['live', 'early', 'placeholder'];
const DEFAULT_STATUS = 'live';

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
  return onSnapshot(
    q,
    (snap) => callback(sortUserCatalysts(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    (err) => {
      console.warn('[catalysts] user sub error:', err);
      // Fire the callback with an empty array so the UI escapes the
      // skeleton loading state and can render the empty message / + tile.
      // Without this, a missing composite index leaves the grid stuck on
      // skeleton placeholders forever.
      callback([]);
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
export function subscribePublicFeed(category, callback, max = 60) {
  const constraints = [
    where('isPublic', '==', true),
    orderBy('createdAt', 'desc'),
    limit(max),
  ];
  if (category && category !== 'all') {
    constraints.unshift(where('category', '==', category));
  }
  return onSnapshot(
    query(collection(db, 'catalysts'), ...constraints),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.warn('[catalysts] feed sub error:', err);
      callback([]);
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

  const doc1 = {
    ownerId: State.user.uid,
    ownerName: State.profile?.displayName || 'anon',
    ownerUsernameLower: (State.profile?.displayName || 'anon').toLowerCase(),
    ownerHex: State.profile?.hexCode || '5aaa72',
    ownerPhoto: State.profile?.photoURL || '',
    ownerIsAdmin: !!State.profile?.isAdmin,
    title: data.title.slice(0, 40),
    slug,
    url: data.url ? normalizeUrl(data.url) : '',
    description: (data.description || '').slice(0, 500),
    category: CATEGORIES.includes(data.category) ? data.category : 'sites',
    platform: PLATFORMS.includes(data.platform) ? data.platform : 'web',
    status: STATUSES.includes(data.status) ? data.status : DEFAULT_STATUS,
    thumbURL,
    logoURL: '',
    accentColor: data.accentColor || '#5AAA72',
    fireCount: 0,
    frostCount: 0,
    viewCount: 0,
    isPublic: true,
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
    accentColor: data.accentColor || '#5AAA72',
    // Refresh the owner-denormalized fields in case the editor changed
    // their profile between catalyst creation and this edit.
    ownerName: State.profile?.displayName || 'anon',
    ownerUsernameLower: (State.profile?.displayName || 'anon').toLowerCase(),
    ownerHex: State.profile?.hexCode || '5aaa72',
    ownerPhoto: State.profile?.photoURL || '',
    ownerIsAdmin: !!State.profile?.isAdmin,
    updatedAt: serverTimestamp(),
  };

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
    toast('Vote failed');
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

export function openCatalystModal(existing = null) {
  const modal = document.getElementById('cat-modal');
  if (!modal) return;
  _editingId = existing?.id || null;
  _pendingFile = null;
  _accentColor = existing?.accentColor || '#' + (State.profile?.hexCode || '5AAA72');

  document.getElementById('cat-modal-title').textContent = existing ? 'Edit Catalyst' : 'New Catalyst';
  _applyStatus(existing?.status || DEFAULT_STATUS);
  document.getElementById('cat-title').value = existing?.title || '';
  document.getElementById('cat-url').value = existing?.url || '';
  document.getElementById('cat-desc').value = existing?.description || '';
  _setPills('cat-category-pills', existing?.category || 'sites');
  _setPills('cat-platform-pills', existing?.platform || 'web');
  _setThumbPreview(existing?.thumbURL || '');
  _updateAccentBtn();

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

  document.getElementById('cat-submit-btn')?.addEventListener('click', async () => {
    const title = document.getElementById('cat-title').value.trim();
    const url = document.getElementById('cat-url').value.trim();
    _clearUrlError();
    if (!title) { toast('Title required'); return; }
    // URL is optional for "placeholder" (WIP) catalysts, required otherwise.
    const urlRequired = _status !== 'placeholder';
    if (urlRequired && !url) { _showUrlError('URL required'); return; }
    if (url && !isValidUrl(url)) { _showUrlError('Enter a valid URL (e.g. example.com)'); return; }
    const data = {
      title,
      url,
      description: document.getElementById('cat-desc').value.trim(),
      category: _getPill('cat-category-pills') || 'sites',
      platform: _getPill('cat-platform-pills') || 'web',
      status: _status,
      accentColor: _accentColor,
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

  // Collaborator placeholder — the data model has no collaborators list
  // yet (MD6/future will add it). Default to 1 (the owner) so the row
  // always displays something meaningful.
  const collabText = document.getElementById('cat-detail-collab-text');
  if (collabText) {
    const count = Array.isArray(catalyst.collaborators) ? catalyst.collaborators.length : 1;
    collabText.textContent = count === 1 ? '1 contributor' : count + ' contributors';
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

  document.getElementById('cat-vote-fire')?.addEventListener('click', async () => {
    if (!_detailCatalyst) return;
    const result = await voteCatalyst(_detailCatalyst.id, 'fire');
    if (result) {
      _myVote = result.type;
      _detailCatalyst.fireCount = result.fireCount;
      _detailCatalyst.frostCount = result.frostCount;
      _renderVoteButtons();
    }
  });
  document.getElementById('cat-vote-frost')?.addEventListener('click', async () => {
    if (!_detailCatalyst) return;
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
