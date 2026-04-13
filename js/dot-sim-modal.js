// ══════════════════════════════════════
//  NodeBlast — DOT-SIM MODAL (DS-02)
//  Full-screen shell + control panel for the sim engine.
// ══════════════════════════════════════

import {
  dotSimInit, dotSimDestroy, dotSimSetConfig,
  dotSimHatch, dotSimGetStats, dotSimPause, dotSimResume,
} from './dot-sim.js';

let _open = false;
let _paused = false;
let _statsInterval = null;
let _resizeObs = null;
let _escHandler = null;

const TRIBES = [
  { name: 'Alpha', color: '#00ffaa', index: 0 },
  { name: 'Beta',  color: '#ff6b35', index: 1 },
  { name: 'Gamma', color: '#a78bfa', index: 2 },
  { name: 'Delta', color: '#38bdf8', index: 3 },
];

const PAUSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
const PLAY_SVG  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';

function _sizeCanvas() {
  const wrap = document.querySelector('.dot-sim-canvas-wrap');
  const canvas = document.getElementById('dot-sim-canvas');
  if (!wrap || !canvas) return;
  const r = wrap.getBoundingClientRect();
  canvas.width  = Math.round(r.width);
  canvas.height = Math.round(r.height);
}

function _renderHatchBtns() {
  const row = document.getElementById('dot-sim-hatch-row');
  if (!row) return;
  row.innerHTML = '';
  TRIBES.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'dot-sim-hatch-btn';
    btn.style.color = t.color;
    btn.textContent = '＋ ' + t.name;
    btn.addEventListener('click', () => dotSimHatch(t.index, 3));
    row.appendChild(btn);
  });
}

function _renderTribeStrip(tribes) {
  const strip = document.getElementById('dot-sim-tribe-strip');
  if (!strip) return;
  strip.innerHTML = '';
  tribes.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'dot-sim-tribe-chip';
    chip.innerHTML = `<span class="chip-dot" style="background:${t.color}"></span>${t.name} <b>${t.count}</b>`;
    strip.appendChild(chip);
  });
}

function _updateStats() {
  const stats = dotSimGetStats();
  const el = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  el('dot-sim-stat-total', stats.totalDots + ' dots');
  el('dot-sim-stat-fps', Math.round(stats.fps) + ' fps');
  el('dot-sim-stat-tick', 'tick ' + stats.tick);
  _renderTribeStrip(stats.tribes);
}

function _wireSlider(id, valId, key, fmt) {
  const slider = document.getElementById(id);
  const valEl  = document.getElementById(valId);
  if (!slider) return;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    if (valEl) valEl.textContent = fmt(v);
    dotSimSetConfig({ [key]: v });
  });
  // Reset display
  if (valEl) valEl.textContent = fmt(parseFloat(slider.value));
}

function _resetSliders() {
  const sets = [
    ['ds-speed', '1'], ['ds-aggression', '1'], ['ds-fertility', '1'], ['ds-food', '1'],
  ];
  sets.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.dispatchEvent(new Event('input')); }
  });
}

// ── Public API ──

export function openDotSim(catalystTitle) {
  if (_open) return;
  _open = true;
  _paused = false;

  const modal = document.getElementById('dot-sim-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  const sub = document.getElementById('dot-sim-subtitle');
  if (sub) sub.textContent = catalystTitle || 'Arena';

  // Size canvas before init
  _sizeCanvas();
  const canvas = document.getElementById('dot-sim-canvas');
  if (canvas) dotSimInit(canvas, { speed: 1, foodRate: 1, aggression: 1, fertility: 1, startingDots: 12 });

  // Hatch buttons
  _renderHatchBtns();

  // Sliders
  const x = v => v.toFixed(v < 1 ? 2 : 1) + '×';
  _wireSlider('ds-speed', 'ds-speed-val', 'speed', x);
  _wireSlider('ds-aggression', 'ds-aggression-val', 'aggression', x);
  _wireSlider('ds-fertility', 'ds-fertility-val', 'fertility', x);
  _wireSlider('ds-food', 'ds-food-val', 'foodRate', x);
  _resetSliders();

  // Pause button
  const pauseBtn = document.getElementById('dot-sim-pause-btn');
  if (pauseBtn) {
    pauseBtn.innerHTML = PAUSE_SVG;
    pauseBtn.onclick = () => {
      _paused = !_paused;
      if (_paused) dotSimPause(); else dotSimResume();
      pauseBtn.innerHTML = _paused ? PLAY_SVG : PAUSE_SVG;
    };
  }

  // Restart
  const restartBtn = document.getElementById('dot-sim-restart-btn');
  if (restartBtn) {
    restartBtn.onclick = () => {
      dotSimDestroy();
      _paused = false;
      if (pauseBtn) pauseBtn.innerHTML = PAUSE_SVG;
      _resetSliders();
      _sizeCanvas();
      const c = document.getElementById('dot-sim-canvas');
      if (c) dotSimInit(c, { speed: 1, foodRate: 1, aggression: 1, fertility: 1, startingDots: 12 });
    };
  }

  // Close
  const closeBtn = document.getElementById('dot-sim-close-btn');
  if (closeBtn) closeBtn.onclick = () => closeDotSim();

  // Backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDotSim();
  });

  // ESC key
  _escHandler = (e) => {
    if (e.key === 'Escape' && _open) { closeDotSim(); e.stopPropagation(); }
  };
  document.addEventListener('keydown', _escHandler, true);

  // Resize observer
  const wrap = document.querySelector('.dot-sim-canvas-wrap');
  if (wrap && typeof ResizeObserver !== 'undefined') {
    _resizeObs = new ResizeObserver(() => _sizeCanvas());
    _resizeObs.observe(wrap);
  }

  // Stats polling
  _statsInterval = setInterval(_updateStats, 250);
  _updateStats();
}

export function closeDotSim() {
  if (!_open) return;
  _open = false;
  dotSimDestroy();
  if (_statsInterval) { clearInterval(_statsInterval); _statsInterval = null; }
  if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
  if (_escHandler) { document.removeEventListener('keydown', _escHandler, true); _escHandler = null; }
  const modal = document.getElementById('dot-sim-modal');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
  document.body.style.overflow = '';
}
