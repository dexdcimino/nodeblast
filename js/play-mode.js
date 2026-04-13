// ══════════════════════════════════════
//  NodeBlast — PLAY MODE (MD01–MD04)
//  Route UI layer: loads Babylon + Photon CDNs, launches the 3D
//  scene with multiplayer sync, DexNote-style exit confirmation,
//  tears down cleanly on route change.
// ══════════════════════════════════════

import State from './state.js';
import { initGame, destroyGame, addOrUpdateRemotePlayer, removeRemotePlayer, getRemotePlayerIds, damageRemotePlayer } from './game.js';
import { initPhoton, destroyPhoton, setPhotonStatus, photonSendDamage } from './photon-client.js';
import { initHathora, destroyHathora, hathoraSendMove, isHathoraConnected } from './hathora-client.js';
import { navigate } from './router.js';

const BABYLON_CDN = 'https://cdn.babylonjs.com/babylon.js';
const BABYLON_LOADERS_CDN = 'https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js';
const PHOTON_CDN = '/photon-realtime-module.js';

let _engine = null;
let _modalWired = false;
let _exitModalOpen = false;

function _addKillFeedEntry(attackerName, targetActorId) {
  const feed = document.getElementById('play-killfeed');
  if (!feed) return;
  const entry     = document.createElement('div');
  entry.className = 'killfeed-entry';
  entry.innerHTML = `<span style="color:#00ff88">${attackerName || 'Unknown'}</span> \u26A1 actor ${targetActorId}`;
  feed.appendChild(entry);
  setTimeout(() => { try { feed.removeChild(entry); } catch {} }, 4000);
  while (feed.children.length > 5) feed.removeChild(feed.firstChild);
}

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

    // Wire damage bridges
    window._nbSendDamage = (targetId, dmg, name) => {
      photonSendDamage(targetId, dmg, name);
    };

    // Request pointer lock immediately — the Play button click is
    // the required user gesture, so this fires without needing
    // a second click on the canvas
    setTimeout(() => {
      const c = document.getElementById('play-canvas');
      if (c && !document.pointerLockElement) {
        c.requestPointerLock();
      }
    }, 100);

    // Identity HUD
    const identEl = document.getElementById('play-identity');
    if (identEl) {
      const name = State.profile?.displayName || 'player';
      const hex  = State.profile?.hexCode || '5aaa72';
      identEl.innerHTML = `<span style="color:#${hex};font-size:18px;vertical-align:middle;margin-right:6px;">●</span><span style="vertical-align:middle">${name}</span>`;
    }

    // Hathora window bridges for photon-client.js dual-send
    window._nbHathoraConnected = isHathoraConnected;
    window._nbHathoraSendMove = hathoraSendMove;

    await _ensurePhoton();
    initPhoton({
      onConnected: (myId) => {
        console.log('[play] photon connected, actor:', myId);
        // Assign spawn based on actor number
        const spawnZ = (myId % 2 === 1) ? -48 : 48;
        const spawnX = (Math.random() - 0.5) * 6;
        if (window._nbSetSpawn) window._nbSetSpawn(spawnX, spawnZ);
        // Layer Hathora on top of Photon for authoritative state
        const name = State.profile?.displayName || 'player';
        const hex = State.profile?.hexCode || '5aaa72';
        initHathora({
          roomId: 'nodeblast-main',
          username: name,
          hex: hex,
          onSnapshot: (players, myHathoraId) => {
            const snapshotIds = new Set();
            players.forEach((p) => {
              if (p.id === myHathoraId) return;
              snapshotIds.add(p.id);
              addOrUpdateRemotePlayer(p.id, p.x, p.y, p.z, p.rotY, p.username, p.hex);
            });
            getRemotePlayerIds().forEach((id) => {
              if (!snapshotIds.has(id)) removeRemotePlayer(id);
            });
          },
          onConnected: (id) => {
            console.log('[play] hathora connected:', id);
            setPhotonStatus('online (authoritative)');
          },
          onError: (err) => {
            console.warn('[play] hathora failed, staying on photon:', err?.message || err);
            setPhotonStatus('online (relay)');
          },
        });
      },
      onPlayerUpdate: (id, x, y, z, rotY, pitch, username, hex) => {
        // Only use Photon updates when Hathora is not connected
        if (!isHathoraConnected()) {
          addOrUpdateRemotePlayer(id, x, y, z, rotY, username, hex);
        }
      },
      onPlayerLeave: (id) => {
        if (!isHathoraConnected()) {
          removeRemotePlayer(id);
        }
      },
      onPlayerDamage: (targetId, damage, attackerName) => {
        if (targetId === window._nbMyActorId) {
          if (window._nbApplyPlayerDamage) window._nbApplyPlayerDamage(damage);
        } else {
          damageRemotePlayer(targetId, damage);
        }
        _addKillFeedEntry(attackerName, targetId);
      },
    });
  } catch (err) {
    console.error('[play] failed to init:', err);
    view.innerHTML = '<div style="color:#f66;padding:2rem;font:14px monospace">Failed to load: ' + (err.message || err) + '</div>';
  }
}

export function destroyPlayRoute() {
  closeExitModal();
  destroyHathora();
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
  window._nbHathoraConnected = null;
  window._nbHathoraSendMove = null;
  window._nbSendDamage = null;
  window._nbOnPlayerDamaged = null;
  window._nbPhotonSendDamage = null;
  try { document.exitPointerLock(); } catch {}
}
