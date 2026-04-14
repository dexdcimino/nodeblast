// ══════════════════════════════════════
//  NodeBlast — NODE BLASTER
//  Fires sticky nodes that grow on surfaces + enemies,
//  then explode dealing AOE damage
// ══════════════════════════════════════

let _scene   = null;
let _camera  = null;

const _stickyNodes   = [];
const _activeBlobs   = [];  // goo blobs flying from node blaster explosion

const GROW_TIME        = 200;   // slightly longer grow for drama
const MAX_SCALE        = 22.0;  // 4-5x visually larger than before
const EXPLODE_RADIUS   = 8;     // larger blast radius
const EXPLODE_DAMAGE   = 55;    // harder hit
const STICK_SPEED      = 1.4;
const GOO_SPLASH_COUNT = 18;    // blob particles on explosion
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

        const exp     = new B.PointLight('nb_exp_' + Date.now(), pos, _scene);
        exp.diffuse   = new B.Color3(c.r, c.g, c.b);
        exp.intensity = 5.0;
        exp.range     = EXPLODE_RADIUS * 2;
        let ei        = 0;
        const fade    = setInterval(() => {
          ei++;
          if (exp.intensity !== undefined)
            exp.intensity = Math.max(0, 5.0 - ei * 0.35);
          if (ei >= 15) { clearInterval(fade); try { exp.dispose(); } catch {} }
        }, 16);

        // ── Big goo explosion particle burst ──
        const ps              = new B.ParticleSystem('nb_ps_' + Date.now(), 140, _scene);
        ps.emitter            = pos.clone();
        ps.direction1         = new B.Vector3(-3, 0.5, -3);
        ps.direction2         = new B.Vector3( 3,  5.0,  3);
        ps.minLifeTime        = 0.35; ps.maxLifeTime   = 1.2;
        ps.minSize            = 0.18; ps.maxSize       = 0.65;
        ps.minEmitPower       = 5;    ps.maxEmitPower  = 18;
        ps.updateSpeed        = 0.02; ps.emitRate      = 400;
        ps.color1             = new B.Color4(c.r, c.g, c.b, 1.0);
        ps.color2             = new B.Color4(Math.min(c.r + 0.3, 1), Math.min(c.g + 0.3, 1), Math.min(c.b + 0.3, 1), 0.85);
        ps.colorDead          = new B.Color4(c.r * 0.2, c.g * 0.2, c.b * 0.2, 0.0);
        ps.targetStopDuration = 0.12;
        ps.start();
        setTimeout(() => { try { ps.dispose(); } catch {} }, 2000);

        // ── Goo blob splats flying outward ──
        for (let g = 0; g < GOO_SPLASH_COUNT; g++) {
          const blob = B.MeshBuilder.CreateSphere('nb_blob_' + Date.now() + '_' + g,
            { diameter: 0.12 + Math.random() * 0.22, segments: 4 }, _scene);
          blob.position.copyFrom(pos);
          const bm = new B.StandardMaterial('nb_bm_' + Date.now(), _scene);
          const br = 0.7 + Math.random() * 0.3;
          bm.emissiveColor = new B.Color3(c.r * br, c.g * br, c.b * br);
          bm.disableLighting = true;
          blob.material = bm;
          const angle  = (g / GOO_SPLASH_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
          const speed  = 0.18 + Math.random() * 0.28;
          blob._bvel   = new B.Vector3(
            Math.cos(angle) * speed,
            0.15 + Math.random() * 0.35,
            Math.sin(angle) * speed,
          );
          blob._blife  = 60 + Math.floor(Math.random() * 60);
          blob._blanded = false;
          _activeBlobs.push(blob);
        }

        // ── Ground splash ring ──
        const ring = B.MeshBuilder.CreateCylinder('nb_ring_' + Date.now(),
          { diameter: EXPLODE_RADIUS * 0.8, height: 0.04, tessellation: 16 }, _scene);
        ring.position.set(pos.x, 0.03, pos.z);
        const rm = new B.StandardMaterial('nb_rm_' + Date.now(), _scene);
        rm.emissiveColor = new B.Color3(c.r * 0.7, c.g * 0.7, c.b * 0.7);
        rm.alpha = 0.7;
        rm.disableLighting = true;
        ring.material = rm;
        let ringLife = 120;
        const ringFade = setInterval(() => {
          ringLife--;
          if (rm.alpha !== undefined) rm.alpha = (ringLife / 120) * 0.7;
          if (ringLife <= 0) { clearInterval(ringFade); try { ring.dispose(); } catch {} }
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
