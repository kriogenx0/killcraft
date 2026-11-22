// Wood, oil and salvage. Lumber Mills cut wood from the trees around them, and cut trees slowly
// grow back. Oil Derricks pump oil wells that never refill. Destroyed units and buildings leave
// part of their ore behind for harvesters. Ore fields themselves are in ore.ts.
import { G, hooks, type Ent } from './state.ts';
import { MW, MH, TS, TREE, GRASS } from './const.ts';
import { ORE_TILE_MAX } from '../data/ore.ts';
import { UNIT, isUnitType } from '../data/unit.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import {
  DERRICK_REACH, MILL_MAX_TREES, MILL_RADIUS, OIL_PER_DERRICK, SALVAGE_SHARE, TREE_REGROW, TREE_WOOD, WOOD_PER_TREE,
} from '../data/economy.ts';

/** Visit tiles in a rectangle around a footprint (tx, ty, size s), clipped to the map. */
function around(tx: number, ty: number, s: number, r: number, fn: (i: number) => void): void {
  for (let y = Math.max(0, ty - r); y < Math.min(MH, ty + s + r); y++)
    for (let x = Math.max(0, tx - r); x < Math.min(MW, tx + s + r); x++) fn(y * MW + x);
}

/** Tree tiles a mill at (tx, ty, size s) would reach, nearest first, at most MILL_MAX_TREES. */
function millTrees(tx: number, ty: number, s: number): number[] {
  const cx = tx + s / 2, cy = ty + s / 2, list: number[] = [];
  around(tx, ty, s, MILL_RADIUS, (i) => { if (G.terr[i] === TREE) list.push(i); });
  const d = (i: number) => Math.hypot((i % MW) + 0.5 - cx, ((i / MW) | 0) + 0.5 - cy);
  return list.sort((a, b) => d(a) - d(b)).slice(0, MILL_MAX_TREES);
}

/** How many trees a mill placed here would work. */
export const treesNear = (tx: number, ty: number, s: number): number => millTrees(tx, ty, s).length;

const working = (team: number, type: BldType): Ent[] => G.ents.filter((e) => !e.dead && e.team === team && e.type === type && e.done);

/** The trees each of a team's mills cuts. A tree two mills could reach is cut by the first only. */
function teamTrees(team: number): number[] {
  const seen = new Set<number>();
  for (const m of working(team, 'mill')) for (const i of millTrees(m.tx, m.ty, m.w)) seen.add(i);
  return [...seen];
}

/** A tree with wood left is cut at the full rate; a cut-down one only gives what grows back. */
const cutRate = (i: number): number => (G.treeWood[i] >= WOOD_PER_TREE ? WOOD_PER_TREE : Math.min(WOOD_PER_TREE, TREE_REGROW));

/** Wood per second a team's mills cut right now (slower once their trees are cut down). */
export const woodRate = (team: number): number => teamTrees(team).reduce((s, i) => s + cutRate(i), 0);

/** Wood per second one mill cuts on its own (for its info panel). */
export const millRate = (m: Ent): number => millTrees(m.tx, m.ty, m.w).reduce((s, i) => s + cutRate(i), 0);

/** Oil tiles a derrick at (tx, ty, size s) reaches. */
function wellTiles(tx: number, ty: number, s: number): number[] {
  const list: number[] = [];
  around(tx, ty, s, DERRICK_REACH, (i) => { if (G.oilField[i] > 0) list.push(i); });
  return list;
}

/** Oil left in the ground within reach of a derrick placed here. */
export const oilNear = (tx: number, ty: number, s: number): number => wellTiles(tx, ty, s).reduce((sum, i) => sum + G.oilField[i], 0);

/** Oil left in reach of a derrick. */
export const oilLeft = (d: Ent): number => oilNear(d.tx, d.ty, d.w);

/** Oil per second a team's derricks pump (dry ones pump nothing). */
export const oilRate = (team: number): number => working(team, 'derrick').filter((d) => oilLeft(d) > 0).length * OIL_PER_DERRICK;

/** Add `dt` seconds of wood and oil income to both teams, and let cut trees grow back. */
export function collect(dt: number): void {
  for (let team = 0; team < G.teams; team++) {
    for (const i of teamTrees(team)) {
      const cut = Math.min(G.treeWood[i], WOOD_PER_TREE * dt);
      G.treeWood[i] -= cut;
      G.wood[team] += cut;
    }
    for (const d of working(team, 'derrick')) {
      let want = OIL_PER_DERRICK * dt;
      for (const i of wellTiles(d.tx, d.ty, d.w)) {
        const take = Math.min(want, G.oilField[i]);
        G.oilField[i] -= take;
        G.oil[team] += take;
        if ((want -= take) <= 0) break;
      }
    }
  }
  for (let i = 0; i < MW * MH; i++) if (G.terr[i] === TREE && G.treeWood[i] < TREE_WOOD) G.treeWood[i] = Math.min(TREE_WOOD, G.treeWood[i] + TREE_REGROW * dt);
}

/** Ore a destroyed unit or building leaves behind: a share of its price, plus any ore it carried. */
export function salvageOf(e: Ent): number {
  const price = isUnitType(e.type) ? UNIT[e.type].cost : e.kind === 'bld' ? BUILDING[e.type as BldType].cost : 0;
  return Math.round(price * SALVAGE_SHARE + e.carry);
}

/** Scatter a destroyed thing's salvage as ore on open ground around where it stood. */
export function dropSalvage(e: Ent): void {
  if (G.visualOnly) return; // the server's ore map is the truth online
  let left = salvageOf(e);
  if (left <= 0) return;
  const cx = Math.floor(e.x / TS), cy = Math.floor(e.y / TS), size = Math.max(1, e.w);
  const tiles: number[] = [];
  around(cx - Math.floor(size / 2), cy - Math.floor(size / 2), size, 2, (i) => { if (G.terr[i] === GRASS && !G.blk[i]) tiles.push(i); });
  const d = (i: number) => Math.hypot((i % MW) - cx, ((i / MW) | 0) - cy);
  tiles.sort((a, b) => d(a) - d(b));
  // spread it evenly over the nearest tiles, a little on each
  const share = Math.max(40, Math.ceil(left / Math.max(1, Math.min(tiles.length, size * size + 4))));
  for (const i of tiles) {
    const put = Math.min(left, share, ORE_TILE_MAX - G.ore[i]);
    if (put <= 0) continue;
    G.ore[i] += put;
    if ((left -= put) <= 0) break;
  }
  hooks.oreChanged();
}
