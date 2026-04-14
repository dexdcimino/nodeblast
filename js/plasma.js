// ══════════════════════════════════════
//  NodeBlast — PLASMA CANNON
//  Wavy beam from muzzle, color-matched, enemy damage, ground burn
// ══════════════════════════════════════

import { getProjectileColor } from './guns.js';
import { checkEnemyHit, damageEnemyNode } from './enemy-nodes.js';

let _scene     = null;
let _camera    = null;
let _colBlocks = null;

const _groundBurns = [];  // fading burn marks left on ground
const BEAM_DAMAGE_PER_TICK = 3;   // damage dealt to enemy per firing frame
let   _damageTimer = 0;
const DAMAGE_INTERVAL = 6;        // deal damage every N frames while firing

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
  _beamParticlePS.color1    = new BABYLON.Color4(1.0, 1.0, 1.0, 1.0); // updated per fire
  _beamParticlePS.color2    = new BABYLON.Color4(1.0, 1.0, 1.0, 0.6);
  _beamParticlePS.colorDead = new BABYLON.Color4(0.2, 0.2, 0.2, 0.0);
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
  const B   = BABYLON;
  _clearBeam();

  // ── Get current projectile color ──
  const pc  = getProjectileColor();
  const cr  = pc.r, cg = pc.g, cb = pc.b;

  // ── Origin: gun muzzle if available, else camera ──
  const origin = (window._nbMuzzlePos ? window._nbMuzzlePos.clone() : _camera.position.clone());
  const dir    = _camera.getDirection(B.Vector3.Forward()).normalize();
  const right  = _camera.getDirection(B.Vector3.Right()).normalize();
  const up     = _camera.getDirection(B.Vector3.Up()).normalize();
  const maxLen = 48;

  // ── Raycast against colBlocks and enemy nodes ──
  let hitDist   = maxLen;
  let hitBlock  = null;
  let hitEnemy  = -1;

  for (const b of _colBlocks) {
    if (dir.x === 0 && dir.y === 0 && dir.z === 0) continue;
    const tMinX = dir.x !== 0 ? (b.minX - origin.x) / dir.x : -Infinity;
    const tMaxX = dir.x !== 0 ? (b.maxX - origin.x) / dir.x : Infinity;
    const tMinZ = dir.z !== 0 ? (b.minZ - origin.z) / dir.z : -Infinity;
    const tMaxZ = dir.z !== 0 ? (b.maxZ - origin.z) / dir.z : Infinity;
    const tMinY = dir.y !== 0 ? (0      - origin.y) / dir.y : -Infinity;
    const tMaxY = dir.y !== 0 ? (b.maxY - origin.y) / dir.y : Infinity;

    const tEnter = Math.max(Math.min(tMinX, tMaxX), Math.min(tMinZ, tMaxZ), Math.min(tMinY, tMaxY));
    const tExit  = Math.min(Math.max(tMinX, tMaxX), Math.max(tMinZ, tMaxZ), Math.max(tMinY, tMaxY));

    if (tExit > 0 && tEnter < tExit && tEnter < hitDist) {
      hitDist  = Math.max(0, tEnter);
      hitBlock = b;
    }
  }

  // ── Enemy node ray check ──
  // Sample along beam path for enemy collisions (cheaper than full ray vs sphere per frame)
  if (window._nbEnemyPositions) {
    const enemies = window._nbEnemyPositions();
    for (const e of enemies) {
      const toEnemy = e.pos.subtract(origin);
      const proj    = B.Vector3.Dot(toEnemy, dir);
      if (proj < 0 || proj > hitDist) continue;
      const closest = origin.add(dir.scale(proj));
      const dist2   = B.Vector3.Distance(closest, e.pos);
      if (dist2 < 0.9 && proj < hitDist) {
        hitDist   = proj;
        hitEnemy  = e.index;
        hitBlock  = null;
      }
    }
  }

  // ── Deal damage to hit enemy (rate-limited) ──
  _damageTimer++;
  if (hitEnemy >= 0 && _damageTimer >= DAMAGE_INTERVAL) {
    _damageTimer = 0;
    damageEnemyNode(hitEnemy, BEAM_DAMAGE_PER_TICK);
  }

  const hitPoint = origin.add(dir.scale(hitDist));

  // ── Build sine-wave beam path (stable wobble, relative to firing direction) ──
  const segments = 20;
  const points   = [];
  for (let i = 0; i <= segments; i++) {
    const t     = i / segments;
    const pos   = origin.add(dir.scale(hitDist * t));
    // Wobble is a sine wave in screen-space right/up — amplitude tapers near origin and hit
    const taper  = Math.sin(t * Math.PI);  // 0 at both ends, peak at middle
    const wobble = Math.sin(t * 10 + _beamTimer * 0.4) * 0.055 * taper;
    const wob2   = Math.cos(t * 7  + _beamTimer * 0.3) * 0.035 * taper;
    pos.addInPlace(right.scale(wobble));
    pos.addInPlace(up.scale(wob2));
    points.push(pos);
  }

  // ── Outer glow beam ──
  const tube  = B.MeshBuilder.CreateTube('plasma_beam', {
    path: points, radius: 0.032, tessellation: 6, updatable: false,
  }, _scene);
  const bm           = new B.StandardMaterial('pbm_' + _beamTimer, _scene);
  bm.emissiveColor   = new B.Color3(cr, cg, cb);
  bm.disableLighting = true;
  bm.alpha           = 0.80;
  tube.material      = bm;
  _beamMeshes.push(tube);

  // ── Bright core ──
  const core  = B.MeshBuilder.CreateTube('plasma_core', {
    path: points, radius: 0.010, tessellation: 4, updatable: false,
  }, _scene);
  const cm           = new B.StandardMaterial('pcm_' + _beamTimer, _scene);
  cm.emissiveColor   = new B.Color3(
    Math.min(cr * 1.5 + 0.3, 1.0),
    Math.min(cg * 1.5 + 0.3, 1.0),
    Math.min(cb * 1.5 + 0.3, 1.0),
  );
  cm.disableLighting = true;
  core.material      = cm;
  _beamMeshes.push(core);

  // ── Update beam light and particles to match color ──
  _beamLight.position.copyFrom(hitPoint);
  _beamLight.diffuse   = new B.Color3(cr, cg, cb);
  _beamLight.intensity = 2.2;

  // Move particle emitter to midpoint of beam so sparks look attached
  const midPoint = origin.add(dir.scale(hitDist * 0.5));
  _beamParticlePS.emitter = midPoint.clone();
  _beamParticlePS.color1  = new B.Color4(cr, cg, cb, 1.0);
  _beamParticlePS.color2  = new B.Color4(Math.min(cr + 0.3, 1), Math.min(cg + 0.3, 1), Math.min(cb + 0.3, 1), 0.5);
  _beamParticlePS.emitRate = 90;

  // ── Impact sparks at hit point ──
  if (hitDist < maxLen) {
    _spawnImpactSparks(hitPoint, cr, cg, cb);
  }

  // ── Ground/surface burn mark ──
  if (hitPoint.y < 0.3) {
    _spawnGroundBurn(hitPoint, cr, cg, cb);
  }

  // ── Block destruction (unchanged) ──
  if (hitBlock && !_destroyedBlocks.has(hitBlock)) {
    _destroyBlock(hitBlock);
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

function _spawnImpactSparks(pos, cr, cg, cb) {
  const B = BABYLON;
  // Rate-limit impact sparks — don't spawn every frame
  if (_beamTimer % 3 !== 0) return;
  const ps = new B.ParticleSystem('impact_spark', 24, _scene);
  ps.emitter         = pos.clone();
  ps.minEmitBox      = B.Vector3.Zero();
  ps.maxEmitBox      = B.Vector3.Zero();
  ps.direction1      = new B.Vector3(-1.5, -0.5, -1.5);
  ps.direction2      = new B.Vector3( 1.5,  1.5,  1.5);
  ps.minLifeTime     = 0.08;
  ps.maxLifeTime     = 0.25;
  ps.minSize         = 0.03;
  ps.maxSize         = 0.09;
  ps.minEmitPower    = 2;
  ps.maxEmitPower    = 7;
  ps.updateSpeed     = 0.02;
  ps.emitRate        = 180;
  ps.color1          = new B.Color4(cr, cg, cb, 1.0);
  ps.color2          = new B.Color4(Math.min(cr + 0.3, 1), Math.min(cg + 0.3, 1), Math.min(cb + 0.3, 1), 0.5);
  ps.colorDead       = new B.Color4(cr * 0.2, cg * 0.2, cb * 0.2, 0.0);
  ps.targetStopDuration = 0.07;
  ps.start();
  setTimeout(() => { try { ps.dispose(); } catch {} }, 500);
}

function _spawnGroundBurn(pos, cr, cg, cb) {
  const B = BABYLON;
  // Don't spam burns every frame — one per ~6 frames
  if (_beamTimer % 6 !== 0) return;
  // Don't exceed burn limit
  if (_groundBurns.length > 40) {
    const old = _groundBurns.shift();
    try { old.dispose(); } catch {}
  }
  const burnW = 0.08 + Math.random() * 0.12;
  const burn = B.MeshBuilder.CreateCylinder('pburn_' + _beamTimer,
    { diameter: burnW, height: 0.02, tessellation: 6 }, _scene);
  burn.position.set(pos.x + (Math.random() - 0.5) * 0.2, 0.015, pos.z + (Math.random() - 0.5) * 0.2);
  const bm = new B.StandardMaterial('pbm2_' + _beamTimer, _scene);
  bm.emissiveColor = new B.Color3(cr * 0.6, cg * 0.6, cb * 0.6);
  bm.disableLighting = true;
  bm.alpha = 0.65;
  burn.material = bm;
  _groundBurns.push(burn);
  // Fade out over 4 seconds
  let life = 240;
  const fade = setInterval(() => {
    life--;
    if (bm.alpha !== undefined) bm.alpha = (life / 240) * 0.65;
    if (life <= 0) {
      clearInterval(fade);
      try { burn.dispose(); } catch {}
      const idx = _groundBurns.indexOf(burn);
      if (idx >= 0) _groundBurns.splice(idx, 1);
    }
  }, 16);
}

export function destroyPlasma() {
  _clearBeam();
  if (_beamLight)      { try { _beamLight.dispose();      } catch {} _beamLight      = null; }
  if (_beamParticlePS) { try { _beamParticlePS.dispose(); } catch {} _beamParticlePS = null; }
  _groundBurns.forEach(b => { try { b.dispose(); } catch {} });
  _groundBurns.length = 0;
  _destroyedBlocks.forEach(data => {
    data.fragments.forEach(f => { try { f.dispose(); } catch {} });
    data.mesh?.setEnabled(true);
  });
  _destroyedBlocks.clear();
}
