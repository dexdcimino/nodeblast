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
    icon: `<svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="25"><rect x="4" y="10" width="22" height="5" rx="2" fill="currentColor" opacity="0.9"/><rect x="10" y="15" width="7" height="8" rx="1.5" fill="currentColor" opacity="0.7"/><circle cx="28" cy="12.5" r="4" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.9"/><circle cx="28" cy="12.5" r="1.5" fill="currentColor" opacity="1"/><line x1="24" y1="12.5" x2="27" y2="12.5" stroke="currentColor" stroke-width="1.5"/></svg>`,
    color:    { r: 0.1, g: 1.0, b: 0.4 },
  },
  {
    id:       'machinegun',
    name:     'Machine Gun',
    slot:     1,
    cooldown: 80,
    icon: `<svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="25"><rect x="2" y="9" width="30" height="7" rx="1.5" fill="currentColor" opacity="0.9"/><rect x="2" y="9" width="30" height="2" rx="1" fill="currentColor" opacity="0.5"/><rect x="10" y="16" width="8" height="7" rx="2" fill="currentColor" opacity="0.75"/><rect x="32" y="10" width="4" height="5" rx="1" fill="currentColor" opacity="0.6"/><circle cx="11" cy="20" r="2.5" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.8"/></svg>`,
    color:    { r: 1.0, g: 0.7, b: 0.1 },
  },
  {
    id:       'plasma',
    name:     'Plasma Cannon',
    slot:     2,
    cooldown: 350,
    icon: `<svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="25"><rect x="3" y="8" width="26" height="12" rx="3" fill="currentColor" opacity="0.85"/><rect x="29" y="7" width="7" height="14" rx="2" fill="currentColor" opacity="0.6"/><line x1="10" y1="8" x2="10" y2="20" stroke="currentColor" stroke-width="1.5" opacity="0.6"/><line x1="18" y1="8" x2="18" y2="20" stroke="currentColor" stroke-width="1.5" opacity="0.6"/><ellipse cx="36" cy="14" rx="2" ry="4" fill="currentColor" opacity="1"/><rect x="7" y="20" width="12" height="5" rx="1.5" fill="currentColor" opacity="0.7"/></svg>`,
    color:    { r: 0.4, g: 0.1, b: 1.0 },
  },
  {
    id:       'nodeblaster',
    name:     'Node Blaster',
    slot:     3,
    cooldown: 500,
    icon: `<svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="25"><ellipse cx="16" cy="14" rx="13" ry="8" fill="currentColor" opacity="0.85"/><rect x="28" y="11" width="8" height="6" rx="2" fill="currentColor" opacity="0.7"/><circle cx="37" cy="14" r="2.5" fill="currentColor" opacity="1"/><rect x="11" y="22" width="9" height="4" rx="1.5" fill="currentColor" opacity="0.6"/><circle cx="8" cy="10" r="2" fill="currentColor" opacity="0.5"/><circle cx="8" cy="18" r="2" fill="currentColor" opacity="0.5"/></svg>`,
    color:    { r: 1.0, g: 0.2, b: 0.2 },
  },
];

// ── Active gun state ──
let _activeSlot      = 0;
let _projectileColor = { r: 0.1, g: 1.0, b: 0.4 };
// Tracks which slots are unlocked — pistol (0) always unlocked
const _unlockedSlots = new Set([0]);

export function unlockSlot(slot) { _unlockedSlots.add(slot); _updateHUD(); }
export function lockSlot(slot)   { if (slot === 0) return; _unlockedSlots.delete(slot); _updateHUD(); }
export function isSlotUnlocked(slot) { return _unlockedSlots.has(slot); }
export function getUnlockedSlots()   { return new Set(_unlockedSlots); }

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
  if (!_unlockedSlots.has(slot)) return;  // can't switch to locked slot
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
    el.classList.toggle('active',   i === _activeSlot);
    el.classList.toggle('locked',   !_unlockedSlots.has(i));
    el.classList.toggle('unlocked',  _unlockedSlots.has(i));
  });
}

export function resetGuns() {
  _activeSlot      = 0;
  _projectileColor = { r: 0.1, g: 1.0, b: 0.4 };
  _unlockedSlots.clear();
  _unlockedSlots.add(0);  // always start with pistol
}
