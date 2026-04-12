// ══════════════════════════════════════
//  NodeBlast — GAME ENGINE
//  Manual FPS controller, skybox, dynamic lighting, arena map
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
const SPRINT_MULT = 1.9;
const JUMP_FORCE  = 0.26;
const GRAVITY     = 0.020;
const GROUND_Y    = 1.8;
const AIR_CONTROL = 0.35;
const FRICTION    = 0.78;
const INERTIA     = 0.18;

// ── Player physics state ──
let _velX      = 0;
let _velZ      = 0;
let _velY      = 0;
let _onGround  = true;
let _sprinting = false;
let _jumpHeld  = false;

// ── Input ──
const _keys         = {};
let _keyDownHandler = null;
let _keyUpHandler   = null;

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
    x: _camera.position.x,
    y: _camera.position.y,
    z: _camera.position.z,
    rotY:     _camera.rotation.y,
    pitch:    _camera.rotation.x,
    username: _playerUsername,
    hex:      _playerHex,
  };
}

// ────────────────────────────────────────
//  Remote players
// ────────────────────────────────────────

function _createRemotePlayerMesh(id, hex, username) {
  const B    = window.BABYLON;
  const root = new B.TransformNode('remote_root_' + id, _scene);

  const body = B.MeshBuilder.CreateCapsule(
    'remote_body_' + id,
    { height: 1.8, radius: 0.35, tessellation: 10 },
    _scene,
  );
  body.parent     = root;
  body.position.y = 0.9;

  const r   = parseInt(hex.slice(0, 2), 16) / 255;
  const g   = parseInt(hex.slice(2, 4), 16) / 255;
  const b   = parseInt(hex.slice(4, 6), 16) / 255;
  const mat = new B.StandardMaterial('remote_mat_' + id, _scene);
  mat.diffuseColor  = new B.Color3(r, g, b);
  mat.emissiveColor = new B.Color3(r * 0.3, g * 0.3, b * 0.3);
  body.material     = mat;

  const ring = B.MeshBuilder.CreateTorus(
    'remote_ring_' + id,
    { diameter: 0.9, thickness: 0.06, tessellation: 24 },
    _scene,
  );
  ring.parent     = root;
  ring.position.y = 0.05;
  ring.rotation.x = Math.PI / 2;
  const ringMat   = new B.StandardMaterial('remote_ring_mat_' + id, _scene);
  ringMat.emissiveColor   = new B.Color3(r, g, b);
  ringMat.disableLighting = true;
  ring.material   = ringMat;

  const labelPlane = B.MeshBuilder.CreatePlane(
    'remote_label_' + id,
    { width: 2.2, height: 0.5 },
    _scene,
  );
  labelPlane.parent        = root;
  labelPlane.position.y    = 2.35;
  labelPlane.billboardMode = B.Mesh.BILLBOARDMODE_ALL;

  const labelTex = new B.DynamicTexture(
    'remote_label_tex_' + id,
    { width: 256, height: 64 },
    _scene,
  );
  labelTex.drawText(
    username, null, 46,
    'bold 26px Outfit,Arial',
    '#' + hex,
    'transparent',
    true,
  );
  const labelMat = new B.StandardMaterial('remote_label_mat_' + id, _scene);
  labelMat.diffuseTexture  = labelTex;
  labelMat.emissiveTexture = labelTex;
  labelMat.opacityTexture  = labelTex;
  labelMat.backFaceCulling = false;
  labelMat.disableLighting = true;
  labelPlane.material      = labelMat;

  return { root, body, ring, labelPlane, labelTex };
}

export function addOrUpdateRemotePlayer(id, x, y, z, rotY, username, hex) {
  let p = _remotePlayers.get(id);
  if (!p) {
    const safeHex  = (hex || '5aaa72').replace('#', '');
    const safeName = username || 'player';
    const meshes   = _createRemotePlayerMesh(id, safeHex, safeName);
    p = {
      ...meshes,
      targetX: x, targetY: y - GROUND_Y, targetZ: z,
      renderX: x, renderY: y - GROUND_Y, renderZ: z,
      targetRotY: rotY, renderRotY: rotY,
      lastUpdate: Date.now(),
    };
    _remotePlayers.set(id, p);
    console.log('[game] remote player added:', id, username);
  } else {
    p.targetX    = x;
    p.targetY    = y - GROUND_Y;
    p.targetZ    = z;
    p.targetRotY = rotY;
    p.lastUpdate = Date.now();
  }
}

export function getRemotePlayerIds() {
  return Array.from(_remotePlayers.keys());
}

export function removeRemotePlayer(id) {
  const p = _remotePlayers.get(id);
  if (!p) return;
  ['labelTex', 'labelPlane', 'ring', 'body', 'root'].forEach(k => {
    try { p[k].dispose(); } catch {}
  });
  _remotePlayers.delete(id);
}

// ────────────────────────────────────────
//  Physics tick
// ────────────────────────────────────────

function _physicsTick() {
  if (!_camera || !_scene) return;
  const B = window.BABYLON;

  const forward = _keys['KeyW']    || _keys['ArrowUp'];
  const back    = _keys['KeyS']    || _keys['ArrowDown'];
  const left    = _keys['KeyA']    || _keys['ArrowLeft'];
  const right   = _keys['KeyD']    || _keys['ArrowRight'];
  const jumping = _keys['Space'];

  const fwd = _camera.getDirection(B.Vector3.Forward());
  fwd.y = 0; fwd.normalize();
  const rgt = _camera.getDirection(B.Vector3.Right());
  rgt.y = 0; rgt.normalize();

  let moveX = 0, moveZ = 0;
  if (forward) { moveX += fwd.x; moveZ += fwd.z; }
  if (back)    { moveX -= fwd.x; moveZ -= fwd.z; }
  if (right)   { moveX += rgt.x; moveZ += rgt.z; }
  if (left)    { moveX -= rgt.x; moveZ -= rgt.z; }

  const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (moveLen > 0) { moveX /= moveLen; moveZ /= moveLen; }

  const speed   = WALK_SPEED * (_sprinting ? SPRINT_MULT : 1.0);
  const control = _onGround ? 1.0 : AIR_CONTROL;

  _velX += ((moveX * speed) - _velX) * INERTIA * control;
  _velZ += ((moveZ * speed) - _velZ) * INERTIA * control;

  if (moveLen === 0 && _onGround) {
    _velX *= FRICTION;
    _velZ *= FRICTION;
  }

  _velY -= GRAVITY;

  if (jumping && _onGround && !_jumpHeld) {
    _velY     = JUMP_FORCE;
    _onGround = false;
    _jumpHeld = true;
  }
  if (!jumping) _jumpHeld = false;

  _camera.position.x += _velX;
  _camera.position.z += _velZ;
  _camera.position.y += _velY;

  if (_camera.position.y <= GROUND_Y) {
    _camera.position.y = GROUND_Y;
    _velY              = 0;
    _onGround          = true;
  }

  const BOUND = 38;
  _camera.position.x = Math.max(-BOUND, Math.min(BOUND, _camera.position.x));
  _camera.position.z = Math.max(-BOUND, Math.min(BOUND, _camera.position.z));

  const now = Date.now();
  _remotePlayers.forEach((p) => {
    p.renderX    += (p.targetX    - p.renderX)    * 0.2;
    p.renderY    += (p.targetY    - p.renderY)    * 0.2;
    p.renderZ    += (p.targetZ    - p.renderZ)    * 0.2;
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
  const B   = window.BABYLON;
  const sky = B.MeshBuilder.CreateBox('skybox', { size: 1000 }, _scene);

  const skyShader = new B.ShaderMaterial('skyShader', _scene, {
    vertexSource: `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      varying vec3 vPosition;
      void main() {
        vPosition   = position;
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }
    `,
    fragmentSource: `
      precision highp float;
      varying vec3 vPosition;
      void main() {
        float t = clamp((normalize(vPosition).y + 1.0) * 0.5, 0.0, 1.0);
        vec3 horizon = vec3(0.04, 0.02, 0.08);
        vec3 zenith  = vec3(0.01, 0.01, 0.05);
        vec3 p       = normalize(vPosition) * 100.0;
        float star   = step(0.994, fract(sin(dot(floor(p), vec3(127.1, 311.7, 74.3))) * 43758.5));
        vec3 col     = mix(horizon, zenith, t) + star * 0.6 * t;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }, {
    attributes: ['position'],
    uniforms:   ['worldViewProjection'],
  });
  sky.material         = skyShader;
  sky.infiniteDistance  = true;
  return sky;
}

// ────────────────────────────────────────
//  Arena map
// ────────────────────────────────────────

function _buildArena() {
  const B = window.BABYLON;

  const ground = B.MeshBuilder.CreateGround('ground', { width: 80, height: 80, subdivisions: 2 }, _scene);
  const gMat   = new B.StandardMaterial('groundMat', _scene);
  gMat.diffuseColor    = new B.Color3(0.07, 0.08, 0.10);
  gMat.specularColor   = new B.Color3(0.08, 0.08, 0.12);
  gMat.specularPower   = 64;
  ground.material      = gMat;
  ground.receiveShadows = true;

  function box(name, w, h, d, x, z, color, emissive) {
    const m = B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, _scene);
    m.position.set(x, h / 2, z);
    const mat = new B.StandardMaterial(name + '_mat', _scene);
    mat.diffuseColor  = color;
    mat.emissiveColor = emissive || new B.Color3(0, 0, 0);
    mat.specularColor = new B.Color3(0.1, 0.1, 0.15);
    m.material        = mat;
    m.receiveShadows  = true;
    return m;
  }

  const CONCRETE = new B.Color3(0.18, 0.19, 0.22);
  const DARK     = new B.Color3(0.12, 0.13, 0.16);
  const ACCENT   = new B.Color3(0.05, 0.20, 0.12);
  const GLOW_G   = new B.Color3(0.0,  0.08, 0.04);

  box('center_base',   12, 0.6, 12,   0,    0,  CONCRETE);
  box('center_wall_n',  2, 3,   1,    0,    3,  DARK);
  box('center_wall_e',  1, 3,   2,    3,    0,  DARK);
  box('center_wall_w',  1, 3,   2,   -3,    0,  DARK);
  box('center_trim_n',  12, 0.08, 0.1,  0,  6.3,  ACCENT, GLOW_G);
  box('center_trim_e',  0.1, 0.08, 12,  6.3, 0,   ACCENT, GLOW_G);
  box('center_trim_w',  0.1, 0.08, 12, -6.3, 0,   ACCENT, GLOW_G);
  box('center_trim_s',  12, 0.08, 0.1,  0, -6.3,  ACCENT, GLOW_G);

  box('cover_ne_1',  1,  2.2, 5,   10,  10, CONCRETE);
  box('cover_ne_2',  5,  2.2, 1,   13,  7,  CONCRETE);
  box('cover_nw_1',  1,  2.2, 5,  -10,  10, CONCRETE);
  box('cover_nw_2',  5,  2.2, 1,  -13,  7,  CONCRETE);
  box('cover_se_1',  1,  2.2, 5,   10, -10, CONCRETE);
  box('cover_se_2',  5,  2.2, 1,   13,  -7, CONCRETE);
  box('cover_sw_1',  1,  2.2, 5,  -10, -10, CONCRETE);
  box('cover_sw_2',  5,  2.2, 1,  -13,  -7, CONCRETE);

  box('tower_ne',  2.5, 7, 2.5,  16,  16, DARK);
  box('tower_nw',  2.5, 7, 2.5, -16,  16, DARK);
  box('tower_se',  2.5, 7, 2.5,  16, -16, DARK);
  box('tower_sw',  2.5, 7, 2.5, -16, -16, DARK);
  box('tower_ne_top', 3, 0.2, 3,  16,  7.1, ACCENT, GLOW_G);
  box('tower_nw_top', 3, 0.2, 3, -16,  7.1, ACCENT, GLOW_G);
  box('tower_se_top', 3, 0.2, 3,  16, -6.9, ACCENT, GLOW_G);
  box('tower_sw_top', 3, 0.2, 3, -16, -6.9, ACCENT, GLOW_G);

  box('mid_n_l',   1.5, 1.8, 4,   5,  18, CONCRETE);
  box('mid_n_r',   1.5, 1.8, 4,  -5,  18, CONCRETE);
  box('mid_s_l',   1.5, 1.8, 4,   5, -18, CONCRETE);
  box('mid_s_r',   1.5, 1.8, 4,  -5, -18, CONCRETE);
  box('mid_e',     4,   1.8, 1.5, 18,  0,  CONCRETE);
  box('mid_w',     4,   1.8, 1.5,-18,  0,  CONCRETE);

  box('bunker_n',  6, 1.1, 2,   0,  22, DARK);
  box('bunker_s',  6, 1.1, 2,   0, -22, DARK);
  box('bunker_e',  2, 1.1, 6,  22,   0, DARK);
  box('bunker_w',  2, 1.1, 6, -22,   0, DARK);

  box('catwalk',   14, 0.3, 3,  0, 28, DARK);
  box('catwalk_support_l', 0.4, 3.5, 0.4, -6, 28, CONCRETE);
  box('catwalk_support_r', 0.4, 3.5, 0.4,  6, 28, CONCRETE);
  box('catwalk_glow', 14, 0.06, 0.1, 0, 28.16, ACCENT, GLOW_G);

  const spawnPts = [
    { x:  0, z: -30 }, { x:  0, z:  30 },
    { x: 30, z:   0 }, { x:-30, z:   0 },
  ];
  spawnPts.forEach((sp, i) => {
    box('spawn_' + i, 3, 0.05, 3, sp.x, sp.z,
      new B.Color3(0.02, 0.12, 0.06),
      new B.Color3(0.0, 0.15, 0.07),
    );
  });
}

// ────────────────────────────────────────
//  initGame
// ────────────────────────────────────────

export function initGame(canvas) {
  const B = window.BABYLON;
  if (!B) throw new Error('Babylon.js not loaded');

  _canvas = canvas;
  refreshPlayerIdentity();

  _engine = new B.Engine(canvas, true, { adaptToDeviceRatio: true, antialias: true });
  _scene  = new B.Scene(_engine);
  _scene.clearColor        = new B.Color4(0.02, 0.02, 0.05, 1);
  _scene.collisionsEnabled = false;

  _createSkybox();

  const hemi       = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), _scene);
  hemi.intensity   = 0.35;
  hemi.diffuse     = new B.Color3(0.6, 0.65, 0.9);
  hemi.groundColor = new B.Color3(0.05, 0.05, 0.08);

  const dir       = new B.DirectionalLight('dir', new B.Vector3(-0.5, -1, -0.3), _scene);
  dir.intensity   = 0.7;
  dir.diffuse     = new B.Color3(0.9, 0.85, 0.8);
  dir.position    = new B.Vector3(20, 40, 20);

  [{ x: 16, z: 16 }, { x: -16, z: 16 }, { x: 16, z: -16 }, { x: -16, z: -16 }].forEach((pos, i) => {
    const pt     = new B.PointLight('pt_' + i, new B.Vector3(pos.x, 1, pos.z), _scene);
    pt.intensity = 0.6;
    pt.diffuse   = new B.Color3(0.1, 0.9, 0.4);
    pt.range     = 10;
  });

  const spot      = new B.SpotLight('spot', new B.Vector3(0, 20, 0), new B.Vector3(0, -1, 0), Math.PI / 4, 8, _scene);
  spot.intensity  = 0.5;
  spot.diffuse    = new B.Color3(0.8, 0.9, 1.0);

  _scene.fogMode    = B.Scene.FOGMODE_EXP2;
  _scene.fogColor   = new B.Color3(0.02, 0.02, 0.05);
  _scene.fogDensity = 0.012;

  _camera = new B.UniversalCamera('cam', new B.Vector3(0, GROUND_Y, -28), _scene);
  _camera.setTarget(B.Vector3.Zero());
  _camera.attachControl(canvas, true);
  _camera.keysUp    = [];
  _camera.keysDown  = [];
  _camera.keysLeft  = [];
  _camera.keysRight = [];
  _camera.angularSensibility = 650;
  _camera.inertia            = 0.04;
  _camera.minZ               = 0.05;
  _camera.fov                = 1.22;

  _pointerLocked = false;
  canvas.addEventListener('click', () => {
    if (!_pointerLocked) canvas.requestPointerLock();
  });
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
  document.addEventListener('keyup',   _keyUpHandler);

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
  if (_keyUpHandler)   { document.removeEventListener('keyup',   _keyUpHandler);   _keyUpHandler   = null; }
  if (_scene && _obsHandler) { _scene.onBeforeRenderObservable.remove(_obsHandler); _obsHandler = null; }
  if (_resizeHandler)  { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }
  _remotePlayers.forEach((_, id) => removeRemotePlayer(id));
  _remotePlayers.clear();
  window._nbGetPlayerState = null;
  _velX = 0; _velZ = 0; _velY = 0;
  _onGround = true; _sprinting = false; _jumpHeld = false;
  Object.keys(_keys).forEach(k => delete _keys[k]);
  _scene = null; _camera = null; _canvas = null; _engine = null;
  if (engine) { engine.stopRenderLoop(); engine.dispose(); }
}
