// ══════════════════════════════════════
//  NodeBlast — PHOTON CLIENT (MD02)
//  Photon Realtime multiplayer: connection lifecycle + state sync.
//  Completely separate from Babylon — just syncs position data.
// ══════════════════════════════════════

const PHOTON_APP_ID = 'ff6d154a-33f9-480a-bb99-eeccfde3b012';
const PHOTON_APP_VERSION = '1.0';
const SEND_RATE_MS = 50;
const MAX_PLAYERS_PER_ROOM = 8;

let _client = null;
let _myId = null;
let _connected = false;
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
  _onPlayerLeave = onPlayerLeave || null;
  _onConnected = onConnected || null;

  _client = new P.LoadBalancing.LoadBalancingClient(
    P.ConnectionProtocol.Wss,
    PHOTON_APP_ID,
    PHOTON_APP_VERSION,
  );

  _client.onStateChange = (state) => {
    console.log('[photon] state:', P.LoadBalancing.LoadBalancingClient.StateToName(state));
  };

  _client.onConnectedToMaster = () => {
    console.log('[photon] connected to master');
    _connected = true;
    setPhotonStatus('joining lobby...');
  };

  _client.onJoinedLobby = () => {
    console.log('[photon] joined lobby');
    setPhotonStatus('finding room...');
    _client.joinRoom('nodeblast-main');
  };

  _client.onJoinRoomFailed = (code, msg) => {
    console.log('[photon] room not found, creating:', code, msg);
    _client.createRoom('nodeblast-main', { maxPlayers: MAX_PLAYERS_PER_ROOM });
  };

  _client.onJoinRoom = () => {
    _myId = _client.myActor().actorNr;
    console.log('[photon] joined room, my actor:', _myId);
    _updatePlayerCount();
    if (_onConnected) _onConnected(_myId);
    _startSendLoop();
  };

  _client.onActorLeave = (actor) => {
    if (_onPlayerLeave) _onPlayerLeave(actor.actorNr);
    _updatePlayerCount();
  };

  _client.onActorJoin = () => {
    _updatePlayerCount();
  };

  _client.onEvent = (code, content, actorNr) => {
    if (code === 1 && actorNr !== _myId && _onPlayerUpdate) {
      _onPlayerUpdate(actorNr, content.x, content.y, content.z, content.rotY, content.pitch, content.username, content.hex);
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
  if (!_connected || !_client) return;
  _client.raiseEvent(1, { x, y, z, rotY, pitch, username, hex });
}

function _startSendLoop() {
  if (_sendTimer) clearInterval(_sendTimer);
  _sendTimer = setInterval(() => {
    if (window._nbGetPlayerState) {
      const s = window._nbGetPlayerState();
      if (!s) return;
      // If Hathora is connected, send moves there (authoritative).
      // Photon still sends for lobby presence + Safari fallback.
      if (window._nbHathoraConnected?.()) {
        window._nbHathoraSendMove?.(s.x, s.y, s.z, s.rotY, s.pitch);
      }
      photonSendState(s.x, s.y, s.z, s.rotY, s.pitch, s.username, s.hex);
    }
  }, SEND_RATE_MS);
}

export function destroyPhoton() {
  if (_sendTimer) { clearInterval(_sendTimer); _sendTimer = null; }
  if (_client) {
    try { _client.disconnect(); } catch {}
    _client = null;
  }
  _connected = false;
  _myId = null;
  _onPlayerUpdate = null;
  _onPlayerLeave = null;
  _onConnected = null;
}
