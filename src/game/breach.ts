// Walls are only attacked when they must be: when enemy walls are all that stand between a unit and
// where it's going. Target picking (combat.ts) skips walls; this finds the one to break through.
import { G, isAir, tileOf, unitDef, type Ent } from './state.ts';
import { MW } from './const.ts';
import { isWall } from '../data/building.ts';
import { WEAPON } from '../data/weapon.ts';
import { findPath, pathReached } from './path.ts';

/** Can this unit knock down a wall at all? */
export function canBreach(u: Ent): boolean {
  const w = unitDef(u).weapon;
  return !!w && !isAir(u) && u.stance === 'engage' && WEAPON[w].vs.building > 0;
}

/** An enemy wall standing on a tile, if any. */
export function enemyWallAt(team: number, tx: number, ty: number): Ent | null {
  return G.ents.find((e) => !e.dead && e.kind === 'bld' && e.team !== team && e.team >= 0 && e.tx === tx && e.ty === ty && isWall(e.type)) ?? null;
}

/**
 * The enemy wall a unit has to break to reach a tile it can't otherwise get to: the first one on the
 * route it would take if enemy walls weren't there. Null when there's no such route (water, cliffs,
 * its own walls) or no enemy wall is in the way.
 */
export function wallInWay(u: Ent, gx: number, gy: number): Ent | null {
  const walls = G.ents.filter((e) => !e.dead && e.kind === 'bld' && e.team !== u.team && e.team >= 0 && isWall(e.type));
  if (!walls.length) return null;
  findPath(tileOf(u.x), tileOf(u.y), gx, gy, u.team);
  if (pathReached) return null; // there's a way round
  const at = new Map<number, Ent>();
  for (const w of walls) { at.set(w.ty * MW + w.tx, w); G.blk[w.ty * MW + w.tx] = 0; }
  let path;
  try {
    path = findPath(tileOf(u.x), tileOf(u.y), gx, gy, u.team);
  } finally {
    for (const i of at.keys()) G.blk[i] = 1;
  }
  if (!pathReached) return null;
  for (const [x, y] of path) {
    const w = at.get(y * MW + x);
    if (w) return w;
  }
  return null;
}
