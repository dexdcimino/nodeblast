// ══════════════════════════════════════
//  NodeBlast — PLASMA CANNON
//  Wavy beam raycast, block destruction, reformation
// ══════════════════════════════════════

let _scene    = null;
let _camera   = null;
let _colBlocks = null;

let _beamActive     = false;
let _beamMeshes     = [];
let _beamParticlePS = null;
let _beamLight      = null;
let _beamTimer      = 0;

const _destroyedBlocks = new Map();

export function initPlasma(scene, camera, colBlocksRef) {
  _scene     = scene;
  _camera    = camera;
  _colBlocks = colBlocksRef;

  _beamLight           = new BABYLON.PointLight('plasma_light', BABYLON.Vector3.Zero(), _scene);
  _beamLight.diffuse   = new BABYLON.Color3(0.5, 0.1, 1.0);
  _beamLight.intensity = 0;
  _beamLight.range     = 8;

  _beamParticlePS                  = new BABYLON.ParticleSystem('plasma_ps', 120, _scene);
  _beamParticlePS.emitter          = _camera;
  _beamParticlePS.minEmitBox       = new BABYLON.Vector3(-0.05, -0.05, 0);
  _beamParticlePS.maxEmitBox       = new BABYLON.Vector3( 0.05,  0.05, 0);
  _beamParticlePS.direction1       = new BABYLON.Vector3(-1, -0.5, 0.5);
  _beamParticlePS.direction2       = new BABYLON.Vector3( 1,  0.5, 1.0);
  _beamParticlePS.minLifeTime      = 0.1;
  _beamParticlePS.maxLifeTime      = 0.35;
  _beamParticlePS.minSize          = 0.04;
  _beamParticlePS.maxSize          = 0.14;
  _beamParticlePS.minEmitPower     = 1;
  _beamParticlePS.maxEmitPower     = 4;
  _beamParticlePS.updateSpeed      = 0.02;
  _beamParticlePS.emitRate         = 0;
  _beamParticlePS.color1           = new BABYLON.Color4(0.6, 0.1, 1.0, 1.0);
  _beamParticlePS.color2           = new BABYLON.Color4(1.0, 0.4, 1.0, 0.6);
  _beamParticlePS.colorDead        = new BABYLON.Color4(0.3, 0.0, 0.5, 0.0);
  _beamParticlePS.start();
}

export function updatePlasma(firing) {
  if (!_scene || !_camera) return;

  _beamTimer++;

  if (firing) {
    _beamActive = true;
    _fireBeam();
  } else {
    _beamActive = false;
    _clearBeam();
    _beamLight.intensity = 0;
    _beamParticlePS.emitRate = 0;
  }

  _updateDestroyedBlocks();
}

function _fireBeam() {
  const B = BABYLON;
  _clearBeam();

  const origin = _camera.position.clone();
  const dir    = _camera.getDirection(B.Vector3.Forward()).normalize();
  const maxLen = 40;

  let hitDist  = maxLen;
  let hitBlock = null;

  for (const b of _colBlocks) {
    const tMinX = (b.minX - origin.x) / dir.x;
    const tMaxX = (b.maxX - origin.x) / dir.x;
    const tMinZ = (b.minZ - origin.z) / dir.z;
    const tMaxZ = (b.maxZ - origin.z) / dir.z;
    const tMinY = (0      - origin.y) / dir.y;
    const tMaxY = (b.maxY - origin.y) / dir.y;

    const tEnter = Math.max(
      Math.min(tMinX, tMaxX),
      Math.min(tMinZ, tMaxZ),
      Math.min(tMinY, tMaxY),
    );
    const tExit = Math.min(
      Math.max(tMinX, tMaxX),
      Math.max(tMinZ, tMaxZ),
      Math.max(tMinY, tMaxY),
    );

    if (tExit > 0 && tEnter < tExit && tEnter < hitDist) {
      hitDist  = Math.max(0, tEnter);
      hitBlock = b;
    }
  }

  const hitPoint = origin.add(dir.scale(hitDist));

  const segments = 16;
  const points   = [];
  for (let i = 0; i <= segments; i++) {
    const t     = i / segments;
    const pos   = origin.add(dir.scale(hitDist * t));
    const right = _camera.getDirection(B.Vector3.Right());
    const up    = _camera.getDirection(B.Vector3.Up());
    const wobble = Math.sin(t * 12 + _beamTimer * 0.35) * 0.06 * (1 - t * 0.5);
    const wob2   = Math.cos(t * 8  + _beamTimer * 0.25) * 0.04 * (1 - t * 0.5);
    pos.addInPlace(right.scale(wobble));
    pos.addInPlace(up.scale(wob2));
    points.push(pos);
  }

  const tube = B.MeshBuilder.CreateTube('plasma_beam', {
    path:      points,
    radius:    0.025,
    tessellation: 5,
    updatable: false,
  }, _scene);
  const bm           = new B.StandardMaterial('pbm_' + _beamTimer, _scene);
  bm.emissiveColor   = new B.Color3(0.7, 0.1, 1.0);
  bm.disableLighting = true;
  bm.alpha           = 0.85;
  tube.material      = bm;
  _beamMeshes.push(tube);

  const core = B.MeshBuilder.CreateTube('plasma_core', {
    path:      points,
    radius:    0.008,
    tessellation: 4,
    updatable: false,
  }, _scene);
  const cm           = new B.StandardMaterial('pcm_' + _beamTimer, _scene);
  cm.emissiveColor   = new B.Color3(1.0, 0.6, 1.0);
  cm.disableLighting = true;
  core.material      = cm;
  _beamMeshes.push(core);

  _beamLight.position.copyFrom(hitPoint);
  _beamLight.intensity = 1.8;

  _beamParticlePS.emitter  = origin.clone();
  _beamParticlePS.emitRate = 80;

  if (hitBlock && !_destroyedBlocks.has(hitBlock)) {
    _destroyBlock(hitBlock);
  }

  if (hitBlock || hitDist < maxLen) {
    _spawnImpactSparks(hitPoint);
  }
}

function _clearBeam() {
  _beamMeshes.forEach(m => { try { m.dispose(); } catch {} });
  _beamMeshes = [];
}

function _destroyBlock(block) {
  const B = BABYLON;

  const mesh = _scene.meshes.find(m =>
    Math.abs(m.position.x - (block.minX + block.maxX) / 2) < 0.1 &&
    Math.abs(m.position.z - (block.minZ + block.maxZ) / 2) < 0.1 &&
    !m.name.startsWith('plasma') && !m.name.startsWith('proj') &&
    !m.name.startsWith('goo')
  );
  if (!mesh) return;

  const w = block.maxX - block.minX;
  const d = block.maxZ - block.minZ;
  const h = block.maxY;

  const fragments = [];
  for (let fx = 0; fx < 2; fx++) {
    for (let fz = 0; fz < 2; fz++) {
      for (let fy = 0; fy < 2; fy++) {
        const frag = B.MeshBuilder.CreateBox('frag_' + Date.now() + '_' + fx + fz + fy, {
          width:  w / 2 * (0.7 + Math.random() * 0.4),
          height: h / 2 * (0.7 + Math.random() * 0.4),
          depth:  d / 2 * (0.7 + Math.random() * 0.4),
        }, _scene);
        frag.position.copyFrom(mesh.position);
        frag.position.x += (fx - 0.5) * w * 0.4;
        frag.position.y += (fy - 0.5) * h * 0.4 + h / 2;
        frag.position.z += (fz - 0.5) * d * 0.4;
        frag.material   = mesh.material;
        frag._vel = new B.Vector3(
          (fx - 0.5) * 0.15 + (Math.random() - 0.5) * 0.1,
          0.15 + Math.random() * 0.15,
          (fz - 0.5) * 0.15 + (Math.random() - 0.5) * 0.1,
        );
        frag._rot = new B.Vector3(
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1,
        );
        fragments.push(frag);
      }
    }
  }

  mesh.setEnabled(false);

  _destroyedBlocks.set(block, {
    mesh,
    fragments,
    timer: 0,
    reformTime: 480,
  });
}

function _updateDestroyedBlocks() {
  _destroyedBlocks.forEach((data, block) => {
    data.timer++;

    if (data.timer < 60) {
      data.fragments.forEach(f => {
        f._vel.y -= 0.008;
        f.position.addInPlace(f._vel);
        f.rotation.addInPlace(f._rot);
        f._vel.scaleInPlace(0.95);
      });
    } else if (data.timer >= data.reformTime - 60) {
      const t = (data.timer - (data.reformTime - 60)) / 60;
      data.fragments.forEach((f, i) => {
        f.position.x += (data.mesh.position.x - f.position.x) * 0.08;
        f.position.y += (data.mesh.position.y - f.position.y) * 0.08;
        f.position.z += (data.mesh.position.z - f.position.z) * 0.08;
        f.rotation.scaleInPlace(0.9);
        if (f.material) f.material.alpha = Math.max(0, 1 - t);
      });

      if (t >= 0.95) {
        data.mesh.setEnabled(true);
        if (data.mesh.material) data.mesh.material.alpha = 1;
        data.fragments.forEach(f => { try { f.dispose(); } catch {} });
        _destroyedBlocks.delete(block);
      }
    } else if (data.timer >= 60) {
      data.fragments.forEach((f, i) => {
        f.position.y += Math.sin(data.timer * 0.05 + i) * 0.003;
      });
    }
  });
}

function _spawnImpactSparks(pos) {
  const B = BABYLON;
  const ps = new B.ParticleSystem('impact_spark', 20, _scene);
  ps.emitter         = pos.clone();
  ps.minEmitBox      = B.Vector3.Zero();
  ps.maxEmitBox      = B.Vector3.Zero();
  ps.direction1      = new B.Vector3(-1, -1, -1);
  ps.direction2      = new B.Vector3( 1,  1,  1);
  ps.minLifeTime     = 0.1;
  ps.maxLifeTime     = 0.3;
  ps.minSize         = 0.04;
  ps.maxSize         = 0.1;
  ps.minEmitPower    = 3;
  ps.maxEmitPower    = 8;
  ps.updateSpeed     = 0.02;
  ps.emitRate        = 200;
  ps.color1          = new B.Color4(0.8, 0.1, 1.0, 1.0);
  ps.color2          = new B.Color4(1.0, 0.5, 1.0, 0.5);
  ps.colorDead       = new B.Color4(0.3, 0.0, 0.5, 0.0);
  ps.targetStopDuration = 0.08;
  ps.start();
  setTimeout(() => { try { ps.dispose(); } catch {} }, 600);
}

export function destroyPlasma() {
  _clearBeam();
  if (_beamLight)      { try { _beamLight.dispose();      } catch {} _beamLight      = null; }
  if (_beamParticlePS) { try { _beamParticlePS.dispose(); } catch {} _beamParticlePS = null; }
  _destroyedBlocks.forEach(data => {
    data.fragments.forEach(f => { try { f.dispose(); } catch {} });
    data.mesh?.setEnabled(true);
  });
  _destroyedBlocks.clear();
}
