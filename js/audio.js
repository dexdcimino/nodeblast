// ══════════════════════════════════════
//  NodeBlast — AUDIO SYSTEM
//  Procedural Web Audio API sounds
//  No external files required
// ══════════════════════════════════════

let _ctx      = null;
let _master   = null;
let _ambientOsc = null;
let _ambientGain = null;
let _jetpackNode = null;
let _jetpackGain = null;
let _enabled = true;

const VOL_MASTER   = 0.35;
const VOL_AMBIENT  = 0.08;
const VOL_SHOOT    = 0.22;
const VOL_FOOTSTEP = 0.06;
const VOL_HIT      = 0.4;
const VOL_EXPLODE  = 0.5;
const VOL_PICKUP   = 0.3;
const VOL_JUMP     = 0.15;
const VOL_JETPACK  = 0.12;

export function initAudio() {
  try {
    _ctx    = new (window.AudioContext || window.webkitAudioContext)();
    _master = _ctx.createGain();
    _master.gain.value = VOL_MASTER;
    _master.connect(_ctx.destination);
    _startAmbient();
  } catch (e) {
    console.warn('[audio] Web Audio not available:', e.message);
    _enabled = false;
  }
}

export function setAudioEnabled(on) {
  _enabled = on;
  if (_master) _master.gain.value = on ? VOL_MASTER : 0;
}

function _startAmbient() {
  if (!_ctx || !_enabled) return;
  _ambientOsc        = _ctx.createOscillator();
  _ambientGain       = _ctx.createGain();
  _ambientOsc.type   = 'sine';
  _ambientOsc.frequency.value = 48;
  _ambientGain.gain.value     = VOL_AMBIENT;
  _ambientOsc.connect(_ambientGain);
  _ambientGain.connect(_master);

  const osc2       = _ctx.createOscillator();
  const g2         = _ctx.createGain();
  osc2.type        = 'sine';
  osc2.frequency.value = 52;
  g2.gain.value    = VOL_AMBIENT * 0.6;
  osc2.connect(g2);
  g2.connect(_master);

  _ambientOsc.start();
  osc2.start();
}

function _burst(frequency, type, duration, volume, pitchEnd) {
  if (!_ctx || !_enabled) return;
  const osc  = _ctx.createOscillator();
  const gain = _ctx.createGain();
  osc.type   = type || 'sine';
  osc.frequency.setValueAtTime(frequency, _ctx.currentTime);
  if (pitchEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(pitchEnd, _ctx.currentTime + duration);
  }
  gain.gain.setValueAtTime(volume, _ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(_master);
  osc.start();
  osc.stop(_ctx.currentTime + duration);
}

function _noise(duration, volume, filterFreq) {
  if (!_ctx || !_enabled) return;
  const bufSize = _ctx.sampleRate * duration;
  const buffer  = _ctx.createBuffer(1, bufSize, _ctx.sampleRate);
  const data    = buffer.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

  const source = _ctx.createBufferSource();
  source.buffer = buffer;

  const filter       = _ctx.createBiquadFilter();
  filter.type        = 'lowpass';
  filter.frequency.value = filterFreq || 800;

  const gain = _ctx.createGain();
  gain.gain.setValueAtTime(volume, _ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(_master);
  source.start();
}

export function playShoot(gunId) {
  if (!_ctx || !_enabled) return;
  switch (gunId) {
    case 'pistol':
      _noise(0.12, VOL_SHOOT, 600);
      _burst(80, 'sine', 0.08, VOL_SHOOT * 0.8);
      break;
    case 'machinegun':
      _noise(0.06, VOL_SHOOT * 0.7, 2000);
      _burst(200, 'square', 0.04, VOL_SHOOT * 0.5, 80);
      break;
    case 'plasma':
      _burst(200, 'sawtooth', 0.3, VOL_SHOOT * 0.6, 800);
      _noise(0.3, VOL_SHOOT * 0.3, 3000);
      break;
    case 'nodeblaster':
      _burst(400, 'sine', 0.15, VOL_SHOOT * 0.7, 100);
      break;
  }
}

export function playHit() {
  _noise(0.18, VOL_HIT, 300);
  _burst(60, 'sine', 0.12, VOL_HIT * 0.8, 30);
}

export function playEnemyDeath() {
  _noise(0.4, VOL_EXPLODE, 400);
  _burst(50, 'sine', 0.3, VOL_EXPLODE * 0.8, 20);
  _burst(120, 'sawtooth', 0.2, VOL_EXPLODE * 0.5, 30);
}

export function playPickup() {
  _burst(440, 'sine', 0.08, VOL_PICKUP);
  setTimeout(() => _burst(660, 'sine', 0.1, VOL_PICKUP * 0.8), 60);
  setTimeout(() => _burst(880, 'sine', 0.12, VOL_PICKUP * 0.6), 120);
}

export function playJump() {
  _noise(0.14, VOL_JUMP, 1500);
  _burst(200, 'sine', 0.12, VOL_JUMP * 0.6, 400);
}

export function playJetpack(active) {
  if (!_ctx || !_enabled) return;
  if (active && !_jetpackNode) {
    _jetpackNode       = _ctx.createOscillator();
    _jetpackGain       = _ctx.createGain();
    _jetpackNode.type  = 'sawtooth';
    _jetpackNode.frequency.value = 120;
    _jetpackGain.gain.value      = 0;
    _jetpackGain.gain.linearRampToValueAtTime(VOL_JETPACK, _ctx.currentTime + 0.1);
    _jetpackNode.connect(_jetpackGain);
    _jetpackGain.connect(_master);
    _jetpackNode.start();
  } else if (!active && _jetpackNode) {
    _jetpackGain?.gain.linearRampToValueAtTime(0, _ctx.currentTime + 0.15);
    const node = _jetpackNode;
    setTimeout(() => { try { node.stop(); } catch {} }, 200);
    _jetpackNode = null;
    _jetpackGain = null;
  }
}

export function playFootstep() {
  _noise(0.07, VOL_FOOTSTEP, 500);
}

export function playGooImpact() {
  _noise(0.1, VOL_SHOOT * 0.5, 400);
  _burst(60, 'sine', 0.06, VOL_SHOOT * 0.4);
}

export function destroyAudio() {
  try {
    if (_jetpackNode) { _jetpackNode.stop(); _jetpackNode = null; }
    if (_ambientOsc)  { _ambientOsc.stop();  _ambientOsc  = null; }
    if (_ctx)         { _ctx.close();        _ctx         = null; }
  } catch {}
}
