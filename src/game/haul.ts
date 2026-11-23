// Carrying resources home. Nothing is banked until a unit brings it back: harvesters and Workers
// unload ore and oil at a Refinery or the Town Hall, and wood there or at a Lumber Mill; units bank the
// Aether they carry by coming near one of those.
import { G, type Ent } from './state.ts';
import type { BldType } from '../data/building.ts';
import { edgeDist } from './path.ts';

/** The nearest of the unit's own finished buildings of these types. */
export function bankAt(u: Ent, types: BldType[]): Ent | null {
  let best: Ent | null = null, bd = Infinity;
  for (const e of G.ents)
    if (!e.dead && e.team === u.team && e.done && types.includes(e.type as BldType)) {
      const d = edgeDist(u, e);
      if (d < bd) { bd = d; best = e; }
    }
  return best;
}
