// Wood, oil and salvage. Workers chop trees (see chop.ts) and cut trees slowly grow back. Oil Derricks pump oil wells that never refill. Destroyed units and buildings leave
// part of their ore behind for harvesters. Ore fields themselves are in ore.ts.
import { refitBonus } from './refit.ts';
import { G, hooks, type Ent } from './state.ts';
import { MW, MH, TS, TREE, GRASS } from './const.ts';
import { ORE_TILE_MAX } from '../data/ore.ts';
import { UNIT, isUnitType } from '../data/unit.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import {
  DERRICK_REACH, DERRICK_STORE, MILL_RADIUS, OIL_PER_DERRICK, OIL_TRICKLE, SALVAGE_SHARE, TREE_REGROW, TREE_WOOD,
} from '../data/economy.ts';

/** Visit tiles in a rectangle around a footprint (tx, ty, size s), clipped to the map. */
function around(tx: number, ty: number, s: number, r: number, fn: (i: number) => void): void {
  for (let y = Math.max(0, ty - r); y < Math.min(MH, ty + s + r); y++)
    for (let x = Math.max(0, tx - r); x < Math.min(MW, tx + s + r); x++) fn(y * MW + x);
}

/** How many trees are within a mill's reach if it's placed here. */
export function treesNear(tx: number, ty: number, s: number): number {
  let n = 0;
  around(tx, ty, s, MILL_RADIUS, (i) => { if (G.terr[i] === TREE) n++; });
  return n;
}

/** Wood still standing in the trees near a mill. */
export function woodNear(m: Ent): number {
  let w = 0;
  around(m.tx, m.ty, m.w, MILL_RADIUS, (i) => { if (G.terr[i] === TREE) w += G.treeWood[i]; });
  return w;
}

const working = (team: number, type: BldType): Ent[] => G.ents.filter((e) => !e.dead && e.team === team && e.type === type && e.done);

/** Most a derrick holds in store before Workers carry it away. */
export const storeMax = (b: Ent): number => (b.type === 'derrick' ? DERRICK_STORE : 0);

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

/** Oil per second a team's derricks pump into their tanks (dry ones only trickle). */
export const oilRate = (team: number): number => working(team, 'derrick').reduce((n, d) => n + (oilLeft(d) > 0 ? OIL_PER_DERRICK : OIL_TRICKLE), 0);

/**
 * Derricks pump `dt` seconds of oil into their own stores (not the bank: Workers carry it home),
 * stopping when full. Cut trees grow back.
 */
export function collect(dt: number): void {
  if (G.visualOnly) return; // online, the server's stores and trees are the truth
  for (let team = 0; team < G.teams; team++) {
    for (const d of working(team, 'derrick')) {
      const room = DERRICK_STORE - d.carry;
      if (room <= 0) continue; // a full tank stops the pump: the well keeps the rest
      let want = Math.min(OIL_PER_DERRICK * refitBonus(d) * dt, room), got = 0;
      for (const i of wellTiles(d.tx, d.ty, d.w)) {
        if (want <= 0) break;
        const take = Math.min(want, G.oilField[i]);
        G.oilField[i] -= take;
        got += take;
        want -= take;
      }
      // a dry well still seeps a little into the tank
      if (!got) got = Math.min(OIL_TRICKLE * refitBonus(d) * dt, room);
      d.carry += got;
    }
  }
  for (let i = 0; i < MW * MH; i++) if (G.terr[i] === TREE && G.treeWood[i] < TREE_WOOD) G.treeWood[i] = Math.min(TREE_WOOD, G.treeWood[i] + TREE_REGROW * dt);
}

/** Ore a destroyed unit or building leaves behind: a share of its price, plus any ore it carried. */
export function salvageOf(e: Ent): number {
  const price = isUnitType(e.type) ? UNIT[e.type].cost : e.kind === 'bld' ? BUILDING[e.type as BldType].cost : 0;
  return Math.round(price * SALVAGE_SHARE + e.carry + (e.loot ?? 0));
}

/** Scatter a destroyed (or scrapped) thing's salvage as ore on open ground around where it stood. */
export function dropSalvage(e: Ent, amount = salvageOf(e)): void {
  if (G.visualOnly) return; // the server's ore map is the truth online
  let left = amount;
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
    G.scrap[i] = 1;
    if ((left -= put) <= 0) break;
  }
  hooks.oreChanged();
}
