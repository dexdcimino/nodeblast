// ══════════════════════════════════════
//  NodeBlast — GAME ENGINE
//  Natural jump, space gun, block collision, large arena
// ══════════════════════════════════════

import State from './state.js';

// ── Module state ──
let _engine        = null;
let _scene         = null;
let _camera        = null;
let _canvas        = null;
let _pointerLocked = false;
let _resizeHandler = null;
let _obsHandler    = null;

let _playerUsername = 'player';
let _playerHex      = '5aaa72';

// ── Physics constants ──
const WALK_SPEED  = 0.09;
const SPRINT_MULT = 1.85;
const JUMP_FORCE  = 0.18;
const GRAVITY     = 0.011;
const GROUND_Y    = 1.8;
const AIR_CONTROL = 0.3;
const FRICTION    = 0.76;
const INERTIA     = 0.16;

// ── Player physics state ──
let _velX      = 0;
let _velZ      = 0;
let _velY      = 0;
let _onGround  = true;
let _sprinting = false;
let _jumpHeld  = false;

// ── Collision blocks ──
const _colBlocks = [];

// ── Input ──
const _keys         = {};
let _keyDownHandler = null;
let _keyUpHandler   = null;

// ── Gun ──
let _lastShot      = 0;
const SHOT_COOLDOWN = 180;
const _projectiles  = [];
let _mouseDownHandler = null;

// ── Remote players ──
const _remotePlayers = new Map();

// ────────────────────────────────────────
//  Identity
// ────────────────────────────────────────

export function refreshPlayerIdentity() {
  _playerUsername = State.profile?.displayName || State.user?.displayName || 'player';
  _playerHex      = State.profile?.hexCode || '5aaa72';
}

export function getPlayerState() {
  if (!_camera) return null;
  return {
    x: _camera.position.x, y: _camera.position.y, z: _camera.position.z,
    rotY: _camera.rotation.y, pitch: _camera.rotation.x,
    username: _playerUsername, hex: _playerHex,
  };
}

// ────────────────────────────────────────
//  Remote players
// ────────────────────────────────────────

function _createRemotePlayerMesh(id, hex, username) {
  const B = window.BABYLON;
  const root = new B.TransformNode('remote_root_' + id, _scene);
  const body = B.MeshBuilder.CreateCapsule('remote_body_' + id, { height: 1.8, radius: 0.35, tessellation: 10 }, _scene);
  body.parent = root; body.position.y = 0.9;
  const r = parseInt(hex.slice(0,2),16)/255, g = parseInt(hex.slice(2,4),16)/255, b = parseInt(hex.slice(4,6),16)/255;
  const mat = new B.StandardMaterial('remote_mat_' + id, _scene);
  mat.diffuseColor = new B.Color3(r, g, b);
  mat.emissiveColor = new B.Color3(r*0.3, g*0.3, b*0.3);
  body.material = mat;
  const ring = B.MeshBuilder.CreateTorus('remote_ring_' + id, { diameter: 0.9, thickness: 0.06, tessellation: 24 }, _scene);
  ring.parent = root; ring.position.y = 0.05; ring.rotation.x = Math.PI/2;
  const ringMat = new B.StandardMaterial('remote_ring_mat_' + id, _scene);
  ringMat.emissiveColor = new B.Color3(r, g, b); ringMat.disableLighting = true;
  ring.material = ringMat;
  const labelPlane = B.MeshBuilder.CreatePlane('remote_label_' + id, { width: 2.2, height: 0.5 }, _scene);
  labelPlane.parent = root; labelPlane.position.y = 2.35; labelPlane.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
  const labelTex = new B.DynamicTexture('remote_label_tex_' + id, { width: 256, height: 64 }, _scene);
  labelTex.drawText(username, null, 46, 'bold 26px Outfit,Arial', '#' + hex, 'transparent', true);
  const labelMat = new B.StandardMaterial('remote_label_mat_' + id, _scene);
  labelMat.diffuseTexture = labelTex; labelMat.emissiveTexture = labelTex;
  labelMat.opacityTexture = labelTex; labelMat.backFaceCulling = false;
  labelMat.disableLighting = true; labelPlane.material = labelMat;
  return { root, body, ring, labelPlane, labelTex };
}

export function addOrUpdateRemotePlayer(id, x, y, z, rotY, username, hex) {
  let p = _remotePlayers.get(id);
  if (!p) {
    const meshes = _createRemotePlayerMesh(id, (hex||'5aaa72').replace('#',''), username||'player');
    p = { ...meshes, targetX: x, targetY: y-GROUND_Y, targetZ: z, renderX: x, renderY: y-GROUND_Y, renderZ: z, targetRotY: rotY, renderRotY: rotY, lastUpdate: Date.now() };
    _remotePlayers.set(id, p);
  } else {
    p.targetX = x; p.targetY = y-GROUND_Y; p.targetZ = z; p.targetRotY = rotY; p.lastUpdate = Date.now();
  }
}

export function getRemotePlayerIds() { return Array.from(_remotePlayers.keys()); }

export function removeRemotePlayer(id) {
  const p = _remotePlayers.get(id); if (!p) return;
  ['labelTex','labelPlane','ring','body','root'].forEach(k => { try { p[k].dispose(); } catch {} });
  _remotePlayers.delete(id);
}

// ────────────────────────────────────────
//  Collision
// ────────────────────────────────────────

function _addCol(x, z, w, d, h) {
  _colBlocks.push({ minX: x-w/2, maxX: x+w/2, minZ: z-d/2, maxZ: z+d/2, maxY: h });
}

function _resolveCollision(newX, newZ, newY) {
  const PR = 0.45;
  let rx = newX, rz = newZ;
  for (const b of _colBlocks) {
    if (newY - GROUND_Y > b.maxY) continue;
    const oX = (rx > b.minX-PR && rx < b.maxX+PR);
    const oZ = (rz > b.minZ-PR && rz < b.maxZ+PR);
    if (!oX || !oZ) continue;
    const pL = rx-(b.minX-PR), pR = (b.maxX+PR)-rx, pF = rz-(b.minZ-PR), pB = (b.maxZ+PR)-rz;
    const m = Math.min(pL, pR, pF, pB);
    if (m === pL) rx = b.minX-PR;
    if (m === pR) rx = b.maxX+PR;
    if (m === pF) rz = b.minZ-PR;
    if (m === pB) rz = b.maxZ+PR;
  }
  return { x: rx, z: rz };
}

// ────────────────────────────────────────
//  Gun
// ────────────────────────────────────────

function _shoot() {
  const now = Date.now();
  if (now - _lastShot < SHOT_COOLDOWN) return;
  _lastShot = now;
  const B = window.BABYLON;
  const dir = _camera.getDirection(B.Vector3.Forward()).normalize();
  const origin = _camera.position.add(dir.scale(0.8));
  const ball = B.MeshBuilder.CreateSphere('proj_'+now, { diameter: 0.18, segments: 5 }, _scene);
  ball.position.copyFrom(origin);
  const mat = new B.StandardMaterial('proj_mat_'+now, _scene);
  mat.emissiveColor = new B.Color3(0.1, 1.0, 0.4); mat.disableLighting = true;
  ball.material = mat;
  const flash = new B.PointLight('flash_'+now, origin.clone(), _scene);
  flash.diffuse = new B.Color3(0.2, 1.0, 0.5); flash.intensity = 2.0; flash.range = 6;
  setTimeout(() => { try { flash.dispose(); } catch {} }, 80);
  _projectiles.push({ mesh: ball, vel: dir.scale(1.8), life: 60 });
}

function _updateProjectiles() {
  const dead = [];
  for (let i = 0; i < _projectiles.length; i++) {
    const p = _projectiles[i]; p.life--;
    p.mesh.position.addInPlace(p.vel); p.vel.y -= 0.004;
    let hit = false;
    const px = p.mesh.position.x, py = p.mesh.position.y, pz = p.mesh.position.z;
    for (const b of _colBlocks) {
      if (px > b.minX-0.1 && px < b.maxX+0.1 && pz > b.minZ-0.1 && pz < b.maxZ+0.1 && py < b.maxY+0.1 && py > -0.5) { hit = true; break; }
    }
    if (py < 0.1) hit = true;
    if (Math.abs(px) > 60 || Math.abs(pz) > 60) hit = true;
    if (hit || p.life <= 0) {
      if (hit) {
        const B = window.BABYLON;
        const imp = new B.PointLight('imp_'+i, p.mesh.position.clone(), _scene);
        imp.diffuse = new B.Color3(0.2, 1.0, 0.4); imp.intensity = 1.5; imp.range = 4;
        setTimeout(() => { try { imp.dispose(); } catch {} }, 60);
      }
      try { p.mesh.dispose(); } catch {}
      dead.push(i);
    }
  }
  for (let i = dead.length-1; i >= 0; i--) _projectiles.splice(dead[i], 1);
}

// ────────────────────────────────────────
//  Physics tick
// ────────────────────────────────────────

function _physicsTick() {
  if (!_camera || !_scene) return;
  const B = window.BABYLON;
  const forward = _keys['KeyW']||_keys['ArrowUp'], back = _keys['KeyS']||_keys['ArrowDown'];
  const left = _keys['KeyA']||_keys['ArrowLeft'], right = _keys['KeyD']||_keys['ArrowRight'];
  const jumping = _keys['Space'];
  const fwd = _camera.getDirection(B.Vector3.Forward()); fwd.y = 0; fwd.normalize();
  const rgt = _camera.getDirection(B.Vector3.Right()); rgt.y = 0; rgt.normalize();
  let moveX = 0, moveZ = 0;
  if (forward) { moveX += fwd.x; moveZ += fwd.z; }
  if (back) { moveX -= fwd.x; moveZ -= fwd.z; }
  if (right) { moveX += rgt.x; moveZ += rgt.z; }
  if (left) { moveX -= rgt.x; moveZ -= rgt.z; }
  const moveLen = Math.sqrt(moveX*moveX + moveZ*moveZ);
  if (moveLen > 0) { moveX /= moveLen; moveZ /= moveLen; }
  const speed = WALK_SPEED * (_sprinting ? SPRINT_MULT : 1.0);
  const control = _onGround ? 1.0 : AIR_CONTROL;
  _velX += ((moveX*speed) - _velX) * INERTIA * control;
  _velZ += ((moveZ*speed) - _velZ) * INERTIA * control;
  if (moveLen === 0 && _onGround) { _velX *= FRICTION; _velZ *= FRICTION; }
  const fallMult = _velY < 0 ? 1.6 : 1.0;
  _velY -= GRAVITY * fallMult;
  if (jumping && _onGround && !_jumpHeld) { _velY = JUMP_FORCE; _onGround = false; _jumpHeld = true; }
  if (!jumping) _jumpHeld = false;
  const resolved = _resolveCollision(_camera.position.x + _velX, _camera.position.z + _velZ, _camera.position.y);
  _camera.position.x = resolved.x; _camera.position.z = resolved.z;
  _camera.position.y += _velY;
  if (_camera.position.y <= GROUND_Y) { _camera.position.y = GROUND_Y; _velY = 0; _onGround = true; }
  const BOUND = 58;
  _camera.position.x = Math.max(-BOUND, Math.min(BOUND, _camera.position.x));
  _camera.position.z = Math.max(-BOUND, Math.min(BOUND, _camera.position.z));
  _updateProjectiles();
  const now = Date.now();
  _remotePlayers.forEach((p) => {
    p.renderX += (p.targetX - p.renderX) * 0.2;
    p.renderY += (p.targetY - p.renderY) * 0.2;
    p.renderZ += (p.targetZ - p.renderZ) * 0.2;
    p.renderRotY += (p.targetRotY - p.renderRotY) * 0.2;
    p.root.position.set(p.renderX, p.renderY, p.renderZ);
    p.root.rotation.y = p.renderRotY;
    p.root.setEnabled(now - p.lastUpdate <= 5000);
  });
}

// ────────────────────────────────────────
//  Skybox
// ────────────────────────────────────────

function _createSkybox() {
  const B = window.BABYLON;
  const sky = B.MeshBuilder.CreateBox('skybox', { size: 1200 }, _scene);
  const mat = new B.ShaderMaterial('skyShader', _scene, {
    vertexSource: `precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;varying vec3 vPos;void main(){vPos=position;gl_Position=worldViewProjection*vec4(position,1.0);}`,
    fragmentSource: `precision highp float;varying vec3 vPos;void main(){float t=clamp((normalize(vPos).y+1.0)*0.5,0.0,1.0);vec3 h=vec3(0.05,0.02,0.10);vec3 z=vec3(0.01,0.01,0.06);vec3 p=normalize(vPos)*120.0;float s=step(0.995,fract(sin(dot(floor(p),vec3(127.1,311.7,74.3)))*43758.5));vec3 c=mix(h,z,t)+s*0.7*smoothstep(0.4,1.0,t);gl_FragColor=vec4(c,1.0);}`,
  }, { attributes: ['position'], uniforms: ['worldViewProjection'] });
  mat.backFaceCulling = false; sky.material = mat; sky.infiniteDistance = true;
}

// ────────────────────────────────────────
//  Arena
// ────────────────────────────────────────

function _buildArena() {
  const B = window.BABYLON;
  function mkMat(name, r, g, b, er, eg, eb) {
    const m = new B.StandardMaterial(name, _scene);
    m.diffuseColor = new B.Color3(r, g, b);
    m.emissiveColor = new B.Color3(er||0, eg||0, eb||0);
    m.specularColor = new B.Color3(0.08, 0.08, 0.12); m.specularPower = 48;
    return m;
  }
  const MC = mkMat('mc', 0.16, 0.17, 0.21);
  const MD = mkMat('md', 0.10, 0.11, 0.14);
  const MG = mkMat('mg', 0.03, 0.18, 0.09, 0.0, 0.55, 0.22);
  const MGD = mkMat('mgd', 0.02, 0.12, 0.06, 0.0, 0.25, 0.10);

  const ground = B.MeshBuilder.CreateGround('ground', { width: 130, height: 130, subdivisions: 2 }, _scene);
  ground.material = mkMat('gnd', 0.06, 0.07, 0.09); ground.receiveShadows = true;

  function box(name, w, h, d, x, z, mat, noCol) {
    const m = B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, _scene);
    m.position.set(x, h/2, z); m.material = mat; m.receiveShadows = true;
    if (!noCol) _addCol(x, z, w, d, h); return m;
  }
  function strip(name, w, h, d, x, y, z) {
    const m = B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, _scene);
    m.position.set(x, y, z); m.material = MG; return m;
  }

  // Center
  box('ctr_base', 18, 0.7, 18, 0, 0, MD);
  box('ctr_inner', 8, 1.4, 8, 0, 0, MC);
  strip('ctr_n', 18, 0.1, 0.15, 0, 0.75, 9);
  strip('ctr_s', 18, 0.1, 0.15, 0, 0.75, -9);
  strip('ctr_e', 0.15, 0.1, 18, 9, 0.75, 0);
  strip('ctr_w', 0.15, 0.1, 18, -9, 0.75, 0);
  box('ctr_pillar', 2, 5, 2, 0, 0, MD);

  // Towers
  [{x:28,z:28},{x:-28,z:28},{x:28,z:-28},{x:-28,z:-28}].forEach((t,i) => {
    box('tw_'+i, 5, 10, 5, t.x, t.z, MD);
    box('tw_'+i+'_top', 7, 0.5, 7, t.x, t.z, MC);
    strip('tw_'+i+'_glow', 7, 0.12, 7, t.x, 10.3, t.z);
    const pt = new B.PointLight('tw_pt_'+i, new B.Vector3(t.x, 1, t.z), _scene);
    pt.diffuse = new B.Color3(0.1, 1.0, 0.4); pt.intensity = 1.2; pt.range = 14;
  });

  // L-walls
  [{x:14,z:14,w:1,d:6},{x:19,z:11,w:6,d:1},{x:-14,z:14,w:1,d:6},{x:-19,z:11,w:6,d:1},
   {x:14,z:-14,w:1,d:6},{x:19,z:-11,w:6,d:1},{x:-14,z:-14,w:1,d:6},{x:-19,z:-11,w:6,d:1}].forEach((w,i) => {
    box('lw_'+i, w.w, 2.5, w.d, w.x, w.z, MC);
  });

  // Bunkers
  [{x:0,z:38},{x:0,z:-38},{x:38,z:0},{x:-38,z:0}].forEach((b,i) => {
    const ns = b.x === 0;
    box('bk_'+i, ns?10:2, 1.4, ns?2:10, b.x, b.z, MD);
    box('bk_'+i+'_l', ns?1:2, 2.5, ns?2:1, b.x+(ns?-6:0), b.z+(ns?0:-6), MC);
    box('bk_'+i+'_r', ns?1:2, 2.5, ns?2:1, b.x+(ns?6:0), b.z+(ns?0:6), MC);
    strip('bk_'+i+'_glow', ns?10:2, 0.08, ns?2:10, b.x, 1.45, b.z);
  });

  // Catwalks
  box('cat_n', 20, 0.4, 4, 0, 44, MD);
  box('cat_n_sl', 0.5, 5, 0.5, -9, 44, MC);
  box('cat_n_sr', 0.5, 5, 0.5, 9, 44, MC);
  box('cat_n_sm', 0.5, 5, 0.5, 0, 44, MC);
  box('cat_s', 20, 0.4, 4, 0, -44, MD);
  box('cat_s_sl', 0.5, 5, 0.5, -9, -44, MC);
  box('cat_s_sr', 0.5, 5, 0.5, 9, -44, MC);

  // Ramps
  [1,2,3].forEach(s => {
    box('ramp_n_'+s, 4, s*0.5, 2, 0, 20+s*3, MC);
    box('ramp_s_'+s, 4, s*0.5, 2, 0, -20-s*3, MC);
  });

  // Pillars
  [{x:8,z:22},{x:-8,z:22},{x:8,z:-22},{x:-8,z:-22},{x:22,z:8},{x:22,z:-8},{x:-22,z:8},{x:-22,z:-8}].forEach((p,i) => {
    box('pil_'+i, 2, 4, 2, p.x, p.z, MD);
    strip('pil_'+i+'_glow', 2, 0.08, 2, p.x, 4.1, p.z);
  });

  // Spawns
  [{x:0,z:-50},{x:0,z:50},{x:50,z:0},{x:-50,z:0}].forEach((s,i) => {
    const pad = B.MeshBuilder.CreateGround('spawn_'+i, { width: 4, height: 4 }, _scene);
    pad.position.set(s.x, 0.02, s.z); pad.material = MGD;
  });

  // Perimeter walls
  const W = 60;
  [{x:0,z:W,w:W*2,d:1},{x:0,z:-W,w:W*2,d:1},{x:W,z:0,w:1,d:W*2},{x:-W,z:0,w:1,d:W*2}].forEach((w,i) => {
    const wall = B.MeshBuilder.CreateBox('bound_'+i, { width: w.w, height: 12, depth: w.d }, _scene);
    wall.position.set(w.x, 6, w.z); wall.isVisible = false; _addCol(w.x, w.z, w.w, w.d, 12);
  });

  // Center spotlight
  const spot = new B.SpotLight('spot', new B.Vector3(0,30,0), new B.Vector3(0,-1,0), Math.PI/5, 10, _scene);
  spot.intensity = 0.6; spot.diffuse = new B.Color3(0.85, 0.95, 1.0);
}

// ────────────────────────────────────────
//  initGame
// ────────────────────────────────────────

export function initGame(canvas) {
  const B = window.BABYLON;
  if (!B) throw new Error('Babylon.js not loaded');
  _canvas = canvas; _colBlocks.length = 0; refreshPlayerIdentity();

  _engine = new B.Engine(canvas, true, { adaptToDeviceRatio: true, antialias: true });
  _scene = new B.Scene(_engine);
  _scene.clearColor = new B.Color4(0.02, 0.02, 0.05, 1);
  _scene.collisionsEnabled = false;

  _createSkybox();

  const hemi = new B.HemisphericLight('hemi', new B.Vector3(0,1,0), _scene);
  hemi.intensity = 0.30; hemi.diffuse = new B.Color3(0.55, 0.60, 0.85);
  hemi.groundColor = new B.Color3(0.04, 0.04, 0.07);
  const dir = new B.DirectionalLight('dir', new B.Vector3(-0.5,-1,-0.3), _scene);
  dir.intensity = 0.65; dir.diffuse = new B.Color3(0.85, 0.82, 0.75);
  dir.position = new B.Vector3(30, 50, 30);
  _scene.fogMode = B.Scene.FOGMODE_EXP2;
  _scene.fogColor = new B.Color3(0.02, 0.02, 0.05);
  _scene.fogDensity = 0.008;

  _camera = new B.UniversalCamera('cam', new B.Vector3(0, GROUND_Y, -48), _scene);
  _camera.setTarget(B.Vector3.Zero());
  _camera.attachControl(canvas, true);
  _camera.keysUp = []; _camera.keysDown = []; _camera.keysLeft = []; _camera.keysRight = [];
  _camera.angularSensibility = 650; _camera.inertia = 0.04;
  _camera.minZ = 0.05; _camera.fov = 1.22;

  _pointerLocked = false;
  canvas.addEventListener('click', () => { if (!_pointerLocked) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => {
    _pointerLocked = document.pointerLockElement === canvas;
    const ch = document.getElementById('play-crosshair');
    if (ch) ch.style.opacity = _pointerLocked ? '1' : '0.35';
  });

  _keyDownHandler = (e) => {
    _keys[e.code] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') _sprinting = true;
    if (e.code === 'Space') e.preventDefault();
  };
  _keyUpHandler = (e) => {
    _keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') _sprinting = false;
  };
  document.addEventListener('keydown', _keyDownHandler);
  document.addEventListener('keyup', _keyUpHandler);

  _mouseDownHandler = (e) => { if (e.button === 0 && _pointerLocked) _shoot(); };
  document.addEventListener('mousedown', _mouseDownHandler);

  _buildArena();
  _obsHandler = _scene.onBeforeRenderObservable.add(_physicsTick);
  _engine.runRenderLoop(() => _scene.render());
  _resizeHandler = () => _engine.resize();
  window.addEventListener('resize', _resizeHandler);
  window._nbGetPlayerState = getPlayerState;
  return { engine: _engine, scene: _scene };
}

// ────────────────────────────────────────
//  destroyGame
// ────────────────────────────────────────

export function destroyGame(engine) {
  if (_keyDownHandler) { document.removeEventListener('keydown', _keyDownHandler); _keyDownHandler = null; }
  if (_keyUpHandler) { document.removeEventListener('keyup', _keyUpHandler); _keyUpHandler = null; }
  if (_mouseDownHandler) { document.removeEventListener('mousedown', _mouseDownHandler); _mouseDownHandler = null; }
  if (_scene && _obsHandler) { _scene.onBeforeRenderObservable.remove(_obsHandler); _obsHandler = null; }
  if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }
  _projectiles.forEach(p => { try { p.mesh.dispose(); } catch {} });
  _projectiles.length = 0;
  _remotePlayers.forEach((_, id) => removeRemotePlayer(id));
  _remotePlayers.clear();
  window._nbGetPlayerState = null;
  _velX = 0; _velZ = 0; _velY = 0;
  _onGround = true; _sprinting = false; _jumpHeld = false;
  _colBlocks.length = 0;
  Object.keys(_keys).forEach(k => delete _keys[k]);
  _scene = null; _camera = null; _canvas = null; _engine = null;
  if (engine) { engine.stopRenderLoop(); engine.dispose(); }
}
