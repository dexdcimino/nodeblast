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
let _jetpackNoise       = null;
let _jetpackFilter      = null;
let _jetpackNoiseGain   = null;
let _jetpackShimmer     = null;
let _jetpackShimmerGain = null;
let _jetpackLFO         = null;
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

  function _crack(vol) {
    const buf = _ctx.createBuffer(1, _ctx.sampleRate * 0.03, _ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = _ctx.createBufferSource(); src.buffer = buf;
    const g = _ctx.createGain();
    g.gain.setValueAtTime(vol, _ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + 0.05);
    src.connect(g); g.connect(_master); src.start();
  }

  switch (gunId) {
    case 'pistol':
      _crack(VOL_SHOOT * 1.2);
      _burst(180, 'square', 0.08, VOL_SHOOT * 0.6, 60);
      _noise(0.06, VOL_SHOOT * 0.4, 3000);
      break;
    case 'machinegun':
      _crack(VOL_SHOOT * 0.8);
      _burst(120, 'square', 0.04, VOL_SHOOT * 0.5, 50);
      _noise(0.03, VOL_SHOOT * 0.3, 4000);
      break;
    case 'plasma':
      _burst(300, 'sawtooth', 0.2, VOL_SHOOT * 0.5, 1200);
      _noise(0.25, VOL_SHOOT * 0.3, 2500);
      _burst(80, 'sine', 0.3, VOL_SHOOT * 0.4, 40);
      break;
    case 'nodeblaster':
      _crack(VOL_SHOOT * 1.0);
      _burst(200, 'sawtooth', 0.15, VOL_SHOOT * 0.7, 60);
      _noise(0.12, VOL_SHOOT * 0.5, 800);
      break;
    case 'rocket':
      _crack(VOL_SHOOT * 1.3);
      _burst(80, 'sine', 0.25, VOL_SHOOT * 0.8, 30);
      _noise(0.3, VOL_SHOOT * 0.6, 600);
      break;
    case 'sniper':
      _crack(VOL_SHOOT * 1.5);
      _burst(100, 'square', 0.1, VOL_SHOOT * 0.9, 35);
      _noise(0.2, VOL_SHOOT * 0.8, 1500);
      setTimeout(() => {
        if (!_ctx || !_enabled) return;
        _noise(0.3, VOL_SHOOT * 0.15, 800);
      }, 80);
      break;
  }
}

export function playHit() {
  if (!_ctx || !_enabled) return;
  _noise(0.1, VOL_HIT * 1.2, 500);
  _burst(100, 'sine', 0.08, VOL_HIT * 0.6, 40);
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
    // Layer 1: low rumble
    _jetpackNode       = _ctx.createOscillator();
    _jetpackGain       = _ctx.createGain();
    _jetpackNode.type  = 'sine';
    _jetpackNode.frequency.value = 55;
    _jetpackGain.gain.value      = 0;
    _jetpackGain.gain.linearRampToValueAtTime(VOL_JETPACK * 0.6, _ctx.currentTime + 0.15);
    _jetpackNode.connect(_jetpackGain);
    _jetpackGain.connect(_master);
    _jetpackNode.start();
    // Layer 2: mid thrust — filtered noise whoosh
    const bufSize = _ctx.sampleRate * 2;
    const buffer  = _ctx.createBuffer(1, bufSize, _ctx.sampleRate);
    const data    = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    _jetpackNoise        = _ctx.createBufferSource();
    _jetpackNoise.buffer = buffer;
    _jetpackNoise.loop   = true;
    _jetpackFilter                 = _ctx.createBiquadFilter();
    _jetpackFilter.type            = 'bandpass';
    _jetpackFilter.frequency.value = 800;
    _jetpackFilter.Q.value         = 0.8;
    _jetpackNoiseGain              = _ctx.createGain();
    _jetpackNoiseGain.gain.value   = 0;
    _jetpackNoiseGain.gain.linearRampToValueAtTime(VOL_JETPACK * 0.5, _ctx.currentTime + 0.2);
    _jetpackNoise.connect(_jetpackFilter);
    _jetpackFilter.connect(_jetpackNoiseGain);
    _jetpackNoiseGain.connect(_master);
    _jetpackNoise.start();
    // Layer 3: high shimmer with LFO
    _jetpackShimmer       = _ctx.createOscillator();
    _jetpackShimmerGain   = _ctx.createGain();
    _jetpackShimmer.type  = 'triangle';
    _jetpackShimmer.frequency.value = 1200;
    const lfo       = _ctx.createOscillator();
    const lfoGain   = _ctx.createGain();
    lfo.frequency.value = 3.5;
    lfoGain.gain.value  = 40;
    lfo.connect(lfoGain);
    lfoGain.connect(_jetpackShimmer.frequency);
    lfo.start();
    _jetpackLFO = lfo;
    _jetpackShimmerGain.gain.value = 0;
    _jetpackShimmerGain.gain.linearRampToValueAtTime(VOL_JETPACK * 0.15, _ctx.currentTime + 0.25);
    _jetpackShimmer.connect(_jetpackShimmerGain);
    _jetpackShimmerGain.connect(_master);
    _jetpackShimmer.start();
  } else if (!active && _jetpackNode) {
    const stopTime = _ctx.currentTime + 0.25;
    [_jetpackGain, _jetpackNoiseGain, _jetpackShimmerGain].forEach(g => {
      if (g) { try { g.gain.linearRampToValueAtTime(0, stopTime); } catch {} }
    });
    const toStop = [_jetpackNode, _jetpackNoise, _jetpackShimmer, _jetpackLFO];
    setTimeout(() => { toStop.forEach(n => { try { if (n) n.stop(); } catch {} }); }, 280);
    _jetpackNode = null; _jetpackGain = null;
    _jetpackNoise = null; _jetpackFilter = null; _jetpackNoiseGain = null;
    _jetpackShimmer = null; _jetpackShimmerGain = null; _jetpackLFO = null;
  }
}

export function playFootstep() {
  _noise(0.07, VOL_FOOTSTEP, 500);
}

export function playGooImpact() {
  _noise(0.1, VOL_SHOOT * 0.5, 400);
  _burst(60, 'sine', 0.06, VOL_SHOOT * 0.4);
}

export function playBlockBreak() {
  if (!_ctx || !_enabled) return;
  try {
    const now = _ctx.currentTime;

    // Impact transient — short noise burst
    const bufLen = _ctx.sampleRate * 0.08;
    const buf    = _ctx.createBuffer(1, bufLen, _ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 2.5);
    }
    const src    = _ctx.createBufferSource();
    src.buffer   = buf;

    const lpf    = _ctx.createBiquadFilter();
    lpf.type     = 'lowpass';
    lpf.frequency.setValueAtTime(800, now);
    lpf.frequency.linearRampToValueAtTime(200, now + 0.08);

    const gain   = _ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    src.connect(lpf);
    lpf.connect(gain);
    gain.connect(_master);
    src.start(now);
    src.stop(now + 0.35);

    // Rubble tail — slightly pitched noise
    const buf2   = _ctx.createBuffer(1, _ctx.sampleRate * 0.25, _ctx.sampleRate);
    const d2     = buf2.getChannelData(0);
    for (let i = 0; i < d2.length; i++) {
      d2[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d2.length, 1.2) * 0.4;
    }
    const src2   = _ctx.createBufferSource();
    src2.buffer  = buf2;
    const hpf    = _ctx.createBiquadFilter();
    hpf.type     = 'highpass';
    hpf.frequency.value = 300;
    const gain2  = _ctx.createGain();
    gain2.gain.setValueAtTime(0.25, now + 0.04);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    src2.connect(hpf);
    hpf.connect(gain2);
    gain2.connect(_master);
    src2.start(now + 0.04);
    src2.stop(now + 0.5);
  } catch (e) {
    console.warn('[audio] playBlockBreak error:', e.message);
  }
}

export function destroyAudio() {
  try {
    if (_jetpackNode)    { _jetpackNode.stop();    _jetpackNode    = null; }
    if (_jetpackNoise)   { _jetpackNoise.stop();   _jetpackNoise   = null; }
    if (_jetpackShimmer) { _jetpackShimmer.stop();  _jetpackShimmer = null; }
    if (_jetpackLFO)     { _jetpackLFO.stop();     _jetpackLFO     = null; }
    if (_ambientOsc)     { _ambientOsc.stop();     _ambientOsc     = null; }
    if (_ctx)            { _ctx.close();            _ctx            = null; }
  } catch {}
}
