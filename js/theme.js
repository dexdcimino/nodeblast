import State from './state.js';

const PALETTES = {
  bold:   { clr:'#5AAA72', top:'#72e122', dk:'#397212', lt:'#95e35c' },
  soft:   { clr:'#825FC2', top:'#a385d4', dk:'#5f468f', lt:'#b79de6' },
  ocean:  { clr:'#127596', top:'#2e6d9e', dk:'#0c4d63', lt:'#3aa0c7' },
  ember:  { clr:'#9c4060', top:'#c85c2e', dk:'#6b2838', lt:'#d9766f' },
  custom: { clr:'#5AAA72', top:'#72e122', dk:'#397212', lt:'#95e35c' },
};

// ══════════════════════════════════════════════════════════════
//  Logo color palette — both columns of the picker share this list
// ──────────────────────────────────────────────────────────────
//  Each picker column independently selects one of these 10 colors:
//    - LEFT  (top) → #nodeblast_logo_left, "node" wordmark,
//                    AND drives the site-wide --clr accent.
//    - RIGHT (bot) → #nodeblast_logo_right, "blast" wordmark —
//                    pure decoration, no --clr.
//  Circles are transparent negative space (hole-punched by the
//  compound paths in the big halves).
// ══════════════════════════════════════════════════════════════

export const LOGO_PALETTE = [
  { hex: '#127596', name: 'DexNote Blue' },     //  1
  { hex: '#E8453C', name: 'Rich Red' },         //  2
  { hex: '#F26B1C', name: 'Lambo Orange' },     //  3
  { hex: '#F2C41C', name: 'Golden Yellow' },    //  4
  { hex: '#7AC74F', name: 'Natural Green' },    //  5
  { hex: '#2ECCC1', name: 'Teal Cyan' },        //  6
  { hex: '#378ADD', name: 'Clean Blue' },       //  7
  { hex: '#8B5CF6', name: 'Electric Violet' },  //  8
  { hex: '#D946A8', name: 'Magenta Pink' },     //  9
  { hex: '#9AA5B4', name: 'Cool Gray' },        // 10
];

// MD33: defaults from assets/nodeblast_logo_v2.svg.
// .st0 (#127596 teal) fills nodeblast_logo_left; .st1 (#7ac74f green)
// fills nodeblast_logo_right. "Top" (left column) maps to the left
// half; "Bot" (right column) maps to the right half.
export const DEFAULT_LOGO_TOP = '#127596';   // SVG .st0 teal (left)
export const DEFAULT_LOGO_BOT = '#7ac74f';   // SVG .st1 green (right)

let _transTimer = null;
let _currentAccent = null;
const _logoRepaintListeners = [];

// Register a callback to re-apply the logo paint whenever the theme
// changes. init.js subscribes to this so its paintLogo() can re-run
// with the light-mode-adjusted colors without theme.js having to
// import anything from init.js (one-way dependency).
export function onThemeChange(cb) {
  if (typeof cb === 'function') _logoRepaintListeners.push(cb);
}

// Darken a raw picker color for light-mode rendering of the SVG logo
// and "nodeblast" wordmark. The picker swatches themselves keep their
// unadjusted hex; this is only used at paint time. Mirrors the 25%
// black-mix used by applyAccent below, which is the same amount DexNote
// darkens its session color in light mode.
export function getThemeAdjustedLogoColor(hex) {
  if (!hex) return hex;
  if (State.theme === 'dark') return hex;
  return _mixBlack(hex, 0.22);
}

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
  // Reapply the accent so the light-mode darkening kicks in after a
  // dark → light toggle (and vice versa).
  if (_currentAccent) applyAccent(_currentAccent);
  // Notify subscribers so the logo SVG + wordmark can re-paint with
  // the theme-adjusted colors.
  _logoRepaintListeners.forEach((cb) => { try { cb(theme); } catch (e) { console.warn(e); } });
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

function _mixWhite(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c + (255 - c) * amt).toString(16).padStart(2, '0');
  return '#' + mix(r) + mix(g) + mix(b);
}

// Apply a user-chosen accent color site-wide. Drives the same --clr /
// --clr-top / --clr-dk / --clr-lt variables the palette system uses,
// so every existing accent-colored element (buttons, links, hex
// borders, profile bar highlights, …) picks it up with no further
// plumbing. In light mode we darken the base so it keeps enough
// contrast against the page background, mirroring how DexNote
// handles its session color.
export function applyAccent(hex) {
  if (!hex) hex = DEFAULT_LOGO_TOP;
  const isDark = State.theme === 'dark';
  const clr = isDark ? hex : _mixBlack(hex, 0.25);
  document.documentElement.style.setProperty('--clr', clr);
  document.documentElement.style.setProperty('--clr-top', _mixWhite(hex, 0.20));
  document.documentElement.style.setProperty('--clr-dk',  _mixBlack(hex, 0.45));
  document.documentElement.style.setProperty('--clr-lt',  _mixWhite(hex, 0.35));
  _currentAccent = hex;
  State.accent = hex;
}

// ══════════════════════════════════════════════════════════════
//  Dynamic favicon
// ──────────────────────────────────────────────────────────────
//  Builds a tiny copy of the nodeblast logo SVG on the fly with
//  the user's chosen colors painted in, then swaps the document's
//  <link rel="icon"> to a blob URL pointing at it. The previous
//  blob is revoked to avoid leaking object URLs.
// ══════════════════════════════════════════════════════════════

let _faviconBlobUrl = null;

function buildLogoSvg(topColor, botColor) {
  // MD33: V2 paths — pre-rotated, no transform needed. topColor
  // paints the left half, botColor the right. Circles are omitted
  // since the compound paths cut the holes via even-odd fill.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 234.6">`
    + `<path fill="${botColor}" d="M237.5,72.3c-5.3-9.2-27.8-48.1-27.8-48.1C201.1,9.2,185.1,0,167.8,0h-79.7C70.8,0,54.9,9.2,46.2,24.2c-7.5,13.1,2,29.3,17.1,29.2h.6c35.4,0,64,28.7,64,64s28.7,64,64,64c0,0,25.2.7,45.1-18.1s19-46,19-46c0-17.6-13.2-35.8-18.5-45ZM190.5,141.3c-11.9-.8-21.6-10.4-22.4-22.4-.9-14.5,11-26.4,25.5-25.5,11.9.8,21.6,10.4,22.4,22.4.9,14.5-11,26.4-25.5,25.5Z"/>`
    + `<path fill="${topColor}" d="M192.7,181.2h-.6c-35.4,0-64-28.7-64-64s-28.7-64-64-64c0,0-24.4-.9-44.3,17.4S0,117.3,0,117.3c0,17.6,13.2,35.8,18.5,45,5.3,9.2,27.8,48.1,27.8,48.1,8.6,15,24.6,24.2,41.9,24.2h79.7c17.3,0,33.2-9.2,41.9-24.2,7.5-13.1-2-29.3-17.1-29.2ZM62.4,141.2c-11.9-.8-21.6-10.4-22.4-22.4-.9-14.5,11-26.4,25.5-25.5,11.9.8,21.6,10.4,22.4,22.4.9,14.5-11,26.4-25.5,25.5Z"/>`
    + `</svg>`;
}

export function applyFavicon(topColor, botColor) {
  try {
    const svg = buildLogoSvg(topColor, botColor);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      document.head.appendChild(link);
    }
    link.type = 'image/svg+xml';
    link.href = url;
    if (_faviconBlobUrl) URL.revokeObjectURL(_faviconBlobUrl);
    _faviconBlobUrl = url;
  } catch (err) {
    console.warn('[theme] applyFavicon failed:', err);
  }
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
