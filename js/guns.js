// ══════════════════════════════════════
//  NodeBlast — GUN SYSTEM
//  Definitions, HUD, pickup logic
// ══════════════════════════════════════

// ── Gun definitions ──
export const GUNS = [
  {
    id:       'pistol',
    name:     'Space Pistol',
    slot:     0,
    cooldown: 220,
    icon:     '⊙',
    color:    { r: 0.1, g: 1.0, b: 0.4 },
  },
  {
    id:       'machinegun',
    name:     'Machine Gun',
    slot:     1,
    cooldown: 80,
    icon:     '⊕',
    color:    { r: 1.0, g: 0.7, b: 0.1 },
  },
  {
    id:       'plasma',
    name:     'Plasma Cannon',
    slot:     2,
    cooldown: 350,
    icon:     '⊗',
    color:    { r: 0.4, g: 0.1, b: 1.0 },
  },
  {
    id:       'nodeblaster',
    name:     'Node Blaster',
    slot:     3,
    cooldown: 500,
    icon:     '⊛',
    color:    { r: 1.0, g: 0.2, b: 0.2 },
  },
];

// ── Active gun state ──
let _activeSlot    = 0;
let _projectileColor = { r: 0.1, g: 1.0, b: 0.4 };

export function getActiveGun()       { return GUNS[_activeSlot]; }
export function getActiveSlot()      { return _activeSlot; }
export function getProjectileColor() { return _projectileColor; }

export function setProjectileColor(r, g, b) {
  _projectileColor = { r, g, b };
  if (window._nbSetGunColor) window._nbSetGunColor(r, g, b);
  if (window._nbRebuildGun) window._nbRebuildGun();
}

export function setActiveSlot(slot) {
  if (slot < 0 || slot >= GUNS.length) return;
  _activeSlot = slot;
  _projectileColor = { ...GUNS[slot].color };
  _updateHUD();
  if (window._nbRebuildGun) window._nbRebuildGun();
}

// ── HUD ──
export function initGunHUD() {
  const wrap = document.getElementById('play-gun-hud');
  if (!wrap) return;
  wrap.innerHTML = '';

  GUNS.forEach((gun, i) => {
    const slot = document.createElement('div');
    slot.className  = 'gun-slot';
    slot.id         = 'gun-slot-' + i;
    slot.dataset.slot = i;
    slot.innerHTML  = `
      <div class="gun-slot-key">${i + 1}</div>
      <div class="gun-slot-icon">${gun.icon}</div>
      <div class="gun-slot-name">${gun.name}</div>
    `;
    slot.addEventListener('click', () => setActiveSlot(i));
    wrap.appendChild(slot);
  });

  _updateHUD();
}

function _updateHUD() {
  document.querySelectorAll('.gun-slot').forEach((el, i) => {
    el.classList.toggle('active', i === _activeSlot);
  });
}

export function resetGuns() {
  _activeSlot      = 0;
  _projectileColor = { r: 0.1, g: 1.0, b: 0.4 };
}
