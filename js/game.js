// ══════════════════════════════════════
//  NodeBlast — GAME (MD01 + MD02)
//  Babylon.js 3D scene: ground, boxes, FPS camera,
//  remote player rendering + interpolation.
// ══════════════════════════════════════

let _resizeHandler = null;
let _scene = null;
let _camera = null;
const _remotePlayers = new Map();

export function getPlayerState() {
  if (!_camera) return null;
  return {
    x: _camera.position.x,
    y: _camera.position.y,
    z: _camera.position.z,
    rotY: _camera.rotation.y,
  };
}

export function addOrUpdateRemotePlayer(id, x, y, z, rotY) {
  const B = window.BABYLON;
  if (!B || !_scene) return;
  let p = _remotePlayers.get(id);
  if (!p) {
    const mesh = B.MeshBuilder.CreateCapsule('player_' + id, { height: 1.8, radius: 0.35 }, _scene);
    const mat = new B.StandardMaterial('mat_' + id, _scene);
    mat.diffuseColor = new B.Color3(0.35, 0.67, 0.45);
    mat.emissiveColor = new B.Color3(0.1, 0.2, 0.1);
    mesh.material = mat;
    p = {
      mesh,
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

export function removeRemotePlayer(id) {
  const p = _remotePlayers.get(id);
  if (p) {
    p.mesh.dispose();
    _remotePlayers.delete(id);
  }
}

export function initGame(canvas) {
  const B = window.BABYLON;
  if (!B) throw new Error('Babylon.js not loaded');

  const engine = new B.Engine(canvas, true, { adaptToDeviceRatio: true });
  const scene = new B.Scene(engine);
  _scene = scene;

  scene.clearColor = new B.Color4(0.04, 0.04, 0.06, 1);
  scene.collisionsEnabled = true;
  scene.gravity = new B.Vector3(0, -0.98, 0);

  const camera = new B.UniversalCamera('cam', new B.Vector3(0, 1.8, -5), scene);
  _camera = camera;
  camera.setTarget(B.Vector3.Zero());
  camera.attachControl(canvas, true);
  camera.keysUp = [87, 38];
  camera.keysDown = [83, 40];
  camera.keysLeft = [65, 37];
  camera.keysRight = [68, 39];
  camera.speed = 0.15;
  camera.minZ = 0.1;
  camera.checkCollisions = true;
  camera.applyGravity = true;
  camera.ellipsoid = new B.Vector3(0.5, 0.9, 0.5);

  canvas.addEventListener('click', () => canvas.requestPointerLock());

  const hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;
  const dir = new B.DirectionalLight('dir', new B.Vector3(-1, -2, -1), scene);
  dir.intensity = 0.8;

  const ground = B.MeshBuilder.CreateGround('ground', { width: 60, height: 60 }, scene);
  const groundMat = new B.StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = B.Color3.FromHexString('#1a1a2e');
  ground.material = groundMat;
  ground.checkCollisions = true;

  const boxColor = B.Color3.FromHexString('#5AAA72');
  const boxMat = new B.StandardMaterial('boxMat', scene);
  boxMat.diffuseColor = boxColor;
  const boxPositions = [
    [4, 1, 6],
    [-5, 1, 3],
    [8, 1, -4],
    [-3, 1, -7],
  ];
  boxPositions.forEach(([x, y, z], i) => {
    const box = B.MeshBuilder.CreateBox('box' + i, { height: 2, width: 2, depth: 2 }, scene);
    box.position = new B.Vector3(x, y, z);
    box.material = boxMat;
    box.checkCollisions = true;
  });

  // State bridge for photon-client.js send loop
  window._nbGetPlayerState = getPlayerState;

  engine.runRenderLoop(() => {
    scene.render();
    // Interpolate remote players toward their target positions
    const now = Date.now();
    const lerpFactor = 0.18;
    _remotePlayers.forEach((p) => {
      p.renderX += (p.targetX - p.renderX) * lerpFactor;
      p.renderY += (p.targetY - p.renderY) * lerpFactor;
      p.renderZ += (p.targetZ - p.renderZ) * lerpFactor;
      p.renderRotY += (p.targetRotY - p.renderRotY) * lerpFactor;
      p.mesh.position.set(p.renderX, p.renderY, p.renderZ);
      p.mesh.rotation.y = p.renderRotY;
      p.mesh.setEnabled(now - p.lastUpdate <= 5000);
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
  // Dispose all remote player meshes
  _remotePlayers.forEach((p) => { try { p.mesh.dispose(); } catch {} });
  _remotePlayers.clear();
  // Clear state bridge
  window._nbGetPlayerState = null;
  _scene = null;
  _camera = null;
  if (engine) {
    engine.stopRenderLoop();
    engine.dispose();
  }
}
