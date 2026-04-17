// ══════════════════════════════════════
//  NodeBlast — DOT-SIM MODAL (DS-02)
//  Full-screen shell + control panel for the sim engine.
// ══════════════════════════════════════

import {
  dotSimInit, dotSimDestroy, dotSimSetConfig,
  dotSimHatch, dotSimGetStats, dotSimPause, dotSimResume,
  dotSimSetMode,
} from './dot-sim.js';

let _open = false;
let _paused = false;
let _statsInterval = null;
let _resizeObs = null;
let _escHandler = null;
let _selectedMode = 'competitive';

const TRIBES = [
  { name: 'Alpha', color: '#00ffaa', index: 0, traits: 'Aggressive · Social' },
  { name: 'Beta',  color: '#ff6b35', index: 1, traits: 'Fertile · Cautious' },
  { name: 'Gamma', color: '#a78bfa', index: 2, traits: 'Fast · Solitary' },
  { name: 'Delta', color: '#38bdf8', index: 3, traits: 'Balanced · Brave' },
];

const PAUSE_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
const PLAY_SVG  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';

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
  const stats = dotSimGetStats();
  const isCompetitive = stats.gameMode === 'competitive';
  TRIBES.forEach(t => {
    if (isCompetitive && t.index !== stats.playerTribe) return;
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

  // Game over check
  if (stats.gameOver && stats.gameMode === 'competitive') {
    const go = document.getElementById('ds-game-over');
    const title = document.getElementById('ds-game-over-title');
    const sub = document.getElementById('ds-game-over-sub');
    if (go && !go.classList.contains('open')) {
      title.textContent = stats.gameResult === 'win' ? 'DOMINANT' : 'DEFEATED';
      title.style.color = stats.gameResult === 'win' ? '#00ff8c' : '#ff4444';
      sub.textContent = stats.gameResult === 'win' ? 'Your tribe has claimed the arena' : 'Your tribe has fallen';
      go.classList.add('open');
      dotSimPause();
    }
  }
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

function _renderTribeCards() {
  const grid = document.getElementById('ds-tribe-select-grid');
  if (!grid) return;
  grid.innerHTML = '';
  TRIBES.forEach(t => {
    const card = document.createElement('div');
    card.className = 'ds-tribe-card';
    card.innerHTML = `<div class="ds-tribe-card-name" style="color:${t.color}">${t.name}</div><div class="ds-tribe-card-traits">${t.traits}</div>`;
    card.addEventListener('click', () => _startGame(_selectedMode, t.index));
    grid.appendChild(card);
  });
}

function _startGame(mode, tribeIndex) {
  const canvasWrap = document.querySelector('.dot-sim-canvas-wrap');
  const controls = document.querySelector('.dot-sim-controls');
  const tribeSelect = document.getElementById('ds-tribe-select');
  const gameOver = document.getElementById('ds-game-over');

  if (tribeSelect) tribeSelect.style.display = 'none';
  if (gameOver) gameOver.classList.remove('open');
  if (canvasWrap) canvasWrap.style.display = '';
  if (controls) controls.style.display = '';

  dotSimSetMode(mode, tribeIndex);
  _sizeCanvas();
  const canvas = document.getElementById('dot-sim-canvas');
  if (canvas) dotSimInit(canvas, { speed: 1, foodRate: 1, aggression: 1, fertility: 1, startingDots: 12 });

  _renderHatchBtns();

  const x = v => v.toFixed(v < 1 ? 2 : 1) + '×';
  _wireSlider('ds-speed', 'ds-speed-val', 'speed', x);
  _wireSlider('ds-aggression', 'ds-aggression-val', 'aggression', x);
  _wireSlider('ds-fertility', 'ds-fertility-val', 'fertility', x);
  _wireSlider('ds-food', 'ds-food-val', 'foodRate', x);
  _resetSliders();

  _paused = false;
  const pauseBtn = document.getElementById('dot-sim-pause-btn');
  if (pauseBtn) pauseBtn.innerHTML = PAUSE_SVG;

  if (!_statsInterval) {
    _statsInterval = setInterval(_updateStats, 250);
  }
  _updateStats();
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

  // Show tribe select, hide canvas/controls
  const canvasWrap = document.querySelector('.dot-sim-canvas-wrap');
  const controls = document.querySelector('.dot-sim-controls');
  const tribeSelect = document.getElementById('ds-tribe-select');
  const gameOver = document.getElementById('ds-game-over');
  if (canvasWrap) canvasWrap.style.display = 'none';
  if (controls) controls.style.display = 'none';
  if (gameOver) gameOver.classList.remove('open');
  if (tribeSelect) { tribeSelect.style.display = 'flex'; _renderTribeCards(); }

  // Mode toggle
  const compBtn = document.getElementById('ds-mode-competitive');
  const sandBtn = document.getElementById('ds-mode-sandbox');
  if (compBtn) compBtn.onclick = () => {
    _selectedMode = 'competitive';
    compBtn.classList.add('active'); sandBtn?.classList.remove('active');
  };
  if (sandBtn) sandBtn.onclick = () => {
    _selectedMode = 'sandbox';
    sandBtn.classList.add('active'); compBtn?.classList.remove('active');
  };
  // Reset toggle state
  _selectedMode = 'competitive';
  if (compBtn) compBtn.classList.add('active');
  if (sandBtn) sandBtn.classList.remove('active');

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

  // Restart — return to tribe select
  const restartBtn = document.getElementById('dot-sim-restart-btn');
  if (restartBtn) {
    restartBtn.onclick = () => {
      dotSimDestroy();
      _paused = false;
      if (pauseBtn) pauseBtn.innerHTML = PAUSE_SVG;
      if (_statsInterval) { clearInterval(_statsInterval); _statsInterval = null; }
      if (canvasWrap) canvasWrap.style.display = 'none';
      if (controls) controls.style.display = 'none';
      if (gameOver) gameOver.classList.remove('open');
      if (tribeSelect) { tribeSelect.style.display = 'flex'; _renderTribeCards(); }
    };
  }

  // Download source
  const dlBtn = document.getElementById('dot-sim-download-btn');
  if (dlBtn) dlBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = './js/dot-sim.js';
    a.download = 'dot-sim.js';
    a.click();
  };

  // Close
  const closeBtn = document.getElementById('dot-sim-close-btn');
  if (closeBtn) closeBtn.onclick = () => closeDotSim();

  // Game over restart
  const goRestart = document.getElementById('ds-game-over-restart');
  if (goRestart) goRestart.onclick = () => {
    closeDotSim();
    setTimeout(() => openDotSim(catalystTitle), 50);
  };

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
