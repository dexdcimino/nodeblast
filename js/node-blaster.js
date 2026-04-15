// ══════════════════════════════════════
//  NodeBlast — NODE BLASTER
//  Fires sticky nodes that grow on surfaces + enemies,
//  then explode dealing AOE damage
// ══════════════════════════════════════

let _scene   = null;
let _camera  = null;

const _stickyNodes   = [];
const _activeBlobs   = [];  // goo blobs flying from node blaster explosion

const GROW_TIME        = 260;
const MAX_SCALE        = 40.0;
const EXPLODE_RADIUS   = 12;
const EXPLODE_DAMAGE   = 65;
const STICK_SPEED      = 1.4;
const GOO_SPLASH_COUNT = 32;
const SURFACE_OFFSET   = 0.18;  // push node to surface face on stick

// Called every frame from updateNodeBlaster to advance flying blobs
function _updateBlobs() {
  const dead = [];
  for (let i = 0; i < _activeBlobs.length; i++) {
    const b = _activeBlobs[i];
    b._blife--;
    if (!b._blanded) {
      b._bvel.y -= 0.012;
      b.position.addInPlace(b._bvel);
      b._bvel.scaleInPlace(0.94);
      if (b.position.y <= 0.06) {
        b.position.y = 0.06;
        b._blanded = true;
        b.scaling.set(2.0, 0.15, 2.0);
      }
    }
    if (b._blife < 40 && b.material) {
      b.material.alpha = b._blife / 40;
    }
    if (b._blife <= 0) {
      dead.push(i);
      try { b.dispose(); } catch {}
    }
  }
  for (let i = dead.length - 1; i >= 0; i--) _activeBlobs.splice(dead[i], 1);
}

export function initNodeBlaster(scene, camera) {
  _scene  = scene;
  _camera = camera;
}

export function fireNodeBlaster(muzzlePos, direction, color) {
  const B = BABYLON;

  const proj = B.MeshBuilder.CreateSphere('nb_proj_' + Date.now(),
    { diameter: 0.28, segments: 6 }, _scene);
  proj.position.copyFrom(muzzlePos);

  const mat           = new B.StandardMaterial('nb_pm_' + Date.now(), _scene);
  mat.emissiveColor   = new B.Color3(color.r, color.g, color.b);
  mat.disableLighting = true;
  proj.material       = mat;

  const light       = new B.PointLight('nb_pl_' + Date.now(),
    muzzlePos.clone(), _scene);
  light.diffuse     = new B.Color3(color.r, color.g, color.b);
  light.intensity   = 1.2;
  light.range       = 4;

  _stickyNodes.push({
    mesh:      proj,
    light,
    vel:       direction.scale(STICK_SPEED),
    color,
    stuck:     false,
    growTimer: 0,
    scale:     1.0,
    life:      300,
  });
}

export function updateNodeBlaster(colBlocks, onExplode) {
  if (!_scene) return;
  const B    = BABYLON;
  const dead = [];

  for (let i = 0; i < _stickyNodes.length; i++) {
    const n = _stickyNodes[i];

    if (!n.stuck) {
      n.life--;
      const prevPos = n.mesh.position.clone();
      n.mesh.position.addInPlace(n.vel);
      n.vel.y -= 0.005;
      n.light.position.copyFrom(n.mesh.position);

      const px = n.mesh.position.x;
      const py = n.mesh.position.y;
      const pz = n.mesh.position.z;

      let hit      = false;
      let hitNormal = new B.Vector3(0, 1, 0);
      let stuckEnemy = null;

      // ── Wall / floor collision with surface correction ──
      for (const b of colBlocks) {
        const M = 0.2;
        if (px > b.minX - M && px < b.maxX + M &&
            pz > b.minZ - M && pz < b.maxZ + M &&
            py < b.maxY + M  && py > -0.5) {

          // Find the face we hit by seeing which axis has the smallest penetration
          const dists = [
            { n: new B.Vector3(1, 0, 0),  d: Math.abs(px - b.maxX) },
            { n: new B.Vector3(-1, 0, 0), d: Math.abs(px - b.minX) },
            { n: new B.Vector3(0, 1, 0),  d: Math.abs(py - b.maxY) },
            { n: new B.Vector3(0, 0, 1),  d: Math.abs(pz - b.maxZ) },
            { n: new B.Vector3(0, 0, -1), d: Math.abs(pz - b.minZ) },
          ];
          hitNormal = dists.reduce((a, c) => c.d < a.d ? c : a).n;

          // Push projectile to surface face
          n.mesh.position.copyFrom(prevPos);
          n.mesh.position.addInPlace(hitNormal.scale(SURFACE_OFFSET));

          hit = true;
          break;
        }
      }

      // ── Floor collision ──
      if (!hit && py < 0.14) {
        n.mesh.position.y = 0.14;
        hitNormal = new B.Vector3(0, 1, 0);
        hit = true;
      }

      // ── Enemy collision ──
      if (!hit && window._nbEnemyPositions) {
        const enemies = window._nbEnemyPositions();
        for (const e of enemies) {
          const dx = px - e.pos.x;
          const dy = py - e.pos.y;
          const dz = pz - e.pos.z;
          if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 1.1) {
            // Stick ON the enemy surface (push out to radius)
            const toEnemy = new B.Vector3(dx, dy, dz).normalize();
            n.mesh.position.set(
              e.pos.x + toEnemy.x * 0.9,
              e.pos.y + toEnemy.y * 0.9 + 0.5, // float near top of enemy
              e.pos.z + toEnemy.z * 0.9,
            );
            hitNormal = toEnemy;
            stuckEnemy = e.index;
            if (window._nbApplyEnemyColor) window._nbApplyEnemyColor(e.index, n.color);
            hit = true;
            break;
          }
        }
      }

      if (hit) {
        n.stuck       = true;
        n.stuckEnemy  = stuckEnemy;   // track which enemy (null if wall/floor)
        n.stuckNormal = hitNormal;
        n.vel.scaleInPlace(0);
        n.light.intensity = 1.2;
        // Flatten on stick like a splat
        n.mesh.scaling.set(1.6, 0.35, 1.6);
        setTimeout(() => {
          if (n.mesh && !n.mesh.isDisposed()) n.mesh.scaling.setAll(1.0);
        }, 100);
      }

      if (n.life <= 0 && !n.stuck) {
        dead.push(i);
        try { n.mesh.dispose(); n.light.dispose(); } catch {}
        continue;
      }

    } else {
      n.growTimer++;
      n.scale = 1.0 + (n.growTimer / GROW_TIME) * (MAX_SCALE - 1.0);
      n.mesh.scaling.setAll(Math.min(n.scale, MAX_SCALE));

      // If stuck to an enemy, follow it (it's moving/falling)
      if (n.stuckEnemy !== null && n.stuckEnemy !== undefined && window._nbEnemyPositions) {
        const ep = window._nbEnemyPositions().find(e => e.index === n.stuckEnemy);
        if (ep) {
          n.mesh.position.set(ep.pos.x, ep.pos.y + 0.6, ep.pos.z);
          n.light.position.copyFrom(n.mesh.position);
        }
      }

      n.light.intensity = 0.8 + Math.sin(n.growTimer * 0.2) * 0.4;
      n.light.range     = 4 + n.scale * 0.8;

      if (n.growTimer >= GROW_TIME) {
        const pos = n.mesh.position.clone();
        const c   = n.color;

        // ══ MEGA EXPLOSION ══

        // Big bright flash
        const exp = new B.PointLight('nb_exp_' + Date.now(), pos, _scene);
        exp.diffuse   = new B.Color3(c.r, c.g, c.b);
        exp.intensity = 10.0;
        exp.range     = EXPLODE_RADIUS * 3;
        let ei = 0;
        const fade = setInterval(() => {
          ei++;
          if (exp.intensity !== undefined) exp.intensity = Math.max(0, 10.0 - ei * 0.5);
          if (ei >= 20) { clearInterval(fade); try { exp.dispose(); } catch {} }
        }, 16);

        // Multiple particle bursts at different speeds
        for (let burst = 0; burst < 3; burst++) {
          const ps = new B.ParticleSystem('nb_ps_' + Date.now() + '_' + burst, 200, _scene);
          ps.emitter     = pos.clone();
          const spread   = 4 + burst * 3;
          ps.direction1  = new B.Vector3(-spread, 0.5, -spread);
          ps.direction2  = new B.Vector3(spread, 6 + burst * 3, spread);
          ps.minLifeTime = 0.3 + burst * 0.2;
          ps.maxLifeTime = 1.2 + burst * 0.5;
          ps.minSize     = 0.15 + burst * 0.1;
          ps.maxSize     = 0.6 + burst * 0.3;
          ps.minEmitPower = 6 + burst * 5;
          ps.maxEmitPower = 20 + burst * 8;
          ps.updateSpeed  = 0.02;
          ps.emitRate     = 500;
          ps.color1       = new B.Color4(c.r, c.g, c.b, 1.0);
          ps.color2       = new B.Color4(
            Math.min(c.r + 0.4, 1), Math.min(c.g + 0.4, 1), Math.min(c.b + 0.4, 1), 0.8
          );
          ps.colorDead = new B.Color4(c.r * 0.1, c.g * 0.1, c.b * 0.1, 0.0);
          ps.targetStopDuration = 0.1 + burst * 0.05;
          ps.start();
          setTimeout(() => { try { ps.dispose(); } catch {} }, 2500);
        }

        // Expanding shockwave rings
        for (let r = 0; r < 4; r++) {
          const ring = B.MeshBuilder.CreateTorus('nb_ring_' + Date.now() + '_' + r, {
            diameter: 1.0, thickness: 0.12 - r * 0.02, tessellation: 24
          }, _scene);
          ring.position.set(pos.x, 0.1 + r * 0.5, pos.z);
          ring.rotation.x = Math.PI / 2;
          const rm = new B.StandardMaterial('nb_rm_' + Date.now() + '_' + r, _scene);
          rm.emissiveColor = new B.Color3(c.r, c.g, c.b);
          rm.disableLighting = true;
          rm.alpha = 0.85;
          ring.material = rm;
          let rl = 0;
          const ringSpeed = 0.5 + r * 0.15;
          const ringAnim = setInterval(() => {
            rl++;
            ring.scaling.setAll(1 + rl * ringSpeed);
            rm.alpha = Math.max(0, 0.85 - rl * 0.035);
            if (rl >= 28) { clearInterval(ringAnim); try { ring.dispose(); } catch {} }
          }, 16);
        }

        // Big flying debris chunks
        for (let g = 0; g < GOO_SPLASH_COUNT; g++) {
          const blobSize = 0.15 + Math.random() * 0.35;
          const blob = B.MeshBuilder.CreateSphere('nb_blob_' + Date.now() + '_' + g,
            { diameter: blobSize, segments: 4 }, _scene);
          blob.position.copyFrom(pos);
          const bm = new B.StandardMaterial('nb_bm_' + Date.now() + '_' + g, _scene);
          const br = 0.6 + Math.random() * 0.4;
          bm.emissiveColor = new B.Color3(c.r * br, c.g * br, c.b * br);
          bm.disableLighting = true;
          blob.material = bm;
          const angle  = (g / GOO_SPLASH_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
          const speed  = 0.25 + Math.random() * 0.45;
          blob._bvel   = new B.Vector3(
            Math.cos(angle) * speed, 0.2 + Math.random() * 0.5, Math.sin(angle) * speed,
          );
          blob._blife  = 80 + Math.floor(Math.random() * 80);
          blob._blanded = false;
          _activeBlobs.push(blob);
        }

        // Ground scorch
        const scorch = B.MeshBuilder.CreateCylinder('nb_scorch_' + Date.now(), {
          diameter: EXPLODE_RADIUS * 0.7, height: 0.03, tessellation: 16
        }, _scene);
        scorch.position.set(pos.x, 0.03, pos.z);
        const scm = new B.StandardMaterial('nb_scm_' + Date.now(), _scene);
        scm.emissiveColor = new B.Color3(c.r * 0.4, c.g * 0.4, c.b * 0.4);
        scm.disableLighting = true;
        scm.alpha = 0.65;
        scorch.material = scm;
        let scorchLife = 180;
        const scorchFade = setInterval(() => {
          scorchLife--;
          scm.alpha = (scorchLife / 180) * 0.65;
          if (scorchLife <= 0) { clearInterval(scorchFade); try { scorch.dispose(); } catch {} }
        }, 16);

        if (onExplode) onExplode(pos.x, pos.y, pos.z, EXPLODE_RADIUS,
          EXPLODE_DAMAGE, n.color);

        dead.push(i);
        try { n.mesh.dispose(); n.light.dispose(); } catch {}
      }
    }
  }

  _updateBlobs();

  for (let i = dead.length - 1; i >= 0; i--)
    _stickyNodes.splice(dead[i], 1);
}

export function destroyNodeBlaster() {
  _stickyNodes.forEach(n => {
    try { n.mesh.dispose(); n.light.dispose(); } catch {}
  });
  _stickyNodes.length = 0;
  _activeBlobs.forEach(b => { try { b.dispose(); } catch {} });
  _activeBlobs.length = 0;
}
