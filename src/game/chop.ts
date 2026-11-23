// Chopping wood. A Worker on a wood run walks to a tree, chops a load and carries it to the nearest
// Lumber Mill, Refinery or Town Hall (see unit.ts for the trip home); nothing is banked
// until it's dropped off. Workers spread over the trees, one to a tree while there are enough.
import { G, valid, type Ent, type HarvestOrder, type Target } from './state.ts';
import { MH, MW, TREE, TS } from './const.ts';
import { approach, turnToward } from './move.ts';
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

/** The nearest tree with wood worth chopping within r tiles of (cx, cy), preferring ones nobody else is on. */
export function nearestTree(u: Ent, cx: number, cy: number, r: number): number | null {
  let best: number | null = null, bd = Infinity;
  const bad = cantReach.get(u);
  for (let y = Math.max(0, cy - r); y <= Math.min(MH - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(MW - 1, cx + r); x++) {
      const i = y * MW + x;
      if (G.terr[i] !== TREE || G.treeWood[i] < CHOP_WORTH || !reachable(i) || bad?.has(i)) continue;
      const d = Math.hypot(x - cx, y - cy) + choppersAt(i, u) * 6;
      if (d < bd) { bd = d; best = i; }
    }
  return best;
}

/** Pick the next tree: near the Worker's mill if it has one, else near the Worker; anywhere as a last resort. */
function nextTree(u: Ent, o: HarvestOrder): number | null {
  const mill = valid(o.src);
  const [cx, cy] = mill ? [mill.tx + 1, mill.ty + 1] : [Math.floor(u.x / TS), Math.floor(u.y / TS)];
  return nearestTree(u, cx, cy, MILL_RADIUS + 2) ?? nearestTree(u, Math.floor(u.x / TS), Math.floor(u.y / TS), 14) ?? nearestTree(u, cx, cy, MW);
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
