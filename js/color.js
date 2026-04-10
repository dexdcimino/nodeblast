// ══════════════════════════════════════
//  NodeBlast — COLOR PICKER
//  Minimal HSB color picker popup
// ══════════════════════════════════════

let _h = 140, _s = 47, _b = 67;
let _onChange = null;
let _anchor = null;

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
  const h = hex.replace('#', '');
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

function _drawBox() {
  const canvas = document.getElementById('clr-box-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const hueColor = hsbToHex(_h, 100, 100);
  const satGrad = ctx.createLinearGradient(0, 0, w, 0);
  satGrad.addColorStop(0, '#fff');
  satGrad.addColorStop(1, hueColor);
  ctx.fillStyle = satGrad;
  ctx.fillRect(0, 0, w, h);
  const brGrad = ctx.createLinearGradient(0, 0, 0, h);
  brGrad.addColorStop(0, 'rgba(0,0,0,0)');
  brGrad.addColorStop(1, '#000');
  ctx.fillStyle = brGrad;
  ctx.fillRect(0, 0, w, h);
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

function _syncSliders() {
  const hs = document.getElementById('slider-h');
  const ss = document.getElementById('slider-s');
  const bs = document.getElementById('slider-b');
  if (hs) hs.value = _h;
  if (ss) ss.value = _s;
  if (bs) bs.value = _b;
  const sat = document.getElementById('clr-hex-in');
  const swatch = document.getElementById('clr-swatch');
  const hex = hsbToHex(_h, _s, _b).toUpperCase().slice(1);
  if (sat && document.activeElement !== sat) sat.value = hex;
  if (swatch) swatch.style.background = '#' + hex;
}

function _push() {
  _drawBox();
  _updateCursor();
  _syncSliders();
  if (_onChange) _onChange(hsbToHex(_h, _s, _b));
}

export function openColorPopup(anchor, initialHex, onChange) {
  const pop = document.getElementById('clr-popup');
  if (!pop) return;
  _anchor = anchor;
  _onChange = onChange || null;
  if (initialHex && /^#?[0-9a-f]{6}$/i.test(initialHex)) {
    const hsb = hexToHsb(initialHex.replace('#', '#'));
    _h = hsb.h; _s = hsb.s; _b = hsb.b;
  }
  pop.classList.add('open');
  // Position
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    const pw = 278;
    let left = r.right + 8;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, r.left - pw - 8);
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.top)) + 'px';
  } else {
    pop.style.left = '50%';
    pop.style.top = '50%';
    pop.style.transform = 'translate(-50%,-50%)';
  }
  _push();
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
    const r = wrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const y = Math.max(0, Math.min(r.height, e.clientY - r.top));
    _s = Math.round((x / r.width) * 100);
    _b = Math.round((1 - y / r.height) * 100);
    _push();
  };
  wrap.addEventListener('mousedown', (e) => { dragging = true; onBoxDrag(e); });
  window.addEventListener('mousemove', (e) => { if (dragging) onBoxDrag(e); });
  window.addEventListener('mouseup', () => { dragging = false; });

  document.getElementById('slider-h').addEventListener('input', (e) => { _h = +e.target.value; _push(); });
  document.getElementById('slider-s').addEventListener('input', (e) => { _s = +e.target.value; _push(); });
  document.getElementById('slider-b').addEventListener('input', (e) => { _b = +e.target.value; _push(); });

  const hexIn = document.getElementById('clr-hex-in');
  hexIn.addEventListener('input', () => {
    const v = hexIn.value.replace('#', '').trim();
    if (/^[0-9a-f]{6}$/i.test(v)) {
      const hsb = hexToHsb('#' + v);
      _h = hsb.h; _s = hsb.s; _b = hsb.b;
      _drawBox(); _updateCursor();
      const swatch = document.getElementById('clr-swatch');
      if (swatch) swatch.style.background = '#' + v;
      if (_onChange) _onChange('#' + v);
    }
  });

  document.getElementById('clr-hex-copy').addEventListener('click', () => {
    const hex = hsbToHex(_h, _s, _b);
    navigator.clipboard?.writeText(hex);
    import('./ui-events.js').then(m => m.toast('Copied ' + hex));
  });

  document.getElementById('clr-popup-close').addEventListener('click', closeColorPopup);

  document.addEventListener('click', (e) => {
    if (!isColorPickerOpen()) return;
    if (pop.contains(e.target)) return;
    if (_anchor && _anchor.contains(e.target)) return;
    closeColorPopup();
  });

  _drawBox();
  _updateCursor();
}
