// ══════════════════════════════════════
//  NodeBlast — GAME (MD01)
//  Babylon.js 3D scene: ground, boxes, FPS camera
// ══════════════════════════════════════

let _resizeHandler = null;

export function initGame(canvas) {
  const B = window.BABYLON;
  if (!B) throw new Error('Babylon.js not loaded');

  const engine = new B.Engine(canvas, true, { adaptToDeviceRatio: true });
  const scene = new B.Scene(engine);

  scene.clearColor = new B.Color4(0.04, 0.04, 0.06, 1);
  scene.collisionsEnabled = true;
  scene.gravity = new B.Vector3(0, -0.98, 0);

  // Camera — UniversalCamera for FPS controls
  const camera = new B.UniversalCamera('cam', new B.Vector3(0, 1.8, -5), scene);
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

  // Pointer lock on canvas click
  canvas.addEventListener('click', () => canvas.requestPointerLock());

  // Lighting
  const hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;
  const dir = new B.DirectionalLight('dir', new B.Vector3(-1, -2, -1), scene);
  dir.intensity = 0.8;

  // Ground
  const ground = B.MeshBuilder.CreateGround('ground', { width: 60, height: 60 }, scene);
  const groundMat = new B.StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = B.Color3.FromHexString('#1a1a2e');
  ground.material = groundMat;
  ground.checkCollisions = true;

  // Reference boxes
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

  // Render loop
  engine.runRenderLoop(() => scene.render());

  // Resize handler (stored so destroyGame can remove it)
  _resizeHandler = () => engine.resize();
  window.addEventListener('resize', _resizeHandler);

  return { engine, scene };
}

export function destroyGame(engine) {
  if (_resizeHandler) {
    window.removeEventListener('resize', _resizeHandler);
    _resizeHandler = null;
  }
  if (engine) {
    engine.stopRenderLoop();
    engine.dispose();
  }
}
