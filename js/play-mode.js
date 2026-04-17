// ══════════════════════════════════════
//  NodeBlast — PLAY MODE (MD01–MD04)
//  Route UI layer: loads Babylon + Photon CDNs, launches the 3D
//  scene with multiplayer sync, DexNote-style exit confirmation,
//  tears down cleanly on route change.
// ══════════════════════════════════════

import State from './state.js';
import { initGame, destroyGame, attachCameraInput, addOrUpdateRemotePlayer, removeRemotePlayer, getRemotePlayerIds, damageRemotePlayer, getRemotePlayerData } from './game.js';
import { initPhoton, destroyPhoton, setPhotonStatus, photonSendDamage, isInRoom } from './photon-client.js';
import { initHathora, destroyHathora, hathoraSendMove, isHathoraConnected } from './hathora-client.js';
import { navigate } from './router.js';

const BABYLON_CDN = 'https://cdn.babylonjs.com/babylon.js';
const BABYLON_LOADERS_CDN = 'https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js';
const PHOTON_CDN = '/photon-realtime-module.js';

let _engine = null;
let _modalWired = false;
let _exitModalOpen = false;
let _returnPath = '/games';
let _loadTimeout = null;

const MAX_VISIBLE_PLAYERS = 8;

function _updatePlayerList() {
  const list = document.getElementById('play-player-list');
  if (!list) return;
  list.innerHTML = '';

  const localName = State.profile?.displayName || 'You';
  const localHex  = (State.profile?.hexCode || '5aaa72').replace('#', '');

  // ── Player count header ──
  const ids    = getRemotePlayerIds();
  const total  = 1 + ids.length;
  let countEl  = document.getElementById('play-player-count');
  if (!countEl) {
    countEl = document.createElement('div');
    countEl.id = 'play-player-count';
    list.parentElement?.insertBefore(countEl, list);
  }
  countEl.textContent = `${total} / ${MAX_VISIBLE_PLAYERS} players`;

  // ── Local player row (always first, pulsing dot) ──
  const localPill = document.createElement('div');
  localPill.className = 'player-list-pill player-list-self';
  localPill.innerHTML = `
    <span class="player-list-dot pulse" style="background:#${localHex};box-shadow:0 0 6px #${localHex}"></span>
    <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${localName}</span>
    <span style="font-size:10px;opacity:0.45;flex-shrink:0">you</span>
  `;
  list.appendChild(localPill);

  // ── Remote players (cap display at MAX_VISIBLE_PLAYERS - 1) ──
  const visible  = ids.slice(0, MAX_VISIBLE_PLAYERS - 1);
  const overflow = ids.length - visible.length;

  visible.forEach(id => {
    const data = getRemotePlayerData(id);
    const name = data?.username || ('Player ' + id);
    const hex  = (data?.hex || '5aaa72').replace('#', '');
    const pill = document.createElement('div');
    pill.className = 'player-list-pill';
    pill.innerHTML = `
      <span class="player-list-dot" style="background:#${hex};box-shadow:0 0 5px #${hex}"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${name}</span>
    `;
    list.appendChild(pill);
  });

  // ── Overflow indicator if somehow > 8 ──
  if (overflow > 0) {
    const ovf = document.createElement('div');
    ovf.className = 'player-list-overflow';
    ovf.textContent = `+${overflow} more`;
    list.appendChild(ovf);
  }
}

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

function closeExitModal(skipRelock) {
  _exitModalOpen = false;
  const modal = document.getElementById('play-exit-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  // Re-acquire pointer lock so mouse immediately controls camera again
  // BUT skip if we're exiting the game entirely
  if (!skipRelock) {
    setTimeout(() => {
      const canvas = document.getElementById('play-canvas');
      if (canvas && !document.pointerLockElement) {
        canvas.requestPointerLock().catch(() => {});
      }
    }, 80);
  }
}

// ── Route lifecycle ──

export async function renderPlayRoute(gameId) {
  const view = document.getElementById('play-view');
  const canvas = document.getElementById('play-canvas');
  if (!view || !canvas) return;

  // Remember where the player came from so exit returns them there
  const currentPath = window.location.pathname;
  if (!currentPath.startsWith('/game/') && currentPath !== '/play') {
    _returnPath = currentPath;
  } else {
    _returnPath = document.referrer && new URL(document.referrer).pathname !== currentPath
      ? new URL(document.referrer).pathname
      : '/games';
  }

  console.log('[play] loading game:', gameId || 'arena1');

  // Detect mobile — play mode requires keyboard + mouse
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && !window.matchMedia('(pointer:fine)').matches);
  if (isMobile) {
    view.classList.add('visible');
    view.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;font-family:'Outfit',sans-serif;color:rgba(255,255,255,0.8);padding:32px;text-align:center;">
        <div style="font-size:48px">🎮</div>
        <div style="font-size:22px;font-weight:700">Desktop Only</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.5)">Play mode requires a keyboard and mouse.<br>Visit on desktop to play.</div>
        <button onclick="history.back()" style="margin-top:8px;padding:10px 24px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-family:'Outfit',sans-serif;font-size:14px;cursor:pointer;">← Back</button>
      </div>`;
    document.getElementById('hdr')?.classList.add('play-mode');
    return;
  }

  document.title = 'play — nodeblast';
  view.classList.add('visible');
  document.getElementById('hdr')?.classList.add('play-mode');

  // Show loading overlay immediately — hides the broken pre-init canvas
  const loadOverlay = document.getElementById('play-loading-overlay');
  const loadBar     = document.getElementById('play-loading-bar');
  const loadLabel   = document.getElementById('play-loading-label');
  if (loadOverlay) {
    loadOverlay.style.display = '';
    loadOverlay.classList.remove('hidden');
    if (loadBar) loadBar.style.width = '0%';
  }

  // Safety timeout — if loading takes more than 15 seconds, bail out
  _loadTimeout = setTimeout(() => {
    console.error('[play] loading timed out — redirecting to /games');
    try { document.exitPointerLock(); } catch {}
    if (loadOverlay) loadOverlay.style.display = 'none';
    navigate('/games');
  }, 15000);

  function _setLoadProgress(pct, label) {
    if (loadBar)   loadBar.style.width   = pct + '%';
    if (loadLabel) loadLabel.textContent = label || 'Loading Arena...';
  }

  function _hideLoadOverlay() {
    if (!loadOverlay) return;
    loadOverlay.classList.add('hidden');
    // Attach camera input NOW — not during loading — so mouse movement
    // during the loading screen doesn't accumulate into camera rotation
    attachCameraInput();
    // Remove from DOM after transition so it doesn't intercept clicks
    setTimeout(() => {
      if (loadOverlay.parentNode) loadOverlay.style.display = 'none';
    }, 600);
  }

  // Window bridge for init.js Escape handler
  window._nbOpenExitModal = openExitModal;
  window._nbCloseExitModal = closeExitModal;
  Object.defineProperty(window, '_nbPlayExitModalOpen', {
    get: () => _exitModalOpen,
    configurable: true,
  });

  // Wire modal + exit buttons + audio toggle once
  if (!_modalWired) {
    _modalWired = true;
    let _audioOn = true;
    document.getElementById('play-audio-btn')?.addEventListener('click', () => {
      _audioOn = !_audioOn;
      if (window._nbSetAudio) window._nbSetAudio(_audioOn);
      const btn = document.getElementById('play-audio-btn');
      if (btn) btn.textContent = _audioOn ? '\uD83D\uDD0A' : '\uD83D\uDD07';
    });
    document.getElementById('play-exit-btn')?.addEventListener('click', () => openExitModal());
    document.getElementById('play-exit-yes')?.addEventListener('click', () => {
      closeExitModal(true);
      navigate(_returnPath || '/games');
    });
    document.getElementById('play-exit-no')?.addEventListener('click', () => closeExitModal());
    document.getElementById('play-exit-modal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('play-exit-modal')) closeExitModal();
    });
  }

  try {
    _setLoadProgress(15, 'Loading Engine...');
    await _ensureBabylon();
    _setLoadProgress(45, 'Building Arena...');
    const result = initGame(canvas);
    _engine = result.engine;

    // Arena is built and rendering — hide loading overlay now
    // (multiplayer connection happens in background)
    _setLoadProgress(100, 'Ready!');
    clearTimeout(_loadTimeout);
    setTimeout(_hideLoadOverlay, 300);

    // Wire damage bridges
    window._nbSendDamage = (targetId, dmg, name) => {
      photonSendDamage(targetId, dmg, name);
    };

    _setLoadProgress(75, 'Connecting...');

    // Request pointer lock immediately — the Play button click is
    // the required user gesture, so this fires without needing
    // a second click on the canvas
    setTimeout(() => {
      const c = document.getElementById('play-canvas');
      if (c && !document.pointerLockElement) {
        c.requestPointerLock().catch(() => {});
      }
    }, 100);

    // Identity HUD
    const identEl = document.getElementById('play-identity');
    const name    = State.profile?.displayName || 'player';
    const hex     = (State.profile?.hexCode || '5aaa72').replace('#', '');
    if (identEl) {
      identEl.innerHTML = `<span style="color:#${hex};font-size:18px;vertical-align:middle;margin-right:6px;">●</span><span style="vertical-align:middle">${name}</span>`;
    }

    // Profile pill (top-right)
    const pillDot  = document.getElementById('play-profile-dot');
    const pillName = document.getElementById('play-profile-name');
    if (pillDot)  { pillDot.style.background = '#' + hex; pillDot.style.color = '#' + hex; }
    if (pillName) pillName.textContent = name;

    // Notification badge — check if there are unread notifications
    const notifBadge = document.getElementById('play-notif-badge');
    if (notifBadge && State.unreadNotifCount > 0) {
      notifBadge.classList.remove('hidden');
    }

    // Notification button opens notifications when clicked
    document.getElementById('play-notif-btn')?.addEventListener('click', () => {
      try { document.exitPointerLock(); } catch {}
      // Navigate to notifications after exit
      setTimeout(() => {
        if (window._nbOpenExitModal) window._nbOpenExitModal();
      }, 50);
    });

    // Hathora window bridges for photon-client.js dual-send
    window._nbHathoraConnected = isHathoraConnected;
    window._nbHathoraSendMove = hathoraSendMove;

    _setLoadProgress(88, 'Joining Server...');
    await _ensurePhoton();
    initPhoton({
      onConnected: (myId) => {
        console.log('[play] photon connected, actor:', myId);
        console.log('[play] multiplayer connected');
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
            // Only remove Hathora-tracked players (UUID string IDs), not Photon players (integer IDs)
            getRemotePlayerIds().forEach((id) => {
              const isHathoraId = typeof id === 'string' && id.length > 8;
              if (isHathoraId && !snapshotIds.has(id)) removeRemotePlayer(id);
            });
            _updatePlayerList();
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
        addOrUpdateRemotePlayer(id, x, y, z, rotY, username, hex);
        _updatePlayerList();
      },
      onPlayerLeave: (id) => {
        removeRemotePlayer(id);
        _updatePlayerList();
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
    window._nbPhotonInRoom = isInRoom;
  } catch (err) {
    clearTimeout(_loadTimeout);
    console.error('[play] failed to init:', err);
    try { document.exitPointerLock(); } catch {}
    if (loadOverlay) loadOverlay.style.display = 'none';
    navigate('/games');
  }
}

export function destroyPlayRoute() {
  if (_loadTimeout) { clearTimeout(_loadTimeout); _loadTimeout = null; }
  closeExitModal(true);
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
  window._nbPhotonInRoom = null;
  try { document.exitPointerLock(); } catch {}
  document.body.style.cursor = '';
}
