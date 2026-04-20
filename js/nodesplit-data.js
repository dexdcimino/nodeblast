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

// ── Seed batch 2 — personality/lifestyle poll questions ──
const BATCH2_QUESTIONS = [
  {id:'seed2_01',category:'general',text:'Are you more of a morning person or a night owl?',options:['Morning person','Night owl']},
  {id:'seed2_02',category:'random',text:'Would you rather have unlimited free time or unlimited money?',options:['Unlimited free time','Unlimited money']},
  {id:'seed2_03',category:'general',text:'Do you read the comments before or after watching the video?',options:['Before','After']},
  {id:'seed2_04',category:'random',text:"Would you rather know when you'll die or how you'll die?",options:['When','How']},
  {id:'seed2_05',category:'general',text:'How do you feel about small talk?',options:['Love it, easy way to connect','Tolerate it when needed','Actively avoid it']},
  {id:'seed2_06',category:'general',text:'When you travel, what do you plan in advance?',options:['Everything — full itinerary','The big stuff, wing the rest','Just the flight, figure it out there']},
  {id:'seed2_07',category:'random',text:'If you found $20 on the ground in an empty room, you would…',options:['Pocket it, no hesitation','Try to find the owner',"Leave it — not mine to take"]},
  {id:'seed2_08',category:'food',text:"What's your relationship with leftovers?",options:['Eat them immediately, best meal','Reheat within a day or two','They die in the back of the fridge']},
  {id:'seed2_09',category:'general',text:"What's the first thing you do when you wake up?",options:['Check my phone','Shower or wash up','Eat something','Sit in silence for a minute']},
  {id:'seed2_10',category:'random',text:'Pick your superpower:',options:['Fly','Read minds','Teleport','Become invisible']},
  {id:'seed2_11',category:'general',text:"How do you handle a group chat you don't care about?",options:['Mute and ignore forever','Skim occasionally, rarely reply','Leave the chat','Keep up out of guilt']},
  {id:'seed2_12',category:'general',text:"What's your go-to when you can't sleep?",options:['Scroll my phone','Read a book','Watch something','Just lie there and suffer']},
  {id:'seed2_13',category:'general',text:'Pick your ideal weekend:',options:['Out with friends, loud and social','Quiet at home, cozy and alone','Outside — hike, beach, park','Grinding a personal project','Out of town, somewhere new']},
  {id:'seed2_14',category:'general',text:'What do you value most in a friendship?',options:['Loyalty','Shared sense of humor','Deep conversations','Low-maintenance vibes','Being there in hard times']},
  {id:'seed2_15',category:'random',text:'What kind of drunk are you?',options:['Fun drunk — life of the party','Affectionate drunk — I love everyone','Philosophical drunk — deep thoughts only','Sleepy drunk — find me on the couch',"I don't drink"]},
  {id:'seed2_16',category:'random',text:'Pick the petty thing that bothers you most:',options:['People who chew loudly','People who walk slowly in crowds',"People who don't use turn signals",'People who reply "k"','People who are late']},
  {id:'seed2_17',category:'general',text:"What's your primary vibe?",options:['Chaos gremlin','Old soul','Golden retriever energy','Mysterious cat person','Type-A perfectionist','Walking sleep-deprived mess']},
  {id:'seed2_18',category:'general',text:'Pick your dream living situation:',options:['Cabin in the woods','Apartment in a big city','Beachfront somewhere warm','Farm with animals','Mountain town, small but cool','Somewhere nomadic, always moving']},
  {id:'seed2_19',category:'random',text:"What's your biggest ick?",options:['Bad grammar in texts','Wearing socks with sandals','Over-sharing too early','Fake laughing','Talking during movies','Public displays of affection']},
  {id:'seed2_20',category:'random',text:'Which fictional world would you actually want to live in?',options:['Harry Potter','Star Wars','Middle-earth (Lord of the Rings)','Pokémon','Avatar: The Last Airbender','Studio Ghibli movies']},
];

export async function seedNodeSplitQuestionsBatch2() {
  let added = 0, skipped = 0;
  for (const seed of BATCH2_QUESTIONS) {
    const qRef   = doc(db, 'nodesplit_questions', seed.id);
    const cntRef = doc(db, 'nodesplit_option_counts', seed.id);
    const existing = await getDoc(qRef);
    if (existing.exists()) { skipped++; continue; }
    const opts = seed.options.map((t, i) => ({ id: String.fromCharCode(97 + i), text: t }));
    const counts = {};
    opts.forEach(o => { counts[o.id] = 0; });
    await setDoc(qRef, {
      text: seed.text, authorId: 'system', authorName: 'nodeblast.dev', authorHex: '000000',
      category: seed.category, options: opts, totalVotes: 0, commentCount: 0,
      createdAt: serverTimestamp(), status: 'active',
    });
    await setDoc(cntRef, { questionId: seed.id, counts });
    added++;
  }
  console.log('[nodesplit] batch2 seed — added:', added, 'skipped (already existed):', skipped);
  return { added, skipped };
}

if (typeof window !== 'undefined') {
  window._nbSeedNodeSplitBatch2 = seedNodeSplitQuestionsBatch2;
}
