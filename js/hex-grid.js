// ══════════════════════════════════════
//  NodeBlast — HEX GRID
//  Dynamic honeycomb layout with click routing
// ══════════════════════════════════════

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

function layoutRows(count) {
  const rows = [];
  let remaining = count;
  let rowIdx = 0;
  while (remaining > 0) {
    const cols = rowIdx % 2 === 0 ? 4 : 3;
    const take = Math.min(cols, remaining);
    rows.push(take);
    remaining -= take;
    rowIdx++;
  }
  return rows;
}

function catalystTileHTML(cat) {
  const creator = `${cat.ownerName || 'anon'}#${cat.ownerHex || '5aaa72'}`;
  const domain = safeDomain(cat.url);
  const title = escapeHtml(cat.title || '');
  const accent = cat.accentColor || '#5AAA72';
  return `
    <div class="hex-fade"></div>
    <div class="hex-info">
      <div class="hex-title">${title}</div>
      <div class="hex-url">${escapeHtml(domain)}</div>
      <div class="hex-creator" style="color:${escapeHtml(accent)};pointer-events:auto;cursor:pointer" data-creator-link>${escapeHtml(creator)}</div>
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _lastState = { tiles: [], showAdd: false, onTileClick: null, onAddClick: null };

export function renderHexGrid(state = _lastState) {
  _lastState = state;
  ensureClipPath();
  const honey = document.getElementById('honeycomb');
  if (!honey) return;
  honey.innerHTML = '';

  const tiles = state.tiles || [];
  const totalTiles = tiles.length + (state.showAdd ? 1 : 0);
  if (totalTiles === 0) {
    honey.style.height = '100%';
    const empty = document.createElement('div');
    empty.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--tx3);font-size:14px;';
    empty.textContent = 'No catalysts yet';
    honey.appendChild(empty);
    return;
  }

  const containerW = honey.clientWidth;
  if (containerW <= 0) return;

  const COLS = 4;
  const hexW = (containerW - GAP * (COLS + 1)) / (COLS + 0.5);
  const hexH = hexW * 1.1547;
  const stepX = hexW + GAP;
  const stepY = hexH * 0.75 + GAP;

  const rowCounts = layoutRows(totalTiles);

  let idx = 0;
  for (let row = 0; row < rowCounts.length; row++) {
    const count = rowCounts[row];
    const rowWidth = count * hexW + (count - 1) * GAP;
    const rowLeft = (containerW - rowWidth) / 2;
    const top = GAP + row * stepY;

    for (let col = 0; col < count; col++) {
      if (idx >= totalTiles) break;
      const isAdd = state.showAdd && idx === tiles.length;
      const tile = tiles[idx];
      const left = rowLeft + col * stepX;

      const el = document.createElement('div');
      el.className = 'hex-tile' + (isAdd ? ' add-tile' : '');
      el.style.width = hexW + 'px';
      el.style.height = hexH + 'px';
      el.style.left = left + 'px';
      el.style.top = top + 'px';

      if (isAdd) {
        el.innerHTML = addTileHTML();
        el.addEventListener('click', () => state.onAddClick?.());
      } else {
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
          state.onTileClick?.(tile);
        });
      }
      honey.appendChild(el);
      idx++;
    }
  }

  const totalH = GAP + rowCounts.length * stepY;
  honey.style.height = totalH + 'px';
}
