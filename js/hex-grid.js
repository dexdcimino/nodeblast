// ══════════════════════════════════════
//  NodeBlast — HEX GRID
//  Dynamic responsive honeycomb layout
// ══════════════════════════════════════

import { renderUsername, escapeHtml } from './ui-events.js';

const GAP = 10;
const ROUND_R = 0.08;

// Pointy-top hex vertices (objectBoundingBox 0..1)
const HEX_VERTS = [
  [0.5, 0.0],
  [1.0, 0.25],
  [1.0, 0.75],
  [0.5, 1.0],
  [0.0, 0.75],
  [0.0, 0.25],
];

function buildRoundedHexPath(r) {
  const n = HEX_VERTS.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = HEX_VERTS[(i - 1 + n) % n];
    const curr = HEX_VERTS[i];
    const next = HEX_VERTS[(i + 1) % n];
    const inDx = curr[0] - prev[0], inDy = curr[1] - prev[1];
    const inLen = Math.hypot(inDx, inDy);
    const inUx = inDx / inLen, inUy = inDy / inLen;
    const outDx = next[0] - curr[0], outDy = next[1] - curr[1];
    const outLen = Math.hypot(outDx, outDy);
    const outUx = outDx / outLen, outUy = outDy / outLen;
    const ex = curr[0] - inUx * r, ey = curr[1] - inUy * r;
    const xx = curr[0] + outUx * r, xy = curr[1] + outUy * r;
    if (i === 0) d += `M ${ex.toFixed(5)} ${ey.toFixed(5)} `;
    else d += `L ${ex.toFixed(5)} ${ey.toFixed(5)} `;
    d += `Q ${curr[0].toFixed(5)} ${curr[1].toFixed(5)} ${xx.toFixed(5)} ${xy.toFixed(5)} `;
  }
  d += 'Z';
  return d;
}

function ensureClipPath() {
  const path = document.getElementById('hex-clip-path');
  if (path) path.setAttribute('d', buildRoundedHexPath(ROUND_R));
}

function safeDomain(url) {
  if (!url) return '';
  try { return new URL(url).host.replace(/^www\./, ''); }
  catch { return url; }
}

export function getCols(width) {
  if (width >= 1200) return 4;
  if (width >= 800) return 3;
  if (width >= 500) return 2;
  return 1;
}

function layoutRows(count, COLS) {
  const rows = [];
  if (COLS <= 1) {
    for (let i = 0; i < count; i++) rows.push(1);
    return rows;
  }
  let remaining = count;
  let rowIdx = 0;
  while (remaining > 0) {
    const cols = rowIdx % 2 === 0 ? COLS : COLS - 1;
    const take = Math.min(cols, remaining);
    rows.push(take);
    remaining -= take;
    rowIdx++;
  }
  return rows;
}

function catalystTileHTML(cat) {
  const domain = safeDomain(cat.url);
  const title = escapeHtml(cat.title || '');
  const accent = cat.accentColor || '#5AAA72';
  const hex = escapeHtml(cat.ownerHex || '5aaa72');
  const unameHtml = renderUsername(cat.ownerName || 'anon', accent);
  const faviconHtml = domain
    ? `<img class="hex-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32" alt="" onerror="this.style.display='none'">`
    : '';
  return `
    ${faviconHtml}
    <div class="hex-fade"></div>
    <div class="hex-info">
      <div class="hex-title">${title}</div>
      <div class="hex-url" data-url-link>${escapeHtml(domain)}</div>
      <div class="hex-creator" data-creator-link><span class="hex-creator-name">${unameHtml}</span><span class="hex-creator-hex" style="color:${escapeHtml(accent)}">#${hex}</span></div>
    </div>
  `;
}

function addTileHTML() {
  return `
    <div class="add-tile-bg"></div>
    <div class="add-tile-plus">
      <span class="plus">+</span>
      <span class="label">add catalyst</span>
    </div>
  `;
}

function skeletonHTML() {
  return `<div class="hex-skeleton-inner"></div>`;
}

let _lastState = null;

export function renderHexGrid(state) {
  if (!state) state = _lastState;
  if (!state) return;
  _lastState = state;

  ensureClipPath();
  const honey = document.getElementById('honeycomb');
  if (!honey) return;
  honey.innerHTML = '';

  const containerW = honey.clientWidth;
  if (containerW <= 0) return;

  const COLS = getCols(containerW);

  // Loading: render N skeleton placeholders matching current column count
  if (state.loading) {
    const skeletonCount = Math.max(3, COLS + Math.max(0, COLS - 1));
    _renderTiles(honey, containerW, COLS, skeletonCount, (i, el) => {
      el.classList.add('hex-skeleton');
      el.innerHTML = skeletonHTML();
    });
    return;
  }

  const tiles = state.tiles || [];
  const showAdd = !!state.showAdd;
  const totalTiles = tiles.length + (showAdd ? 1 : 0);

  if (totalTiles === 0) {
    honey.style.height = '100%';
    const empty = document.createElement('div');
    empty.className = 'hex-empty';
    empty.textContent = state.emptyMessage || 'No catalysts yet';
    honey.appendChild(empty);
    return;
  }

  // Own-profile empty state: render just the + tile plus the caption
  // underneath so the user gets both the affordance and the prompt.
  const isOwnEmpty = tiles.length === 0 && showAdd && state.emptyMessage;

  _renderTiles(honey, containerW, COLS, totalTiles, (i, el) => {
    const isAdd = showAdd && i === tiles.length;
    if (isAdd) {
      el.classList.add('add-tile');
      el.innerHTML = addTileHTML();
      el.addEventListener('click', () => state.onAddClick?.());
    } else {
      const tile = tiles[i];
      const accent = tile.accentColor || '#5AAA72';
      el.style.setProperty('--accent', accent);
      if (tile.thumbURL) el.style.setProperty('--thumb', `url("${tile.thumbURL}")`);
      el.innerHTML = catalystTileHTML(tile);
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-creator-link]')) {
          e.stopPropagation();
          state.onCreatorClick?.(tile);
          return;
        }
        if (e.target.closest('[data-url-link]')) {
          e.stopPropagation();
          if (tile.url) window.open(tile.url, '_blank', 'noopener');
          return;
        }
        state.onTileClick?.(tile);
      });
    }
  });

  if (isOwnEmpty) {
    // Position the caption just below the single + tile.
    const hexW = (containerW - GAP * (COLS + 1)) / (COLS + 0.5);
    const hexH = hexW * 1.1547;
    const caption = document.createElement('div');
    caption.className = 'hex-empty-caption';
    caption.textContent = state.emptyMessage;
    caption.style.top = (GAP + hexH + 12) + 'px';
    honey.appendChild(caption);
  }
}

function _renderTiles(honey, containerW, COLS, count, decorate) {
  const hexW = (containerW - GAP * (COLS + 1)) / (COLS + 0.5);
  const hexH = hexW * 1.1547;
  const stepX = hexW + GAP;
  const stepY = hexH * 0.75 + GAP;

  const rowCounts = layoutRows(count, COLS);

  let idx = 0;
  for (let row = 0; row < rowCounts.length; row++) {
    const rowCount = rowCounts[row];
    const rowWidth = rowCount * hexW + (rowCount - 1) * GAP;
    const rowLeft = (containerW - rowWidth) / 2;
    const top = GAP + row * stepY;

    for (let col = 0; col < rowCount; col++) {
      const left = rowLeft + col * stepX;
      const el = document.createElement('div');
      el.className = 'hex-tile';
      el.style.width = hexW + 'px';
      el.style.height = hexH + 'px';
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      decorate(idx, el);
      honey.appendChild(el);
      idx++;
    }
  }

  const totalH = GAP + rowCounts.length * stepY;
  honey.style.height = totalH + 'px';
}
