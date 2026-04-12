// ══════════════════════════════════════
//  NodeBlast — PLAY MODE (MD01)
//  Route UI layer: loads Babylon CDN, launches the 3D scene,
//  tears down cleanly on route change.
// ══════════════════════════════════════

import { initGame, destroyGame } from './game.js';
import { navigate } from './router.js';

const BABYLON_CDN = 'https://cdn.babylonjs.com/babylon.js';
const BABYLON_LOADERS_CDN = 'https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js';

let _engine = null;
let _exitWired = false;

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

async function _ensureBabylon() {
  if (window.BABYLON) return;
  await _loadScript(BABYLON_CDN);
  await _loadScript(BABYLON_LOADERS_CDN);
}

export async function renderPlayRoute() {
  const view = document.getElementById('play-view');
  const canvas = document.getElementById('play-canvas');
  if (!view || !canvas) return;

  document.title = 'play — nodeblast';
  view.classList.add('visible');

  // Wire exit button once
  if (!_exitWired) {
    document.getElementById('play-exit-btn')?.addEventListener('click', () => navigate('/'));
    _exitWired = true;
  }

  try {
    await _ensureBabylon();
    const result = initGame(canvas);
    _engine = result.engine;
  } catch (err) {
    console.error('[play] failed to init game:', err);
    view.innerHTML = '<div style="color:#f66;padding:2rem;font:14px monospace">Failed to load 3D engine: ' + (err.message || err) + '</div>';
  }
}

export function destroyPlayRoute() {
  if (_engine) {
    destroyGame(_engine);
    _engine = null;
  }
  const view = document.getElementById('play-view');
  if (view) view.classList.remove('visible');
  try { document.exitPointerLock(); } catch {}
}
