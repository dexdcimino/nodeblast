// ══════════════════════════════════════
//  NodeBlast — GAME ENGINE
//  Manual FPS controller — proper physics,
//  sprint, jump, air control, smooth feel.
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
const WALK_SPEED    = 0.18;
const SPRINT_MULT   = 2.6;
const JUMP_FORCE    = 0.28;
const GRAVITY       = 0.022;
const GROUND_Y      = 1.8;
const AIR_CONTROL   = 0.4;
const FRICTION      = 0.82;
const INERTIA       = 0.14;

// ── Player physics state ──
let _velX     = 0;
let _velZ     = 0;
let _velY     = 0;
let _onGround = true;
let _sprinting = false;

// ── Input state ──
const _keys = {};
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
    rotY:  _camera.rotation.y,
    pitch: _camera.rotation.x,
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
    { height: 1.8, radius: 0.35, tessellation: 8 },
    _scene,
  );
  body.parent     = root;
  body.position.y = 0.9;

  const r   = parseInt(hex.slice(0, 2), 16) / 255;
  const g   = parseInt(hex.slice(2, 4), 16) / 255;
  const b   = parseInt(hex.slice(4, 6), 16) / 255;
  const mat = new B.StandardMaterial('remote_mat_' + id, _scene);
  mat.diffuseColor  = new B.Color3(r, g, b);
  mat.emissiveColor = new B.Color3(r * 0.25, g * 0.25, b * 0.25);
  body.material = mat;

  const labelPlane = B.MeshBuilder.CreatePlane(
    'remote_label_' + id,
    { width: 2, height: 0.45 },
    _scene,
  );
  labelPlane.parent        = root;
  labelPlane.position.y    = 2.3;
  labelPlane.billboardMode = B.Mesh.BILLBOARDMODE_ALL;

  const labelTex = new B.DynamicTexture(
    'remote_label_tex_' + id,
    { width: 256, height: 64 },
    _scene,
  );
  labelTex.drawText(username, null, 46, 'bold 28px Outfit,Arial', '#ffffff', 'transparent', true);

  const labelMat = new B.StandardMaterial('remote_label_mat_' + id, _scene);
  labelMat.diffuseTexture  = labelTex;
  labelMat.emissiveTexture = labelTex;
  labelMat.opacityTexture  = labelTex;
  labelMat.backFaceCulling = false;
  labelMat.disableLighting = true;
  labelPlane.material      = labelMat;

  return { root, body, labelPlane, labelTex };
}

export function addOrUpdateRemotePlayer(id, x, y, z, rotY, username, hex) {
  let p = _remotePlayers.get(id);
  if (!p) {
    const safeHex  = (hex || '5aaa72').replace('#', '');
    const safeName = username || 'player';
    const meshes   = _createRemotePlayerMesh(id, safeHex, safeName);
    p = {
      ...meshes,
      targetX: x, targetY: y, targetZ: z, targetRotY: rotY,
      renderX: x, renderY: y, renderZ: z, renderRotY: rotY,
      lastUpdate: Date.now(),
    };
    _remotePlayers.set(id, p);
    console.log('[game] remote player added:', id, username);
  } else {
    p.targetX    = x;
    p.targetY    = y - 1.8;
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
  try { p.labelTex.dispose(); }   catch {}
  try { p.labelPlane.dispose(); } catch {}
  try { p.body.dispose(); }       catch {}
  try { p.root.dispose(); }       catch {}
  _remotePlayers.delete(id);
  console.log('[game] remote player removed:', id);
}

// ────────────────────────────────────────
//  FPS physics tick — runs every frame
// ────────────────────────────────────────

function _physicsTick() {
  if (!_camera || !_scene) return;

  const B = window.BABYLON;

  const forward = _keys['KeyW'] || _keys['ArrowUp'];
  const back    = _keys['KeyS'] || _keys['ArrowDown'];
  const left    = _keys['KeyA'] || _keys['ArrowLeft'];
  const right   = _keys['KeyD'] || _keys['ArrowRight'];
  const jumping = _keys['Space'];

  const camForward = _camera.getDirection(B.Vector3.Forward());
  camForward.y = 0;
  camForward.normalize();
  const camRight = _camera.getDirection(B.Vector3.Right());
  camRight.y = 0;
  camRight.normalize();

  let moveX = 0;
  let moveZ = 0;
  if (forward) { moveX += camForward.x; moveZ += camForward.z; }
  if (back)    { moveX -= camForward.x; moveZ -= camForward.z; }
  if (right)   { moveX += camRight.x;   moveZ += camRight.z;   }
  if (left)    { moveX -= camRight.x;   moveZ -= camRight.z;   }

  const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (moveLen > 0) { moveX /= moveLen; moveZ /= moveLen; }

  const speed   = WALK_SPEED * (_sprinting ? SPRINT_MULT : 1.0);
  const control = _onGround ? 1.0 : AIR_CONTROL;

  const targetVX = moveX * speed;
  const targetVZ = moveZ * speed;
  _velX += (targetVX - _velX) * INERTIA * control;
  _velZ += (targetVZ - _velZ) * INERTIA * control;

  if (moveLen === 0) {
    _velX *= FRICTION;
    _velZ *= FRICTION;
  }

  _velY -= GRAVITY;

  if (jumping && _onGround) {
    _velY     = JUMP_FORCE;
    _onGround = false;
  }

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

  const now        = Date.now();
  const lerpFactor = 0.2;
  _remotePlayers.forEach((p) => {
    p.renderX    += (p.targetX    - p.renderX)    * lerpFactor;
    p.renderY    += (p.targetY    - p.renderY)    * lerpFactor;
    p.renderZ    += (p.targetZ    - p.renderZ)    * lerpFactor;
    p.renderRotY += (p.targetRotY - p.renderRotY) * lerpFactor;
    p.root.position.set(p.renderX, p.renderY, p.renderZ);
    p.root.rotation.y = p.renderRotY;
    p.root.setEnabled(now - p.lastUpdate <= 5000);
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

  _engine = new B.Engine(canvas, true, { adaptToDeviceRatio: true });
  _scene  = new B.Scene(_engine);

  _scene.clearColor        = new B.Color4(0.04, 0.04, 0.06, 1);
  _scene.collisionsEnabled = false;

  _scene.fogMode    = B.Scene.FOGMODE_EXP2;
  _scene.fogColor   = new B.Color3(0.05, 0.05, 0.08);
  _scene.fogDensity = 0.016;

  // Camera — mouse look only, NO built-in key movement
  _camera = new B.UniversalCamera('cam', new B.Vector3(0, GROUND_Y, -5), _scene);
  _camera.setTarget(B.Vector3.Zero());
  _camera.attachControl(canvas, true);
  _camera.keysUp    = [];
  _camera.keysDown  = [];
  _camera.keysLeft  = [];
  _camera.keysRight = [];
  _camera.angularSensibility = 700;
  _camera.inertia            = 0.05;
  _camera.minZ               = 0.05;
  _camera.fov                = 1.309;

  // Pointer lock
  _pointerLocked = false;
  canvas.addEventListener('click', () => {
    if (!_pointerLocked) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    _pointerLocked = document.pointerLockElement === canvas;
    const ch = document.getElementById('play-crosshair');
    if (ch) ch.style.opacity = _pointerLocked ? '1' : '0.35';
  });

  // Input
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

  // Lighting
  const hemi     = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), _scene);
  hemi.intensity = 0.55;
  const dir      = new B.DirectionalLight('dir', new B.Vector3(-1, -2, -1), _scene);
  dir.intensity  = 0.9;
  dir.position   = new B.Vector3(20, 40, 20);

  // Ground
  const ground = B.MeshBuilder.CreateGround('ground', { width: 80, height: 80, subdivisions: 2 }, _scene);
  const gMat   = new B.StandardMaterial('groundMat', _scene);
  gMat.diffuseColor  = new B.Color3(0.08, 0.09, 0.13);
  gMat.specularColor = new B.Color3(0.03, 0.03, 0.05);
  ground.material    = gMat;

  // Cover blocks
  const blocks = [
    { x:  0,  z:  0, w: 2, h: 1.2, d: 6   },
    { x:  5,  z:  3, w: 3, h: 2,   d: 1.5 },
    { x: -5,  z:  3, w: 3, h: 2,   d: 1.5 },
    { x:  0,  z:  8, w: 8, h: 0.8, d: 2   },
    { x: 12,  z: -4, w: 2, h: 4,   d: 2   },
    { x:-12,  z: -4, w: 2, h: 4,   d: 2   },
    { x:  7,  z:-10, w: 4, h: 1.5, d: 4   },
    { x: -7,  z:-10, w: 4, h: 1.5, d: 4   },
    { x:  0,  z:-18, w:10, h: 3,   d: 3   },
    { x: 18,  z:  8, w: 2, h: 6,   d: 2   },
    { x:-18,  z:  8, w: 2, h: 6,   d: 2   },
    { x:  0,  z: 18, w: 6, h: 2,   d: 2   },
  ];
  blocks.forEach((b, i) => {
    const box = B.MeshBuilder.CreateBox('block_' + i, { width: b.w, height: b.h, depth: b.d }, _scene);
    box.position.set(b.x, b.h / 2, b.z);
    const mat = new B.StandardMaterial('bMat_' + i, _scene);
    const shade = 0.18 + (i % 3) * 0.03;
    mat.diffuseColor  = new B.Color3(shade, shade + 0.02, shade + 0.06);
    mat.specularColor = new B.Color3(0.04, 0.04, 0.06);
    box.material      = mat;
  });

  // Physics tick on scene observer
  _obsHandler = _scene.onBeforeRenderObservable.add(_physicsTick);

  // Render loop
  _engine.runRenderLoop(() => _scene.render());

  // Resize
  _resizeHandler = () => _engine.resize();
  window.addEventListener('resize', _resizeHandler);

  // State bridge
  window._nbGetPlayerState = getPlayerState;

  return { engine: _engine, scene: _scene };
}

// ────────────────────────────────────────
//  destroyGame
// ────────────────────────────────────────

export function destroyGame(engine) {
  if (_keyDownHandler) { document.removeEventListener('keydown', _keyDownHandler); _keyDownHandler = null; }
  if (_keyUpHandler)   { document.removeEventListener('keyup',   _keyUpHandler);   _keyUpHandler   = null; }

  if (_scene && _obsHandler) {
    _scene.onBeforeRenderObservable.remove(_obsHandler);
    _obsHandler = null;
  }

  if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }

  _remotePlayers.forEach((_, id) => removeRemotePlayer(id));
  _remotePlayers.clear();

  window._nbGetPlayerState = null;

  _velX = 0; _velZ = 0; _velY = 0;
  _onGround = true; _sprinting = false;
  Object.keys(_keys).forEach(k => delete _keys[k]);

  _scene  = null;
  _camera = null;
  _canvas = null;
  _engine = null;
  if (engine) {
    engine.stopRenderLoop();
    engine.dispose();
  }
}
