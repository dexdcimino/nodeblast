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
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import State from './state.js';
import { uploadCatalystThumb, deleteCatalystThumb } from './storage.js';
import { openColorPopup, closeColorPopup } from './color.js';
import { toast, showModal } from './ui-events.js';

const db = getFirestore(app);

export const CATEGORIES = ['games', 'tools', 'creative', 'ai', 'sites', 'wild'];
export const PLATFORMS = ['web', 'mobile', 'both'];

function normalizeUrl(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
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
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

export async function createCatalyst(data, file) {
  if (!State.user) throw new Error('Not signed in');
  const catRef = doc(collection(db, 'catalysts'));
  const catId = catRef.id;

  let thumbURL = '';
  if (file) {
    try { thumbURL = await uploadCatalystThumb(State.user.uid, catId, file); }
    catch (err) { console.warn('[catalysts] thumb upload failed:', err); }
  }

  const doc1 = {
    ownerId: State.user.uid,
    ownerName: State.profile?.displayName || 'anon',
    ownerHex: State.profile?.hexCode || '5aaa72',
    ownerPhoto: State.profile?.photoURL || '',
    title: data.title.slice(0, 40),
    url: normalizeUrl(data.url),
    description: (data.description || '').slice(0, 500),
    category: CATEGORIES.includes(data.category) ? data.category : 'sites',
    platform: PLATFORMS.includes(data.platform) ? data.platform : 'web',
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

  const updates = {
    title: data.title.slice(0, 40),
    url: normalizeUrl(data.url),
    description: (data.description || '').slice(0, 500),
    category: CATEGORIES.includes(data.category) ? data.category : 'sites',
    platform: PLATFORMS.includes(data.platform) ? data.platform : 'web',
    accentColor: data.accentColor || '#5AAA72',
    updatedAt: serverTimestamp(),
  };
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

function _setPills(containerId, value) {
  document.querySelectorAll(`#${containerId} .cat-pill`).forEach((b) => {
    b.classList.toggle('selected', b.dataset.val === value);
  });
}
function _getPill(containerId) {
  return document.querySelector(`#${containerId} .cat-pill.selected`)?.dataset.val;
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

  document.getElementById('cat-submit-btn')?.addEventListener('click', async () => {
    const title = document.getElementById('cat-title').value.trim();
    const url = document.getElementById('cat-url').value.trim();
    if (!title) { toast('Title required'); return; }
    if (!url) { toast('URL required'); return; }
    const data = {
      title,
      url,
      description: document.getElementById('cat-desc').value.trim(),
      category: _getPill('cat-category-pills') || 'sites',
      platform: _getPill('cat-platform-pills') || 'web',
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
      toast('Save failed: ' + (err.message || 'unknown'));
    } finally {
      submitBtn.disabled = false;
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

  const creator = document.getElementById('cat-detail-creator');
  const hex = catalyst.ownerHex || '5aaa72';
  creator.innerHTML = `
    <div class="cat-detail-creator-avatar" style="border-color:#${hex}">
      ${catalyst.ownerPhoto ? `<img src="${catalyst.ownerPhoto}" alt="">` : ''}
    </div>
    <span style="color:#${hex}">${catalyst.ownerName || 'anon'}#${hex}</span>
  `;

  document.getElementById('cat-detail-category').textContent = catalyst.category || 'sites';
  document.getElementById('cat-detail-platform').textContent = catalyst.platform || 'web';

  const openBtn = document.getElementById('cat-detail-open');
  openBtn.onclick = () => window.open(catalyst.url, '_blank', 'noopener');

  _myVote = await getMyVote(catalyst.id);
  _renderVoteButtons();

  pop.classList.add('open');
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
