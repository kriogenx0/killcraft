// Carrying resources home. Nothing is banked until a unit brings it back: harvesters and Workers
// unload ore and oil at a Refinery, a Mining Camp or any Town Hall, and wood at a Town Hall, Refinery
// or Lumber Mill; units bank the Aether they carry by coming near a Town Hall or Refinery. Each load
// goes to the nearest one, so an expansion by far ore shortens the trips.
import { G, type Ent } from './state.ts';
import type { BldType } from '../data/building.ts';
import { edgeDist } from './path.ts';

/** Where ore and oil are dropped off. */
export const ORE_BANKS: BldType[] = ['refinery', 'yard', 'camp'];

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

/** All the team's finished buildings of these types. */
export const banksOf = (team: number, types: readonly BldType[]): Ent[] =>
  G.ents.filter((e) => !e.dead && e.team === team && e.done && types.includes(e.type as BldType));
