// ══════════════════════════════════════
//  NodeBlast — NODESPLIT DATA (NS-01)
//  Firestore CRUD + real-time listeners for NodeSplit.
//  No UI — clean data layer for the modal to call.
// ══════════════════════════════════════

import { app } from './firebase-config.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  runTransaction,
  onSnapshot,
  increment,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import State from './state.js';

const db = getFirestore(app);
const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

const CATEGORIES = ['general', 'food', 'tech', 'politics', 'sports', 'random'];

// ── Feed ──

export async function fetchQuestions({ category = null, sort = 'hot', pageLimit = 20, after = null } = {}) {
  const constraints = [where('status', '==', 'active')];
  if (category && CATEGORIES.includes(category)) constraints.push(where('category', '==', category));
  constraints.push(orderBy(sort === 'new' ? 'createdAt' : 'totalVotes', 'desc'));
  constraints.push(limit(pageLimit));
  if (after) constraints.push(startAfter(after));

  const snap = await getDocs(query(collection(db, 'nodesplit_questions'), ...constraints));
  const questions = snap.docs.map(d => ({ id: d.id, ...d.data(), _snap: d }));
  const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
  return { questions, lastDoc };
}

export function subscribeQuestionCounts(questionId, onUpdate) {
  return onSnapshot(doc(db, 'nodesplit_option_counts', questionId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    onUpdate({ counts: data.counts || {}, totalVotes: Object.values(data.counts || {}).reduce((s, v) => s + v, 0) });
  }, (err) => console.warn('[nodesplit] counts sub error:', err));
}

// ── Voting ──

export async function castVote(questionId, optionId) {
  if (!State.user) throw new Error('auth_required');
  const uid = State.user.uid;
  const voteRef = doc(db, 'nodesplit_votes', `${questionId}_${uid}`);
  const qRef = doc(db, 'nodesplit_questions', questionId);
  const cntRef = doc(db, 'nodesplit_option_counts', questionId);

  return await runTransaction(db, async (tx) => {
    const [voteSnap, cntSnap] = await Promise.all([tx.get(voteRef), tx.get(cntRef)]);
    const prevOptionId = voteSnap.exists() ? voteSnap.data().optionId : null;
    const isFirstVote = !voteSnap.exists();
    const isSameOption = prevOptionId === optionId;

    if (isSameOption) {
      tx.delete(voteRef);
      tx.update(cntRef, { [`counts.${optionId}`]: increment(-1) });
      tx.update(qRef, { totalVotes: increment(-1) });
      return { optionId: null };
    }

    tx.set(voteRef, { questionId, uid, optionId, createdAt: serverTimestamp() });
    const updates = { [`counts.${optionId}`]: increment(1) };
    if (prevOptionId) updates[`counts.${prevOptionId}`] = increment(-1);
    tx.update(cntRef, updates);
    if (isFirstVote) tx.update(qRef, { totalVotes: increment(1) });
    return { optionId };
  });
}

export async function getMyVote(questionId) {
  if (!State.user) return null;
  const snap = await getDoc(doc(db, 'nodesplit_votes', `${questionId}_${State.user.uid}`));
  return snap.exists() ? snap.data().optionId : null;
}

export async function getMyVotes(questionIds) {
  if (!State.user || !questionIds.length) return new Map();
  const results = await Promise.all(
    questionIds.map(async (qid) => {
      const snap = await getDoc(doc(db, 'nodesplit_votes', `${qid}_${State.user.uid}`));
      return [qid, snap.exists() ? snap.data().optionId : null];
    })
  );
  return new Map(results);
}

// ── Questions ──

export async function postQuestion({ text, options, category }) {
  if (!State.user) throw new Error('auth_required');
  const trimmed = (text || '').trim();
  if (trimmed.length < 10 || trimmed.length > 120) throw new Error('Question must be 10–120 characters');
  if (!Array.isArray(options) || options.length < 2 || options.length > 6) throw new Error('2–6 options required');
  const cat = CATEGORIES.includes(category) ? category : 'general';

  const optArr = options.map((o, i) => {
    const t = (typeof o === 'string' ? o : o.text || '').trim();
    if (!t || t.length > 60) throw new Error('Each option must be 1–60 characters');
    return { id: String.fromCharCode(97 + i), text: t };
  });

  const qRef = doc(collection(db, 'nodesplit_questions'));
  const cntRef = doc(db, 'nodesplit_option_counts', qRef.id);
  const counts = {};
  optArr.forEach(o => { counts[o.id] = 0; });

  const qDoc = {
    text: trimmed,
    authorId: State.user.uid,
    authorName: State.profile?.displayName || 'anon',
    authorHex: State.profile?.hexCode || '5aaa72',
    category: cat,
    options: optArr,
    totalVotes: 0,
    commentCount: 0,
    createdAt: serverTimestamp(),
    status: 'active',
  };

  await Promise.all([
    setDoc(qRef, qDoc),
    setDoc(cntRef, { questionId: qRef.id, counts }),
  ]);
  return { id: qRef.id, ...qDoc };
}

export async function removeQuestion(questionId) {
  if (!State.user) throw new Error('auth_required');
  const ref = doc(db, 'nodesplit_questions', questionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('not_found');
  const data = snap.data();
  const isAuthor = data.authorId === State.user.uid;
  const isAdmin = !!State.profile?.isAdmin;
  if (!isAuthor && !isAdmin) throw new Error('unauthorized');
  await updateDoc(ref, { status: 'removed' });
}

// ── Comments ──

export async function fetchComments(questionId) {
  const snap = await getDocs(query(
    collection(db, 'nodesplit_comments'),
    where('questionId', '==', questionId),
    orderBy('createdAt', 'asc'),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function postComment(questionId, text) {
  if (!State.user) throw new Error('auth_required');
  const trimmed = (text || '').trim();
  if (!trimmed || trimmed.length > 280) throw new Error('Comment must be 1–280 characters');

  const ref = doc(collection(db, 'nodesplit_comments'));
  await setDoc(ref, {
    questionId,
    authorId: State.user.uid,
    authorName: State.profile?.displayName || 'anon',
    authorHex: State.profile?.hexCode || '5aaa72',
    text: trimmed,
    createdAt: serverTimestamp(),
  });
  // Increment comment count on the question doc
  await updateDoc(doc(db, 'nodesplit_questions', questionId), { commentCount: increment(1) });
  return { id: ref.id };
}

export function subscribeComments(questionId, onUpdate) {
  return onSnapshot(
    query(collection(db, 'nodesplit_comments'), where('questionId', '==', questionId), orderBy('createdAt', 'asc')),
    (snap) => {
      onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    (err) => console.warn('[nodesplit] comments sub error:', err),
  );
}

// ── Seed (dev only) ──

export async function seedNodeSplitQuestions() {
  if (!isLocal) return;
  const snap = await getDocs(query(collection(db, 'nodesplit_questions'), limit(1)));
  if (!snap.empty) return;

  const seeds = [
    { text: 'Pepperoni or cheese pizza?', category: 'food', options: ['Pepperoni', 'Cheese'] },
    { text: 'Would you rather have super speed or flight?', category: 'random', options: ['Super Speed', 'Flight'] },
    { text: 'tabs or spaces?', category: 'tech', options: ['Tabs', 'Spaces', 'Both are fine'] },
    { text: 'Morning person or night owl?', category: 'general', options: ['Morning', 'Night Owl'] },
    { text: 'Dogs or cats?', category: 'general', options: ['Dogs', 'Cats', 'Both', 'Neither'] },
    { text: 'PC or console gaming?', category: 'tech', options: ['PC', 'Console', 'Mobile', "I don't game"] },
  ];

  for (const seed of seeds) {
    const opts = seed.options.map((t, i) => ({ id: String.fromCharCode(97 + i), text: t }));
    const qRef = doc(collection(db, 'nodesplit_questions'));
    const counts = {};
    opts.forEach(o => { counts[o.id] = 0; });
    await setDoc(qRef, {
      text: seed.text,
      authorId: 'system',
      authorName: 'nodeblast.dev',
      authorHex: '000000',
      category: seed.category,
      options: opts,
      totalVotes: 0,
      commentCount: 0,
      createdAt: serverTimestamp(),
      status: 'active',
    });
    await setDoc(doc(db, 'nodesplit_option_counts', qRef.id), { questionId: qRef.id, counts });
  }
  console.log('[nodesplit] seeded 6 questions');
}
