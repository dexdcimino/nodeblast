// ══════════════════════════════════════
//  NodeBlast — ROUTER
//  Client-side routing via history.pushState
// ══════════════════════════════════════

let _renderRoute = null;

export function getRoute() {
  const path = window.location.pathname;
  if (path === '/' || path === '') return { page: 'feed' };

  const parts = path.split('/').filter(Boolean);
  if (parts.length === 1) return { page: 'profile', username: decodeURIComponent(parts[0]) };
  if (parts.length === 2) {
    return {
      page: 'catalyst',
      username: decodeURIComponent(parts[0]),
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
