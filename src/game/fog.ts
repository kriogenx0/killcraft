// Fog of war per team: 0 unexplored, 1 explored, 2 currently visible.
import { G, hooks, tileOf, unitDef, bldDef } from './state.ts';
import { MW, MH, TS } from './const.ts';

export function updFog(): void {
  G.sight.forEach((vis, team) => {
    if (G.reveal) { vis.fill(2); return; }
    if (!G.human[team] && team !== G.viewer) return; // computer players don't need fog
    for (let i = 0; i < MW * MH; i++) if (vis[i] === 2) vis[i] = 1;
    for (const e of G.ents) {
      if (e.dead || e.team !== team || e.kind === 'source') continue;
      const r = e.kind === 'unit' ? unitDef(e).sight : bldDef(e).sight, cx = e.x / TS, cy = e.y / TS;
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

export const seenAt = (x: number, y: number): boolean => G.vis[tileOf(y) * MW + tileOf(x)] === 2;
export const exploredAt = (x: number, y: number): boolean => G.vis[tileOf(y) * MW + tileOf(x)] > 0;
