const COLS = 4;
const GAP = 10;
const ROUND_R = 0.08;

const DEMO_TILES = [
  {title:'DexNote', url:'dexnote.dev', creator:'dex', color:'#1199ff', accent:'#5AAA72'},
  {title:'dexddc', url:'dexddc.com', creator:'dex', color:'#1199ff', accent:'#7F77DD'},
  {title:'Archer Arena', url:'coming soon', creator:'dex', color:'#1199ff', accent:'#E8853A'},
  {title:'Dot-Sim', url:'coming soon', creator:'dex', color:'#1199ff', accent:'#E8413A'},
  {title:'NodeBlast', url:'nodeblast.dev', creator:'dex', color:'#1199ff', accent:'#378ADD'},
  {title:'Spire', url:'coming soon', creator:'dex', color:'#1199ff', accent:'#825FC2'},
  {title:'Cupcake Game', url:'dexddc.com', creator:'dex', color:'#1199ff', accent:'#E8853A'},
  {title:'Pixel Forge', url:'pixelforge.io', creator:'zara', color:'#00bcd4', accent:'#00BCD4'},
  {title:'Beat Maker', url:'beats.app', creator:'koda', color:'#ffb74d', accent:'#FFB74D'},
  {title:'Dream Gen', url:'dreamgen.dev', creator:'luna', color:'#ce93d8', accent:'#CE93D8'},
  {title:'Voxel World', url:'voxelworld.dev', creator:'rex', color:'#4db6ac', accent:'#4DB6AC'},
  {title:'Wave Synth', url:'wavesynth.io', creator:'echo', color:'#90caf9', accent:'#90CAF9'},
];

// Pointy-top hex vertices in objectBoundingBox space (0..1)
const HEX_VERTS = [
  [0.5, 0.0],
  [1.0, 0.25],
  [1.0, 0.75],
  [0.5, 1.0],
  [0.0, 0.75],
  [0.0, 0.25],
];

function buildRoundedHexPath(r) {
  // For each vertex, stop short along the incoming edge, curve through the vertex, resume along outgoing edge.
  const n = HEX_VERTS.length;
  const pts = HEX_VERTS;
  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    // Direction from prev -> curr (incoming)
    const inDx = curr[0] - prev[0];
    const inDy = curr[1] - prev[1];
    const inLen = Math.hypot(inDx, inDy);
    const inUx = inDx / inLen;
    const inUy = inDy / inLen;

    // Direction from curr -> next (outgoing)
    const outDx = next[0] - curr[0];
    const outDy = next[1] - curr[1];
    const outLen = Math.hypot(outDx, outDy);
    const outUx = outDx / outLen;
    const outUy = outDy / outLen;

    // Entry point = curr - inU * r
    const ex = curr[0] - inUx * r;
    const ey = curr[1] - inUy * r;
    // Exit point = curr + outU * r
    const xx = curr[0] + outUx * r;
    const xy = curr[1] + outUy * r;

    if (i === 0) {
      d += `M ${ex.toFixed(5)} ${ey.toFixed(5)} `;
    } else {
      d += `L ${ex.toFixed(5)} ${ey.toFixed(5)} `;
    }
    d += `Q ${curr[0].toFixed(5)} ${curr[1].toFixed(5)} ${xx.toFixed(5)} ${xy.toFixed(5)} `;
  }
  d += 'Z';
  return d;
}

function ensureClipPath() {
  let path = document.getElementById('hex-clip-path');
  if (!path) return;
  path.setAttribute('d', buildRoundedHexPath(ROUND_R));
}

function tileHTML(t) {
  return `
    <div class="hex-fade"></div>
    <div class="hex-info">
      <div class="hex-title">${t.title}</div>
      <div class="hex-url">${t.url}</div>
      <div class="hex-creator" style="color:${t.accent}">${t.creator}</div>
    </div>
  `;
}

export function renderHexGrid() {
  ensureClipPath();
  const honey = document.getElementById('honeycomb');
  if (!honey) return;
  honey.innerHTML = '';

  const containerW = honey.clientWidth;
  if (containerW <= 0) return;

  const hexW = (containerW - GAP * (COLS + 1)) / (COLS + 0.5);
  const hexH = hexW * 1.1547;
  const stepX = hexW + GAP;
  const stepY = hexH * 0.75 + GAP;

  // 4-3-4-3 pattern
  const rowCounts = [COLS, COLS - 1, COLS, COLS - 1];

  let idx = 0;
  for (let row = 0; row < rowCounts.length; row++) {
    const count = rowCounts[row];
    const rowWidth = count * hexW + (count - 1) * GAP;
    const rowLeft = (containerW - rowWidth) / 2;
    const top = GAP + row * stepY;

    for (let col = 0; col < count; col++) {
      if (idx >= DEMO_TILES.length) break;
      const t = DEMO_TILES[idx++];
      const left = rowLeft + col * stepX;

      const el = document.createElement('div');
      el.className = 'hex-tile';
      el.style.width = hexW + 'px';
      el.style.height = hexH + 'px';
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.setProperty('--accent', t.accent);
      el.innerHTML = tileHTML(t);
      honey.appendChild(el);
    }
  }

  const totalH = GAP + rowCounts.length * stepY;
  honey.style.height = totalH + 'px';
}
