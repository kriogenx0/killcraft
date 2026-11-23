// Chopping wood. A Worker on a wood run walks to a tree, chops a load and carries it to the nearest
// Lumber Mill, Refinery or Town Hall (see unit.ts for the trip home); nothing is banked
// until it's dropped off. Workers spread over the trees, one to a tree while there are enough.
import { G, valid, type Ent, type HarvestOrder, type Target } from './state.ts';
import { GRASS, MH, MW, TREE, TS } from './const.ts';
import { approach, turnToward } from './move.ts';
import { bankAt } from './haul.ts';
import { part } from './fx.ts';
import { CHOP_RATE, CHOP_WORTH, MILL_RADIUS, WOOD_LOAD } from '../data/economy.ts';

/** Where a Worker drops off wood. */
export const WOOD_BANKS = ['mill', 'refinery', 'yard'] as const;

/** How close (px, from the tree's edge) a Worker has to stand to chop: anywhere on a tile touching it, corners included. */
const CHOP_REACH = TS * 0.75;

/** Most wood a unit carries. */
export const woodLoad = (_u: Ent): number => WOOD_LOAD;

/** A tree tile as something to walk up to. */
const treeTarget = (i: number): Target => {
  const tx = i % MW, ty = (i / MW) | 0;
  return { tx, ty, w: 1, h: 1, x: (tx + 0.5) * TS, y: (ty + 0.5) * TS };
};

/** A tree a Worker can stand next to (not deep inside a wood). */
function reachable(i: number): boolean {
  const x = i % MW, y = (i / MW) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < MW && ny < MH && !G.blk[ny * MW + nx]) return true;
  }
  return false;
}

/** Trees each Worker found it couldn't walk up to; forgotten once it chops. */
const cantReach = new WeakMap<Ent, Set<number>>();
function giveUpOn(u: Ent, i: number): void {
  let bad = cantReach.get(u);
  if (!bad || bad.size > 32) cantReach.set(u, (bad = new Set()));
  bad.add(i);
}

/** How many of the team's other choppers are working or heading for this tree. */
function choppersAt(i: number, u: Ent): number {
  let n = 0;
  for (const e of G.ents)
    if (e !== u && !e.dead && e.team === u.team && e.order?.t === 'harvest' && e.order.res === 'wood' && e.order.ty * MW + e.order.tx === i && e.order.st !== 'ret' && e.order.st !== 'unload') n++;
  return n;
}

/** Tiles from (x, y) to the nearest tile of a footprint (0 on it). */
const tilesTo = (x: number, y: number, f: { tx: number; ty: number; w: number; h: number }): number =>
  Math.hypot(Math.max(f.tx - x, 0, x - (f.tx + f.w - 1)), Math.max(f.ty - y, 0, y - (f.ty + f.h - 1)));

/**
 * The tree with wood worth chopping within r tiles of (cx, cy) that is closest to `home` (a
 * drop-off, so trips stay short; (cx, cy) itself if none), preferring ones nobody else is on.
 */
export function nearestTree(u: Ent, cx: number, cy: number, r: number, home?: Ent | null): number | null {
  let best: number | null = null, bd = Infinity;
  const bad = cantReach.get(u);
  for (let y = Math.max(0, cy - r); y <= Math.min(MH - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(MW - 1, cx + r); x++) {
      const i = y * MW + x;
      if (G.terr[i] !== TREE || G.treeWood[i] < CHOP_WORTH || !reachable(i) || bad?.has(i)) continue;
      const d = (home ? tilesTo(x, y, home) : Math.hypot(x - cx, y - cy)) + choppersAt(i, u) * CROWD;
      if (d < bd) { bd = d; best = i; }
    }
  return best;
}

/** How many tiles further a Worker will walk for a tree of its own rather than share one. */
const CROWD = 3;

/**
 * Pick the next tree: the closest to the Worker's mill if it has one, else to its nearest drop-off
 * (Lumber Mill, Refinery or Town Hall), so the walk home stays short; anywhere as a last resort.
 */
function nextTree(u: Ent, o: HarvestOrder): number | null {
  const home = valid(o.src) ?? bankAt(u, [...WOOD_BANKS]);
  if (!home) return nearestTree(u, Math.floor(u.x / TS), Math.floor(u.y / TS), 14) ?? nearestTree(u, Math.floor(u.x / TS), Math.floor(u.y / TS), MW);
  const cx = home.tx + (home.w >> 1), cy = home.ty + (home.h >> 1);
  return nearestTree(u, cx, cy, MILL_RADIUS + 2, home) ?? nearestTree(u, cx, cy, 16, home) ?? nearestTree(u, cx, cy, MW, home);
}

function pickAnother(u: Ent, o: HarvestOrder): void {
  const t = nextTree(u, o);
  if (t !== null) { o.tx = t % MW; o.ty = (t / MW) | 0; }
  u.path = null;
}

/** Walk to a tree and chop it until the load is full; the caller takes it home once `o.st` is 'ret'. */
export function updChop(u: Ent, o: HarvestOrder, dt: number): void {
  let i = o.ty * MW + o.tx;
  const good = G.terr[i] === TREE && G.treeWood[i] >= Math.min(CHOP_WORTH, 1) && reachable(i);
  if (!good || (o.st === 'go' && G.treeWood[i] < CHOP_WORTH)) {
    const t = nextTree(u, o);
    if (t === null) { o.st = u.carry > 0 ? 'ret' : 'go'; o.wait = 2; u.path = null; return; }
    i = t;
    o.tx = i % MW; o.ty = (i / MW) | 0;
    o.st = 'go';
    u.path = null;
  }
  const tree = treeTarget(i);
  if (o.st === 'go') {
    const r = approach(u, tree, CHOP_REACH, dt);
    // no way there (or the path ran out short of it): try another tree
    if (r === null || (!r && u.path?.length === 0)) { giveUpOn(u, i); o.wait = 0.5; pickAnother(u, o); return; }
    if (r) o.st = 'gather';
    return;
  }
  // chopping
  cantReach.delete(u);
  const take = Math.min(CHOP_RATE * dt, woodLoad(u) - u.carry, G.treeWood[i]);
  G.treeWood[i] -= take;
  u.carry += take;
  u.cargo = 'wood';
  u.atkT = 0.2; // swing the axe
  u.face = turnToward(u.face, Math.atan2(tree.y - u.y, tree.x - u.x), 8 * dt);
  if (Math.random() < dt * 4) part('chip', tree.x + (Math.random() - 0.5) * 10, tree.y, { vz: 50, vx: (Math.random() - 0.5) * 40, max: 0.5, size: 2, col: '#c89a5a' });
  if (u.carry >= woodLoad(u) - 0.01) { o.st = 'ret'; u.path = null; }
  else if (G.treeWood[i] < 1) { o.st = 'go'; u.path = null; } // this one's bare: on to the next
}

/** Seconds it takes a Worker to cut a tree down to clear a way out. */
const FELL_TIME = 4;
/** How far (tiles) a shut-in Worker looks for a way out through the trees. */
const FELL_SEARCH = 30;

/** The tree each shut-in Worker is cutting down, and how long it has been at it. */
const felling = new WeakMap<Ent, { i: number; t: number }>();
const lastLook = new WeakMap<Ent, number>();

/**
 * The first tree in the way on the shortest walk to `goal` that goes through as few trees as
 * possible; null when there's an open way (or no way at all, trees or not).
 */
function treeInWay(u: Ent, goal: Target): number | null {
  const sx = Math.floor(u.x / TS), sy = Math.floor(u.y / TS);
  const x0 = Math.max(0, sx - FELL_SEARCH), y0 = Math.max(0, sy - FELL_SEARCH), x1 = Math.min(MW - 1, sx + FELL_SEARCH), y1 = Math.min(MH - 1, sy + FELL_SEARCH);
  const atGoal = (x: number, y: number) => x >= goal.tx - 1 && x <= goal.tx + goal.w && y >= goal.ty - 1 && y <= goal.ty + goal.h;
  const cost = new Map<number, number>(), from = new Map<number, number>();
  // 0-1 search: open ground is free, each tree costs one
  const dq: number[] = [sy * MW + sx];
  cost.set(dq[0], 0);
  while (dq.length) {
    const i = dq.shift() as number, x = i % MW, y = (i / MW) | 0, c = cost.get(i) as number;
    if (atGoal(x, y) && !G.blk[i]) {
      if (c === 0) return null;
      // walk back to the first tree on the way
      let first = -1;
      for (let k: number | undefined = i; k !== undefined; k = from.get(k)) if (G.terr[k] === TREE) first = k;
      return first;
    }
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      const ni = ny * MW + nx, tree = G.terr[ni] === TREE;
      if (G.blk[ni] && !tree) continue;
      const nc = c + (tree ? 1 : 0);
      if (nc >= (cost.get(ni) ?? Infinity)) continue;
      cost.set(ni, nc);
      from.set(ni, i);
      if (tree) dq.push(ni); else dq.unshift(ni);
    }
  }
  return null;
}

/** Cut a tree down for good: the tile becomes open ground. */
function fell(i: number): void {
  G.terr[i] = GRASS;
  G.treeWood[i] = 0;
  G.blk[i] = G.ents.some((e) => !e.dead && e.kind === 'bld' && i % MW >= e.tx && i % MW < e.tx + e.w && ((i / MW) | 0) >= e.ty && ((i / MW) | 0) < e.ty + e.h) ? 1 : 0;
}

/**
 * A Worker shut in by trees (say, a structure went up across the only gap) cuts its way out toward
 * `goal`. Returns true while it's doing so, false when there's no tree to cut that would help.
 */
export function chopOut(u: Ent, goal: Target, dt: number): boolean {
  if (u.type !== 'worker') return false;
  let f = felling.get(u);
  if (!f || G.terr[f.i] !== TREE) {
    // looking for a way out is a wide search: at most once a second
    if (G.gameT < (lastLook.get(u) ?? -Infinity) + 1) return false;
    lastLook.set(u, G.gameT);
    const i = treeInWay(u, goal);
    if (i === null || i < 0) { felling.delete(u); return false; }
    felling.set(u, (f = { i, t: 0 }));
    u.path = null;
  }
  const tree = treeTarget(f.i);
  const r = approach(u, tree, CHOP_REACH, dt);
  if (r === null) { felling.delete(u); return false; }
  if (!r) return true;
  f.t += dt;
  u.atkT = 0.2; // swing the axe
  u.face = turnToward(u.face, Math.atan2(tree.y - u.y, tree.x - u.x), 8 * dt);
  if (Math.random() < dt * 4) part('chip', tree.x + (Math.random() - 0.5) * 10, tree.y, { vz: 50, vx: (Math.random() - 0.5) * 40, max: 0.5, size: 2, col: '#c89a5a' });
  if (f.t >= FELL_TIME) { fell(f.i); felling.delete(u); u.path = null; }
  return true;
}

/** Whether a Worker is part-way through cutting its way out. */
export const fellingOut = (u: Ent): boolean => felling.has(u);
