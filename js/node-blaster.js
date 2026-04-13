// ══════════════════════════════════════
//  NodeBlast — NODE BLASTER
//  Fires sticky nodes that grow on surfaces + enemies,
//  then explode dealing AOE damage
// ══════════════════════════════════════

let _scene   = null;
let _camera  = null;

const _stickyNodes = [];

const GROW_TIME      = 180;
const MAX_SCALE      = 10.0;
const EXPLODE_RADIUS = 6;
const EXPLODE_DAMAGE = 40;
const STICK_SPEED    = 1.4;

export function initNodeBlaster(scene, camera) {
  _scene  = scene;
  _camera = camera;
}

export function fireNodeBlaster(muzzlePos, direction, color) {
  const B = BABYLON;

  const proj = B.MeshBuilder.CreateSphere('nb_proj_' + Date.now(),
    { diameter: 0.22, segments: 5 }, _scene);
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
      n.mesh.position.addInPlace(n.vel);
      n.vel.y -= 0.005;
      n.light.position.copyFrom(n.mesh.position);

      const px = n.mesh.position.x;
      const py = n.mesh.position.y;
      const pz = n.mesh.position.z;

      let hit = false;

      for (const b of colBlocks) {
        if (px > b.minX - 0.15 && px < b.maxX + 0.15 &&
            pz > b.minZ - 0.15 && pz < b.maxZ + 0.15 &&
            py < b.maxY + 0.15  && py > -0.5) {
          hit = true;
          break;
        }
      }
      if (py < 0.15) hit = true;

      if (!hit && window._nbEnemyPositions) {
        const enemies = window._nbEnemyPositions();
        for (const e of enemies) {
          const dx = px - e.pos.x;
          const dy = py - e.pos.y;
          const dz = pz - e.pos.z;
          if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 0.9) {
            hit = true;
            if (window._nbApplyEnemyColor) window._nbApplyEnemyColor(e.index, n.color);
            break;
          }
        }
      }

      if (hit) {
        n.stuck = true;
        n.vel.scaleInPlace(0);
        n.light.intensity = 0.8;
        n.mesh.scaling.set(1.4, 0.4, 1.4);
        setTimeout(() => {
          if (n.mesh && !n.mesh.isDisposed()) n.mesh.scaling.setAll(1.0);
        }, 80);
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

        const ps              = new B.ParticleSystem('nb_ps_' + Date.now(), 80, _scene);
        ps.emitter            = pos.clone();
        ps.direction1         = new B.Vector3(-2, -2, -2);
        ps.direction2         = new B.Vector3( 2,  2,  2);
        ps.minLifeTime        = 0.2; ps.maxLifeTime   = 0.8;
        ps.minSize            = 0.1; ps.maxSize       = 0.35;
        ps.minEmitPower       = 3;   ps.maxEmitPower  = 10;
        ps.updateSpeed        = 0.02; ps.emitRate      = 300;
        ps.color1             = new B.Color4(c.r, c.g, c.b, 1.0);
        ps.color2             = new B.Color4(c.r * 0.5, c.g * 0.5, c.b * 0.5, 0.5);
        ps.colorDead          = new B.Color4(0, 0, 0, 0);
        ps.targetStopDuration = 0.1;
        ps.start();
        setTimeout(() => { try { ps.dispose(); } catch {} }, 1500);

        if (onExplode) onExplode(pos.x, pos.y, pos.z, EXPLODE_RADIUS,
          EXPLODE_DAMAGE, n.color);

        dead.push(i);
        try { n.mesh.dispose(); n.light.dispose(); } catch {}
      }
    }
  }

  for (let i = dead.length - 1; i >= 0; i--)
    _stickyNodes.splice(dead[i], 1);
}

export function destroyNodeBlaster() {
  _stickyNodes.forEach(n => {
    try { n.mesh.dispose(); n.light.dispose(); } catch {}
  });
  _stickyNodes.length = 0;
}
