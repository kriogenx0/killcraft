// Fog of war per team: 0 unexplored, 1 explored (fogged over), 2 visible. With fog set to Reveal, explored
// ground stays at 2; with Regrow, ground a side stops seeing drops back to 1; Off (G.reveal) shows every tile.
import { G, allied, hooks, tileOf, unitDef, bldDef, type Ent } from './state.ts';
import { WEAPON } from '../data/weapon.ts';
import { UNIT_SIGHT_BOOST } from '../data/unit.ts';
import { MW, MH, TS } from './const.ts';

export function updFog(): void {
  G.sight.forEach((vis, team) => {
    if (G.reveal) { vis.fill(2); return; }
    // computer players don't need fog, except to aim a gun that reaches past its own sight (Big Bertha),
    // or when a person plays on their side: allies share what they see
    const mates = Array.from({ length: G.teams }, (_, t) => t).filter((t) => allied(t, team));
    if (!mates.some((t) => G.human[t] || t === G.viewer) && !G.ents.some((e) => !e.dead && e.team === team && outranges(e))) return;
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

export const seenAt = (x: number, y: number): boolean => G.vis[tileOf(y) * MW + tileOf(x)] === 2;
export const exploredAt = (x: number, y: number): boolean => G.vis[tileOf(y) * MW + tileOf(x)] > 0;

/**
 * A finished building or a unit with a gun that reaches further than it can see (Big Bertha, the
 * Artillery Tank): it fires only at what its side sees, so even a computer side needs a sight map.
 */
function outranges(e: Ent): boolean {
  if (e.kind === 'unit') { const d = unitDef(e), w = d.weapon ? WEAPON[d.weapon] : null; return !!w && w.range > d.sight; }
  if (e.kind !== 'bld' || !e.done) return false;
  const d = bldDef(e), w = d.weapon ? WEAPON[d.weapon] : null;
  return !!w && w.range > d.sight;
}
