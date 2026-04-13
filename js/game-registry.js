// ══════════════════════════════════════
//  NodeBlast — GAME REGISTRY
//  Single source of truth for all internal games.
//  To add a new game: add an entry here. Nothing else needs updating.
// ══════════════════════════════════════

export const GAME_REGISTRY = [
  {
    id: 'arena_1',
    name: 'NodeBlast: Arena 1',
    description: 'First-person shooter. Fast movement, 4 weapons, multiplayer.',
    badge: '🎮',
    color: '#00ff8c',
    status: 'live',
    launchMode: 'route',
    route: '/play',
  },
  {
    id: 'dot_sim',
    name: 'Dot-Sim',
    description: 'Agent-based life simulator. Hatch dots, tune their traits, watch tribes emerge.',
    badge: '◈',
    color: '#a78bfa',
    status: 'beta',
    launchMode: 'modal',
    modalFn: 'openDotSim',
  },
];

export function getGame(id) {
  return GAME_REGISTRY.find(g => g.id === id) ?? null;
}

export function getLiveGames() {
  return GAME_REGISTRY.filter(g => g.status !== 'coming_soon');
}

// ── Future: Dynamic / User-Hosted Games ──────────────────────────────────────
//
// When the dev platform ships, user-created game catalysts will have a
// `sourceUrl` pointing to their hosted game module JS file.
//
// The launch flow will be:
//   1. Catalyst click → read cat.sourceUrl
//   2. If sourceUrl is set → dynamically import(sourceUrl) in a sandboxed iframe
//   3. The module must export: { init(canvas, config), destroy(), getStats() }
//      (same interface as dot-sim.js public API)
//   4. If sourceUrl is absent → fall back to GAME_REGISTRY launchMode
//
// Security: sourceUrl modules run in a sandboxed iframe with no access to
// parent window, Firebase, or user data. They communicate back via postMessage.
//
// To add a new first-party game: add an entry to GAME_REGISTRY above.
// To support user games: implement the iframe sandbox loader (future sprint).
// ─────────────────────────────────────────────────────────────────────────────
