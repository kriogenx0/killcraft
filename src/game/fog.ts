// Fog of war per team: 0 unexplored, 1 explored, 2 currently visible.
import { G, hooks, tileOf, unitDef, bldDef, type Ent } from './state.ts';
import { WEAPON } from '../data/weapon.ts';
import { MW, MH, TS } from './const.ts';

export function updFog(): void {
  G.sight.forEach((vis, team) => {
    if (G.reveal) { vis.fill(2); return; }
    // computer players don't need fog, except to aim a gun that reaches past its own sight (Big Bertha)
    if (!G.human[team] && team !== G.viewer && !G.ents.some((e) => !e.dead && e.team === team && outranges(e))) return;
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

/** A finished building with a gun that reaches further than it can see: it fires only at what its side sees. */
function outranges(e: Ent): boolean {
  if (e.kind !== 'bld' || !e.done) return false;
  const d = bldDef(e), w = d.weapon ? WEAPON[d.weapon] : null;
  return !!w && w.range > d.sight;
}
