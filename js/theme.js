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
//    - LEFT  (top) → #nodeblast_logo_top, #nodeblast_circle_bottom,
//                    "blast" wordmark, AND drives the site-wide --clr
//                    accent (so buttons/borders/etc. recolor with it).
//    - RIGHT (bot) → #nodeblast_logo_bottom, #nodeblast_circle_top,
//                    "node" wordmark — pure decoration, no --clr.
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

// MD31: defaults pulled from assets/nodeblast_logo_v1.svg.
// .st1 (#7ac74f green) fills nodeblast_logo_top; .st0 (#127596 teal)
// fills nodeblast_logo_bottom.
export const DEFAULT_LOGO_TOP = '#7ac74f';   // SVG .st1 green
export const DEFAULT_LOGO_BOT = '#127596';   // SVG .st0 teal

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
  // Both small inner dots are intentionally OMITTED — the big half
  // paths have those dots cut out as inner subpaths (even-odd fill),
  // so leaving the small-dot fill paths off gives us the negative
  // space the picker spec calls for.
  //
  // The wrapping <g> rotates the artwork 90° CW around its center
  // (117.35, 128). The viewBox is shifted so the rotated bounding
  // box (256 × 234.7) sits flush at origin (-10.65, 10.65).
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10.65 10.65 256 234.7">`
    + `<g transform="rotate(90 117.35 128)">`
    + `<path fill="${topColor}" d="M162.4,18.5C150.9,7.1,134.9,0,117.4,0s-33.4,7.1-45,18.5l-48.1,27.8C9.3,54.9,0,70.9,0,88.2v79.7c0,17.3,9.2,33.2,24.2,41.9h0c13.1,7.5,29.3-2,29.2-17.1v-.6c0-35.4,28.7-64,64-64s64-28.7,64-64-7.3-33.9-19-45.5h0ZM119,87.9c-14.5.9-26.4-11-25.5-25.5.8-11.9,10.4-21.6,22.4-22.4,14.5-.9,26.4,11,25.5,25.5-.8,11.9-10.4,21.6-22.4,22.4Z"/>`
    + `<path fill="${botColor}" d="M72.3,237.5c11.5,11.4,27.4,18.5,45,18.5s33.4-7.1,45-18.5l48.1-27.8c15-8.6,24.2-24.6,24.2-41.9v-79.7c0-17.3-9.2-33.2-24.2-41.9h0c-13.1-7.5-29.3,2-29.2,17.1v.6c0,35.4-28.7,64-64,64s-64,28.7-64,64,7.3,33.9,19,45.5h0ZM115.7,168.1c14.5-.9,26.4,11,25.5,25.5-.8,11.9-10.4,21.6-22.4,22.4-14.5.9-26.4-11-25.5-25.5.8-11.9,10.4-21.6,22.4-22.4Z"/>`
    + `</g>`
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
