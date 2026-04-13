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
let _sendTimer = null;

export function setPhotonStatus(msg) {
  const el = document.getElementById('play-status');
  if (el) el.textContent = msg;
}

export function initPhoton({ onPlayerUpdate, onPlayerLeave, onConnected }) {
  const P = window.Photon;
  if (!P) throw new Error('Photon SDK not loaded');

  _onPlayerUpdate = onPlayerUpdate || null;
  _onPlayerLeave  = onPlayerLeave  || null;
  _onConnected    = onConnected    || null;

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
      _client.joinRoom('nodeblast-main');
    }

    if (name === 'Joined') {
      if (_inRoom) return;
      _inRoom = true;
      _myId = _client.myActor().actorNr;
      window._nbMyActorId = _myId;
      console.log('[photon] in room, my actor:', _myId);
      _updatePlayerCount();
      if (_onConnected) _onConnected(_myId);
      _startSendLoop();
    }

    if (name === 'Error' || name === 'Disconnected') {
      setPhotonStatus('offline');
      _inRoom = false;
    }
  };

  _client.onJoinRoomFailed = (code, msg) => {
    console.log('[photon] join failed, creating new room:', code, msg);
    const roomId = 'nodeblast-' + Math.floor(Date.now() / 30000);
    _client.createRoom(roomId, { maxPlayers: MAX_PLAYERS_PER_ROOM });
  };

  _client.onActorLeave = (actor) => {
    if (_onPlayerLeave) _onPlayerLeave(actor.actorNr);
    _updatePlayerCount();
  };

  _client.onActorJoin = () => {
    _updatePlayerCount();
  };

  _client.onEvent = (code, content, actorNr) => {
    if (code === 1) {
      console.log('[photon] pos update from actor:', actorNr,
        'my id:', _myId,
        'x:', content?.x?.toFixed(2),
        'z:', content?.z?.toFixed(2));
      if (actorNr !== _myId && _onPlayerUpdate) {
        _onPlayerUpdate(
          actorNr,
          content.x, content.y, content.z,
          content.rotY, content.pitch,
          content.username, content.hex,
        );
      }
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

export function photonSendState(x, y, z, rotY, pitch, username, hex) {
  if (!_inRoom || !_client) return;
  _client.raiseEvent(1, { x, y, z, rotY, pitch, username, hex });
}

function _startSendLoop() {
  if (_sendTimer) clearInterval(_sendTimer);
  _sendTimer = setInterval(() => {
    if (!window._nbGetPlayerState) return;
    const s = window._nbGetPlayerState();
    if (!s) return;
    console.log('[photon] sending state:', s.x.toFixed(2), s.z.toFixed(2));
    if (window._nbHathoraConnected?.()) {
      window._nbHathoraSendMove?.(s.x, s.y, s.z, s.rotY, s.pitch);
    }
    photonSendState(s.x, s.y, s.z, s.rotY, s.pitch, s.username, s.hex);
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
}
