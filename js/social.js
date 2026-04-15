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
    id: 'tiktok',
    label: 'TikTok',
    match: (u) => /tiktok\.com/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.44a8.16 8.16 0 004.77 1.53V7.56a4.85 4.85 0 01-1.01-.87z"/></svg>',
  },
  {
    id: 'facebook',
    label: 'Facebook',
    match: (u) => /facebook\.com|fb\.com/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
  },
  {
    id: 'twitch',
    label: 'Twitch',
    match: (u) => /twitch\.tv/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>',
  },
  {
    id: 'discord',
    label: 'Discord',
    match: (u) => /discord\.(gg|com)/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    match: (u) => /reddit\.com/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.249-.561 1.249-1.249 0-.688-.562-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.249-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 00.029-.463.33.33 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.095z"/></svg>',
  },
  {
    id: 'dexnote',
    label: 'DexNote',
    match: (u) => /dexnote\.(dev|vercel\.app)/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L19.82 8 12 12.82 4.18 8 12 4.18zM4 9.64l7 3.5V19.5l-7-3.5V9.64zm16 0v6.36l-7 3.5v-6.36l7-3.5z"/></svg>',
  },
  {
    id: 'nodeblast',
    label: 'NodeBlast',
    match: (u) => /nodeblast\.(dev|vercel\.app)/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/></svg>',
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    match: (u) => /pinterest\.(com|co)/i.test(u),
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641 0 12.017 0z"/></svg>',
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
