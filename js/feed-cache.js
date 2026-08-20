// ══════════════════════════════════════════════════════════════
//  NodeBlast — FEED CACHE
//
//  A local copy of the last public-feed snapshot, so the hex grid can
//  paint real content without waiting on the network.
//
//  Why this exists: the feed query cannot leave the browser until App
//  Check has minted a token, and App Check itself waits on reCAPTCHA
//  Enterprise. Measured cold on nodeblast.dev:
//
//     1891ms  reCAPTCHA enterprise.js requested
//     2615ms  reCAPTCHA anchor  ──┐  ~2.1s attestation
//     4770ms  App Check token   ──┘
//     5084ms  first Firestore request
//     5580ms  first tile on screen
//
//  Nothing in that chain is under our control, and none of it is
//  needed to draw a grid we already have the data for. Painting from
//  this cache moves first content to the moment the modules finish
//  loading; the live snapshot then swaps in behind it.
// ══════════════════════════════════════════════════════════════

const KEY = 'nb-feed-cache-v1';
const MAX_ENTRIES = 160;

// Only the fields the tile and card renderers actually read — anything
// else is dead weight on disk. Note lockPassword: the real value stays
// in memory and is reduced to a presence flag here, because a cache
// entry is written to disk and a password must never be.
function trim(cat) {
  return {
    id: cat.id,
    title: cat.title || '',
    slug: cat.slug || '',
    url: cat.url || '',
    type: cat.type || '',
    gameId: cat.gameId || null,
    category: cat.category || '',
    status: cat.status || 'live',
    accentColor: cat.accentColor || '',
    thumbURL: cat.thumbURL || '',
    ownerId: cat.ownerId || '',
    ownerName: cat.ownerName || '',
    ownerHex: cat.ownerHex || '',
    ownerPhoto: cat.ownerPhoto || '',
    ownerIsAdmin: !!cat.ownerIsAdmin,
    ownerSocialLinks: Array.isArray(cat.ownerSocialLinks) ? cat.ownerSocialLinks : [],
    ownerFireVoteCount: cat.ownerFireVoteCount,
    ownerFrostVoteCount: cat.ownerFrostVoteCount,
    fireCount: cat.fireCount || 0,
    frostCount: cat.frostCount || 0,
    sortOrder: cat.sortOrder,
    isPublic: cat.isPublic !== false,
    isLocked: !!cat.isLocked,
    lockPassword: (cat.isLocked && cat.lockPassword) ? 1 : '',
    collaboratorCount: cat.collaboratorCount,
    devMode: cat.devMode,
    devCount: cat.devCount,
    createdAtMs: cat.createdAt?.toMillis?.() ?? 0,
  };
}

// The sort helpers call createdAt.toMillis(), which JSON cannot carry.
// Restore just enough of the Timestamp shape for them to work.
function rehydrate(c) {
  const ms = c.createdAtMs || 0;
  return { ...c, createdAt: { toMillis: () => ms } };
}

export function saveFeedCache(category, catalysts) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      category: category || 'all',
      savedAt: Date.now(),
      items: (catalysts || []).slice(0, MAX_ENTRIES).map(trim),
    }));
  } catch {
    // Quota exceeded, or storage blocked in private mode. The cache is
    // an optimisation and is never required for correctness — drop it
    // rather than letting a storage error surface into the boot path.
    try { localStorage.removeItem(KEY); } catch {}
  }
}

export function loadFeedCache(category) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.items) || p.items.length === 0) return null;
    // A snapshot taken under a different category filter would paint
    // the wrong set, so only reuse an exact match.
    if ((p.category || 'all') !== (category || 'all')) return null;
    return p.items.map(rehydrate);
  } catch {
    return null;
  }
}

// First-ever visit has no localStorage cache, and the live query is
// still stuck behind the App Check handshake. /feed-seed.json is a
// static file on our own origin — no App Check, no Firestore, just a
// plain GET — so the grid has something real to draw within a couple of
// hundred milliseconds. Whatever it holds is replaced the moment the
// server snapshot lands, so drift here is cosmetic.
let _seedPromise = null;
export function loadSeedFeed() {
  if (_seedPromise) return _seedPromise;
  _seedPromise = fetch('/feed-seed.json', { cache: 'force-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => (p && Array.isArray(p.items) && p.items.length ? p.items.map(rehydrate) : null))
    .catch(() => null);
  return _seedPromise;
}

export function clearFeedCache() {
  try { localStorage.removeItem(KEY); } catch {}
}
