import State from './state.js';

const PALETTES = {
  bold:   { clr:'#5AAA72', top:'#72e122', dk:'#397212', lt:'#95e35c' },
  soft:   { clr:'#825FC2', top:'#a385d4', dk:'#5f468f', lt:'#b79de6' },
  ocean:  { clr:'#127596', top:'#2e6d9e', dk:'#0c4d63', lt:'#3aa0c7' },
  ember:  { clr:'#9c4060', top:'#c85c2e', dk:'#6b2838', lt:'#d9766f' },
  custom: { clr:'#5AAA72', top:'#72e122', dk:'#397212', lt:'#95e35c' },
};

let _transTimer = null;

export function applyTheme(theme, skipTransition = false) {
  if (!skipTransition && document.documentElement.dataset.theme && document.documentElement.dataset.theme !== theme) {
    document.documentElement.classList.add('theme-transition');
    clearTimeout(_transTimer);
    _transTimer = setTimeout(() => document.documentElement.classList.remove('theme-transition'), 400);
  }
  State.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('nb-theme', theme);

  document.querySelectorAll('.auth-theme-btn').forEach(b => b.classList.toggle('selected', b.dataset.themeVal === theme));
  _updateAuthAccent();
}

export function applyPalette(name) {
  const p = PALETTES[name] || PALETTES.bold;
  State.palette = name;
  localStorage.setItem('nb-palette', name);
  document.documentElement.style.setProperty('--clr', p.clr);
  document.documentElement.style.setProperty('--clr-top', p.top);
  document.documentElement.style.setProperty('--clr-dk', p.dk);
  document.documentElement.style.setProperty('--clr-lt', p.lt);

  document.querySelectorAll('.settings-palette-btn').forEach(b => b.classList.toggle('selected', b.dataset.palette === name));
  if (name === 'bold' || name === 'soft') {
    document.querySelectorAll('.auth-palette-btn').forEach(b => b.classList.toggle('selected', b.dataset.palette === name));
  }
  _updateAuthAccent();
}

function _updateAuthAccent() {
  const pal = PALETTES[State.palette] || PALETTES.bold;
  const isDark = State.theme === 'dark';
  const accent = isDark ? pal.clr : _mixBlack(pal.clr, 0.25);
  document.getElementById('auth-card')?.style.setProperty('--auth-accent', accent);
}

function _mixBlack(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c * (1 - amt)).toString(16).padStart(2, '0');
  return '#' + mix(r) + mix(g) + mix(b);
}

export function initThemeToggle() {
  const btn = document.querySelector('.icon-btn[data-action="theme"]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    applyTheme(State.theme === 'dark' ? 'light' : 'dark');
  });
}

export function initPalettePickers() {
  document.querySelectorAll('.auth-palette-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyPalette(btn.dataset.palette);
    });
  });
  document.querySelectorAll('.settings-palette-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyPalette(btn.dataset.palette);
    });
  });
  document.querySelectorAll('.auth-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.themeVal);
    });
  });
}
