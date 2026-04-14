// ══════════════════════════════════════
//  NodeBlast — ENEMY NODES
//  Defensive version — null-safe throughout
// ══════════════════════════════════════

const ENEMY_COUNT    = 4;
const AGGRO_RANGE    = 18;
const SHOOT_RANGE    = 14;
const SHOOT_COOLDOWN = 160;   // slightly slower fire rate
const MOVE_SPEED     = 0.028; // slower raw speed; delta-scaled below
const FLOAT_HEIGHT   = 2.5;
const FLOAT_AMP      = 0.4;
const RESPAWN_TIME   = 720;
const PATROL_SPEED_BASE = 0.005; // replaces per-enemy random in spawn
const ENEMY_RADIUS   = 0.6;  // collision radius for wall pushout
const PROJ_RADIUS    = 0.12; // projectile collision radius vs walls

const NODE_NAMES = ['NODE-AC7', 'NODE-B3X', 'NODE-D9K', 'NODE-F2R'];
const SPAWN_POS  = [
  { x:  20, z:  20 },
  { x: -20, z:  20 },
  { x:  20, z: -20 },
  { x: -20, z: -20 },
];

let _scene        = null;
let _camera       = null;
let _onHitPlayer  = null;
let _colBlocks    = null;  // set by initEnemyNodes

const _enemies           = [];
const _enemyProjectiles  = [];

export function initEnemyNodes(scene, camera, onHitPlayer, colBlocks) {
  _enemies.length          = 0;
  _enemyProjectiles.length = 0;

  _scene       = scene;
  _camera      = camera;
  _onHitPlayer = onHitPlayer;
  _colBlocks   = colBlocks || [];

  window._nbEnemyPositions = () => _enemies
    .filter(e => e && e.state !== 'dead' && e.root)
    .map(e => ({ index: e.index, pos: e.root.position.clone() }));

  for (let i = 0; i < ENEMY_COUNT; i++) {
    try { _spawnEnemy(i); } catch (err) {
      console.warn('[enemies] spawn failed for enemy', i, err.message);
    }
  }
}

function _spawnEnemy(i) {
  if (typeof BABYLON === 'undefined') {
    console.warn('[enemies] BABYLON not ready, skipping enemy', i);
    return;
  }
  const B  = BABYLON;
  const sp = SPAWN_POS[i];

  const root = new B.TransformNode('enemy_root_' + i, _scene);
  root.position.set(sp.x, FLOAT_HEIGHT, sp.z);

  const body = B.MeshBuilder.CreateSphere('enemy_body_' + i,
    { diameter: 0.7, segments: 8 }, _scene);
  body.parent   = root;
  const bMat    = new B.StandardMaterial('enemy_mat_' + i, _scene);
  bMat.diffuseColor  = new B.Color3(0.6, 0.0, 0.0);
  bMat.emissiveColor = new B.Color3(0.8, 0.0, 0.0);
  body.material = bMat;

  const ring = B.MeshBuilder.CreateTorus('enemy_ring_' + i,
    { diameter: 1.1, thickness: 0.06, tessellation: 20 }, _scene);
  ring.parent     = root;
  ring.rotation.x = Math.PI / 3;
  const rMat      = new B.StandardMaterial('enemy_ring_mat_' + i, _scene);
  rMat.emissiveColor   = new B.Color3(1.0, 0.1, 0.1);
  rMat.disableLighting = true;
  ring.material        = rMat;

  const light      = new B.PointLight('enemy_light_' + i,
    new B.Vector3(0, 0, 0), _scene);
  light.parent     = root;
  light.diffuse    = new B.Color3(1.0, 0.1, 0.0);
  light.intensity  = 0.7;
  light.range      = 8;

  const label = B.MeshBuilder.CreatePlane('enemy_label_' + i,
    { width: 2.0, height: 0.45 }, _scene);
  label.parent        = root;
  label.position.y    = 0.9;
  label.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
  const lt            = new B.DynamicTexture('enemy_lt_' + i,
    { width: 256, height: 58 }, _scene);
  lt.drawText(NODE_NAMES[i], null, 40,
    'bold 24px Outfit,Arial', '#ff4444', 'transparent', true);
  const lMat = new B.StandardMaterial('enemy_lm_' + i, _scene);
  lMat.diffuseTexture  = lt;
  lMat.emissiveTexture = lt;
  lMat.opacityTexture  = lt;
  lMat.backFaceCulling = false;
  lMat.disableLighting = true;
  label.material       = lMat;

  const hbBg = B.MeshBuilder.CreatePlane('enemy_hb_bg_' + i,
    { width: 1.0, height: 0.1 }, _scene);
  hbBg.parent        = root;
  hbBg.position.y    = 0.65;
  hbBg.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
  const hbBgM        = new B.StandardMaterial('ehbgm_' + i, _scene);
  hbBgM.diffuseColor    = new B.Color3(0.1, 0.0, 0.0);
  hbBgM.disableLighting = true;
  hbBg.material         = hbBgM;

  const hbFill = B.MeshBuilder.CreatePlane('enemy_hb_fill_' + i,
    { width: 1.0, height: 0.08 }, _scene);
  hbFill.parent        = root;
  hbFill.position.y    = 0.65;
  hbFill.position.z    = -0.001;
  hbFill.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
  const hbFillM        = new B.StandardMaterial('ehbfm_' + i, _scene);
  hbFillM.emissiveColor   = new B.Color3(0.9, 0.0, 0.0);
  hbFillM.disableLighting = true;
  hbFill.material         = hbFillM;

  _enemies.push({
    root, body, ring, light, label, hbBg, hbFill, lt,
    index:        i,
    name:         NODE_NAMES[i],
    hp:           100,
    maxHp:        100,
    state:        'patrol',
    shootTimer:   Math.floor(Math.random() * SHOOT_COOLDOWN),
    patrolAngle:  Math.random() * Math.PI * 2,
    patrolRadius: 6 + Math.random() * 4,
    patrolSpeed:  0.008 + Math.random() * 0.005,
    spawnPos:     { x: sp.x, z: sp.z },
    respawnTimer: 0,
    floatOffset:  Math.random() * Math.PI * 2,
  });
}

// Push an XZ position out of any intersecting colBlock.
// Returns corrected {x, z} — identical logic to player's _resolveCollision.
function _resolveEnemyCollision(nx, nz, floatY) {
  const R = ENEMY_RADIUS;
  let rx = nx, rz = nz;
  for (const b of _colBlocks) {
    // Skip blocks taller than enemy float height (enemy is above them)
    if (floatY - 0.5 >= b.maxY) continue;
    if (!(rx > b.minX - R && rx < b.maxX + R && rz > b.minZ - R && rz < b.maxZ + R)) continue;
    const pushes = [
      { a: 'x', v: b.minX - R - rx },
      { a: 'x', v: b.maxX + R - rx },
      { a: 'z', v: b.minZ - R - rz },
      { a: 'z', v: b.maxZ + R - rz },
    ];
    const best = pushes.reduce((a, c) => Math.abs(c.v) < Math.abs(a.v) ? c : a);
    if (best.a === 'x') rx += best.v; else rz += best.v;
  }
  return { x: rx, z: rz };
}

// Check if a straight line from `from` to `to` is blocked by a colBlock.
// Returns true if LOS is clear, false if blocked.
function _hasLineOfSight(from, to) {
  if (!_colBlocks || _colBlocks.length === 0) return true;
  const dir = to.subtract(from);
  const len = dir.length();
  if (len < 0.01) return true;
  const step = dir.normalize();
  const steps = Math.ceil(len / 0.5);
  for (let s = 1; s < steps; s++) {
    const p = from.add(step.scale(s * 0.5));
    for (const b of _colBlocks) {
      if (p.x > b.minX && p.x < b.maxX &&
          p.z > b.minZ && p.z < b.maxZ &&
          p.y < b.maxY && p.y > 0) {
        return false;
      }
    }
  }
  return true;
}

export function updateEnemyNodes() {
  if (!_scene || !_camera) return;
  const B    = BABYLON;
  const pPos = _camera.position;
  const now  = Date.now();

  _enemies.forEach(e => {
    if (!e || !e.root || !e.body) return;

    if (e.state === 'dead') {
      e.respawnTimer++;
      if (e.respawnTimer >= RESPAWN_TIME) {
        e.hp           = e.maxHp;
        e.state        = 'patrol';
        e.respawnTimer = 0;
        e.root.setEnabled(true);
        e.root.position.set(e.spawnPos.x, FLOAT_HEIGHT, e.spawnPos.z);
        _updateHealthBar(e);
      }
      return;
    }

    const dx   = pPos.x - e.root.position.x;
    const dz   = pPos.z - e.root.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);

    e.root.position.y = FLOAT_HEIGHT +
      Math.sin(now * 0.001 + e.floatOffset) * FLOAT_AMP;

    if (e.ring) e.ring.rotation.y += 0.03;

    // Delta time for consistent speed regardless of framerate
    const delta = window._nbDelta || 1.0;

    if (dist < AGGRO_RANGE) {
      e.state = 'aggro';
      const invDist = 1 / Math.max(dist, 0.1);
      const moveSpeedActual = (e._slowed ? MOVE_SPEED * 0.5 : MOVE_SPEED) * delta;
      const nx = e.root.position.x + dx * invDist * moveSpeedActual;
      const nz = e.root.position.z + dz * invDist * moveSpeedActual;

      // Wall collision — push enemy out of any blocking geometry
      const resolved = _resolveEnemyCollision(nx, nz, e.root.position.y);
      e.root.position.x = resolved.x;
      e.root.position.z = resolved.z;
      e.root.rotation.y = Math.atan2(dx, dz);

      if (dist < SHOOT_RANGE) {
        e.shootTimer++;
        // Only shoot if there's a clear line of sight to the player
        if (e.shootTimer >= SHOOT_COOLDOWN) {
          const hasLOS = _hasLineOfSight(e.root.position, pPos);
          if (hasLOS) {
            e.shootTimer = 0;
            _enemyShoot(e);
          } else {
            // Back off timer slightly so it re-checks often but doesn't spam
            e.shootTimer = Math.max(0, e.shootTimer - 10);
          }
        }
      }

      if (e.light) e.light.intensity = 1.2;
      if (e.body.material)
        e.body.material.emissiveColor = new B.Color3(1.0, 0.0, 0.0);

    } else {
      e.state = 'patrol';
      e.patrolAngle += e.patrolSpeed * delta;
      const px = e.spawnPos.x + Math.cos(e.patrolAngle) * e.patrolRadius;
      const pz = e.spawnPos.z + Math.sin(e.patrolAngle) * e.patrolRadius;
      // Wall collision on patrol too
      const resolved = _resolveEnemyCollision(px, pz, e.root.position.y);
      e.root.position.x = resolved.x;
      e.root.position.z = resolved.z;
      if (e.light) e.light.intensity = 0.7;
      if (e.body.material)
        e.body.material.emissiveColor = new B.Color3(0.8, 0.0, 0.0);
    }
  });

  _updateEnemyProjectiles();
}

function _enemyShoot(enemy) {
  if (!_camera) return;
  const B   = BABYLON;
  const dir = _camera.position.subtract(enemy.root.position).normalize();
  // Scatter increases with distance — close enemies are more accurate
  const dist2 = enemy.root.position.subtract(_camera.position).length();
  const scatter = 0.18 + (dist2 / SHOOT_RANGE) * 0.22; // 0.18 close → 0.40 at max range
  dir.x += (Math.random() - 0.5) * scatter;
  dir.y += (Math.random() - 0.5) * (scatter * 0.6);
  dir.z += (Math.random() - 0.5) * scatter;
  dir.normalize();

  const proj = B.MeshBuilder.CreateSphere('eproj_' + Date.now(),
    { diameter: 0.18, segments: 4 }, _scene);
  proj.position.copyFrom(enemy.root.position);
  const mat         = new B.StandardMaterial('epm_' + Date.now(), _scene);
  mat.emissiveColor = new B.Color3(1.0, 0.1, 0.0);
  mat.disableLighting = true;
  proj.material     = mat;

  _enemyProjectiles.push({ mesh: proj, vel: dir.scale(0.8), life: 120 });
}

function _updateEnemyProjectiles() {
  if (!_camera) return;
  const pPos = _camera.position;
  const dead = [];

  for (let i = 0; i < _enemyProjectiles.length; i++) {
    const p = _enemyProjectiles[i];
    p.life--;
    p.mesh.position.addInPlace(p.vel);
    p.vel.y -= 0.004;

    const dx = p.mesh.position.x - pPos.x;
    const dy = p.mesh.position.y - pPos.y;
    const dz = p.mesh.position.z - pPos.z;
    if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 1.5) {
      if (_onHitPlayer) _onHitPlayer(15);
      try { p.mesh.dispose(); } catch {}
      dead.push(i);
      continue;
    }

    // Wall collision for enemy projectiles
    let wallHit = false;
    if (_colBlocks) {
      const ppx = p.mesh.position.x;
      const ppy = p.mesh.position.y;
      const ppz = p.mesh.position.z;
      for (const b of _colBlocks) {
        if (ppx > b.minX - PROJ_RADIUS && ppx < b.maxX + PROJ_RADIUS &&
            ppz > b.minZ - PROJ_RADIUS && ppz < b.maxZ + PROJ_RADIUS &&
            ppy < b.maxY + PROJ_RADIUS && ppy > -0.5) {
          wallHit = true;
          break;
        }
      }
    }

    if (wallHit || p.life <= 0 || p.mesh.position.y < 0) {
      try { p.mesh.dispose(); } catch {}
      dead.push(i);
    }
  }
  for (let i = dead.length - 1; i >= 0; i--)
    _enemyProjectiles.splice(dead[i], 1);
}

export function damageEnemyNode(enemyIndex, damage) {
  const e = _enemies.find(en => en && en.index === enemyIndex);
  if (!e || e.state === 'dead') return;
  e.hp -= damage;
  _updateHealthBar(e);
  if (e.hp <= 0) {
    _killEnemy(e);
  } else if (e.body?.material) {
    e.body.material.emissiveColor = new BABYLON.Color3(1.0, 1.0, 1.0);
    setTimeout(() => {
      if (e.body?.material)
        e.body.material.emissiveColor = new BABYLON.Color3(1.0, 0.0, 0.0);
    }, 80);
  }
}

// Called by node blaster when an enemy gets hit — recolors + slows
window._nbApplyEnemyColor = (index, color) => {
  const e = _enemies.find(en => en && en.index === index);
  if (!e || e.state === 'dead') return;
  if (e.body?.material) {
    e.body.material.diffuseColor  = new BABYLON.Color3(color.r * 0.5, color.g * 0.5, color.b * 0.5);
    e.body.material.emissiveColor = new BABYLON.Color3(color.r, color.g, color.b);
  }
  if (e.ring?.material) {
    e.ring.material.emissiveColor = new BABYLON.Color3(color.r, color.g, color.b);
  }
  const origSpeed = e.patrolSpeed;
  e.patrolSpeed  *= 0.5;
  e._slowed = true;
  setTimeout(() => {
    if (e) {
      e.patrolSpeed = origSpeed;
      e._slowed     = false;
      if (e.body?.material) {
        e.body.material.diffuseColor  = new BABYLON.Color3(0.6, 0.0, 0.0);
        e.body.material.emissiveColor = new BABYLON.Color3(0.8, 0.0, 0.0);
      }
      if (e.ring?.material)
        e.ring.material.emissiveColor = new BABYLON.Color3(1.0, 0.1, 0.1);
    }
  }, 5000);
};

export function checkEnemyHit(pos) {
  for (const e of _enemies) {
    if (!e || !e.root || e.state === 'dead') continue;
    const dx = pos.x - e.root.position.x;
    const dy = pos.y - e.root.position.y;
    const dz = pos.z - e.root.position.z;
    if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 0.8) return e.index;
  }
  return -1;
}

function _killEnemy(e) {
  const B    = BABYLON;
  e.state    = 'dead';
  e.hp       = 0;
  if (e.root) e.root.setEnabled(false);
  if (window._nbPlayEnemyDeath) window._nbPlayEnemyDeath();
  e.respawnTimer = 0;

  const pos = e.root ? e.root.position.clone() : new B.Vector3(0, 2, 0);

  const exp     = new B.PointLight('exp_' + Date.now(), pos, _scene);
  exp.diffuse   = new B.Color3(1.0, 0.2, 0.0);
  exp.intensity = 4.0;
  exp.range     = 12;
  let ei        = 0;
  const fade    = setInterval(() => {
    ei++;
    if (exp.intensity !== undefined)
      exp.intensity = Math.max(0, 4.0 - ei * 0.3);
    if (ei >= 14) { clearInterval(fade); try { exp.dispose(); } catch {} }
  }, 16);

  const ps              = new B.ParticleSystem('death_ps_' + Date.now(), 60, _scene);
  ps.emitter            = pos.clone();
  ps.direction1         = new B.Vector3(-1, -1, -1);
  ps.direction2         = new B.Vector3( 1,  1,  1);
  ps.minLifeTime        = 0.2; ps.maxLifeTime   = 0.6;
  ps.minSize            = 0.08; ps.maxSize       = 0.25;
  ps.minEmitPower       = 4;   ps.maxEmitPower  = 10;
  ps.updateSpeed        = 0.02; ps.emitRate      = 200;
  ps.color1             = new BABYLON.Color4(1.0, 0.2, 0.0, 1.0);
  ps.color2             = new BABYLON.Color4(1.0, 0.8, 0.0, 0.5);
  ps.colorDead          = new BABYLON.Color4(0.3, 0.0, 0.0, 0.0);
  ps.targetStopDuration = 0.15;
  ps.start();
  setTimeout(() => { try { ps.dispose(); } catch {} }, 1500);
}

function _updateHealthBar(e) {
  if (!e.hbFill) return;
  const pct = Math.max(0, Math.min(1, e.hp / e.maxHp));
  e.hbFill.scaling.x  = pct;
  e.hbFill.position.x = -(1 - pct) * 0.5;
  if (e.hbFill.material) {
    const B = BABYLON;
    if (pct > 0.6)
      e.hbFill.material.emissiveColor = new B.Color3(0.1, 0.9, 0.1);
    else if (pct > 0.3)
      e.hbFill.material.emissiveColor = new B.Color3(0.9, 0.7, 0.0);
    else
      e.hbFill.material.emissiveColor = new B.Color3(0.9, 0.05, 0.05);
  }
}

export function destroyEnemyNodes() {
  _enemies.forEach(e => {
    if (!e) return;
    ['label', 'hbBg', 'hbFill', 'ring', 'body', 'root', 'light'].forEach(k => {
      try { if (e[k]) e[k].dispose(); } catch {}
    });
    try { if (e.lt) e.lt.dispose(); } catch {}
  });
  _enemies.length          = 0;
  _enemyProjectiles.forEach(p => { try { if (p.mesh) p.mesh.dispose(); } catch {} });
  _enemyProjectiles.length = 0;
  _scene       = null;
  _camera      = null;
  _onHitPlayer = null;
  window._nbEnemyPositions = null;
}
