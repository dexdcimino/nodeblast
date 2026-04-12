// ══════════════════════════════════════
//  NodeBlast — HEX GRID
//  Dynamic responsive honeycomb layout
// ══════════════════════════════════════

import { renderUsername, escapeHtml } from './ui-events.js';

// Spacing knobs for the honeycomb layout. Bumped significantly from
// previous values: wider gaps + a deeper top padding so the hex grid
// has breathing room around it after the profile bar was detached
// into the main content area and given its own margin.
const GAP = 60;
const GRID_TOP_PAD = 56;
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

function statusBadgeHTML(status) {
  if (status === 'early') return '<div class="hex-status" data-status="early">Early</div>';
  if (status === 'placeholder') return '<div class="hex-status" data-status="placeholder">WIP</div>';
  // Live is the default/expected state — render a small green dot, no text.
  return '<div class="hex-status" data-status="live"></div>';
}

// Tiny inline globe glyph for the hover domain line. Pure SVG with
// currentColor stroke — no network fetch, works in any theme.
const GLOBE_MINI_SVG = '<svg class="hex-globe-mini" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

// MD21: gray yin-yang logo placeholder shown on catalyst tiles that
// have no uploaded thumbnail. Matches the 90°-rotated header logo so
// the whole mark is pointy-top-aligned with the hex clip. Every path
// uses `fill="currentColor"` so CSS can drive the tint from a single
// `color` rule (keeps dark/light theme adaptation automatic).
export const PLACEHOLDER_LOGO_SVG = `<svg class="hex-placeholder-logo" xmlns="http://www.w3.org/2000/svg" viewBox="-10.65 10.65 256 234.7" aria-hidden="true">
  <g transform="rotate(90 117.35 128)" fill="currentColor">
    <path d="M162.3,18.5C150.8,7.1,134.9,0,117.3,0s-33.4,7.1-45,18.5l-48.1,27.8C9.2,54.9,0,70.9,0,88.2v79.7c0,17.3,9.2,33.2,24.2,41.9h0c13.1,7.5,29.3-2,29.2-17.1v-.6c0-35.4,28.7-64,64-64s64-28.7,64-64-7.3-33.9-19-45.5ZM118.9,87.9c-14.5.9-26.4-11-25.5-25.5.8-11.9,10.4-21.6,22.4-22.4,14.5-.9,26.4,11,25.5,25.5-.8,11.9-10.4,21.6-22.4,22.4Z"/>
    <path d="M72.3,237.5c11.6,11.4,27.5,18.5,45,18.5s33.4-7.1,45-18.5l48.1-27.8c15-8.6,24.2-24.6,24.2-41.9v-79.7c0-17.3-9.2-33.2-24.2-41.9h0c-13.1-7.5-29.3,2-29.2,17.1v.6c0,35.3-28.6,64-64,64s-64,28.6-64,64,7.3,33.9,19,45.5h0ZM115.8,168.1c14.5-.9,26.4,11,25.5,25.5-.8,11.9-10.4,21.6-22.4,22.4-14.5.9-26.4-11-25.5-25.5.8-11.9,10.4-21.6,22.4-22.4Z"/>
  </g>
</svg>`;

// MD23: padlock icon rendered over locked catalyst tiles. Same
// currentColor pattern so CSS can tint it. Non-rotated because a
// padlock on its side looks weird.
const LOCK_OVERLAY_SVG = '<svg class="hex-lock-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

// Small people icon for the collaborator-count badge. Currently hidden
// (collaborator data model doesn't exist yet), but the markup renders
// conditionally so flipping on a future write pushes it live without
// another tile refactor.
const PEOPLE_MINI_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

function catalystTileHTML(cat, { showCreatorAvatar = false } = {}) {
  const domain = safeDomain(cat.url);
  const title = escapeHtml(cat.title || '');
  const hex = escapeHtml(cat.ownerHex || '5aaa72');
  const status = cat.status || 'live';
  // MD21: when there's no uploaded thumbnail, drop in the faded
  // yin-yang placeholder as a standalone layer. The tile also gets
  // the `no-thumb` class in the caller so CSS can swap to a lighter
  // fade gradient (heavy overlay is only needed over a photo).
  const placeholderHTML = !cat.thumbURL
    ? `<div class="hex-placeholder">${PLACEHOLDER_LOGO_SVG}</div>`
    : '';

  // MD23: padlock overlay for password-protected catalysts. The
  // `.locked` class on the tile element (wired in the caller) drives
  // the thumbnail blur + dim via CSS. The overlay itself holds the
  // big padlock icon that makes the locked state unmistakable.
  const lockHTML = cat.isLocked && cat.lockPassword
    ? `<div class="hex-lock-overlay">${LOCK_OVERLAY_SVG}</div>`
    : '';

  // Creator avatar on community tiles only. Profile pages show the
  // creator prominently in the profile bar above, so repeating them
  // on every tile is visual noise. The avatar is informational —
  // pointer-events:none in CSS — so clicks pass through to the
  // tile-body click handler which opens the detail modal.
  let avatarHTML = '';
  if (showCreatorAvatar) {
    const initial = escapeHtml((cat.ownerName || 'A').charAt(0).toUpperCase());
    const photo = cat.ownerPhoto
      ? `<img src="${escapeHtml(cat.ownerPhoto)}" alt="">`
      : `<span class="hex-creator-avatar-initial">${initial}</span>`;
    avatarHTML = `<div class="hex-creator-avatar" style="border-color:#${hex}">${photo}</div>`;
  }

  // Collaborator count. The owner is implicit (not stored in the
  // collaborators array), so total = 1 + extras. We prefer the
  // denormalized collaboratorCount field when present, otherwise
  // compute from the array length, otherwise default to 1.
  let collabCount;
  if (typeof cat.collaboratorCount === 'number') {
    collabCount = cat.collaboratorCount;
  } else if (Array.isArray(cat.collaborators)) {
    collabCount = 1 + cat.collaborators.length;
  } else {
    collabCount = 1;
  }
  const collabHTML = collabCount > 1
    ? `<div class="hex-collab-badge">${PEOPLE_MINI_SVG}<span>${collabCount}</span></div>`
    : '';

  // Fire / poop vote badges. Only render when count > 0 so the static
  // face stays clean for fresh catalysts. Fire → bottom-left, poop →
  // bottom-right. The vote type value is still 'frost' internally
  // (see voteCatalyst comment) — `frostCount` on the catalyst doc is
  // the poop count in UI land.
  const fireCount = cat.fireCount || 0;
  const poopCount = cat.frostCount || 0;
  const fireHTML = fireCount > 0
    ? `<div class="hex-vote hex-vote-fire"><span class="hex-vote-emoji">🔥</span><span>${fireCount}</span></div>`
    : '';
  const poopHTML = poopCount > 0
    ? `<div class="hex-vote hex-vote-poop"><span class="hex-vote-emoji">💩</span><span>${poopCount}</span></div>`
    : '';

  // Layers, top → bottom:
  //   .hex-placeholder    — faded logo watermark (no-thumb tiles only)
  //   .hex-creator-avatar — top center, community tiles only
  //   .hex-status         — top right corner (see CSS), never conflicts with avatar
  //   .hex-collab-badge   — top left corner (conditional)
  //   .hex-vote-fire/poop — bottom corners (conditional on count > 0)
  //   .hex-fade           — bottom linear gradient for title legibility
  //   .hex-lock-overlay   — centered padlock (locked tiles only)
  //   .hex-info           — title + (hover) domain, anchored bottom
  return `
    ${placeholderHTML}
    ${avatarHTML}
    ${statusBadgeHTML(status)}
    ${collabHTML}
    ${fireHTML}
    ${poopHTML}
    <div class="hex-fade"></div>
    ${lockHTML}
    <div class="hex-info">
      <div class="hex-title">${title}</div>
      ${domain ? `<div class="hex-domain" data-url-link>${GLOBE_MINI_SVG}<span>${escapeHtml(domain)}</span></div>` : ''}
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

// ══════════════════════════════════════════════════════════════
//  Drag-to-reorder state
// ──────────────────────────────────────────────────────────────
//  _dragState is non-null whenever a pointerdown on a reorderable
//  tile has started a (possibly pending) drag. Only .active becomes
//  true once the hold timer fires or the mouse has moved past the
//  threshold. While .active is set, renderHexGrid() defers any
//  incoming re-renders so the Firestore snapshot that fires right
//  after the drop-commit can't clobber the drag animation.
// ══════════════════════════════════════════════════════════════

let _dragState = null;
let _suppressNextClick = false;
let _deferredRender = false;
let _lastState = null;

// Hold-to-drag delay. Desktop users can also start drag immediately
// by moving the mouse past HOLD_MOVE_THRESHOLD.
const HOLD_DELAY_MS = 180;
const HOLD_MOVE_THRESHOLD = 8;

export function renderHexGrid(state) {
  if (state) _lastState = state;
  if (!_lastState) return;

  // Defer re-renders while a drag is in progress (or during the brief
  // post-drop animation cooldown). The deferred render runs once the
  // drag state clears.
  if (_dragState && _dragState.active) {
    _deferredRender = true;
    return;
  }

  _renderNow(_lastState);
}

function _renderNow(state) {
  ensureClipPath();
  const honey = document.getElementById('honeycomb');
  if (!honey) return;
  honey.innerHTML = '';
  honey.classList.remove('reordering');

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

  const tileEls = new Array(tiles.length);

  const slots = _renderTiles(honey, containerW, COLS, totalTiles, (i, el) => {
    const isAdd = showAdd && i === tiles.length;
    if (isAdd) {
      el.classList.add('add-tile');
      el.innerHTML = addTileHTML();
      el.addEventListener('click', () => {
        if (_suppressNextClick) { _suppressNextClick = false; return; }
        state.onAddClick?.();
      });
    } else {
      const tile = tiles[i];
      tileEls[i] = el;
      const accent = tile.accentColor || '#5AAA72';
      el.style.setProperty('--accent', accent);
      if (tile.thumbURL) el.style.setProperty('--thumb', `url("${tile.thumbURL}")`);
      else el.classList.add('no-thumb');
      if (tile.status === 'placeholder') el.classList.add('wip');
      // MD23: mark locked tiles so the thumb blur + dim kick in.
      if (tile.isLocked && tile.lockPassword) el.classList.add('locked');
      el.innerHTML = catalystTileHTML(tile, { showCreatorAvatar: !!state.showCreatorAvatar });
      el.addEventListener('click', (e) => {
        if (_suppressNextClick) { _suppressNextClick = false; return; }
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

  // Attach drag handlers to the user's own tiles (the add tile is
  // never reorderable). `showAdd` is only true on the signed-in
  // user's own profile route, so gating on onReorder + showAdd gives
  // us the "own profile only" requirement for free.
  console.log('[drag] gate', {
    hasOnReorder: !!state.onReorder,
    showAdd,
    tileCount: tiles.length,
    willAttach: !!(state.onReorder && showAdd && tiles.length > 1),
  });
  if (state.onReorder && showAdd && tiles.length > 1) {
    _attachDragReorder(honey, tileEls, tiles, slots.slice(0, tiles.length), state.onReorder);
  }

  if (isOwnEmpty) {
    // Position the caption just below the single + tile.
    const hexW = (containerW - GAP * (COLS + 1)) / (COLS + 0.5);
    const hexH = hexW * 1.1547;
    const caption = document.createElement('div');
    caption.className = 'hex-empty-caption';
    caption.textContent = state.emptyMessage;
    caption.style.top = (GRID_TOP_PAD + hexH + 16) + 'px';
    honey.appendChild(caption);
  }
}

function _renderTiles(honey, containerW, COLS, count, decorate) {
  const hexW = (containerW - GAP * (COLS + 1)) / (COLS + 0.5);
  const hexH = hexW * 1.1547;
  const stepX = hexW + GAP;
  const stepY = hexH * 0.75 + GAP;

  const rowCounts = layoutRows(count, COLS);
  const slots = [];

  let idx = 0;
  for (let row = 0; row < rowCounts.length; row++) {
    const rowCount = rowCounts[row];
    const rowWidth = rowCount * hexW + (rowCount - 1) * GAP;
    const rowLeft = (containerW - rowWidth) / 2;
    const top = GRID_TOP_PAD + row * stepY;

    for (let col = 0; col < rowCount; col++) {
      const left = rowLeft + col * stepX;
      const el = document.createElement('div');
      el.className = 'hex-tile';
      el.style.width = hexW + 'px';
      el.style.height = hexH + 'px';
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      slots.push({ left, top, width: hexW, height: hexH });
      decorate(idx, el);
      honey.appendChild(el);
      idx++;
    }
  }

  const totalH = GRID_TOP_PAD + rowCounts.length * stepY + GAP;
  honey.style.height = totalH + 'px';
  return slots;
}

/* ══════════════════════════════════════
   DRAG TO REORDER
══════════════════════════════════════ */

function _attachDragReorder(honey, tileEls, tiles, slots, onReorder) {
  console.log('[drag] _attachDragReorder called', tileEls.length);
  tileEls.forEach((el) => {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => _onPointerDown(e, el, honey, tileEls, tiles, slots, onReorder));
  });
}

function _onPointerDown(e, el, honey, tileEls, tiles, slots, onReorder) {
  console.log('[drag] pointerdown on tile', {
    pointerType: e.pointerType,
    button: e.button,
    target: e.target?.className || e.target?.tagName,
    onUrlLink: !!e.target.closest?.('[data-url-link]'),
    onCreatorLink: !!e.target.closest?.('[data-creator-link]'),
    alreadyDragging: !!_dragState,
  });
  if (_dragState) return;
  if (e.button !== undefined && e.button !== 0) return;
  // Don't start a drag when the user clicks the inline url/creator
  // links inside the tile — those have their own click targets.
  if (e.target.closest('[data-url-link]') || e.target.closest('[data-creator-link]')) return;

  const ctx = {
    active: false,
    pointerType: e.pointerType,
    startX: e.clientX,
    startY: e.clientY,
    el,
    idx: tileEls.indexOf(el),
    order: tileEls.slice(),        // mutable: elements in current visual order
    tileOrder: tiles.slice(),      // mutable: tile data in parallel order
    slots,
    honey,
    onReorder,
    offsetX: 0,
    offsetY: 0,
    holdTimer: null,
    onMove: null,
    onUp: null,
  };

  // Offset from tile's layout origin (style.left/top, pre-transform)
  // to the pointer. We translate against the honeycomb container so
  // the tile follows the cursor even if the page has been scrolled.
  const honeyRect = honey.getBoundingClientRect();
  const tileLeft = parseFloat(el.style.left) || 0;
  const tileTop = parseFloat(el.style.top) || 0;
  ctx.offsetX = e.clientX - (honeyRect.left + tileLeft);
  ctx.offsetY = e.clientY - (honeyRect.top + tileTop);

  ctx.onMove = (ev) => _onPointerMove(ctx, ev);
  ctx.onUp = (ev) => _onPointerUp(ctx, ev);

  window.addEventListener('pointermove', ctx.onMove, { passive: false });
  window.addEventListener('pointerup', ctx.onUp);
  window.addEventListener('pointercancel', ctx.onUp);

  ctx.holdTimer = setTimeout(() => {
    if (_dragState === ctx && !ctx.active) _beginDrag(ctx, ctx.startX, ctx.startY);
  }, HOLD_DELAY_MS);

  _dragState = ctx;
}

function _beginDrag(ctx, clientX, clientY) {
  ctx.active = true;
  ctx.el.classList.add('dragging');
  ctx.honey.classList.add('reordering');
  document.body.classList.add('dragging-active');
  _moveDraggedTile(ctx, clientX, clientY);
}

function _moveDraggedTile(ctx, clientX, clientY) {
  const rect = ctx.honey.getBoundingClientRect();
  const x = clientX - rect.left - ctx.offsetX;
  const y = clientY - rect.top - ctx.offsetY;
  ctx.el.style.left = x + 'px';
  ctx.el.style.top = y + 'px';
}

function _onPointerMove(ctx, ev) {
  if (!ctx.active) {
    const dx = ev.clientX - ctx.startX;
    const dy = ev.clientY - ctx.startY;
    if (Math.hypot(dx, dy) < HOLD_MOVE_THRESHOLD) return;

    if (ctx.pointerType === 'mouse') {
      // Desktop: movement before the hold timer instantly starts the
      // drag, rather than forcing a deliberate hold.
      clearTimeout(ctx.holdTimer);
      _beginDrag(ctx, ev.clientX, ev.clientY);
    } else {
      // Touch / pen: the user is probably scrolling. Abort.
      _teardownListeners(ctx);
      _dragState = null;
    }
    return;
  }

  // Active drag — keep the page from scrolling or selecting text
  // while we move the tile around.
  if (ev.cancelable) ev.preventDefault();
  _moveDraggedTile(ctx, ev.clientX, ev.clientY);

  // Find the slot whose center is closest to the pointer. We only
  // consider real tile slots (the + tile is excluded via slots.slice
  // in the caller), so a drop can never land on the add tile.
  const rect = ctx.honey.getBoundingClientRect();
  const localX = ev.clientX - rect.left;
  const localY = ev.clientY - rect.top;

  let best = ctx.idx;
  let bestDist = Infinity;
  for (let i = 0; i < ctx.slots.length; i++) {
    const s = ctx.slots[i];
    const cx = s.left + s.width / 2;
    const cy = s.top + s.height / 2;
    const dx = localX - cx;
    const dy = localY - cy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = i; }
  }

  if (best !== ctx.idx) {
    // splice from the old index into the new one — tiles between the
    // two positions shift by one, matching how app-icon reorders
    // behave on iOS/Android.
    const [movedEl] = ctx.order.splice(ctx.idx, 1);
    const [movedTile] = ctx.tileOrder.splice(ctx.idx, 1);
    ctx.order.splice(best, 0, movedEl);
    ctx.tileOrder.splice(best, 0, movedTile);
    ctx.idx = best;

    // Reposition every non-dragged element to its new slot. The
    // dragged element keeps its cursor-driven position.
    ctx.order.forEach((elA, i) => {
      if (elA === ctx.el) return;
      const s = ctx.slots[i];
      elA.style.left = s.left + 'px';
      elA.style.top = s.top + 'px';
    });
  }
}

function _onPointerUp(ctx, ev) {
  if (!ctx.active) {
    // Released before drag ever started — treat as a plain click.
    _teardownListeners(ctx);
    _dragState = null;
    return;
  }

  // Snap the dragged tile into its final slot. Removing .dragging
  // restores the CSS transition, so the tile smoothly animates from
  // its cursor position into the slot position.
  const finalSlot = ctx.slots[ctx.idx];
  ctx.el.classList.remove('dragging');
  ctx.el.style.left = finalSlot.left + 'px';
  ctx.el.style.top = finalSlot.top + 'px';

  const orderedIds = ctx.tileOrder.map((t) => t.id);

  _teardownListeners(ctx);

  // Keep _dragState.active true during the snap-back animation so
  // any Firestore snapshot that fires from the optimistic write
  // doesn't trigger a mid-animation re-render.
  setTimeout(() => {
    ctx.honey.classList.remove('reordering');
    document.body.classList.remove('dragging-active');
    _dragState = null;
    if (_deferredRender) {
      _deferredRender = false;
      renderHexGrid();
    }
  }, 280);

  // Swallow the synthetic click event that follows the pointerup so
  // releasing a drop on top of a tile doesn't open the catalyst detail
  // popup.
  _suppressNextClick = true;
  setTimeout(() => { _suppressNextClick = false; }, 120);

  ctx.onReorder?.(orderedIds);
}

function _teardownListeners(ctx) {
  clearTimeout(ctx.holdTimer);
  window.removeEventListener('pointermove', ctx.onMove);
  window.removeEventListener('pointerup', ctx.onUp);
  window.removeEventListener('pointercancel', ctx.onUp);
}

/* ══════════════════════════════════════
   Standalone tile factory (for the community hub)
══════════════════════════════════════ */

// Returns a standalone .hex-tile element suitable for dropping into any
// flow-layout container — the community hub's per-creator cards use
// this to build a simple flex-wrap row of hexes instead of the full
// staggered honeycomb. The returned element uses the SAME visual CSS
// (clip-path, hover layer, backdrop dim) as honeycomb tiles — the only
// difference is the `hex-tile-flow` modifier class which flips
// position:absolute → relative so flex wrap works. The click handlers
// mirror the honeycomb path exactly: url/creator link delegation, then
// tile click. No drag wiring (community tiles are never reorderable).
export function createCatalystTileElement(cat, { width, height, showCreatorAvatar = false, showPinButton = false, isPinned = false } = {}, handlers = {}) {
  const el = document.createElement('div');
  el.className = 'hex-tile hex-tile-flow';
  if (width)  el.style.width  = typeof width  === 'number' ? width  + 'px' : width;
  if (height) el.style.height = typeof height === 'number' ? height + 'px' : height;

  const accent = cat.accentColor || '#5AAA72';
  el.style.setProperty('--accent', accent);
  if (cat.thumbURL) el.style.setProperty('--thumb', `url("${cat.thumbURL}")`);
  else el.classList.add('no-thumb');
  if (cat.status === 'placeholder') el.classList.add('wip');
  // MD23: locked-tile class for thumb blur + overlay.
  if (cat.isLocked && cat.lockPassword) el.classList.add('locked');
  el.innerHTML = catalystTileHTML(cat, { showCreatorAvatar });

  // MD18: pin/unpin button for community-view tiles. Rendered as an
  // extra overlay child rather than baked into catalystTileHTML so
  // honeycomb tiles on profile pages stay untouched.
  if (showPinButton) {
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'hex-pin-btn' + (isPinned ? ' pinned' : '');
    pinBtn.setAttribute('data-pin-btn', '');
    pinBtn.setAttribute('data-tip', isPinned ? 'Unpin from profile' : 'Pin to profile');
    pinBtn.setAttribute('aria-label', isPinned ? 'Unpin' : 'Pin');
    pinBtn.textContent = isPinned ? '−' : '+';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Optimistic UI flip so the button responds instantly. The
      // caller's handler performs the write and the next tracked
      // snapshot tick will re-render the tile definitively.
      const nowPinned = !pinBtn.classList.contains('pinned');
      pinBtn.classList.toggle('pinned', nowPinned);
      pinBtn.textContent = nowPinned ? '−' : '+';
      pinBtn.setAttribute('data-tip', nowPinned ? 'Unpin from profile' : 'Pin to profile');
      handlers.onPinClick?.(cat, nowPinned);
    });
    el.appendChild(pinBtn);
  }

  el.addEventListener('click', (e) => {
    if (_suppressNextClick) { _suppressNextClick = false; return; }
    if (e.target.closest('[data-pin-btn]')) return;
    if (e.target.closest('[data-creator-link]')) {
      e.stopPropagation();
      handlers.onCreatorClick?.(cat);
      return;
    }
    if (e.target.closest('[data-url-link]')) {
      e.stopPropagation();
      if (cat.url) window.open(cat.url, '_blank', 'noopener');
      return;
    }
    handlers.onTileClick?.(cat);
  });

  return el;
}

/* ══════════════════════════════════════
   MD14: Mini hex grid for the account-menu dropdown
══════════════════════════════════════ */

// Thumb-only staggered honeycomb for the profile dropdown. Reuses
// the same layoutRows + drag-reorder helpers as the main grid, but
// skips the .hex-info overlay (title/url/creator) because the tiles
// are too small to fit text legibly. Container must be `position:
// relative` (set inline below). Tiles are .hex-tile so they inherit
// clip-path + thumb background, with `.mini-hex-tile` added for
// mini-specific overrides.
//
// Layout constants tuned for the 330px account menu:
//   - 4 columns
//   - GAP 4px
//   - No top padding (the surrounding .acct-dropdown-body handles it)
const MINI_COLS = 4;
const MINI_GAP = 4;

export function renderMiniHexGrid({ container, tiles, showAdd = false, onTileClick, onAddClick, onReorder }) {
  if (!container) return;
  ensureClipPath();
  container.innerHTML = '';
  container.classList.remove('reordering'); // safety — in case drag state leaked

  const containerW = container.clientWidth;
  // Account-menu body is display:none until its section is .open.
  // clientWidth is 0 in that case — bail and let the caller re-fire
  // this render once the section expands.
  if (containerW <= 0) return;

  const totalTiles = (tiles?.length || 0) + (showAdd ? 1 : 0);
  if (totalTiles === 0) {
    container.innerHTML = '<div class="mini-hex-empty">No catalysts yet</div>';
    container.style.height = '';
    return;
  }

  const hexW = (containerW - MINI_GAP * (MINI_COLS + 1)) / (MINI_COLS + 0.5);
  const hexH = hexW * 1.1547;
  const stepX = hexW + MINI_GAP;
  const stepY = hexH * 0.75 + MINI_GAP;

  const rowCounts = layoutRows(totalTiles, MINI_COLS);
  const slots = [];
  const tileEls = new Array(tiles.length);

  container.style.position = 'relative';

  let idx = 0;
  for (let row = 0; row < rowCounts.length; row++) {
    const rowCount = rowCounts[row];
    const rowWidth = rowCount * hexW + (rowCount - 1) * MINI_GAP;
    const rowLeft = (containerW - rowWidth) / 2;
    const top = row * stepY;

    for (let col = 0; col < rowCount; col++) {
      const left = rowLeft + col * stepX;
      const el = document.createElement('div');
      el.className = 'hex-tile mini-hex-tile';
      el.style.width = hexW + 'px';
      el.style.height = hexH + 'px';
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      slots.push({ left, top, width: hexW, height: hexH });

      const isAdd = showAdd && idx === tiles.length;
      if (isAdd) {
        el.classList.add('add-tile');
        el.innerHTML = '<div class="add-tile-bg"></div><div class="add-tile-plus"><span class="plus">+</span></div>';
        el.addEventListener('click', () => {
          if (_suppressNextClick) { _suppressNextClick = false; return; }
          onAddClick?.();
        });
      } else {
        const tile = tiles[idx];
        tileEls[idx] = el;
        const accent = tile.accentColor || '#5AAA72';
        el.style.setProperty('--accent', accent);
        if (tile.thumbURL) {
          el.style.setProperty('--thumb', `url("${tile.thumbURL}")`);
        } else {
          // MD21: paint the faded logo placeholder directly into the
          // mini tile so no-thumb catalysts get the same watermark in
          // the dropdown's small grid. Mini tiles normally have no
          // inner DOM, so this is the only path that adds it.
          el.classList.add('no-thumb');
          el.innerHTML = `<div class="hex-placeholder">${PLACEHOLDER_LOGO_SVG}</div>`;
        }
        if (tile.status === 'placeholder') el.classList.add('wip');
        // MD23: mini tiles still surface the locked state. Owners
        // will see a small padlock overlay even in the dropdown, and
        // CSS will add the blur. We inject the overlay inline since
        // mini tiles normally have no inner DOM.
        if (tile.isLocked && tile.lockPassword) {
          el.classList.add('locked');
          // Append — don't clobber — the placeholder we may have
          // already rendered for no-thumb minis.
          el.insertAdjacentHTML('beforeend', '<div class="hex-lock-overlay">' + LOCK_OVERLAY_SVG + '</div>');
        }
        // No inner HTML (other than the placeholder + lock overlay,
        // if any) — the `.hex-tile::before` pseudo-element paints
        // the thumbnail via `--thumb`. Tooltip surfaces the title
        // since there's no room for text on a 60px tile.
        el.setAttribute('data-tip', tile.title || 'Catalyst');
        el.addEventListener('click', () => {
          if (_suppressNextClick) { _suppressNextClick = false; return; }
          onTileClick?.(tile);
        });
      }
      container.appendChild(el);
      idx++;
    }
  }

  // MD22: the previous formula `rowCounts.length * stepY + MINI_GAP`
  // undercounted by roughly hexH*0.25 because stepY is the overlap
  // pitch, not the full tile height. That left the last row
  // (typically the "+" add tile) bleeding past the container's
  // bottom edge. Correct math: top of last row + hexH + bottom pad.
  const totalH = (rowCounts.length - 1) * stepY + hexH + MINI_GAP * 2;
  container.style.height = totalH + 'px';

  // Drag to reorder — same _attachDragReorder as the main grid, so
  // behavior is identical (hold-to-drag, shift-on-hover, snap-to-slot).
  // Only attached when there's more than one real tile AND a callback
  // was provided (the mini grid is read-only when onReorder is null).
  if (onReorder && tiles.length > 1) {
    _attachDragReorder(container, tileEls, tiles, slots.slice(0, tiles.length), onReorder);
  }
}
