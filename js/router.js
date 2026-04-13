// ══════════════════════════════════════
//  NodeBlast — ROUTER
//  Client-side routing via history.pushState
// ══════════════════════════════════════

let _renderRoute = null;

// Parse "dex.1199ff" → { username: "dex", hex: "1199ff" }
// Parse "dex"         → { username: "dex", hex: null }         (backwards compat)
// Parse "dex.dev.1199ff" → { username: "dex.dev", hex: "1199ff" }
//
// Matches the LAST dot followed by exactly 6 hex chars, so names
// that legitimately contain dots (admin ".dev" badge, etc.) still
// parse correctly.
export function parseUserSlug(slug) {
  const match = (slug || '').match(/^(.+)\.([0-9a-fA-F]{6})$/);
  if (match) {
    return { username: match[1], hex: match[2].toLowerCase() };
  }
  return { username: slug || '', hex: null };
}

export function buildUserSlug(username, hex) {
  const name = (username || '').toLowerCase();
  if (!hex) return encodeURIComponent(name);
  return encodeURIComponent(name + '.' + hex.toLowerCase());
}

export function getRoute() {
  const path = window.location.pathname;
  if (path === '/' || path === '') return { page: 'feed' };
  if (path === '/play') return { page: 'play' };
  if (path === '/games') return { page: 'games' };

  const parts = path.split('/').filter(Boolean);

  if (parts.length === 1) {
    const parsed = parseUserSlug(decodeURIComponent(parts[0]));
    return { page: 'profile', username: parsed.username, hex: parsed.hex };
  }
  if (parts.length === 2) {
    const parsed = parseUserSlug(decodeURIComponent(parts[0]));
    return {
      page: 'catalyst',
      username: parsed.username,
      hex: parsed.hex,
      slug: decodeURIComponent(parts[1]),
    };
  }
  return { page: 'feed' };
}

export function navigate(path, { replace = false } = {}) {
  if (window.location.pathname === path) return;
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  if (_renderRoute) _renderRoute();
}

export function initRouter(renderFn) {
  _renderRoute = renderFn;
  window.addEventListener('popstate', () => {
    if (_renderRoute) _renderRoute();
  });

  // Intercept link clicks that target internal routes so we don't force a full reload
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('mailto:')) return;
    e.preventDefault();
    navigate(href);
  });
}

export function setPageTitle(parts) {
  const base = 'nodeblast';
  if (!parts || parts.length === 0) {
    document.title = base;
  } else {
    document.title = parts.join(' — ') + ' — ' + base;
  }
}
