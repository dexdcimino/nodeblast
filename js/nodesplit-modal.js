// ══════════════════════════════════════
//  NodeBlast — NODESPLIT MODAL (NS-02)
//  Phone-frame swipe feed, voting, comments, create sheet.
// ══════════════════════════════════════

import State from './state.js';
import { toast } from './ui-events.js';
import {
  fetchQuestions, subscribeQuestionCounts, castVote,
  getMyVotes, postQuestion, fetchComments, postComment,
  subscribeComments, seedNodeSplitQuestions, seedNodeSplitQuestionsBatch2,
} from './nodesplit-data.js';

let _open = false;
let _questions = [];
let _myVotes = new Map();
let _liveCounts = new Map();
let _countUnsubs = new Map();
let _commentUnsub = null;
let _currentCommentQId = null;
let _activeIndex = 0;
let _activeCategory = null;
let _escHandler = null;
let _timeInterval = null;
let _wired = false;

function _esc(id) { return document.getElementById(id); }

function _activeQ() { return _questions[_activeIndex] || null; }

function _updateTime() {
  const el = _esc('ns-status-time');
  if (el) {
    const d = new Date();
    el.textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }
}

// ── Card rendering ──

function _renderCards() {
  const feed = _esc('ns-feed');
  if (!feed) return;
  const empty = _esc('ns-empty');
  // Remove old cards (keep the empty placeholder)
  feed.querySelectorAll('.ns-card').forEach(c => c.remove());
  if (_questions.length === 0) {
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  _questions.forEach((q) => {
    const card = document.createElement('div');
    card.className = 'ns-card';
    card.dataset.questionId = q.id;

    const myOpt = _myVotes.get(q.id) || null;
    const counts = _liveCounts.get(q.id) || {};
    const total = Object.values(counts).reduce((s, v) => s + (v || 0), 0) || q.totalVotes || 0;

    card.innerHTML = `
      <div class="ns-card-top">
        <div class="ns-card-meta">
          <span class="ns-card-author" style="color:#${q.authorHex || '5aaa72'}">@${_e(q.authorName || 'anon')}</span>
          <span class="ns-card-category">${_e(q.category || 'general')}</span>
        </div>
        <div class="ns-card-question">${_e(q.text)}</div>
        <div class="ns-card-votes-total"><span id="ns-total-${q.id}">${total}</span> votes</div>
      </div>
      <div class="ns-card-bottom">
        <div class="ns-options" id="ns-options-${q.id}">
          ${(q.options || []).map((o, i) => {
            const cnt = counts[o.id] || 0;
            const pct = total > 0 ? Math.round(cnt / total * 100) : 0;
            const voted = myOpt === o.id;
            const opac = 1 - i * 0.15;
            return `<button class="ns-option ${voted ? 'ns-option-voted' : ''}" data-option-id="${o.id}" style="--bar-opacity:${opac}">
              <div class="ns-option-bar" style="width:${pct}%"></div>
              <span class="ns-option-text">${_e(o.text)}</span>
              <span class="ns-option-count">${cnt}</span>
            </button>`;
          }).join('')}
        </div>
      </div>
    `;
    feed.appendChild(card);
  });

  // Wire option clicks via delegation
  feed.querySelectorAll('.ns-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.ns-card');
      if (!card) return;
      _handleVote(card.dataset.questionId, btn.dataset.optionId);
    });
  });

  // Subscribe to counts for first few visible cards
  _questions.slice(0, 4).forEach(q => _ensureCountSub(q.id));
}

function _e(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function _updateCardCounts(qId) {
  const counts = _liveCounts.get(qId) || {};
  const total = Object.values(counts).reduce((s, v) => s + (v || 0), 0);
  const totalEl = document.getElementById('ns-total-' + qId);
  if (totalEl) totalEl.textContent = total;

  const myOpt = _myVotes.get(qId) || null;
  const optionsEl = document.getElementById('ns-options-' + qId);
  if (!optionsEl) return;
  optionsEl.querySelectorAll('.ns-option').forEach(btn => {
    const oid = btn.dataset.optionId;
    const cnt = counts[oid] || 0;
    const pct = total > 0 ? Math.round(cnt / total * 100) : 0;
    btn.querySelector('.ns-option-bar').style.width = pct + '%';
    btn.querySelector('.ns-option-count').textContent = cnt;
    btn.classList.toggle('ns-option-voted', myOpt === oid);
  });
}

function _ensureCountSub(qId) {
  if (_countUnsubs.has(qId)) return;
  const unsub = subscribeQuestionCounts(qId, ({ counts }) => {
    _liveCounts.set(qId, counts);
    _updateCardCounts(qId);
  });
  _countUnsubs.set(qId, unsub);
}

// ── Voting ──

async function _handleVote(qId, optId) {
  if (!State.user) { toast('Sign in to vote'); return; }
  const prev = _myVotes.get(qId);
  _myVotes.set(qId, prev === optId ? null : optId);
  _updateCardCounts(qId);
  try {
    const res = await castVote(qId, optId);
    _myVotes.set(qId, res.optionId);
    _updateCardCounts(qId);
  } catch {
    _myVotes.set(qId, prev);
    _updateCardCounts(qId);
    toast('Vote failed');
  }
}

// ── Comments ──

function _openComments(qId) {
  const panel = _esc('ns-comments-panel');
  if (!panel) return;
  _currentCommentQId = qId;
  panel.classList.add('open');
  const list = _esc('ns-comments-list');
  if (list) list.innerHTML = '<div class="ns-comment-item" style="color:#555">Loading…</div>';
  // Auth gate
  const gate = _esc('ns-comments-auth-gate');
  const comp = _esc('ns-comment-composer');
  if (gate && comp) {
    gate.style.display = State.user ? 'none' : '';
    comp.style.display = State.user ? '' : 'none';
  }
  if (_commentUnsub) { _commentUnsub(); _commentUnsub = null; }
  _commentUnsub = subscribeComments(qId, (comments) => {
    if (!list) return;
    if (comments.length === 0) { list.innerHTML = '<div style="color:#555;text-align:center;padding:24px">No comments yet</div>'; return; }
    list.innerHTML = comments.map(c => `<div class="ns-comment-item"><div class="ns-comment-author" style="color:#${_e(c.authorHex || '5aaa72')}">@${_e(c.authorName || 'anon')}</div><div class="ns-comment-text">${_e(c.text)}</div></div>`).join('');
    list.scrollTop = list.scrollHeight;
  });
  // Update rail count
  const q = _questions.find(q => q.id === qId);
  const countEl = _esc('ns-comment-count');
  if (countEl && q) countEl.textContent = q.commentCount || 0;
}

function _closeComments() {
  const panel = _esc('ns-comments-panel');
  if (panel) panel.classList.remove('open');
  if (_commentUnsub) { _commentUnsub(); _commentUnsub = null; }
  _currentCommentQId = null;
}

async function _sendComment() {
  if (!State.user || !_currentCommentQId) return;
  const input = _esc('ns-comment-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try { await postComment(_currentCommentQId, text); } catch { toast('Comment failed'); }
}

// ── Create sheet ──

function _openCreate() {
  if (!State.user) { toast('Sign in to create a question'); return; }
  const sheet = _esc('ns-create-sheet');
  if (sheet) sheet.classList.add('open');
}

function _closeCreate() {
  const sheet = _esc('ns-create-sheet');
  if (sheet) sheet.classList.remove('open');
}

async function _submitQuestion() {
  const text = _esc('ns-question-text')?.value?.trim() || '';
  const catBtn = document.querySelector('#ns-create-cat-pills .ns-cat-pill.selected');
  const category = catBtn?.dataset.cat || 'general';
  const optEls = document.querySelectorAll('#ns-options-list .ns-option-row input');
  const options = Array.from(optEls).map(el => el.value.trim()).filter(Boolean);
  const errEl = _esc('ns-create-error');
  if (errEl) errEl.textContent = '';
  try {
    const q = await postQuestion({ text, options, category });
    _questions.unshift(q);
    _closeCreate();
    _renderCards();
    // Reset form
    if (_esc('ns-question-text')) _esc('ns-question-text').value = '';
    optEls.forEach(el => { el.value = ''; });
    toast('Question posted!');
  } catch (err) {
    if (errEl) errEl.textContent = err.message || 'Failed to post';
  }
}

// ── Scroll snap detection ──

function _onFeedScroll() {
  const feed = _esc('ns-feed');
  if (!feed || _questions.length === 0) return;
  const h = feed.clientHeight;
  if (h === 0) return;
  const idx = Math.round(feed.scrollTop / h);
  if (idx !== _activeIndex && idx >= 0 && idx < _questions.length) {
    _activeIndex = idx;
    _ensureCountSub(_questions[idx].id);
    const countEl = _esc('ns-comment-count');
    if (countEl) countEl.textContent = _questions[idx].commentCount || 0;
  }
}

// ── Wire once ──

function _wireOnce() {
  if (_wired) return;
  _wired = true;

  _esc('ns-close-btn')?.addEventListener('click', closeNodeSplit);
  _esc('ns-comment-btn')?.addEventListener('click', () => {
    const q = _activeQ();
    if (q) _openComments(q.id);
  });
  _esc('ns-comments-close')?.addEventListener('click', _closeComments);
  _esc('ns-send-comment')?.addEventListener('click', _sendComment);
  _esc('ns-comment-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _sendComment(); } });
  _esc('ns-create-btn')?.addEventListener('click', _openCreate);
  _esc('ns-empty-create')?.addEventListener('click', _openCreate);
  _esc('ns-create-close')?.addEventListener('click', _closeCreate);
  _esc('ns-submit-question')?.addEventListener('click', _submitQuestion);
  _esc('ns-question-text')?.addEventListener('input', e => {
    const el = _esc('ns-q-chars');
    if (el) el.textContent = e.target.value.length;
  });

  // Category filter toggle
  _esc('ns-filter-btn')?.addEventListener('click', () => {
    const strip = _esc('ns-category-strip');
    if (strip) strip.style.display = strip.style.display === 'none' ? '' : 'none';
  });
  document.querySelectorAll('#ns-category-strip .ns-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ns-category-strip .ns-cat-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      _activeCategory = btn.dataset.cat === 'all' ? null : btn.dataset.cat;
      _loadFeed();
    });
  });

  // Create sheet category pills
  document.querySelectorAll('#ns-create-cat-pills .ns-cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ns-create-cat-pills .ns-cat-pill').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Add option
  _esc('ns-add-option')?.addEventListener('click', () => {
    const list = _esc('ns-options-list');
    if (!list) return;
    const rows = list.querySelectorAll('.ns-option-row');
    if (rows.length >= 6) return;
    const idx = rows.length;
    const row = document.createElement('div');
    row.className = 'ns-option-row';
    row.innerHTML = `<input type="text" placeholder="Option ${String.fromCharCode(65 + idx)}" maxlength="60"><button class="ns-remove-option">✕</button>`;
    row.querySelector('.ns-remove-option').addEventListener('click', () => row.remove());
    list.appendChild(row);
  });

  // Share button
  _esc('ns-share-btn')?.addEventListener('click', () => {
    const q = _activeQ();
    if (!q) return;
    const url = window.location.origin + '/nodesplit/' + q.id;
    if (navigator.share) navigator.share({ title: q.text, url }).catch(() => {});
    else { navigator.clipboard?.writeText(url); toast('Link copied'); }
  });

  // Feed scroll
  _esc('ns-feed')?.addEventListener('scroll', _onFeedScroll);

  // Backdrop close
  document.querySelector('.ns-backdrop')?.addEventListener('click', closeNodeSplit);
}

async function _loadFeed() {
  // Clear old subs
  _countUnsubs.forEach(u => u());
  _countUnsubs.clear();
  _liveCounts.clear();
  _activeIndex = 0;
  try {
    const res = await fetchQuestions({ category: _activeCategory, sort: 'hot' });
    _questions = res.questions;
    if (State.user && _questions.length) {
      _myVotes = await getMyVotes(_questions.map(q => q.id));
    }
    _renderCards();
  } catch (err) {
    console.warn('[nodesplit] feed load failed:', err);
  }
}

// ── Public API ──

export async function openNodeSplit(title) {
  if (_open) return;
  _open = true;
  const modal = _esc('nodesplit-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  _updateTime();
  _timeInterval = setInterval(_updateTime, 60000);
  _wireOnce();

  _escHandler = (e) => {
    if (e.key === 'Escape' && _open) { e.stopPropagation(); closeNodeSplit(); }
  };
  document.addEventListener('keydown', _escHandler, true);

  await seedNodeSplitQuestions();
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    await seedNodeSplitQuestionsBatch2();
  }
  await _loadFeed();
}

export function closeNodeSplit() {
  if (!_open) return;
  _open = false;
  _closeComments();
  _closeCreate();
  _countUnsubs.forEach(u => u());
  _countUnsubs.clear();
  if (_timeInterval) { clearInterval(_timeInterval); _timeInterval = null; }
  if (_escHandler) { document.removeEventListener('keydown', _escHandler, true); _escHandler = null; }
  const modal = _esc('nodesplit-modal');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
  document.body.style.overflow = '';
}
