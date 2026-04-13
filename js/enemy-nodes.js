// ══════════════════════════════════════
//  NodeBlast — ENEMY NODES
//  Floating AI enemies with aggro, goo attack, health
// ══════════════════════════════════════

const ENEMY_COUNT    = 4;
const AGGRO_RANGE    = 18;
const SHOOT_RANGE    = 14;
const SHOOT_COOLDOWN = 120;
const MOVE_SPEED     = 0.04;
const FLOAT_HEIGHT   = 2.5;
const FLOAT_AMP      = 0.4;
const RESPAWN_TIME   = 720;

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

const _enemies    = [];
const _enemyProjectiles = [];

export function initEnemyNodes(scene, camera, onHitPlayer) {
  _scene       = scene;
  _camera      = camera;
  _onHitPlayer = onHitPlayer;

  // Expose positions for node blaster seeking
  window._nbEnemyPositions = () => _enemies
    .filter(e => e.state !== 'dead')
    .map(e => ({ index: e.index, pos: e.root.position.clone() }));

  for (let i = 0; i < ENEMY_COUNT; i++) {
    _spawnEnemy(i);
  }
}

function _spawnEnemyBodyProc(i, root) {
  const B = BABYLON;
  const body = B.MeshBuilder.CreateSphere('enemy_body_' + i,
    { diameter: 0.7, segments: 8 }, _scene);
  body.parent = root;
  const mat   = new B.StandardMaterial('enemy_mat_' + i, _scene);
  mat.diffuseColor  = new B.Color3(0.6, 0.0, 0.0);
  mat.emissiveColor = new B.Color3(0.8, 0.0, 0.0);
  body.material     = mat;
  const ring = B.MeshBuilder.CreateTorus('enemy_ring_' + i,
    { diameter: 1.1, thickness: 0.06, tessellation: 20 }, _scene);
  ring.parent     = root;
  ring.rotation.x = Math.PI / 3;
  const rm        = new B.StandardMaterial('enemy_ring_mat_' + i, _scene);
  rm.emissiveColor   = new B.Color3(1.0, 0.1, 0.1);
  rm.disableLighting = true;
  ring.material      = rm;
  return { body, ring };
}

function _tryLoadEnemyGLB(path, scene, onSuccess, onFallback) {
  BABYLON.SceneLoader.ImportMeshAsync('', '', path, scene)
    .then(result => {
      if (!result.meshes || result.meshes.length === 0) { onFallback(); }
      else { onSuccess(result.meshes); }
    })
    .catch(() => { onFallback(); });
}

function _spawnEnemy(i) {
  const B    = BABYLON;
  const sp   = SPAWN_POS[i];
  const name = NODE_NAMES[i];

  const root = new B.TransformNode('enemy_root_' + i, _scene);
  root.position.set(sp.x, FLOAT_HEIGHT, sp.z);

  let body = null, ring = null;
  _tryLoadEnemyGLB('./games/Arena_1/models/nodeblast_enemy1_node.glb', _scene,
    (meshes) => {
      meshes.forEach(m => { if (m.name === '__root__') return; m.parent = root; });
    },
    () => { const proc = _spawnEnemyBodyProc(i, root); body = proc.body; ring = proc.ring; }
  );

  const light       = new B.PointLight('enemy_light_' + i,
    new B.Vector3(0, 0, 0), _scene);
  light.parent      = root;
  light.diffuse     = new B.Color3(1.0, 0.1, 0.0);
  light.intensity   = 0.7;
  light.range       = 8;

  const label = B.MeshBuilder.CreatePlane('enemy_label_' + i,
    { width: 2.0, height: 0.45 }, _scene);
  label.parent        = root;
  label.position.y    = 0.9;
  label.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
  const lt            = new B.DynamicTexture('enemy_lt_' + i,
    { width: 256, height: 58 }, _scene);
  lt.drawText(name, null, 40, 'bold 24px Outfit,Arial', '#ff4444', 'transparent', true);
  const lm = new B.StandardMaterial('enemy_lm_' + i, _scene);
  lm.diffuseTexture  = lt;
  lm.emissiveTexture = lt;
  lm.opacityTexture  = lt;
  lm.backFaceCulling = false;
  lm.disableLighting = true;
  label.material     = lm;

  const hbWrap = new B.TransformNode('enemy_hb_wrap_' + i, _scene);
  hbWrap.parent     = root;
  hbWrap.position.y = 1.05;

  const hbBg = B.MeshBuilder.CreatePlane('enemy_hb_bg_' + i,
    { width: 1.1, height: 0.12 }, _scene);
  hbBg.parent        = hbWrap;
  hbBg.position.z    = 0.001;
  hbBg.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
  const hbBgM        = new B.StandardMaterial('ehbgm_' + i, _scene);
  hbBgM.diffuseColor    = new B.Color3(0.08, 0.0, 0.0);
  hbBgM.emissiveColor   = new B.Color3(0.05, 0.0, 0.0);
  hbBgM.disableLighting = true;
  hbBg.material         = hbBgM;

  const hbFill = B.MeshBuilder.CreatePlane('enemy_hb_fill_' + i,
    { width: 1.0, height: 0.10 }, _scene);
  hbFill.parent        = hbWrap;
  hbFill.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
  const hbFillM        = new B.StandardMaterial('ehbfm_' + i, _scene);
  hbFillM.emissiveColor   = new B.Color3(0.1, 0.9, 0.1);
  hbFillM.disableLighting = true;
  hbFill.material         = hbFillM;

  const enemy = {
    root, body, ring, light, label, hbBg, hbFill, hbWrap, lt,
    index:        i,
    name,
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
  };

  _enemies.push(enemy);
}

export function updateEnemyNodes() {
  if (!_scene || !_camera) return;
  const B    = BABYLON;
  const pPos = _camera.position;
  const now  = Date.now();

  _enemies.forEach(e => {
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

    e.root.position.y = FLOAT_HEIGHT + Math.sin(now * 0.001 + e.floatOffset) * FLOAT_AMP;
    e.ring.rotation.y += 0.03;

    if (dist < AGGRO_RANGE) {
      e.state = 'aggro';

      const invDist = 1 / Math.max(dist, 0.1);
      e.root.position.x += dx * invDist * MOVE_SPEED;
      e.root.position.z += dz * invDist * MOVE_SPEED;

      e.root.rotation.y = Math.atan2(dx, dz);

      if (dist < SHOOT_RANGE) {
        e.shootTimer++;
        if (e.shootTimer >= SHOOT_COOLDOWN) {
          e.shootTimer = 0;
          _enemyShoot(e);
        }
      }

      e.light.intensity = 1.2;
      if (e.body.material) e.body.material.emissiveColor = new B.Color3(1.0, 0.0, 0.0);

    } else {
      e.state = 'patrol';
      e.patrolAngle += e.patrolSpeed;
      e.root.position.x = e.spawnPos.x + Math.cos(e.patrolAngle) * e.patrolRadius;
      e.root.position.z = e.spawnPos.z + Math.sin(e.patrolAngle) * e.patrolRadius;
      e.light.intensity = 0.7;
      if (e.body.material) e.body.material.emissiveColor = new B.Color3(0.8, 0.0, 0.0);
    }
  });

  _updateEnemyProjectiles();
}

function _enemyShoot(enemy) {
  const B    = BABYLON;
  const pPos = _camera.position;

  const dir = pPos.subtract(enemy.root.position).normalize();
  dir.x += (Math.random() - 0.5) * 0.15;
  dir.y += (Math.random() - 0.5) * 0.1;
  dir.z += (Math.random() - 0.5) * 0.15;
  dir.normalize();

  const proj = B.MeshBuilder.CreateSphere('eproj_' + Date.now(),
    { diameter: 0.18, segments: 4 }, _scene);
  proj.position.copyFrom(enemy.root.position);

  const mat           = new B.StandardMaterial('epm_' + Date.now(), _scene);
  mat.emissiveColor   = new B.Color3(1.0, 0.1, 0.0);
  mat.disableLighting = true;
  proj.material       = mat;

  _enemyProjectiles.push({ mesh: proj, vel: dir.scale(0.8), life: 120 });
}

function _updateEnemyProjectiles() {
  const B    = BABYLON;
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

    if (p.life <= 0 || p.mesh.position.y < 0) {
      try { p.mesh.dispose(); } catch {}
      dead.push(i);
    }
  }

  for (let i = dead.length - 1; i >= 0; i--) _enemyProjectiles.splice(dead[i], 1);
}

export function damageEnemyNode(enemyIndex, damage) {
  const B = BABYLON;
  const e = _enemies.find(en => en.index === enemyIndex);
  if (!e || e.state === 'dead') return;

  e.hp -= damage;
  _updateHealthBar(e);

  if (e.hp <= 0) {
    _killEnemy(e);
  } else {
    if (e.body.material) {
      e.body.material.emissiveColor = new B.Color3(1.0, 1.0, 1.0);
      setTimeout(() => {
        if (e.body.material) e.body.material.emissiveColor = new B.Color3(1.0, 0.0, 0.0);
      }, 80);
    }
  }
}

export function checkEnemyHit(pos) {
  for (const e of _enemies) {
    if (e.state === 'dead') continue;
    const dx = pos.x - e.root.position.x;
    const dy = pos.y - e.root.position.y;
    const dz = pos.z - e.root.position.z;
    if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 0.8) {
      return e.index;
    }
  }
  return -1;
}

function _killEnemy(e) {
  const B = BABYLON;
  e.state  = 'dead';
  e.hp     = 0;
  e.root.setEnabled(false);
  if (window._nbPlayEnemyDeath) window._nbPlayEnemyDeath();
  e.respawnTimer = 0;

  const exp       = new B.PointLight('exp_' + Date.now(),
    e.root.position.clone(), _scene);
  exp.diffuse     = new B.Color3(1.0, 0.2, 0.0);
  exp.intensity   = 4.0;
  exp.range       = 12;
  let ei          = 0;
  const fade      = setInterval(() => {
    ei++;
    if (exp.intensity !== undefined) exp.intensity = Math.max(0, 4.0 - ei * 0.3);
    if (ei >= 14) { clearInterval(fade); try { exp.dispose(); } catch {} }
  }, 16);

  const ps              = new B.ParticleSystem('death_ps_' + Date.now(), 60, _scene);
  ps.emitter            = e.root.position.clone();
  ps.direction1         = new B.Vector3(-1, -1, -1);
  ps.direction2         = new B.Vector3( 1,  1,  1);
  ps.minLifeTime        = 0.2;
  ps.maxLifeTime        = 0.6;
  ps.minSize            = 0.08;
  ps.maxSize            = 0.25;
  ps.minEmitPower       = 4;
  ps.maxEmitPower       = 10;
  ps.updateSpeed        = 0.02;
  ps.emitRate           = 200;
  ps.color1             = new BABYLON.Color4(1.0, 0.2, 0.0, 1.0);
  ps.color2             = new BABYLON.Color4(1.0, 0.8, 0.0, 0.5);
  ps.colorDead          = new BABYLON.Color4(0.3, 0.0, 0.0, 0.0);
  ps.targetStopDuration = 0.15;
  ps.start();
  setTimeout(() => { try { ps.dispose(); } catch {} }, 1500);
}

function _updateHealthBar(e) {
  if (!e.hbFill || !e.hbBg) return;
  const pct = Math.max(0, Math.min(1, e.hp / e.maxHp));
  e.hbFill.scaling.x  = pct;
  e.hbFill.position.x = -(1 - pct) * 0.5;
  if (e.hbFill.material) {
    if (pct > 0.6) e.hbFill.material.emissiveColor = new BABYLON.Color3(0.1, 0.9, 0.1);
    else if (pct > 0.3) e.hbFill.material.emissiveColor = new BABYLON.Color3(0.9, 0.7, 0.0);
    else e.hbFill.material.emissiveColor = new BABYLON.Color3(0.9, 0.05, 0.05);
  }
}

export function destroyEnemyNodes() {
  _enemies.forEach(e => {
    ['label', 'hbBg', 'hbFill', 'hbWrap', 'ring', 'body', 'root', 'light'].forEach(k => {
      try { e[k]?.dispose(); } catch {}
    });
    try { e.lt.dispose(); } catch {}
  });
  _enemies.length = 0;
  _enemyProjectiles.forEach(p => { try { p.mesh.dispose(); } catch {} });
  _enemyProjectiles.length = 0;
}
