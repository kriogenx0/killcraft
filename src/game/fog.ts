// Fog of war per team: 0 unexplored, 1 explored (fogged over), 2 visible. With fog set to Reveal, explored
// ground stays at 2; with Regrow, ground a side stops seeing drops back to 1; Off (G.reveal) shows every tile.
import { G, allied, hooks, tileOf, unitDef, bldDef } from './state.ts';
import { UNIT_SIGHT_BOOST } from '../data/unit.ts';
import { MW, MH, TS } from './const.ts';

export function updFog(): void {
  G.sight.forEach((vis, team) => {
    if (G.reveal) { vis.fill(2); return; }
    // every side keeps fog, computers too: what a side has found is all its Workers gather from
    if (G.fog === 'regrow') for (let i = 0; i < MW * MH; i++) if (vis[i] === 2) vis[i] = 1;
    for (const e of G.ents) {
      if (e.dead || e.team < 0 || !allied(e.team, team) || e.kind === 'source') continue;
      const r = e.kind === 'unit' ? unitDef(e).sight * UNIT_SIGHT_BOOST : bldDef(e).sight, cx = e.x / TS, cy = e.y / TS;
      for (let y = Math.floor(cy - r); y <= cy + r; y++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r * r) vis[y * MW + x] = 2;
        }
    }
  });
  G.vis = G.sight[G.viewer] ?? G.sight[0];
  hooks.fogUpdated();
}

/** Has this side found tile i (seen it at least once)? With fog Off every tile counts as found. */
export function found(team: number, i: number): boolean {
  if (G.reveal) return true;
  const s = G.sight[team];
  return !s || s[i] > 0;
}

export const seenAt = (x: number, y: number): boolean => G.vis[tileOf(y) * MW + tileOf(x)] === 2;
export const exploredAt = (x: number, y: number): boolean => G.vis[tileOf(y) * MW + tileOf(x)] > 0;
