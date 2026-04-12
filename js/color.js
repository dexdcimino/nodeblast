// ══════════════════════════════════════
//  NodeBlast — COLOR PICKER
//  HSB canvas + 16 custom slots (no presets row)
//  Drawing approach mirrors DexNote's color.js drawColorBox().
//
//  MD26: matches DexNote byte-for-byte on the saved-color side —
//  16 slots persisted to localStorage under the SHARED key
//  `dexnotes_custom_slots`, so colors saved in either app show up
//  in the other. The preset swatch row is gone per MD26 spec; the
//  picker shows custom slots only.
// ══════════════════════════════════════

let _h = 140, _s = 47, _b = 67;
let _onChange = null;
let _anchor = null;

// Shared key with DexNote so saved colors round-trip across both
// apps. Old NodeBlast users had slots under `nb-custom-slots`; we
// migrate them lazily below if the shared key isn't set yet.
const CSLOTS_KEY = 'dexnotes_custom_slots';
const LEGACY_CSLOTS_KEY = 'nb-custom-slots';
const SLOT_COUNT = 16;
let _customSlots = Array(SLOT_COUNT).fill(null);
try {
  let raw = localStorage.getItem(CSLOTS_KEY);
  // Lazy migration from the pre-MD26 NodeBlast key. Only runs once
  // and never overwrites an existing DexNote saved list.
  if (!raw) {
    const legacy = localStorage.getItem(LEGACY_CSLOTS_KEY);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed)) {
          const migrated = parsed.slice(0, SLOT_COUNT);
          while (migrated.length < SLOT_COUNT) migrated.push(null);
          localStorage.setItem(CSLOTS_KEY, JSON.stringify(migrated));
          raw = JSON.stringify(migrated);
        }
      } catch {}
    }
  }
  if (raw) {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) {
      while (p.length < SLOT_COUNT) p.push(null);
      _customSlots = p.slice(0, SLOT_COUNT);
    }
  }
} catch {}

function saveCustomSlots() {
  try { localStorage.setItem(CSLOTS_KEY, JSON.stringify(_customSlots)); } catch {}
}

export function hsbToHex(h, s, b) {
  h /= 360; s /= 100; b /= 100;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = b * (1 - s);
  const q = b * (1 - f * s);
  const t = b * (1 - (1 - f) * s);
  let r, g, bl;
  switch (i % 6) {
    case 0: r = b; g = t; bl = p; break;
    case 1: r = q; g = b; bl = p; break;
    case 2: r = p; g = b; bl = t; break;
    case 3: r = p; g = q; bl = b; break;
    case 4: r = t; g = p; bl = b; break;
    case 5: r = b; g = p; bl = q; break;
  }
  const to2 = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + to2(r) + to2(g) + to2(bl);
}

export function hexToHsb(hex) {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return { h: 0, s: 0, b: 100 };
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const bl = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, bl), min = Math.min(r, g, bl);
  const d = max - min;
  let hh = 0;
  if (d !== 0) {
    if (max === r) hh = ((g - bl) / d) % 6;
    else if (max === g) hh = (bl - r) / d + 2;
    else hh = (r - g) / d + 4;
  }
  hh = Math.round(hh * 60); if (hh < 0) hh += 360;
  return { h: hh, s: max === 0 ? 0 : Math.round((d / max) * 100), b: Math.round(max * 100) };
}

// Verbatim drawing approach from DexNote: fill with pure hue, then a
// horizontal white→transparent overlay (saturation), then a vertical
// transparent→black overlay (brightness). Avoids any gradient→gradient
// blending artifacts that can produce "white stripes" in the NodeBlast
// attempt that faded directly from white to the hue color.
function _drawBox() {
  const canvas = document.getElementById('clr-box-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const hPure = hsbToHex(_h, 100, 100);
  ctx.fillStyle = hPure; ctx.fillRect(0, 0, W, H);
  const wG = ctx.createLinearGradient(0, 0, W, 0);
  wG.addColorStop(0, 'rgba(255,255,255,1)');
  wG.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = wG; ctx.fillRect(0, 0, W, H);
  const bG = ctx.createLinearGradient(0, 0, 0, H);
  bG.addColorStop(0, 'rgba(0,0,0,0)');
  bG.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = bG; ctx.fillRect(0, 0, W, H);
}

function _updateSliderBgs() {
  const hPure = hsbToHex(_h, 100, 100);
  const ss = document.getElementById('slider-s');
  const sb = document.getElementById('slider-b');
  if (ss) ss.style.background = `linear-gradient(to right,${hsbToHex(_h, 0, _b)},${hsbToHex(_h, 100, _b)})`;
  if (sb) sb.style.background = `linear-gradient(to right,#000,${hPure})`;
}

function _updateCursor() {
  const wrap = document.getElementById('clr-box-wrap');
  const cursor = document.getElementById('clr-cursor');
  if (!wrap || !cursor) return;
  const r = wrap.getBoundingClientRect();
  cursor.style.left = (r.width * (_s / 100)) + 'px';
  cursor.style.top = (r.height * (1 - _b / 100)) + 'px';
  cursor.style.background = hsbToHex(_h, _s, _b);
}

function _syncInputs() {
  const hs = document.getElementById('slider-h');
  const ss = document.getElementById('slider-s');
  const bs = document.getElementById('slider-b');
  if (hs) hs.value = _h;
  if (ss) ss.value = _s;
  if (bs) bs.value = _b;
  const hexIn = document.getElementById('clr-hex-in');
  const swatch = document.getElementById('clr-swatch');
  const hex = hsbToHex(_h, _s, _b).toUpperCase().slice(1);
  if (hexIn && document.activeElement !== hexIn) hexIn.value = hex;
  if (swatch) swatch.style.background = '#' + hex;
}

function _push() {
  _drawBox();
  _updateSliderBgs();
  _updateCursor();
  _syncInputs();
  if (_onChange) _onChange(hsbToHex(_h, _s, _b));
}

function _renderPresets() {
  // MD26: no preset palette row. Kept as an empty function +
  // hidden #clr-presets element so existing layout CSS still has
  // a valid hook without the scaffold rendering anything.
  const row = document.getElementById('clr-presets');
  if (!row) return;
  row.innerHTML = '';
  row.style.display = 'none';
}

function _renderCustomSlots() {
  const row = document.getElementById('clr-custom-slots');
  if (!row) return;
  row.innerHTML = '';
  _customSlots.forEach((c, i) => {
    const s = document.createElement('button');
    s.className = 'clr-custom-slot';
    s.type = 'button';
    s.dataset.slotIdx = i;
    if (c) {
      s.style.background = c;
      s.dataset.tip = c.toUpperCase();
      s.addEventListener('click', (e) => { e.stopPropagation(); _applyHex(c); });
    } else {
      s.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="1" x2="4" y2="7"/><line x1="1" y1="4" x2="7" y2="4"/></svg>';
      s.dataset.tip = 'Save current color';
      s.addEventListener('click', (e) => {
        e.stopPropagation();
        _customSlots[i] = hsbToHex(_h, _s, _b);
        saveCustomSlots();
        _renderCustomSlots();
      });
    }
    // Right-click to clear a filled slot
    if (c) {
      s.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        _customSlots[i] = null;
        saveCustomSlots();
        _renderCustomSlots();
      });
    }
    row.appendChild(s);
  });
}

function _applyHex(hex) {
  const clean = (hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return;
  const hsb = hexToHsb('#' + clean);
  _h = hsb.h; _s = hsb.s; _b = hsb.b;
  _push();
}

export function openColorPopup(anchor, initialHex, onChange) {
  const pop = document.getElementById('clr-popup');
  if (!pop) return;
  _anchor = anchor;
  _onChange = onChange || null;
  if (initialHex) _applyHex(initialHex);

  pop.classList.add('open');
  pop.style.transform = '';
  // Position: prefer right of anchor, flip to the left if it would overflow.
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    const pw = 278;
    let left = r.right + 8;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, r.left - pw - 8);
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, Math.min(window.innerHeight - 420, r.top)) + 'px';
  } else {
    pop.style.left = '50%';
    pop.style.top = '50%';
    pop.style.transform = 'translate(-50%,-50%)';
  }

  _renderPresets();
  _renderCustomSlots();

  // Draw on the next frame so the canvas has a chance to flush layout
  // now that the popup just became display:flex.
  requestAnimationFrame(() => _push());
}

export function closeColorPopup() {
  const pop = document.getElementById('clr-popup');
  if (!pop) return;
  pop.classList.remove('open');
  pop.style.transform = '';
  _onChange = null;
}

export function isColorPickerOpen() {
  return document.getElementById('clr-popup')?.classList.contains('open');
}

export function initColorPicker() {
  const pop = document.getElementById('clr-popup');
  if (!pop) return;

  const wrap = document.getElementById('clr-box-wrap');
  let dragging = false;
  const onBoxDrag = (e) => {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const cx = e.clientX ?? e.touches?.[0]?.clientX;
    const cy = e.clientY ?? e.touches?.[0]?.clientY;
    if (cx == null || cy == null) return;
    const x = Math.max(0, Math.min(r.width, cx - r.left));
    const y = Math.max(0, Math.min(r.height, cy - r.top));
    _s = Math.round((x / r.width) * 100);
    _b = Math.round((1 - y / r.height) * 100);
    _push();
  };
  wrap?.addEventListener('mousedown', (e) => { dragging = true; onBoxDrag(e); e.preventDefault(); });
  window.addEventListener('mousemove', (e) => { if (dragging) onBoxDrag(e); });
  window.addEventListener('mouseup', () => { dragging = false; });
  wrap?.addEventListener('touchstart', (e) => { dragging = true; onBoxDrag(e.touches[0]); e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', (e) => { if (dragging && e.touches[0]) onBoxDrag(e.touches[0]); });
  window.addEventListener('touchend', () => { dragging = false; });

  document.getElementById('slider-h')?.addEventListener('input', (e) => { _h = +e.target.value; _push(); });
  document.getElementById('slider-s')?.addEventListener('input', (e) => { _s = +e.target.value; _push(); });
  document.getElementById('slider-b')?.addEventListener('input', (e) => { _b = +e.target.value; _push(); });

  const hexIn = document.getElementById('clr-hex-in');
  hexIn?.addEventListener('input', () => {
    const v = hexIn.value.replace('#', '').trim();
    if (/^[0-9a-f]{6}$/i.test(v)) {
      const hsb = hexToHsb('#' + v);
      _h = hsb.h; _s = hsb.s; _b = hsb.b;
      _drawBox();
      _updateSliderBgs();
      _updateCursor();
      const swatch = document.getElementById('clr-swatch');
      if (swatch) swatch.style.background = '#' + v;
      if (_onChange) _onChange('#' + v);
    }
  });

  document.getElementById('clr-hex-copy')?.addEventListener('click', () => {
    const hex = hsbToHex(_h, _s, _b);
    navigator.clipboard?.writeText(hex);
    import('./ui-events.js').then((m) => m.toast('Copied ' + hex));
  });

  document.getElementById('clr-popup-close')?.addEventListener('click', closeColorPopup);

  document.addEventListener('click', (e) => {
    if (!isColorPickerOpen()) return;
    if (pop.contains(e.target)) return;
    if (_anchor && _anchor.contains(e.target)) return;
    closeColorPopup();
  });

  // Initial paint — the popup may be hidden but the canvas backing
  // store is set via width/height attributes so drawing still works.
  _drawBox();
  _updateSliderBgs();
  _renderPresets();
  _renderCustomSlots();
}
