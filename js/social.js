// ══════════════════════════════════════════════════════════════
//  NodeBlast — SOCIAL LINKS
//  Shared registry + helpers for the user-configurable social
//  links list. Everything UI-facing (icons, platform detection,
//  normalization, render helpers) lives here so the edit panel,
//  profile bar, and community cards all read from one source.
//
//  Storage shape: users/{uid}.socialLinks is an array of objects:
//    { platform: 'github' | 'linkedin' | ... , url: 'https://...' }
//  The prefs subdoc (users/{uid}/prefs/profile.socialLinks) mirrors
//  the same shape for cross-site sync with DexNote.
// ══════════════════════════════════════════════════════════════

// Platform registry. `id` is the stored enum value, `label` is the
// dropdown label, `match` is a function that returns true if the raw
// URL belongs to this platform (used by auto-detect), and `svg` is
// the inline icon markup we drop into the DOM.
//
// Icons are trimmed to 24x24 viewBox so they share rendering logic
// with the rest of the app's SVG UI.
export const SOCIAL_PLATFORMS = [
  {
    id: 'github',
    label: 'GitHub',
    match: (u) => /github\.com/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.2 11.39.6.1.82-.26.82-.58v-2.03c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.82 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.16 0 0 1-.32 3.3 1.23.96-.27 1.98-.4 3-.41 1.02.01 2.04.14 3 .41 2.3-1.55 3.3-1.23 3.3-1.23.65 1.64.24 2.86.12 3.16.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.47 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.58C20.57 22.3 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z"/></svg>',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    match: (u) => /linkedin\.com/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/></svg>',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    match: (u) => /(youtube\.com|youtu\.be)/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.5 6.2c-.3-1-1.1-1.9-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5c-1 .3-1.8 1.1-2.1 2.1C0 8.1 0 12 0 12s0 3.9.5 5.8c.3 1 1.1 1.9 2.1 2.1 1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5c1-.3 1.9-1.1 2.1-2.1.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    match: (u) => /instagram\.com/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
  },
  {
    id: 'x',
    label: 'X / Twitter',
    match: (u) => /(^|\.)x\.com|twitter\.com/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  },
  {
    id: 'email',
    label: 'Email',
    match: (u) => /^mailto:|^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  },
  {
    id: 'website',
    label: 'Website / Other',
    // Catch-all — checked last via detectPlatform's fallback.
    match: () => true,
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  },
];

const PLATFORM_BY_ID = Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p.id, p]));

// Auto-detect platform from a raw URL string. Iterates through the
// registry in declaration order; 'website' is the catch-all at the end.
// A bare email like "dex@example.com" resolves to 'email'.
export function detectPlatform(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) return 'website';
  for (const p of SOCIAL_PLATFORMS) {
    if (p.id === 'website') continue; // skip catch-all until nothing matches
    if (p.match(url)) return p.id;
  }
  return 'website';
}

// Normalize a URL for clickable use:
//   - Emails get a mailto: prefix unless they already have one.
//   - Other platforms get https:// prepended if no scheme is present.
//   - Empty/invalid → empty string.
export function normalizeLink(platform, rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  if (platform === 'email') {
    return url.toLowerCase().startsWith('mailto:') ? url : 'mailto:' + url;
  }
  if (/^https?:\/\//i.test(url)) return url;
  return 'https://' + url;
}

export function getPlatformLabel(id) {
  return PLATFORM_BY_ID[id]?.label || 'Website';
}

export function getPlatformSvg(id) {
  return PLATFORM_BY_ID[id]?.svg || PLATFORM_BY_ID.website.svg;
}

// Render a row of clickable social-link icons as an HTML string.
// `links` is the stored array shape. Classes are namespaced so the
// caller controls sizing via CSS (small on profile bar, tiny on cards).
// Any link that can't be normalized (empty URL) is skipped.
export function renderSocialIconsHTML(links, { extraClass = '' } = {}) {
  if (!Array.isArray(links) || links.length === 0) return '';
  const items = [];
  for (const link of links) {
    const platform = link?.platform || detectPlatform(link?.url);
    const href = normalizeLink(platform, link?.url);
    if (!href) continue;
    const label = getPlatformLabel(platform);
    const svg = getPlatformSvg(platform);
    const safeHref = href.replace(/"/g, '&quot;');
    items.push(
      `<a class="social-icon" href="${safeHref}" target="_blank" rel="noopener" data-platform="${platform}" data-tip="${label}" aria-label="${label}">${svg}</a>`,
    );
  }
  if (items.length === 0) return '';
  const cls = 'social-icons' + (extraClass ? ' ' + extraClass : '');
  return `<div class="${cls}">${items.join('')}</div>`;
}

// Clean + validate an array of link objects before persistence. Drops
// anything without a usable URL, trims strings, and hard-caps the
// list length at 8 (spec max).
export function sanitizeSocialLinks(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const url = (entry.url || '').toString().trim();
    if (!url) continue;
    const platform = entry.platform || detectPlatform(url);
    out.push({ platform, url });
    if (out.length >= 8) break;
  }
  return out;
}

export const MAX_SOCIAL_LINKS = 8;
