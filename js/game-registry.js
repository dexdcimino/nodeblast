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
