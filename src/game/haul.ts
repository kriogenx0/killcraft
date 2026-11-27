// Carrying resources home. Nothing is banked until a unit brings it back: harvesters and Workers
// unload ore and oil at a Refinery, a Resource Drop or any Town Hall, and wood at a Town Hall,
// Refinery, Resource Drop or Lumber Mill; units bank the Aether they carry by coming near a Town
// Hall, Refinery or Resource Drop. Each load goes to the nearest one by walking (round cliffs,
// water and buildings), so an expansion by far ore shortens the trips.
import { G, type Ent } from './state.ts';
import type { BldType } from '../data/building.ts';
import { edgeDist } from './path.ts';
import { walkDist } from './ore.ts';
import { MH, MW, TS } from './const.ts';

/** Where ore and oil are dropped off. */
export const ORE_BANKS: BldType[] = ['refinery', 'yard', 'camp'];

/** Where Aether is banked. */
export const AETHER_BANKS: BldType[] = ['yard', 'refinery', 'camp'];

/** The nearest (straight line) of the unit's own finished buildings of these types. */
export function bankAt(u: Ent, types: readonly BldType[]): Ent | null {
  let best: Ent | null = null, bd = Infinity;
  for (const e of G.ents)
    if (!e.dead && e.team === u.team && e.done && types.includes(e.type as BldType)) {
      const d = edgeDist(u, e);
      if (d < bd) { bd = d; best = e; }
    }
  return best;
}

/** Walking distances from each drop-off, kept a couple of seconds (woods and buildings change slowly). */
const walks = new Map<number, { t: number; d: Float32Array }>();
export function walkFrom(home: Ent): Float32Array {
  const c = walks.get(home.id);
  if (c && G.gameT >= c.t && G.gameT - c.t < 2) return c.d;
  if (walks.size > 64) walks.clear();
  const d = walkDist([home]);
  walks.set(home.id, { t: G.gameT, d });
  return d;
}

/**
 * The drop-off of these types the unit can walk to soonest: the one by it in tiles of walk, not as
 * the crow flies (a Resource Drop across a river is no help). Straight-line nearest when it can
 * reach none of them from where it stands (wedged in a crowd, say).
 */
export function dropAt(u: Ent, types: readonly BldType[]): Ent | null {
  const homes = banksOf(u.team, types);
  if (homes.length < 2) return homes[0] ?? null;
  const tx = Math.min(MW - 1, Math.max(0, Math.floor(u.x / TS))), ty = Math.min(MH - 1, Math.max(0, Math.floor(u.y / TS)));
  let best: Ent | null = null, bd = Infinity;
  for (const h of homes) {
    // standing beside it already
    if (edgeDist(u, h) <= TS) return h;
    const d = walkFrom(h)[ty * MW + tx];
    if (d < bd) { bd = d; best = h; }
  }
  return best ?? bankAt(u, types);
}

/** All the team's finished buildings of these types. */
export const banksOf = (team: number, types: readonly BldType[]): Ent[] =>
  G.ents.filter((e) => !e.dead && e.team === team && e.done && types.includes(e.type as BldType));
