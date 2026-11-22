// Wood and oil income. Lumber Mills cut wood from the trees around them; Oil Derricks pump a
// steady flow of oil. Ore comes from harvesters (see unit.ts and ore.ts).
import { G, type Ent } from './state.ts';
import { MW, MH, TREE } from './const.ts';
import { MILL_MAX_TREES, MILL_RADIUS, OIL_PER_DERRICK, WOOD_PER_TREE } from '../data/economy.ts';

/** Tree tiles within MILL_RADIUS of a footprint (tx, ty, size s). */
export function treesNear(tx: number, ty: number, s: number, into?: Set<number>): number {
  let n = 0;
  for (let y = Math.max(0, ty - MILL_RADIUS); y < Math.min(MH, ty + s + MILL_RADIUS); y++)
    for (let x = Math.max(0, tx - MILL_RADIUS); x < Math.min(MW, tx + s + MILL_RADIUS); x++) {
      const i = y * MW + x;
      if (G.terr[i] !== TREE || into?.has(i)) continue;
      into?.add(i);
      n++;
    }
  return n;
}

const working = (team: number, type: string): Ent[] => G.ents.filter((e) => !e.dead && e.team === team && e.type === type && e.done);

/** Wood per second a team's mills cut. */
export function woodRate(team: number): number {
  const seen = new Set<number>();
  let trees = 0;
  for (const m of working(team, 'mill')) trees += Math.min(MILL_MAX_TREES, treesNear(m.tx, m.ty, m.w, seen));
  return trees * WOOD_PER_TREE;
}

/** Wood per second one mill adds on its own (for its info panel). */
export function millRate(m: Ent): number {
  return Math.min(MILL_MAX_TREES, treesNear(m.tx, m.ty, m.w)) * WOOD_PER_TREE;
}

/** Oil per second a team's derricks pump. */
export const oilRate = (team: number): number => working(team, 'derrick').length * OIL_PER_DERRICK;

/** Add `dt` seconds of wood and oil income to both teams. */
export function collect(dt: number): void {
  for (const team of [0, 1]) {
    G.wood[team] += woodRate(team) * dt;
    G.oil[team] += oilRate(team) * dt;
  }
}
