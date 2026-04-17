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
  { hex: '#2979FF', name: 'Volt Blue' },        //  1
  { hex: '#0ED2C8', name: 'Reactor Teal' },     //  2
  { hex: '#2DD881', name: 'Blast Green' },       //  3
  { hex: '#FBBD23', name: 'Arc Yellow' },        //  4
  { hex: '#F97316', name: 'Lambo Orange' },      //  5
  { hex: '#F0114C', name: 'Rich Red' },          //  6
  { hex: '#EE46B3', name: 'Hot Pink' },          //  7
  { hex: '#B04CF8', name: 'Plasma Purple' },     //  8
  { hex: '#94A3B8', name: 'Cool Gray' },         //  9
  { hex: '#ffffff', name: 'White' },             // 10
];

export const DEFAULT_LOGO_TOP = '#2DD881';   // Blast Green
export const DEFAULT_LOGO_BOT = '#2979FF';   // Volt Blue

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
  const lower = hex.toLowerCase();
  if (lower === '#ffffff' || lower === '#fff') return hex;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const isYellowish = r > 200 && g > 160 && b < 120;
  if (isYellowish) return _mixBlack(hex, 0.12);
  const lum = _relativeLuminance(hex);
  return _mixBlack(hex, lum > 0.65 ? 0.25 : 0.15);
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
  const palLower = (pal.clr || '').toLowerCase();
  const palIsWhite = palLower === '#ffffff' || palLower === '#fff';
  const palLum = _relativeLuminance(pal.clr);
  const palDarkAmt = palIsWhite ? 0 : (palLum > 0.65 ? 0.30 : 0.15);
  const accent = isDark ? pal.clr : _mixBlack(pal.clr, palDarkAmt);
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

function _relativeLuminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
  const clr = isDark ? hex : getThemeAdjustedLogoColor(hex);
  document.documentElement.style.setProperty('--clr', clr);
  document.documentElement.style.setProperty('--clr-top', _mixWhite(hex, 0.20));
  document.documentElement.style.setProperty('--clr-dk',  _mixBlack(hex, 0.45));
  document.documentElement.style.setProperty('--clr-lt',  _mixWhite(hex, 0.35));

  // Dynamic text-on-accent contrast. Evaluate against the adjusted
  // color (clr) since that's what actually renders as the background.
  const h = clr.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  const onColor = yiq >= 150 ? '#111111' : '#ffffff';
  document.documentElement.style.setProperty('--clr-on', onColor);
  document.documentElement.style.setProperty('--clr-title-on', onColor);

  _currentAccent = hex;
  State.accent = hex;

  if (hex.toLowerCase() === '#ffffff' || hex.toLowerCase() === '#fff') {
    document.documentElement.setAttribute('data-accent-white', '');
  } else {
    document.documentElement.removeAttribute('data-accent-white');
  }
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

export function buildMonoLogoSvg(color) {
  // Paths from assets/nodeblast_logo_mono.svg — filled left blob +
  // outlined right half + filled right circle.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 234.6">`
    + `<path fill="${color}" d="M7.9,117s.7,26.9,17.9,43.3c17.2,16.4,42.5,17,42.5,17,33.3,0,60.3-27,60.3-60.3s26.9-60.3,60.3-60.3h.6c14.2,0,23.2-15.2,16.1-27.5-8.2-14.1-23.2-22.8-39.5-22.8h-75.1c-16.3,0-31.4,8.7-39.5,22.8,0,0-21.2,36.6-26.2,45.3-5,8.7-17.4,25.8-17.4,42.4ZM45.6,115.6c.8-11.3,9.9-20.3,21.1-21.1,13.7-.8,24.9,10.4,24,24-.8,11.3-9.9,20.3-21.1,21.1-13.7.8-24.9-10.4-24-24Z"/>`
    + `<path fill="${color}" d="M166,234h-75.1c-18.5,0-35.8-10-45.1-26h0c-4.5-7.8-4.4-17.1,0-24.8,4.5-7.8,12.6-12.5,21.7-12.5h.6c29.7,0,53.8-24.1,53.8-53.8s29.9-66.7,66.7-66.8c2.2,0,26.2-.1,46.2,18.1,20.7,18.9,20.8,47.6,20.8,48.8,0,15.8-9.4,31-15.6,41.1-1.1,1.7-2,3.2-2.7,4.5-5,8.7-26.2,45.3-26.2,45.3-9.2,16.1-26.5,26-45.1,26ZM57.1,201.5c7,12.1,20,19.5,33.8,19.5h75.1c14,0,26.9-7.5,33.8-19.5,0,0,21.2-36.7,26.2-45.3.8-1.4,1.8-3.1,2.9-4.8,5.4-8.8,13.7-22.2,13.7-34.4,0-.3-.1-24.3-16.5-39.2-16.5-15-37-14.7-37.2-14.7h-.2c-29.7,0-53.8,24.1-53.8,53.8s-30,66.8-66.8,66.8h-.6c-4.4,0-8.3,2.2-10.5,6-2.2,3.7-2.2,8,0,11.8Z"/>`
    + `<path fill="${color}" d="M166.3,115.5c.8-11.3,9.9-20.3,21.1-21.1,13.7-.8,24.9,10.4,24,24-.8,11.3-9.9,20.3-21.1,21.1-13.7.8-24.9-10.4-24-24Z"/>`
    + `</svg>`;
}

export function buildLogoSvg(topColor, botColor) {
  // V2 paths — pre-rotated, IDs match visual sides. topColor =
  // left half (logo_left), botColor = right half (logo_right).
  // Circles omitted — compound paths cut the holes.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 234.6">`
    + `<path fill="${topColor}" d="M0,117.3s.7,28.6,19,46c18.3,17.4,45.1,18.1,45.1,18.1,35.3,0,64-28.7,64-64s28.6-64,64-64h.6c15.1,0,24.6-16.1,17.1-29.2C201.1,9.2,185.2,0,167.9,0h-79.7c-17.3,0-33.3,9.2-41.9,24.2,0,0-22.5,38.9-27.8,48.1C13.2,81.5,0,99.7,0,117.3ZM40,115.8c.8-12,10.5-21.6,22.4-22.4,14.5-.9,26.4,11,25.5,25.5-.8,12-10.5,21.6-22.4,22.4-14.5.9-26.4-11-25.5-25.5Z"/>`
    + `<path fill="${botColor}" d="M46.2,210.4c8.7,15,24.6,24.2,41.9,24.2h79.7c17.3,0,33.3-9.2,41.9-24.2,0,0,22.5-38.9,27.8-48.1,5.3-9.2,18.5-27.4,18.5-45,0,0,.2-28.5-19.8-46.7-20-18.2-44.3-17.4-44.3-17.4-35.3,0-64,28.7-64,64s-28.6,64-64,64h-.6c-15.1,0-24.6,16.1-17.1,29.2h0ZM168.1,115.7c.8-12,10.5-21.6,22.4-22.4,14.5-.9,26.4,11,25.5,25.5-.8,12-10.5,21.6-22.4,22.4-14.5.9-26.4-11-25.5-25.5Z"/>`
    + `</svg>`;
}

export function applyFavicon(topColor, botColor, mode) {
  try {
    const svg = mode === 'mono' ? buildMonoLogoSvg(topColor) : buildLogoSvg(topColor, botColor);
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
