// Lookups for the nearest useful thing.
import { G, type Ent } from './state.ts';
import type { BldType } from '../data/building.ts';
import { edgeDist } from './path.ts';

/** Nearest finished building of a type owned by the unit's team. */
export function nearestOwn(u: Ent, type: BldType): Ent | null {
  let best: Ent | null = null, bd = 1e9;
  for (const e of G.ents)
    if (!e.dead && e.team === u.team && e.type === type && e.done) {
      const d = edgeDist(u, e);
      if (d < bd) { bd = d; best = e; }
    }
  return best;
}
