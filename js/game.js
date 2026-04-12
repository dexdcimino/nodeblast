// ══════════════════════════════════════
//  NodeBlast — GAME (MD01 + MD02 + MD03)
//  Babylon.js 3D scene: FPS camera, labeled remote players,
//  structural blocks, fog, invisible boundary walls.
// ══════════════════════════════════════

import State from './state.js';

let _resizeHandler = null;
let _scene = null;
let _camera = null;
let _pointerLocked = false;
let _playerUsername = 'player';
let _playerHex = '5aaa72';
let _keyDownHandler = null;
let _keyUpHandler = null;
let _jumpHandler = null;
const _remotePlayers = new Map();

export function getPlayerState() {
  if (!_camera) return null;
  return {
    x: _camera.position.x,
    y: _camera.position.y,
    z: _camera.position.z,
    rotY: _camera.rotation.y,
    pitch: _camera.rotation.x,
    username: _playerUsername,
    hex: _playerHex,
  };
}

export function refreshPlayerIdentity() {
  _playerUsername = State.profile?.displayName || State.user?.displayName || 'player';
  _playerHex = State.profile?.hexCode || '5aaa72';
}

// ── Remote player mesh factory ──

function _createRemotePlayerMesh(id, hex, username) {
  const B = window.BABYLON;
  const root = new B.TransformNode('remote_root_' + id, _scene);

  const body = B.MeshBuilder.CreateCapsule(
    'remote_body_' + id,
    { height: 1.8, radius: 0.35, tessellation: 8 },
    _scene,
  );
  body.parent = root;
  body.position.y = 0.9;

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const mat = new B.StandardMaterial('remote_mat_' + id, _scene);
  mat.diffuseColor = new B.Color3(r, g, b);
  mat.emissiveColor = new B.Color3(r * 0.2, g * 0.2, b * 0.2);
  body.material = mat;

  const labelPlane = B.MeshBuilder.CreatePlane(
    'remote_label_' + id,
    { width: 2, height: 0.45 },
    _scene,
  );
  labelPlane.parent = root;
  labelPlane.position.y = 2.2;
  labelPlane.billboardMode = B.Mesh.BILLBOARDMODE_ALL;

  const labelTex = new B.DynamicTexture(
    'remote_label_tex_' + id,
    { width: 256, height: 64 },
    _scene,
  );
  labelTex.drawText(username, null, 46, 'bold 28px Outfit, Arial', '#ffffff', 'transparent', true);
  const labelMat = new B.StandardMaterial('remote_label_mat_' + id, _scene);
  labelMat.diffuseTexture = labelTex;
  labelMat.emissiveTexture = labelTex;
  labelMat.opacityTexture = labelTex;
  labelMat.backFaceCulling = false;
  labelMat.disableLighting = true;
  labelPlane.material = labelMat;

  return { root, body, labelPlane, labelTex };
}

export function addOrUpdateRemotePlayer(id, x, y, z, rotY, username, hex) {
  let p = _remotePlayers.get(id);
  if (!p) {
    const safeHex = (hex || '5aaa72').replace('#', '');
    const safeName = username || 'player';
    const meshes = _createRemotePlayerMesh(id, safeHex, safeName);
    p = {
      root: meshes.root,
      body: meshes.body,
      labelPlane: meshes.labelPlane,
      labelTex: meshes.labelTex,
      targetX: x, targetY: y, targetZ: z, targetRotY: rotY,
      renderX: x, renderY: y, renderZ: z, renderRotY: rotY,
      lastUpdate: Date.now(),
    };
    _remotePlayers.set(id, p);
  } else {
    p.targetX = x;
    p.targetY = y;
    p.targetZ = z;
    p.targetRotY = rotY;
    p.lastUpdate = Date.now();
  }
}

export function getRemotePlayerIds() {
  return Array.from(_remotePlayers.keys());
}

export function removeRemotePlayer(id) {
  const p = _remotePlayers.get(id);
  if (p) {
    p.labelTex.dispose();
    p.labelPlane.dispose();
    p.body.dispose();
    p.root.dispose();
    _remotePlayers.delete(id);
  }
}

// ── Scene init ──

export function initGame(canvas) {
  const B = window.BABYLON;
  if (!B) throw new Error('Babylon.js not loaded');

  // Pull identity from the existing auth state
  _playerUsername = State.profile?.displayName || State.user?.displayName || 'player';
  _playerHex = State.profile?.hexCode || '5aaa72';

  const engine = new B.Engine(canvas, true, { adaptToDeviceRatio: true });
  const scene = new B.Scene(engine);
  _scene = scene;

  scene.clearColor = new B.Color4(0.04, 0.04, 0.06, 1);
  scene.collisionsEnabled = true;

  // Fog — hides the hard edge of the map boundary
  scene.fogMode = B.Scene.FOGMODE_EXP2;
  scene.fogColor = new B.Color3(0.05, 0.05, 0.08);
  scene.fogDensity = 0.018;

  // Camera — FPS-tuned UniversalCamera
  const camera = new B.UniversalCamera('cam', new B.Vector3(0, 1.8, -5), scene);
  _camera = camera;
  camera.setTarget(B.Vector3.Zero());
  camera.attachControl(canvas, true);
  camera.keysUp = [87, 38];
  camera.keysDown = [83, 40];
  camera.keysLeft = [65, 37];
  camera.keysRight = [68, 39];
  camera.speed = 0.5;
  camera.angularSensibility = 800;
  camera.inertia = 0.3;
  camera.minZ = 0.05;
  camera.fov = 1.309; // 75 degrees
  camera.checkCollisions = true;
  camera.applyGravity = true;
  camera.ellipsoid = new B.Vector3(0.5, 0.9, 0.5);
  camera.ellipsoidOffset = new B.Vector3(0, 0.9, 0);
  scene.gravity = new B.Vector3(0, -0.5, 0);

  // Sprint (Shift) + Jump (Space)
  let _sprinting = false;
  let _canJump = true;
  _keyDownHandler = (e) => {
    if (e.key === 'Shift' && !_sprinting) {
      _sprinting = true;
      camera.speed = 1.4;
    }
  };
  _keyUpHandler = (e) => {
    if (e.key === 'Shift') {
      _sprinting = false;
      camera.speed = 0.5;
    }
  };
  _jumpHandler = (e) => {
    if (e.code === 'Space' && _canJump) {
      e.preventDefault();
      _canJump = false;
      let jumpVel = 0.22;
      const jumpInt = setInterval(() => {
        if (!_camera) { clearInterval(jumpInt); return; }
        _camera.position.y += jumpVel;
        jumpVel -= 0.018;
        if (jumpVel < -0.1) {
          clearInterval(jumpInt);
          setTimeout(() => { _canJump = true; }, 200);
        }
      }, 16);
    }
  };
  document.addEventListener('keydown', _keyDownHandler);
  document.addEventListener('keyup', _keyUpHandler);
  document.addEventListener('keydown', _jumpHandler);

  // Pointer lock
  _pointerLocked = false;
  canvas.addEventListener('click', () => {
    if (!_pointerLocked) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    _pointerLocked = document.pointerLockElement === canvas;
    const crosshair = document.getElementById('play-crosshair');
    if (crosshair) crosshair.style.opacity = _pointerLocked ? '1' : '0.3';
  });

  // Lighting
  const hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;
  const dir = new B.DirectionalLight('dir', new B.Vector3(-1, -2, -1), scene);
  dir.intensity = 0.8;

  // Ground
  const ground = B.MeshBuilder.CreateGround('ground', { width: 80, height: 80, subdivisions: 40 }, scene);
  const groundMat = new B.StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = new B.Color3(0.08, 0.08, 0.12);
  groundMat.specularColor = new B.Color3(0.05, 0.05, 0.05);
  ground.material = groundMat;
  ground.position.y = 0;
  ground.checkCollisions = true;

  // Invisible boundary walls
  const wallH = 20, wallD = 1, wallL = 80;
  [{ x: 0, z: 40 }, { x: 0, z: -40 }, { x: 40, z: 0 }, { x: -40, z: 0 }].forEach((pos, i) => {
    const wall = B.MeshBuilder.CreateBox(
      'wall_' + i,
      { width: pos.x === 0 ? wallL : wallD, height: wallH, depth: pos.z === 0 ? wallL : wallD },
      scene,
    );
    wall.position.set(pos.x, wallH / 2, pos.z);
    wall.isVisible = false;
    wall.checkCollisions = true;
  });

  // Structural blocks — platforms/cover
  const blockDefs = [
    { x: 8, z: 5, w: 3, h: 2, d: 3 },
    { x: -8, z: 5, w: 3, h: 2, d: 3 },
    { x: 0, z: 12, w: 6, h: 1, d: 2 },
    { x: 15, z: -8, w: 2, h: 4, d: 2 },
    { x: -15, z: -8, w: 2, h: 4, d: 2 },
    { x: 0, z: -15, w: 8, h: 3, d: 3 },
  ];
  blockDefs.forEach((b, i) => {
    const box = B.MeshBuilder.CreateBox('block_' + i, { width: b.w, height: b.h, depth: b.d }, scene);
    box.position.set(b.x, b.h / 2, b.z);
    box.checkCollisions = true;
    const mat = new B.StandardMaterial('blockMat_' + i, scene);
    mat.diffuseColor = new B.Color3(0.2, 0.22, 0.28);
    mat.specularColor = new B.Color3(0.05, 0.05, 0.08);
    box.material = mat;
  });

  // State bridge for photon-client.js send loop
  window._nbGetPlayerState = getPlayerState;

  // Render loop + remote player interpolation
  engine.runRenderLoop(() => {
    scene.render();
    const now = Date.now();
    const lerpFactor = 0.18;
    _remotePlayers.forEach((p) => {
      p.renderX += (p.targetX - p.renderX) * lerpFactor;
      p.renderY += (p.targetY - p.renderY) * lerpFactor;
      p.renderZ += (p.targetZ - p.renderZ) * lerpFactor;
      p.renderRotY += (p.targetRotY - p.renderRotY) * lerpFactor;
      p.root.position.set(p.renderX, p.renderY, p.renderZ);
      p.root.rotation.y = p.renderRotY;
      p.root.setEnabled(now - p.lastUpdate <= 5000);
    });
  });

  _resizeHandler = () => engine.resize();
  window.addEventListener('resize', _resizeHandler);

  return { engine, scene };
}

export function destroyGame(engine) {
  if (_resizeHandler) {
    window.removeEventListener('resize', _resizeHandler);
    _resizeHandler = null;
  }
  if (_keyDownHandler) { document.removeEventListener('keydown', _keyDownHandler); _keyDownHandler = null; }
  if (_keyUpHandler) { document.removeEventListener('keyup', _keyUpHandler); _keyUpHandler = null; }
  if (_jumpHandler) { document.removeEventListener('keydown', _jumpHandler); _jumpHandler = null; }
  _remotePlayers.forEach((p) => {
    try { p.labelTex.dispose(); } catch {}
    try { p.labelPlane.dispose(); } catch {}
    try { p.body.dispose(); } catch {}
    try { p.root.dispose(); } catch {}
  });
  _remotePlayers.clear();
  window._nbGetPlayerState = null;
  _scene = null;
  _camera = null;
  _pointerLocked = false;
  if (engine) {
    engine.stopRenderLoop();
    engine.dispose();
  }
}
