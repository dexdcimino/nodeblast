// ══════════════════════════════════════════════════════
//  NodeBlast — HATHORA CLIENT (MD05)
//  Authoritative game server connection via WebSocket.
//  Falls back to Photon-only if connection fails.
// ══════════════════════════════════════════════════════

const SERVER_URL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'ws://localhost:7777'
  : 'wss://d3qpbz.edge.hathora.dev:14188'; // updated MD31

let _ws = null;
let _connected = false;
let _myId = null;
let _pendingMyId = null;
let _onSnapshot = null;
let _onConnected = null;
let _onError = null;
let _pingTimer = null;
let _latency = 0;

export function getLatency() { return _latency; }
export function isHathoraConnected() { return _connected; }

export function initHathora({ roomId, username, hex, onSnapshot, onConnected, onError }) {
  _onSnapshot = onSnapshot;
  _onConnected = onConnected;
  _onError = onError;

  try {
    _ws = new WebSocket(SERVER_URL);
  } catch (e) {
    console.warn('[hathora] WebSocket failed:', e.message);
    if (_onError) _onError(e);
    return;
  }

  // Store pending ID so snapshot filter works before welcome arrives
  _pendingMyId = null;

  _ws.onopen = () => {
    console.log('[hathora] connected');
    _ws.send(JSON.stringify({
      type: 'join',
      roomId: roomId || 'default',
      username: username || 'player',
      hex: hex || '5aaa72',
    }));
    _startPing();
  };

  _ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch (msg.type) {
      case 'welcome':
        _myId = msg.id;
        console.log('[hathora] my ID:', _myId);
        break;
      case 'joined':
        _connected = true;
        console.log(`[hathora] joined room: ${msg.roomId}, players: ${msg.playerCount}`);
        if (_onConnected) _onConnected(_myId);
        break;
      case 'snapshot':
        // Guard: if _myId not yet set, fall back to _pendingMyId
        if (_onSnapshot) _onSnapshot(msg.players, _myId || _pendingMyId);
        break;
      case 'pong':
        _latency = Math.round((Date.now() - msg.t) / 2);
        _updateLatencyHUD();
        break;
      case 'error':
        console.warn('[hathora] server error:', msg.code);
        if (_onError) _onError(new Error(msg.code));
        break;
    }
  };

  _ws.onclose = () => {
    _connected = false;
    console.log('[hathora] disconnected');
    _stopPing();
  };

  _ws.onerror = (e) => {
    console.warn('[hathora] ws error');
    if (_onError) _onError(e);
  };
}

export function hathoraSendMove(x, y, z, rotY, pitch) {
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
  _ws.send(JSON.stringify({ type: 'move', x, y, z, rotY, pitch }));
}

export function destroyHathora() {
  _stopPing();
  if (_ws) {
    try { _ws.close(); } catch {}
    _ws = null;
  }
  _connected   = false;
  _myId        = null;
  _pendingMyId = null;
  _onSnapshot = null;
  _onConnected = null;
  _onError = null;
}

function _startPing() {
  _stopPing();
  _pingTimer = setInterval(() => {
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    }
  }, 2000);
}

function _stopPing() {
  if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
}

function _updateLatencyHUD() {
  const el = document.getElementById('play-latency');
  if (el) {
    el.textContent = `${_latency}ms`;
    el.style.color = _latency < 60 ? '#5AAA72' : _latency < 120 ? '#E8853A' : '#e05555';
  }
}
