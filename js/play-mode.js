// ══════════════════════════════════════
//  NodeBlast — PLAY MODE (MD01 + MD02)
//  Route UI layer: loads Babylon + Photon CDNs, launches the 3D
//  scene with multiplayer sync, tears down cleanly on route change.
// ══════════════════════════════════════

import { initGame, destroyGame, addOrUpdateRemotePlayer, removeRemotePlayer } from './game.js';
import { initPhoton, destroyPhoton } from './photon-client.js';
import { navigate } from './router.js';

const BABYLON_CDN = 'https://cdn.babylonjs.com/babylon.js';
const BABYLON_LOADERS_CDN = 'https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js';
const PHOTON_CDN = '/photon-realtime-module.js';

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

async function _ensurePhoton() {
  if (window.Photon) return;
  await _loadScript(PHOTON_CDN);
}

export async function renderPlayRoute() {
  const view = document.getElementById('play-view');
  const canvas = document.getElementById('play-canvas');
  if (!view || !canvas) return;

  document.title = 'play — nodeblast';
  view.classList.add('visible');

  if (!_exitWired) {
    document.getElementById('play-exit-btn')?.addEventListener('click', () => navigate('/'));
    _exitWired = true;
  }

  try {
    await _ensureBabylon();
    const result = initGame(canvas);
    _engine = result.engine;

    // Load Photon SDK and connect — non-blocking relative to Babylon
    await _ensurePhoton();
    initPhoton({
      onConnected: (myId) => {
        console.log('[play] photon connected, actor:', myId);
      },
      onPlayerUpdate: (id, x, y, z, rotY) => {
        addOrUpdateRemotePlayer(id, x, y, z, rotY);
      },
      onPlayerLeave: (id) => {
        removeRemotePlayer(id);
      },
    });
  } catch (err) {
    console.error('[play] failed to init:', err);
    view.innerHTML = '<div style="color:#f66;padding:2rem;font:14px monospace">Failed to load: ' + (err.message || err) + '</div>';
  }
}

export function destroyPlayRoute() {
  destroyPhoton();
  if (_engine) {
    destroyGame(_engine);
    _engine = null;
  }
  const view = document.getElementById('play-view');
  if (view) view.classList.remove('visible');
  try { document.exitPointerLock(); } catch {}
}
