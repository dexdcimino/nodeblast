// ══════════════════════════════════════
//  NodeBlast — CREATOR VOTES (NB-MD09)
//  Fire/poop voting on alchemist creator cards.
//  Collection: creator_votes/{creatorUid}_{voterUid}
//  Aggregate counts live on users/{uid}: fireVoteCount, frostVoteCount
// ══════════════════════════════════════

import { app } from './firebase-config.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import State from './state.js';
import { toast } from './ui-events.js';

const db = getFirestore(app);

// Vote type: 'fire' | 'frost'
export async function voteCreator(creatorUid, type) {
  if (!State.user) { toast('Sign in to vote'); return null; }
  if (creatorUid === State.user.uid) { toast("Can't vote on yourself"); return null; }
  if (type !== 'fire' && type !== 'frost') return null;

  const voterId = State.user.uid;
  const voteRef = doc(db, 'creator_votes', `${creatorUid}_${voterId}`);
  const creatorRef = doc(db, 'users', creatorUid);

  try {
    const snap = await getDoc(voteRef);
    const prev = snap.exists() ? snap.data().type : null;

    if (prev === type) {
      // Toggle off — same vote clicked twice.
      await deleteDoc(voteRef);
      await updateDoc(creatorRef, { [`${type}VoteCount`]: increment(-1) });
      return { type: null };
    }

    // New vote or switching sides.
    await setDoc(voteRef, {
      creatorUid,
      voterId,
      type,
      createdAt: Date.now(),
    });

    const updates = { [`${type}VoteCount`]: increment(1) };
    if (prev) updates[`${prev}VoteCount`] = increment(-1);
    await updateDoc(creatorRef, updates);

    return { type };
  } catch (err) {
    // Creator doc may not have the count fields yet — seed them via merge.
    if (err?.code === 'not-found' || err?.message?.includes('No document')) {
      try {
        await setDoc(creatorRef, {
          fireVoteCount: type === 'fire' ? 1 : 0,
          frostVoteCount: type === 'frost' ? 1 : 0,
        }, { merge: true });
        await setDoc(voteRef, { creatorUid, voterId, type, createdAt: Date.now() });
        return { type };
      } catch (e2) {
        console.warn('[creator-votes] fallback seed failed:', e2);
      }
    }
    console.error('[creator-votes] vote failed:', err?.code, err?.message, err);
    toast('Vote failed');
    return null;
  }
}

// Get the current user's vote for a creator (null if none / signed out).
export async function getMyCreatorVote(creatorUid) {
  if (!State.user) return null;
  try {
    const snap = await getDoc(doc(db, 'creator_votes', `${creatorUid}_${State.user.uid}`));
    return snap.exists() ? snap.data().type : null;
  } catch {
    return null;
  }
}

// Batch-get votes for multiple creators — returns Map<uid, 'fire'|'frost'|null>.
export async function getMyCreatorVotes(creatorUids) {
  if (!State.user || !creatorUids?.length) return new Map();
  const results = new Map();
  await Promise.allSettled(
    creatorUids.map(async (uid) => {
      results.set(uid, await getMyCreatorVote(uid));
    }),
  );
  return results;
}
