// ══════════════════════════════════════
//  NodeBlast — PHOTON CLIENT
//  Uses verified callback names from photon-realtime-module.js
// ══════════════════════════════════════

const PHOTON_APP_ID = 'ff6d154a-33f9-480a-bb99-eeccfde3b012';
const PHOTON_APP_VERSION = '1.0';
const SEND_RATE_MS = 50;
const MAX_PLAYERS_PER_ROOM = 8;

let _client = null;
let _myId = null;
let _connected = false;
let _inRoom = false;
let _onPlayerUpdate = null;
let _onPlayerLeave = null;
let _onConnected = null;
let _onPlayerDamage = null;
let _sendTimer = null;

export function setPhotonStatus(msg) {
  const el = document.getElementById('play-status');
  if (el) el.textContent = msg;
}

export function initPhoton({ onPlayerUpdate, onPlayerLeave, onConnected, onPlayerDamage }) {
  const P = window.Photon;
  if (!P) throw new Error('Photon SDK not loaded');

  _onPlayerUpdate = onPlayerUpdate || null;
  _onPlayerLeave  = onPlayerLeave  || null;
  _onConnected    = onConnected    || null;
  _onPlayerDamage = onPlayerDamage || null;

  _client = new P.LoadBalancing.LoadBalancingClient(
    P.ConnectionProtocol.Wss,
    PHOTON_APP_ID,
    PHOTON_APP_VERSION,
  );

  _client.onStateChange = (state) => {
    const name = P.LoadBalancing.LoadBalancingClient.StateToName(state);
    console.log('[photon] state:', state, name);

    if (name === 'ConnectedToMaster') {
      _connected = true;
      setPhotonStatus('joining lobby...');
    }

    if (name === 'JoinedLobby') {
      setPhotonStatus('finding room...');
      // Atomic join-or-create — eliminates race condition when two players
      // join simultaneously and both see the room as not existing yet
      _client.joinRoom(
        'nodeblast-main',
        { createIfNotExists: true },
        { maxPlayers: MAX_PLAYERS_PER_ROOM, isVisible: true, isOpen: true },
      );
    }

    if (name === 'Joined') {
      if (_inRoom) return;
      _inRoom = true;
      _myId = _client.myActor().actorNr;
      window._nbMyActorId = _myId;
      const roomName    = _client.myRoom()?.name || 'unknown';
      const actorCount  = _client.myRoomActorsCount?.() || '?';
      console.log(`[photon] ✅ in room "${roomName}", actor: ${_myId}, total actors: ${actorCount}`);

      // Set actor custom properties so all room members can see our identity immediately
      // (doesn't require waiting for first position event)
      try {
        const s = window._nbGetPlayerState?.();
        if (s) {
          _client.myActor().setCustomProperties({
            username: s.username || 'player',
            hex:      s.hex      || '5aaa72',
          });
        }
      } catch (e) {
        console.warn('[photon] could not set actor props:', e.message);
      }

      _updatePlayerCount();
      if (_onConnected) _onConnected(_myId);
      _startSendLoop();

      // Immediately broadcast position once to Others so existing room members
      // can render us before our first 50ms loop tick
      setTimeout(() => {
        const s = window._nbGetPlayerState?.();
        if (s && _inRoom && _client) {
          const P = window.Photon;
          _client.raiseEvent(1,
            { x: s.x, y: s.y, z: s.z, rotY: s.rotY, pitch: s.pitch,
              username: s.username || 'player', hex: s.hex || '5aaa72' },
            { receivers: P.LoadBalancing.Constants.ReceiverGroup.Others },
          );
        }
      }, 200);
    }

    if (name === 'Error' || name === 'Disconnected') {
      setPhotonStatus('offline');
      _inRoom = false;
    }
  };

  _client.onJoinRoomFailed = (code, msg) => {
    // Should not happen with createIfNotExists — log for diagnostics only
    console.warn('[photon] ⚠️ joinRoom failed even with createIfNotExists:', code, msg);
    setPhotonStatus('room error — retrying...');
    // Last-resort retry after 1s
    setTimeout(() => {
      if (!_inRoom && _client) {
        _client.joinRoom(
          'nodeblast-main',
          { createIfNotExists: true },
          { maxPlayers: MAX_PLAYERS_PER_ROOM },
        );
      }
    }, 1000);
  };

  _client.onActorLeave = (actor) => {
    console.log('[photon] actor left:', actor.actorNr);
    if (_onPlayerLeave) _onPlayerLeave(actor.actorNr);
    _updatePlayerCount();
  };

  _client.onActorJoin = (actor) => {
    console.log(`[photon] 👤 actor joined: ${actor.actorNr} — room now has ${_client.myRoomActorsCount?.() || '?'} players`);
    _updatePlayerCount();

    // When someone new joins, immediately send our position so they can place us
    // without waiting up to 50ms for the next loop tick
    const s = window._nbGetPlayerState?.();
    if (s && _inRoom && _client) {
      photonSendState(s.x, s.y, s.z, s.rotY, s.pitch, s.username || 'player', s.hex || '5aaa72');
    }

    // Also read their actor properties for immediate name/color display
    try {
      const props = actor.getCustomProperties?.() || {};
      if (props.username && _onPlayerUpdate && actor.actorNr !== _myId) {
        // Trigger a player update with last known position (0,0,0) so the pill appears
        // Their real position arrives with the next event
        _onPlayerUpdate(actor.actorNr, 0, 1.8, 0, 0, 0, props.username, props.hex || '5aaa72');
      }
    } catch (e) {}
  };

  _client.onEvent = (code, content, actorNr) => {
    if (code === 1) {
      if (actorNr !== _myId && _onPlayerUpdate) {
        _onPlayerUpdate(
          actorNr,
          content.x, content.y, content.z,
          content.rotY, content.pitch,
          content.username, content.hex,
        );
      }
    }
    if (code === 2 && _onPlayerDamage) {
      _onPlayerDamage(content.targetId, content.damage, content.attackerName);
    }
  };

  _client.onError = (errorCode, errorMsg) => {
    console.warn('[photon] error:', errorCode, errorMsg);
    setPhotonStatus('offline');
  };

  setPhotonStatus('connecting...');
  _client.connectToRegionMaster('us');
}

function _updatePlayerCount() {
  if (!_client) return;
  try {
    const count = _client.myRoomActorsCount();
    setPhotonStatus('online \u2014 ' + count + (count === 1 ? ' player' : ' players'));
  } catch {}
}

export function photonSendDamage(targetActorId, damage, attackerName) {
  if (!_inRoom || !_client) return;
  const P = window.Photon;
  _client.raiseEvent(2,
    { targetId: targetActorId, damage, attackerName },
    { receivers: P.LoadBalancing.Constants.ReceiverGroup.All }
  );
}

export function photonSendState(x, y, z, rotY, pitch, username, hex) {
  if (!_inRoom || !_client) return;
  _client.raiseEvent(1, { x, y, z, rotY, pitch, username, hex });
}

let _sendCount = 0;
function _startSendLoop() {
  if (_sendTimer) clearInterval(_sendTimer);
  _sendTimer = setInterval(() => {
    if (!window._nbGetPlayerState) return;
    const s = window._nbGetPlayerState();
    if (!s) return;
    _sendCount++;
    if (_sendCount % 40 === 0) { // log every ~2s
      console.log(`[photon] 📡 broadcasting state — pos: (${s.x?.toFixed(1)}, ${s.y?.toFixed(1)}, ${s.z?.toFixed(1)}), user: ${s.username}`);
    }
    if (window._nbHathoraConnected?.()) {
      window._nbHathoraSendMove?.(s.x, s.y, s.z, s.rotY, s.pitch);
    }
    photonSendState(s.x, s.y, s.z, s.rotY, s.pitch, s.username || 'player', s.hex || '5aaa72');
  }, SEND_RATE_MS);
}

export function destroyPhoton() {
  if (_sendTimer) { clearInterval(_sendTimer); _sendTimer = null; }
  if (_client) {
    try { _client.disconnect(); } catch {}
    _client = null;
  }
  _connected = false;
  _inRoom    = false;
  _myId      = null;
  _onPlayerUpdate = null;
  _onPlayerLeave  = null;
  _onConnected    = null;
  _onPlayerDamage = null;
}

export function isInRoom() { return _inRoom; }

// ── Debug helper — call window._nbPhotonStatus() in console to diagnose ──
window._nbPhotonStatus = () => {
  if (!_client) { console.log('[photon] not initialized'); return; }
  try {
    const room    = _client.myRoom();
    const actors  = _client.myRoomActors?.() || {};
    const actorList = Object.values(actors).map(a => ({
      nr:         a.actorNr,
      isLocal:    a.isLocal,
      userId:     a.userId,
      customProps: a.getCustomProperties?.() || {},
    }));
    console.table({
      inRoom:     _inRoom,
      myActorNr:  _myId,
      roomName:   room?.name,
      isOpen:     room?.isOpen,
      isVisible:  room?.isVisible,
      playerCount: room?.playerCount,
    });
    console.log('[photon] actors in room:', actorList);
  } catch (e) {
    console.warn('[photon] status error:', e.message);
  }
};
