// ══════════════════════════════════════════════════════════════
//  NodeBlast service worker
//
//  BUMP THIS VERSION ON EVERY DEPLOY — the bumped `sw.js` (served
//  must-revalidate) is what triggers install → activate → purge of
//  the previous cache, which is how a deploy invalidates the cached
//  module graph. Keep it in step with the ?v= on init.js/style.css.
// ══════════════════════════════════════════════════════════════
const CACHE_NAME = 'nodeblast-v209';

// The app shell. Precached at install so a repeat visit paints without
// touching the network.
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css?v=199',
  '/js/init.js?v=209',
];

// Same-origin paths served stale-while-revalidate: answered instantly
// from cache, refreshed in the background for the next load.
const SWR_PREFIXES = ['/js/', '/css/', '/assets/', '/icons/'];
// The seed file is static data the first paint depends on.
const SWR_EXACT = ['/feed-seed.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // addAll is all-or-nothing; a single 404 would abort the whole
      // install and leave the SW permanently uninstalled. Cache each
      // entry independently so one bad path can't do that.
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return SWR_PREFIXES.some((p) => url.pathname.startsWith(p)) || SWR_EXACT.includes(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin (Firebase, gstatic, Google Fonts, Storage thumbnails)
  // is left entirely alone. Routing it through the worker only adds a
  // hop — the browser's own HTTP cache already handles it, and the
  // Firestore streaming connection must not be buffered.
  if (url.origin !== self.location.origin) return;

  // Navigations are network-first so a deploy is picked up immediately.
  // The cached shell is only a fallback for offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStaticAsset(url)) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        // Serve the cached copy the instant it exists; the refresh
        // above keeps running and lands in the cache for next time.
        return cached || network;
      })
    );
    return;
  }

  // Anything else same-origin: straight to the network, cache as a
  // last-resort offline fallback.
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
