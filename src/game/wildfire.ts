// Forest fires (data/wildfire.ts). A fire attack or a meteor-shower stone landing by the woods now and
// then sets a tree alight. It burns down to a stump over TREE_BURN seconds, may catch the trees
// beside it, and singes anyone standing against it; rain puts it out. The stump grows back like any
// cut tree (economy.ts collect). The server runs it online and sends the burning trees with the
// weather (weatherSnap); a client only shows them.
import { G, isAir, unitDef } from './state.ts';
import { MH, MW, TREE, TS } from './const.ts';
import { TREE_WOOD } from '../data/economy.ts';
import { RAIN_DOUSE } from '../data/weather.ts';
import {
  CATCH_REACH, RAIN_DAMP, SINGE_REACH, TREE_BURN, TREE_FIRE_CAP, TREE_FUEL, TREE_SINGE, TREE_SPREAD,
} from '../data/wildfire.ts';
import { applyElement } from './spells.ts';

/**
 * Forest fires' own dice (mulberry32, kept in G.wildfire so a saved game carries on the same): they
 * never take numbers from Math.random, so a seeded match away from the woods plays out as before.
 */
function rnd(): number {
  const w = G.wildfire;
  w.dice = (w.dice + 0x6d2b79f5) | 0;
  let t = Math.imul(w.dice ^ (w.dice >>> 15), 1 | w.dice);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Seconds between checks for fire spreading and singeing (the burning itself runs every step). */
const TICK = 0.5;

/** No trees burning, for a new match. */
export function initWildfire(seed = G.seed): void {
  G.treeFire.fill(0);
  G.wildfire = { burning: [], dice: (seed ^ 0x5f1e3a) | 0, acc: 0 };
}

/** Is this tree tile on fire? */
export const treeBurning = (i: number): boolean => G.treeFire[i] > 0;

/** Can this tile catch fire: a tree with wood enough on it, not already burning? */
const fuel = (i: number): boolean => G.terr[i] === TREE && G.treeWood[i] >= TREE_FUEL && !(G.treeFire[i] > 0);

/** Set a tree alight. */
export function lightTree(i: number): boolean {
  if (!fuel(i) || G.wildfire.burning.length >= TREE_FIRE_CAP) return false;
  G.treeFire[i] = TREE_BURN;
  G.wildfire.burning.push(i);
  return true;
}

/**
 * Fire lands at (x, y) px with a blast of radius r px: if there are trees within reach, it sets
 * one of them alight (the nearest) with the given chance. The server decides; clients only watch.
 */
export function sparkTrees(x: number, y: number, r: number, chance: number): boolean {
  if (G.visualOnly || chance <= 0) return false;
  const reach = r + CATCH_REACH * TS, cx = Math.floor(x / TS), cy = Math.floor(y / TS), n = Math.ceil(reach / TS) + 1;
  let best = -1, bestD = Infinity;
  for (let ty = Math.max(0, cy - n); ty <= Math.min(MH - 1, cy + n); ty++)
    for (let tx = Math.max(0, cx - n); tx <= Math.min(MW - 1, cx + n); tx++) {
      const i = ty * MW + tx;
      if (!fuel(i)) continue;
      // to the nearest point of the tree's tile
      const dx = Math.max(tx * TS - x, 0, x - (tx + 1) * TS), dy = Math.max(ty * TS - y, 0, y - (ty + 1) * TS), d = Math.hypot(dx, dy);
      if (d <= reach && d < bestD) { best = i; bestD = d; }
    }
  // the dice are only thrown when there's a tree to catch, so fighting in the open changes nothing
  if (best < 0 || rnd() >= chance) return false;
  return lightTree(best);
}

const NEAR: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 0.5], [1, -1, 0.5], [-1, 1, 0.5], [-1, -1, 0.5]];

/** Advance the forest fires by one step. */
export function updWildfire(dt: number): void {
  const w = G.wildfire;
  if (!w?.burning.length) return;
  if (G.visualOnly) { for (const i of w.burning) G.treeFire[i] = Math.max(0.05, G.treeFire[i] - dt); return; } // shown until the server says it's out
  const rain = G.weather?.rain ?? 0;
  if (rain >= RAIN_DOUSE) { for (const i of w.burning) G.treeFire[i] = 0; w.burning = []; return; } // a downpour puts the woods out
  // each tree burns its wood away, down to a charred stump
  const burn = (TREE_WOOD / TREE_BURN) * dt;
  for (const i of w.burning) {
    G.treeFire[i] = Math.max(0, G.treeFire[i] - dt);
    G.treeWood[i] = G.treeFire[i] > 0 && G.terr[i] === TREE ? Math.max(0, G.treeWood[i] - burn) : 0;
    if (G.terr[i] !== TREE) G.treeFire[i] = 0; // felled or cleared from under the flames
  }
  w.acc += dt;
  if (w.acc >= TICK) {
    w.acc -= TICK;
    const damp = rain > 0.05 ? RAIN_DAMP : 1;
    for (const i of w.burning.slice()) {
      if (!(G.treeFire[i] > 0)) continue;
      const tx = i % MW, ty = (i / MW) | 0;
      for (const [dx, dy, k] of NEAR) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
        const j = ny * MW + nx;
        if (fuel(j) && rnd() < TREE_SPREAD * k * damp * TICK) lightTree(j);
      }
    }
    singe();
  }
  w.burning = w.burning.filter((i) => G.treeFire[i] > 0);
}

/** Soldiers, creatures and vehicles standing against a burning tree may catch fire too. */
function singe(): void {
  const reach = SINGE_REACH * TS;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || isAir(e)) continue;
    const tx = Math.floor(e.x / TS), ty = Math.floor(e.y / TS), r = reach + unitDef(e).radius;
    let near = false;
    for (let y = ty - 1; y <= ty + 1 && !near; y++)
      for (let x = tx - 1; x <= tx + 1 && !near; x++) {
        if (x < 0 || y < 0 || x >= MW || y >= MH || !(G.treeFire[y * MW + x] > 0)) continue;
        near = Math.hypot((x + 0.5) * TS - e.x, (y + 0.5) * TS - e.y) <= r;
      }
    if (near && rnd() < TREE_SINGE * TICK) applyElement(e, 'fire', null);
  }
}

/** The burning trees as a snapshot sends them: [tile, seconds left * 10, ...]. */
export const wildfireSnap = (): number[] | undefined =>
  G.wildfire?.burning.length ? G.wildfire.burning.flatMap((i) => [i, Math.round(G.treeFire[i] * 10)]) : undefined;

/** A client takes the server's forest fires: a tree that was burning and no longer is has burnt down. */
export function applyWildfireSnap(f: number[] | undefined): void {
  const w = G.wildfire, now = new Set<number>();
  for (let k = 0; k + 1 < (f?.length ?? 0); k += 2) { const i = f![k]; if (i >= 0 && i < MW * MH) { now.add(i); G.treeFire[i] = Math.max(0.05, f![k + 1] / 10); } }
  for (const i of w.burning) if (!now.has(i)) { G.treeFire[i] = 0; G.treeWood[i] = G.weather.rain >= RAIN_DOUSE ? G.treeWood[i] : 0; }
  w.burning = [...now];
}
