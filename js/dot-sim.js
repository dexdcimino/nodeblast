// ══════════════════════════════════════
//  NodeBlast — DOT-SIM (DS-01)
//  Standalone canvas simulation engine.
//  Zero dependencies. Pure 2D canvas.
// ══════════════════════════════════════

const TRIBES = [
  { name: 'Alpha', color: '#00ffaa', bias: { aggression: 0.6, sociality: 0.7, metabolism: 0.5, fertility: 0.5, fearfulness: 0.4 } },
  { name: 'Beta',  color: '#ff6b35', bias: { aggression: 0.4, sociality: 0.5, metabolism: 0.5, fertility: 0.8, fearfulness: 0.6 } },
  { name: 'Gamma', color: '#a78bfa', bias: { aggression: 0.5, sociality: 0.3, metabolism: 0.7, fertility: 0.5, fearfulness: 0.5 } },
  { name: 'Delta', color: '#38bdf8', bias: { aggression: 0.3, sociality: 0.5, metabolism: 0.5, fertility: 0.5, fearfulness: 0.3 } },
];

const MAX_TOTAL = 120;
const MAX_PER_TRIBE = 40;
const TRAIL_LEN = 6;
const CELL_SIZE = 50;

let _canvas = null, _ctx = null, _raf = null, _paused = false;
let _agents = [], _food = [], _tick = 0, _lastTime = 0, _fps = 0, _fpsFrames = 0, _fpsLast = 0;
let _gridW = 0, _gridH = 0, _grid = null;
let _foodCooldowns = [];
let _zones = [];

let _cfg = {
  speed: 1.0,
  foodRate: 1.0,
  aggression: 1.0,
  fertility: 1.0,
  startingDots: 12,
};

// ── Helpers ──

function _rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
let _nextId = 0;

function _hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// ── Spatial grid ──

function _buildGrid() {
  _gridW = Math.ceil(_canvas.width / CELL_SIZE);
  _gridH = Math.ceil(_canvas.height / CELL_SIZE);
  _grid = new Array(_gridW * _gridH);
  for (let i = 0; i < _grid.length; i++) _grid[i] = [];
  for (const a of _agents) {
    const cx = _clamp(Math.floor(a.x / CELL_SIZE), 0, _gridW - 1);
    const cy = _clamp(Math.floor(a.y / CELL_SIZE), 0, _gridH - 1);
    _grid[cy * _gridW + cx].push(a);
  }
}

function _nearby(x, y, radius) {
  const out = [];
  const cx0 = _clamp(Math.floor((x - radius) / CELL_SIZE), 0, _gridW - 1);
  const cx1 = _clamp(Math.floor((x + radius) / CELL_SIZE), 0, _gridW - 1);
  const cy0 = _clamp(Math.floor((y - radius) / CELL_SIZE), 0, _gridH - 1);
  const cy1 = _clamp(Math.floor((y + radius) / CELL_SIZE), 0, _gridH - 1);
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++)
      for (const a of _grid[cy * _gridW + cx]) out.push(a);
  return out;
}

// ── Agent factory ──

function _spawnAgent(tribe, x, y, parentTraits) {
  const bias = TRIBES[tribe].bias;
  const jitter = () => _rand(-0.2, 0.2);
  const mutate = (v) => _clamp(v + _rand(-0.05, 0.05), 0, 1);
  const traits = parentTraits
    ? { aggression: mutate(parentTraits.aggression), sociality: mutate(parentTraits.sociality), metabolism: mutate(parentTraits.metabolism), fertility: mutate(parentTraits.fertility), fearfulness: mutate(parentTraits.fearfulness) }
    : { aggression: _clamp(bias.aggression + jitter(), 0, 1), sociality: _clamp(bias.sociality + jitter(), 0, 1), metabolism: _clamp(bias.metabolism + jitter(), 0, 1), fertility: _clamp(bias.fertility + jitter(), 0, 1), fearfulness: _clamp(bias.fearfulness + jitter(), 0, 1) };
  return {
    id: _nextId++,
    x: x ?? _rand(30, _canvas.width - 30),
    y: y ?? _rand(30, _canvas.height - 30),
    vx: _rand(-0.3, 0.3), vy: _rand(-0.3, 0.3),
    radius: 4 + tribe * 0.75 + _rand(0, 1),
    tribe, energy: 70, age: 0,
    state: 'idle', traits,
    cooldowns: { attack: 0, reproduce: 0 },
    glowPhase: Math.random() * Math.PI * 2,
    trailPoints: [],
  };
}

function _spawnFood() {
  const fertiles = _zones.filter(z => z.type === 'FERTILE');
  if (fertiles.length > 0 && Math.random() < 0.6) {
    const z = fertiles[Math.floor(Math.random() * fertiles.length)];
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * z.radius;
    return { x: z.x + Math.cos(angle) * dist, y: z.y + Math.sin(angle) * dist, energy: 30, radius: 4 };
  }
  return { x: _rand(20, _canvas.width - 20), y: _rand(20, _canvas.height - 20), energy: 30, radius: 4 };
}

function _generateZones() {
  _zones = [];
  const W = _canvas.width, H = _canvas.height;
  // Fertile patches (3)
  for (let i = 0; i < 3; i++) {
    _zones.push({ type: 'FERTILE', x: _rand(120, W - 120), y: _rand(120, H - 120), radius: _rand(60, 120) });
  }
  // Hazard zones (2)
  for (let i = 0; i < 2; i++) {
    _zones.push({ type: 'HAZARD', x: _rand(100, W - 100), y: _rand(100, H - 100), radius: _rand(40, 80) });
  }
  // Tribe nests (4, one per quadrant)
  const quads = [
    { x: W * 0.2, y: H * 0.2 }, { x: W * 0.8, y: H * 0.2 },
    { x: W * 0.2, y: H * 0.8 }, { x: W * 0.8, y: H * 0.8 },
  ];
  for (let t = 0; t < 4; t++) {
    _zones.push({ type: 'NEST', tribe: t, x: quads[t].x, y: quads[t].y, radius: 50 });
  }
}

// ── Simulation tick ──

function _simTick(dt) {
  _tick++;
  const spd = _cfg.speed * dt;
  _buildGrid();

  // Food cooldowns
  for (let i = _foodCooldowns.length - 1; i >= 0; i--) {
    _foodCooldowns[i] -= spd;
    if (_foodCooldowns[i] <= 0) {
      _food.push(_spawnFood());
      _foodCooldowns.splice(i, 1);
    }
  }

  const dead = [];
  const births = [];
  const tribeCounts = [0, 0, 0, 0];
  for (const a of _agents) tribeCounts[a.tribe]++;

  for (const a of _agents) {
    a.age++;

    // Cooldowns
    if (a.cooldowns.attack > 0) a.cooldowns.attack -= spd;
    if (a.cooldowns.reproduce > 0) a.cooldowns.reproduce -= spd;

    // Energy drain
    a.energy -= (0.03 + a.traits.metabolism * 0.04) * spd;
    if (a.energy <= 0) { dead.push(a); continue; }

    // Perception
    const percR = 50 + a.traits.sociality * 30;
    const neighbors = _nearby(a.x, a.y, percR);
    let nearestFood = null, nearFoodDist = Infinity;
    let nearestAlly = null, nearAllyDist = Infinity;
    let nearestEnemy = null, nearEnemyDist = Infinity;

    for (const f of _food) {
      const d = _dist(a, f);
      if (d < percR && d < nearFoodDist) { nearFoodDist = d; nearestFood = f; }
    }
    for (const n of neighbors) {
      if (n.id === a.id) continue;
      const d = _dist(a, n);
      if (n.tribe === a.tribe) { if (d < nearAllyDist) { nearAllyDist = d; nearestAlly = n; } }
      else { if (d < nearEnemyDist) { nearEnemyDist = d; nearestEnemy = n; } }
    }

    // Decision
    const agg = a.traits.aggression * _cfg.aggression;
    const fear = a.traits.fearfulness;
    a.state = 'idle';

    // Seek food if hungry
    if (nearestFood && a.energy < 60) {
      a.state = 'seeking';
      const dx = nearestFood.x - a.x, dy = nearestFood.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const s = (0.8 + a.traits.metabolism * 0.8) * spd;
      a.vx += (dx / d) * s * 0.12;
      a.vy += (dy / d) * s * 0.12;
      // Eat on contact
      if (nearFoodDist < a.radius + nearestFood.radius) {
        a.energy = Math.min(100, a.energy + nearestFood.energy);
        a.state = 'eating';
        const idx = _food.indexOf(nearestFood);
        if (idx >= 0) { _food.splice(idx, 1); _foodCooldowns.push(300 / _cfg.foodRate); }
      }
    }
    // Cluster with tribe
    else if (nearestAlly && nearAllyDist > 30 && a.traits.sociality > 0.4) {
      const dx = nearestAlly.x - a.x, dy = nearestAlly.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      a.vx += (dx / d) * 0.04 * spd;
      a.vy += (dy / d) * 0.04 * spd;
    }
    // Enemy response
    if (nearestEnemy && nearEnemyDist < percR) {
      if (agg > fear) {
        a.state = 'fighting';
        const dx = nearestEnemy.x - a.x, dy = nearestEnemy.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        a.vx += (dx / d) * 0.1 * spd;
        a.vy += (dy / d) * 0.1 * spd;
        // Deal damage on contact
        if (nearEnemyDist < 8 && a.cooldowns.attack <= 0) {
          nearestEnemy.energy -= agg * 8;
          a.cooldowns.attack = 45;
        }
      } else {
        a.state = 'fleeing';
        const dx = a.x - nearestEnemy.x, dy = a.y - nearestEnemy.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        a.vx += (dx / d) * 0.12 * spd;
        a.vy += (dy / d) * 0.12 * spd;
      }
    }

    // Reproduce
    const fert = a.traits.fertility * _cfg.fertility;
    if (a.energy > 88 && a.cooldowns.reproduce <= 0 && tribeCounts[a.tribe] < MAX_PER_TRIBE && _agents.length + births.length < MAX_TOTAL) {
      if (fert > _rand(0, 1.2)) {
        a.state = 'reproducing';
        a.energy -= 40;
        a.cooldowns.reproduce = 300;
        births.push(_spawnAgent(a.tribe, a.x + _rand(-10, 10), a.y + _rand(-10, 10), a.traits));
        tribeCounts[a.tribe]++;
      }
    }

    // Idle drift
    if (a.state === 'idle') {
      a.vx += _rand(-0.06, 0.06) * spd;
      a.vy += _rand(-0.06, 0.06) * spd;
    }

    // Velocity damping
    a.vx *= 0.92;
    a.vy *= 0.92;

    // Speed cap
    const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
    const maxSpd = 1.5 + a.traits.metabolism * 1.2;
    if (speed > maxSpd) { a.vx = (a.vx / speed) * maxSpd; a.vy = (a.vy / speed) * maxSpd; }

    // Move
    a.x += a.vx * spd;
    a.y += a.vy * spd;

    // Boundary bounce
    const pad = a.radius + 2;
    if (a.x < pad) { a.x = pad; a.vx = Math.abs(a.vx) * 0.5; }
    if (a.x > _canvas.width - pad) { a.x = _canvas.width - pad; a.vx = -Math.abs(a.vx) * 0.5; }
    if (a.y < pad) { a.y = pad; a.vy = Math.abs(a.vy) * 0.5; }
    if (a.y > _canvas.height - pad) { a.y = _canvas.height - pad; a.vy = -Math.abs(a.vy) * 0.5; }

    // Zone effects
    for (const zone of _zones) {
      const dz = _dist(a, zone);
      if (dz > zone.radius) continue;
      if (zone.type === 'HAZARD') { a.energy -= 0.08 * spd; }
      else if (zone.type === 'NEST' && zone.tribe === a.tribe) { a.energy = Math.min(100, a.energy + 0.04 * spd); }
    }

    // Trail
    a.trailPoints.push({ x: a.x, y: a.y });
    if (a.trailPoints.length > TRAIL_LEN) a.trailPoints.shift();
  }

  // Remove dead
  for (const d of dead) {
    const idx = _agents.indexOf(d);
    if (idx >= 0) _agents.splice(idx, 1);
  }

  // Add births
  for (const b of births) _agents.push(b);
}

// ── Rendering ──

function _render() {
  if (!_ctx || !_canvas) return;
  const W = _canvas.width, H = _canvas.height;
  _ctx.clearRect(0, 0, W, H);
  _ctx.fillStyle = '#0a0b0f';
  _ctx.fillRect(0, 0, W, H);

  // Zones
  for (const zone of _zones) {
    if (zone.type === 'FERTILE') {
      const gr = _ctx.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radius);
      gr.addColorStop(0, 'rgba(0,200,80,0.12)');
      gr.addColorStop(0.7, 'rgba(0,200,80,0.04)');
      gr.addColorStop(1, 'rgba(0,200,80,0)');
      _ctx.fillStyle = gr;
      _ctx.beginPath();
      _ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      _ctx.fill();
    } else if (zone.type === 'HAZARD') {
      const pulse = 0.08 + Math.sin(_tick * 0.02) * 0.04;
      const gr = _ctx.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radius);
      gr.addColorStop(0, `rgba(200,50,0,${pulse})`);
      gr.addColorStop(0.7, `rgba(200,50,0,${pulse * 0.4})`);
      gr.addColorStop(1, 'rgba(200,50,0,0)');
      _ctx.fillStyle = gr;
      _ctx.beginPath();
      _ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      _ctx.fill();
    } else if (zone.type === 'NEST') {
      const tc = TRIBES[zone.tribe].color;
      const rgb = _hexToRgb(tc);
      const gr = _ctx.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radius);
      gr.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.05)`);
      gr.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      _ctx.fillStyle = gr;
      _ctx.beginPath();
      _ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      _ctx.fill();
      _ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`;
      _ctx.lineWidth = 1.5;
      _ctx.setLineDash([6, 4]);
      _ctx.beginPath();
      _ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      _ctx.stroke();
      _ctx.setLineDash([]);
    }
  }

  const skipTrails = _agents.length > 80;

  // Trails
  if (!skipTrails) {
    for (const a of _agents) {
      if (a.trailPoints.length < 2) continue;
      const c = TRIBES[a.tribe].color;
      _ctx.strokeStyle = c;
      _ctx.globalAlpha = 0.15;
      _ctx.lineWidth = 1.5;
      _ctx.beginPath();
      _ctx.moveTo(a.trailPoints[0].x, a.trailPoints[0].y);
      for (let i = 1; i < a.trailPoints.length; i++) {
        const p = a.trailPoints[i];
        _ctx.lineTo(p.x, p.y);
      }
      _ctx.stroke();
      _ctx.globalAlpha = 1;
    }
  }

  // Food
  const ft = _tick * 0.03;
  for (const f of _food) {
    const fy = f.y + Math.sin(ft + f.x * 0.1) * 2;
    _ctx.save();
    _ctx.translate(f.x, fy);
    _ctx.rotate(Math.PI / 4);
    // Glow
    const grd = _ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
    grd.addColorStop(0, 'rgba(255,215,0,0.4)');
    grd.addColorStop(1, 'rgba(255,215,0,0)');
    _ctx.fillStyle = grd;
    _ctx.fillRect(-10, -10, 20, 20);
    // Diamond
    _ctx.fillStyle = '#ffd700';
    _ctx.fillRect(-f.radius, -f.radius, f.radius * 2, f.radius * 2);
    _ctx.restore();
  }

  // Dots
  for (const a of _agents) {
    const c = TRIBES[a.tribe].color;
    const rgb = _hexToRgb(c);
    const glow = 0.3 + Math.sin(a.glowPhase + _tick * 0.06) * 0.1;

    // Outer glow
    const gr = _ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.radius * 2.5);
    gr.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${glow})`);
    gr.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    _ctx.fillStyle = gr;
    _ctx.beginPath();
    _ctx.arc(a.x, a.y, a.radius * 2.5, 0, Math.PI * 2);
    _ctx.fill();

    // Body
    _ctx.fillStyle = c;
    _ctx.beginPath();
    _ctx.arc(a.x, a.y, a.radius, 0, Math.PI * 2);
    _ctx.fill();

    // Inner highlight
    _ctx.fillStyle = 'rgba(255,255,255,0.35)';
    _ctx.beginPath();
    _ctx.arc(a.x - a.radius * 0.25, a.y - a.radius * 0.3, a.radius * 0.4, 0, Math.PI * 2);
    _ctx.fill();

    // State ring
    let ringColor = c;
    let ringAlpha = 0.3;
    if (a.state === 'seeking') { ringColor = '#ffffff'; ringAlpha = 0.5 + Math.sin(_tick * 0.15) * 0.3; }
    else if (a.state === 'fighting') { ringColor = '#ff3333'; ringAlpha = 0.8; }
    else if (a.state === 'fleeing') { ringColor = '#ffdd44'; ringAlpha = 0.6; }
    else if (a.state === 'reproducing') { ringColor = c; ringAlpha = 0.9; }
    _ctx.strokeStyle = ringColor;
    _ctx.globalAlpha = ringAlpha;
    _ctx.lineWidth = 1.2;
    _ctx.beginPath();
    _ctx.arc(a.x, a.y, a.radius + 2, 0, Math.PI * 2);
    _ctx.stroke();
    _ctx.globalAlpha = 1;
  }

  // Tribe population bars (top-left)
  const barW = Math.min(120, W * 0.2);
  for (let t = 0; t < 4; t++) {
    const count = _agents.filter(a => a.tribe === t).length;
    const frac = count / MAX_PER_TRIBE;
    const y = 8 + t * 10;
    // Background
    _ctx.fillStyle = 'rgba(255,255,255,0.06)';
    _ctx.beginPath();
    _ctx.roundRect(8, y, barW, 6, 3);
    _ctx.fill();
    // Fill
    _ctx.fillStyle = TRIBES[t].color;
    _ctx.globalAlpha = 0.8;
    _ctx.beginPath();
    _ctx.roundRect(8, y, Math.max(2, barW * frac), 6, 3);
    _ctx.fill();
    _ctx.globalAlpha = 1;
  }
}

// ── Main loop ──

function _loop(time) {
  if (!_canvas) return;
  _raf = requestAnimationFrame(_loop);

  // FPS counter
  _fpsFrames++;
  if (time - _fpsLast > 1000) { _fps = _fpsFrames; _fpsFrames = 0; _fpsLast = time; }

  if (_paused) return;

  // Delta time capped at 50ms
  let dt = (time - _lastTime) / 16.667; // normalize to ~60fps
  if (dt > 3) dt = 3;
  _lastTime = time;

  _simTick(dt);
  _render();
}

// ── Public API ──

export function dotSimInit(canvas, config) {
  _canvas = canvas;
  _ctx = canvas.getContext('2d');
  _agents = [];
  _food = [];
  _foodCooldowns = [];
  _tick = 0;
  _nextId = 0;
  _paused = false;
  if (config) Object.assign(_cfg, config);

  // Resize canvas to container
  const rect = canvas.parentElement?.getBoundingClientRect();
  if (rect) { canvas.width = rect.width; canvas.height = rect.height; }

  // Spawn starting dots
  _generateZones();
  const perTribe = _clamp(_cfg.startingDots, 3, 15);
  const nestZones = _zones.filter(z => z.type === 'NEST');
  for (let t = 0; t < 4; t++) {
    const nest = nestZones.find(z => z.tribe === t);
    for (let i = 0; i < perTribe; i++) {
      const nx = nest ? nest.x + _rand(-40, 40) : undefined;
      const ny = nest ? nest.y + _rand(-40, 40) : undefined;
      _agents.push(_spawnAgent(t, nx, ny));
    }
  }

  // Spawn food
  const foodCount = 12 + Math.floor(Math.random() * 9);
  for (let i = 0; i < foodCount; i++) _food.push(_spawnFood());

  _lastTime = performance.now();
  _fpsLast = _lastTime;
  _raf = requestAnimationFrame(_loop);
}

export function dotSimDestroy() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  _agents = []; _food = []; _foodCooldowns = []; _zones = [];
  _canvas = null; _ctx = null; _grid = null;
}

export function dotSimSetConfig(cfg) {
  Object.assign(_cfg, cfg);
}

export function dotSimHatch(tribeIndex, count) {
  const t = _clamp(tribeIndex, 0, 3);
  const tribePop = _agents.filter(a => a.tribe === t).length;
  const room = Math.min(count, MAX_PER_TRIBE - tribePop, MAX_TOTAL - _agents.length);
  for (let i = 0; i < room; i++) _agents.push(_spawnAgent(t));
}

export function dotSimGetStats() {
  const tribes = TRIBES.map((t, i) => {
    const members = _agents.filter(a => a.tribe === i);
    return {
      name: t.name, color: t.color, count: members.length,
      avgEnergy: members.length ? Math.round(members.reduce((s, a) => s + a.energy, 0) / members.length) : 0,
    };
  });
  return { tribes, totalDots: _agents.length, fps: _fps, tick: _tick };
}

export function dotSimPause() { _paused = true; }
export function dotSimResume() { _paused = false; }
