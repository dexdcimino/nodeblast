#!/usr/bin/env node
/*
 * Honeycomb overlap regression check.
 *
 *   node tools/hex-overlap-check.js [baseUrl] [width]
 *   node tools/hex-overlap-check.js https://nodeblast.dev 1440
 *
 * Why this exists: the community cards shipped with every EVEN catalyst
 * count overlapping - 2, 4, 6, 8, 10, 12, 14 - and nobody caught it by
 * looking. Row centring was cancelling the honeycomb's half-step offset
 * whenever both rows held the same number of tiles, and odd counts hid it
 * by coincidence. At small tile sizes the collision is a few pixels of
 * corner, which is exactly what the eye misses.
 *
 * So this does not eyeball anything. It renders a card at every count
 * from 1 to 15 by seeding the feed cache, reads the real tile rectangles
 * back out of the DOM, builds the actual hexagon polygons and tests every
 * pair with the separating axis theorem.
 *
 * Requires Chrome and a reachable build. Firestore is blocked during the
 * run so the seeded cache is what gets rendered.
 *
 * Exit code 0 = clean, 1 = overlap, clipping or a broken row cap.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const BASE = process.argv[2] || 'http://127.0.0.1:4620/';
const WIDTH = Number(process.argv[3] || 1440);
const MAX_COUNT = 15;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Convex hull of the clip path in objectBoundingBox units. Slightly
// larger than the rounded hexagon actually drawn, so a clean result here
// guarantees a clean result on screen.
const HULL = [[0.5, 0], [1, 0.25], [1, 0.75], [0.5, 1], [0, 0.75], [0, 0.25]];
const toPolygon = (r) => HULL.map(([x, y]) => [r.x + x * r.w, r.y + y * r.h]);

// Separating axis theorem. Two convex polygons overlap when no edge
// normal separates them. The tolerance keeps sub-pixel rounding from
// reading as a collision.
function overlaps(a, b, tolerance = 0.35) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const len = Math.hypot(-(y2 - y1), x2 - x1) || 1;
      const nx = -(y2 - y1) / len;
      const ny = (x2 - x1) / len;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const [x, y] of a) { const d = x * nx + y * ny; if (d < aMin) aMin = d; if (d > aMax) aMax = d; }
      for (const [x, y] of b) { const d = x * nx + y * ny; if (d < bMin) bMin = d; if (d > bMax) bMax = d; }
      if (aMax <= bMin + tolerance || bMax <= aMin + tolerance) return false;
    }
  }
  return true;
}

const cacheFor = (n) => JSON.stringify({
  category: 'all',
  savedAt: 1,
  items: Array.from({ length: n }, (_, i) => ({
    id: 'hex' + i, title: 'Hex ' + i, slug: 'hex-' + i, url: '', type: '',
    gameId: null, category: '', status: 'live', accentColor: '#5aaa72', thumbURL: '',
    ownerId: 'overlapcheck', ownerName: 'OverlapCheck', ownerHex: '5aaa72',
    ownerPhoto: '', ownerIsAdmin: false, ownerSocialLinks: [],
    fireCount: 0, frostCount: 0, sortOrder: i, isPublic: true,
    isLocked: false, lockPassword: '', createdAtMs: 1700000000000 + i,
  })),
});

const READ_TILES = `(() => {
  const body = document.querySelector('.community-tiles');
  if (!body) return JSON.stringify({ tiles: [], rows: 0, clipped: 0 });
  const scroller = body.parentElement;
  const br = body.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  const kids = [...body.children];
  return JSON.stringify({
    tiles: kids.map((t) => {
      const r = t.getBoundingClientRect();
      return { x: r.left - br.left, y: r.top - br.top, w: r.width, h: r.height };
    }),
    rows: new Set(kids.map((t) => t.style.top)).size,
    clipped: kids.filter((t) => {
      const r = t.getBoundingClientRect();
      return r.bottom > sr.bottom + 1 || r.top < sr.top - 1
        || (r.right > sr.right + 1 && !scroller.classList.contains('scrolls'));
    }).length,
  });
})()`;

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!found) { console.error('Chrome not found. Edit CHROME_CANDIDATES in this file.'); process.exit(2); }
  return found;
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcheck-'));
  const port = 9300 + Math.floor(Math.random() * 400);
  const chrome = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + port, 'about:blank',
  ], { stdio: 'ignore' });

  let page;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      page = list.find((t) => t.type === 'page');
    } catch { /* chrome still starting */ }
    if (!page) await sleep(250);
  }
  if (!page) { console.error('Chrome did not expose a page target'); chrome.kill(); process.exit(2); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*firestore.googleapis.com*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1200, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: BASE });
  await sleep(5000);

  let failures = 0;
  console.log('width ' + WIDTH + '  ' + BASE);
  console.log(' n  tiles rows  overlaps clipped');
  for (let n = 1; n <= MAX_COUNT; n++) {
    await send('Runtime.evaluate', {
      expression: "localStorage.setItem('nb-feed-cache-v1', " + JSON.stringify(cacheFor(n)) + ')',
      returnByValue: true,
    });
    await send('Page.navigate', { url: BASE });
    await sleep(4200);
    const res = await send('Runtime.evaluate', { expression: READ_TILES, returnByValue: true });
    const data = JSON.parse(res.result.value);
    const polys = data.tiles.map(toPolygon);
    const hits = [];
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) if (overlaps(polys[i], polys[j])) hits.push(i + '/' + j);
    }
    const bad = hits.length > 0 || data.clipped > 0 || data.tiles.length !== n || data.rows > 2;
    if (bad) failures++;
    console.log(
      String(n).padStart(2) + '   ' + String(data.tiles.length).padStart(2) + '    ' + data.rows
      + '     ' + String(hits.length).padStart(2) + '      ' + data.clipped
      + (bad ? '   FAIL ' + hits.slice(0, 4).join(' ') : '')
    );
  }

  ws.close();
  chrome.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir */ }

  console.log(failures === 0
    ? 'PASS - no overlap, no clipping, two-row cap held at every count 1-' + MAX_COUNT
    : 'FAIL - ' + failures + ' of ' + MAX_COUNT + ' counts broken');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
