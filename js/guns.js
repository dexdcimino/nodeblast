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
  {
    id:       'rocket',
    name:     'Rocket Launcher',
    slot:     4,
    cooldown: 900,
    icon: `<svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="25"><rect x="2" y="10" width="28" height="8" rx="2" fill="currentColor" opacity="0.9"/><rect x="30" y="8" width="6" height="12" rx="1.5" fill="currentColor" opacity="0.7"/><rect x="36" y="6" width="3" height="16" rx="1" fill="currentColor" opacity="0.5"/><rect x="8" y="18" width="10" height="5" rx="1.5" fill="currentColor" opacity="0.7"/><rect x="4" y="8" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.6"/><circle cx="18" cy="14" r="2" fill="currentColor" opacity="0.5"/></svg>`,
    color:    { r: 1.0, g: 0.5, b: 0.0 },
  },
  {
    id:       'sniper',
    name:     'Sniper Rifle',
    slot:     5,
    cooldown: 1200,
    icon: `<svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="25"><rect x="1" y="12" width="34" height="4" rx="1" fill="currentColor" opacity="0.9"/><rect x="8" y="16" width="6" height="7" rx="1.5" fill="currentColor" opacity="0.7"/><rect x="28" y="8" width="3" height="12" rx="1" fill="currentColor" opacity="0.6"/><circle cx="35" cy="14" r="3.5" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.8"/><line x1="35" y1="10" x2="35" y2="18" stroke="currentColor" stroke-width="0.8" opacity="0.5"/><line x1="31" y1="14" x2="39" y2="14" stroke="currentColor" stroke-width="0.8" opacity="0.5"/></svg>`,
    color:    { r: 0.8, g: 0.2, b: 0.9 },
  },
];

// ══════════════════════════════════════
//  4-SLOT INVENTORY
// ══════════════════════════════════════

export const SLOT_COUNT = 4;
const DEFAULT_LOADOUT = ['pistol', 'machinegun', 'plasma', 'nodeblaster'];

let _slotGunIds = DEFAULT_LOADOUT.slice();
let _activeSlot = 0;
let _projectileColor = { r: 0.1, g: 1.0, b: 0.4 };

function _gunForSlot(i) {
  const id = _slotGunIds[i];
  return GUNS.find(g => g.id === id) || GUNS[0];
}

export function getActiveGun()       { return _gunForSlot(_activeSlot); }
export function getActiveSlot()      { return _activeSlot; }
export function getProjectileColor() { return _projectileColor; }
export function getSlotGunIds()      { return _slotGunIds.slice(); }
export function getGunIdAt(i)        { return _slotGunIds[i] || null; }

export function setProjectileColor(r, g, b) {
  _projectileColor = { r, g, b };
  if (window._nbSetGunColor) window._nbSetGunColor(r, g, b);
  if (window._nbRebuildGun)  window._nbRebuildGun();
}

export function setActiveSlot(slot) {
  if (slot < 0 || slot >= SLOT_COUNT) return;
  _activeSlot = slot;
  _projectileColor = { ..._gunForSlot(slot).color };
  _updateHUD();
  if (window._nbRebuildGun) window._nbRebuildGun();
  if (window._nbUnscope)    window._nbUnscope();
}

export function setSlotGun(slotIdx, gunId) {
  if (slotIdx < 0 || slotIdx >= SLOT_COUNT) return null;
  if (!GUNS.find(g => g.id === gunId)) return null;
  const previousId = _slotGunIds[slotIdx];
  _slotGunIds[slotIdx] = gunId;
  _rerenderSlot(slotIdx);
  if (slotIdx === _activeSlot) {
    _projectileColor = { ..._gunForSlot(slotIdx).color };
    if (window._nbRebuildGun) window._nbRebuildGun();
    if (window._nbUnscope)    window._nbUnscope();
  }
  return previousId;
}

// ── HUD ──
export function initGunHUD() {
  const wrap = document.getElementById('play-gun-hud');
  if (!wrap) return;
  wrap.innerHTML = '';

  for (let i = 0; i < SLOT_COUNT; i++) {
    const gun  = _gunForSlot(i);
    const slot = document.createElement('div');
    slot.className    = 'gun-slot';
    slot.id           = 'gun-slot-' + i;
    slot.dataset.slot = i;
    slot.innerHTML    = `
      <div class="gun-slot-key">${i + 1}</div>
      <div class="gun-slot-icon">${gun.icon}</div>
      <div class="gun-slot-name">${gun.name}</div>
    `;
    slot.addEventListener('click', () => setActiveSlot(i));
    wrap.appendChild(slot);
  }

  _updateHUD();
}

function _rerenderSlot(i) {
  const el = document.getElementById('gun-slot-' + i);
  if (!el) return;
  const gun = _gunForSlot(i);
  el.innerHTML = `
    <div class="gun-slot-key">${i + 1}</div>
    <div class="gun-slot-icon">${gun.icon}</div>
    <div class="gun-slot-name">${gun.name}</div>
  `;
  _updateHUD();
}

function _updateHUD() {
  document.querySelectorAll('.gun-slot').forEach((el, i) => {
    el.classList.toggle('active', i === _activeSlot);
    el.classList.remove('locked');
    el.classList.add('unlocked');
  });
}

export function resetGuns() {
  _slotGunIds      = DEFAULT_LOADOUT.slice();
  _activeSlot      = 0;
  _projectileColor = { r: 0.1, g: 1.0, b: 0.4 };
}

// ── Back-compat shims ──
export function unlockSlot(_slot)       { }
export function lockSlot(_slot)         { }
export function isSlotUnlocked(_slot)   { return _slot >= 0 && _slot < SLOT_COUNT; }
export function getUnlockedSlots()      { return new Set([0, 1, 2, 3]); }
