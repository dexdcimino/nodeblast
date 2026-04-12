// ══════════════════════════════════════
//  NodeBlast — PLAY MODE (MD01–MD04)
//  Route UI layer: loads Babylon + Photon CDNs, launches the 3D
//  scene with multiplayer sync, DexNote-style exit confirmation,
//  tears down cleanly on route change.
// ══════════════════════════════════════

import State from './state.js';
import { initGame, destroyGame, addOrUpdateRemotePlayer, removeRemotePlayer } from './game.js';
import { initPhoton, destroyPhoton } from './photon-client.js';
import { navigate } from './router.js';

const BABYLON_CDN = 'https://cdn.babylonjs.com/babylon.js';
const BABYLON_LOADERS_CDN = 'https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js';
const PHOTON_CDN = '/photon-realtime-module.js';

let _engine = null;
let _modalWired = false;
let _exitModalOpen = false;

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

// ── Exit modal ──

function openExitModal() {
  if (_exitModalOpen) return;
  _exitModalOpen = true;
  try { document.exitPointerLock(); } catch {}
  const modal = document.getElementById('play-exit-modal');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeExitModal() {
  _exitModalOpen = false;
  const modal = document.getElementById('play-exit-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

// ── Route lifecycle ──

export async function renderPlayRoute() {
  const view = document.getElementById('play-view');
  const canvas = document.getElementById('play-canvas');
  if (!view || !canvas) return;

  document.title = 'play — nodeblast';
  view.classList.add('visible');
  document.getElementById('hdr')?.classList.add('play-mode');

  // Window bridge for init.js Escape handler
  window._nbOpenExitModal = openExitModal;
  window._nbCloseExitModal = closeExitModal;
  Object.defineProperty(window, '_nbPlayExitModalOpen', {
    get: () => _exitModalOpen,
    configurable: true,
  });

  // Wire modal + exit buttons once
  if (!_modalWired) {
    _modalWired = true;
    document.getElementById('play-exit-btn')?.addEventListener('click', () => openExitModal());
    document.getElementById('play-exit-yes')?.addEventListener('click', () => {
      closeExitModal();
      navigate('/');
    });
    document.getElementById('play-exit-no')?.addEventListener('click', () => closeExitModal());
    document.getElementById('play-exit-modal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('play-exit-modal')) closeExitModal();
    });
  }

  try {
    await _ensureBabylon();
    const result = initGame(canvas);
    _engine = result.engine;

    // Identity HUD
    const identEl = document.getElementById('play-identity');
    if (identEl) {
      const name = State.profile?.displayName || 'player';
      const hex = State.profile?.hexCode || '5aaa72';
      identEl.innerHTML = `<span style="color:#${hex}">\u25a0</span> ${name}`;
    }

    await _ensurePhoton();
    initPhoton({
      onConnected: (myId) => {
        console.log('[play] photon connected, actor:', myId);
      },
      onPlayerUpdate: (id, x, y, z, rotY, pitch, username, hex) => {
        addOrUpdateRemotePlayer(id, x, y, z, rotY, username, hex);
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
  closeExitModal();
  destroyPhoton();
  if (_engine) {
    destroyGame(_engine);
    _engine = null;
  }
  const view = document.getElementById('play-view');
  if (view) view.classList.remove('visible');
  document.getElementById('hdr')?.classList.remove('play-mode');
  window._nbOpenExitModal = null;
  window._nbCloseExitModal = null;
  try { document.exitPointerLock(); } catch {}
}
