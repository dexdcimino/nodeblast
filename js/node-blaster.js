// ══════════════════════════════════════
//  NodeBlast — NODE BLASTER
//  Shoots friendly mini-nodes that seek enemies and combine
// ══════════════════════════════════════

let _scene   = null;
let _camera  = null;
const _friendlyNodes = [];

const SEEK_SPEED    = 0.06;
const COMBINE_RANGE = 1.2;
const DAMAGE        = 8;
const MAX_SIZE      = 3.0;

export function initNodeBlaster(scene, camera) {
  _scene  = scene;
  _camera = camera;
}

export function fireNodeBlaster(muzzlePos, direction, color) {
  const B = BABYLON;

  const node = B.MeshBuilder.CreateSphere('fn_' + Date.now(),
    { diameter: 0.25, segments: 6 }, _scene);
  node.position.copyFrom(muzzlePos);

  const mat           = new B.StandardMaterial('fnm_' + Date.now(), _scene);
  mat.emissiveColor   = new B.Color3(color.r, color.g, color.b);
  mat.disableLighting = true;
  node.material       = mat;

  const light       = new B.PointLight('fnl_' + Date.now(), node.position.clone(), _scene);
  light.diffuse     = new B.Color3(color.r, color.g, color.b);
  light.intensity   = 0.5;
  light.range       = 3;

  _friendlyNodes.push({
    mesh:    node,
    light,
    vel:     direction.scale(1.2),
    hp:      1,
    size:    1,
    life:    300,
    color,
    seeking: false,
  });
}

export function updateNodeBlaster(enemyGetPositions, damageEnemy) {
  if (!_scene) return;
  const B    = BABYLON;
  const dead = [];

  for (let i = 0; i < _friendlyNodes.length; i++) {
    const n = _friendlyNodes[i];
    n.life--;

    n.vel.scaleInPlace(0.92);
    const speed = n.vel.length();

    if (speed < 0.3) n.seeking = true;

    if (n.seeking) {
      const enemies = enemyGetPositions();
      let nearest = null, nearDist = Infinity;
      for (const e of enemies) {
        const dx = e.pos.x - n.mesh.position.x;
        const dy = e.pos.y - n.mesh.position.y;
        const dz = e.pos.z - n.mesh.position.z;
        const d  = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (d < nearDist) { nearDist = d; nearest = e; }
      }
      if (nearest) {
        const dir = nearest.pos.subtract(n.mesh.position).normalize();
        n.vel = n.vel.add(dir.scale(0.008));
        if (n.vel.length() > SEEK_SPEED * n.size) {
          n.vel = n.vel.normalize().scale(SEEK_SPEED * n.size);
        }
        if (nearDist < 0.6 * n.size + 0.4) {
          damageEnemy(nearest.index, DAMAGE);
        }
      }
    }

    n.mesh.position.addInPlace(n.vel);
    n.light.position.copyFrom(n.mesh.position);
    n.mesh.rotation.y += 0.05;

    if (n.life <= 0) {
      try { n.mesh.dispose(); n.light.dispose(); } catch {}
      dead.push(i);
    }
  }

  for (let i = dead.length - 1; i >= 0; i--) _friendlyNodes.splice(dead[i], 1);

  _combineNodes();
}

function _combineNodes() {
  const B = BABYLON;
  for (let i = 0; i < _friendlyNodes.length; i++) {
    for (let j = i + 1; j < _friendlyNodes.length; j++) {
      const a = _friendlyNodes[i];
      const b = _friendlyNodes[j];
      if (a._merging || b._merging) continue;

      const dx = a.mesh.position.x - b.mesh.position.x;
      const dy = a.mesh.position.y - b.mesh.position.y;
      const dz = a.mesh.position.z - b.mesh.position.z;
      const d  = Math.sqrt(dx*dx + dy*dy + dz*dz);

      if (d < COMBINE_RANGE) {
        a.hp   += b.hp;
        a.size  = Math.min(MAX_SIZE, Math.cbrt(a.hp) * 0.8 + 0.4);
        a.mesh.scaling.setAll(a.size);
        a.light.range     = 3 * a.size;
        a.light.intensity = 0.5 * a.size;
        a.life = Math.min(300, a.life + 60);

        if (a.mesh.material) {
          const c = a.color;
          a.mesh.material.emissiveColor = new B.Color3(
            Math.min(1, c.r * 2),
            Math.min(1, c.g * 2),
            Math.min(1, c.b * 2),
          );
          setTimeout(() => {
            if (a.mesh.material) a.mesh.material.emissiveColor = new B.Color3(c.r, c.g, c.b);
          }, 100);
        }

        b._merging = true;
        try { b.mesh.dispose(); b.light.dispose(); } catch {}
        _friendlyNodes.splice(j, 1);
        j--;
      }
    }
  }
}

export function destroyNodeBlaster() {
  _friendlyNodes.forEach(n => {
    try { n.mesh.dispose(); n.light.dispose(); } catch {}
  });
  _friendlyNodes.length = 0;
}
