// Idle Workers put themselves to work: they gather whichever of ore, wood and oil the side needs
// most (what its waiting orders still lack first, then whatever it has least of against how many
// Workers already bring it in), and Workers that picked their own job look again each time they
// drop a load off, so the split follows the bank. Orders a player gives a Worker are left alone.
import { G, tileOf, type Ent, type HarvestOrder } from './state.ts';
import { MH, MW, TREE } from './const.ts';
import { CHOP_WORTH } from '../data/economy.ts';
import { bankAt } from './haul.ts';
import { WOOD_BANKS } from './chop.ts';
import { priceOf } from './production.ts';
import { setOrder } from './order.ts';
import { ais } from './ai.ts';

export type Res = 'ore' | 'wood' | 'oil';

/** Seconds a Worker stands idle before it goes to gather on its own (a player who just moved it may have plans). */
export const IDLE_GRACE = 3;

/** Below this much in the bank a side counts as short of a resource even with nothing waiting on it. */
const FLOOR: Record<Res, number> = { ore: 300, wood: 150, oil: 100 };
/** Rough worth of one of each against ore, so shortfalls compare fairly (prices run lower in wood and oil). */
const WORTH: Record<Res, number> = { ore: 1, wood: 2, oil: 2.5 };
/** The split of gatherers a side aims for when it isn't short of anything. */
const SHARE: Record<Res, number> = { ore: 0.5, wood: 0.3, oil: 0.2 };
/** How far (tiles) from a drop-off gathering is worth the walk. */
const REACH = 18;

const have = (team: number, r: Res): number => (r === 'ore' ? G.credits[team] : r === 'wood' ? G.wood[team] : G.oil[team]);

/** What the side still has to pay for: queued orders waiting for the money and sites placed before it could pay. */
export function owed(team: number): Record<Res, number> {
  const o = { ore: 0, wood: 0, oil: 0 };
  const add = (t: Parameters<typeof priceOf>[0]) => { const p = priceOf(t); o.ore += p.ore; o.wood += p.wood; o.oil += p.oil; };
  const prod = G.prod[team];
  if (prod) for (const line of Object.values(prod)) for (const it of line) if (!it.paid) add(it.type);
  for (const e of G.ents) if (!e.dead && e.team === team && e.kind === 'bld' && e.unpaid) add(e.type as Parameters<typeof priceOf>[0]);
  return o;
}

/** What a gatherer's order brings in (none if it isn't gathering). */
export function jobOf(u: Ent): Res | null {
  return u.order?.t === 'harvest' ? u.order.res ?? 'ore' : null;
}

/** Any of `test` true on a tile within REACH of a building. */
function near(b: Ent, test: (i: number) => boolean): boolean {
  const cx = b.tx + (b.w >> 1), cy = b.ty + (b.h >> 1);
  for (let y = Math.max(0, cy - REACH); y <= Math.min(MH - 1, cy + REACH); y++)
    for (let x = Math.max(0, cx - REACH); x <= Math.min(MW - 1, cx + REACH); x++) if (test(y * MW + x)) return true;
  return false;
}

/** The resources this Worker could go and gather right now: something to take and somewhere to bring it. */
export function options(u: Ent): Res[] {
  const out: Res[] = [];
  const oreHome = bankAt(u, ['refinery', 'yard']);
  if (oreHome && near(oreHome, (i) => G.ore[i] > 0)) out.push('ore');
  if (u.type === 'worker') {
    const woodHome = bankAt(u, [...WOOD_BANKS]);
    if (woodHome && near(woodHome, (i) => G.terr[i] === TREE && G.treeWood[i] >= CHOP_WORTH)) out.push('wood');
    if (oreHome && derrickFor(u)) out.push('oil');
  }
  return out;
}

/** Oil a derrick must hold before an idle Worker walks out for it: less isn't worth the trip. */
export const OIL_TRIP = 60;

/**
 * The side's nearest Oil Derrick with a load waiting and no Worker on it. A derrick pumps slowly,
 * so one Worker keeps up with it; a second would only stand there holding a few drops.
 */
function derrickFor(u: Ent): Ent | null {
  let best: Ent | null = null, bd = Infinity;
  for (const d of G.ents) {
    if (d.dead || d.team !== u.team || d.type !== 'derrick' || !d.done || d.carry < OIL_TRIP) continue;
    if (G.ents.some((w) => w !== u && !w.dead && w.team === u.team && w.order?.t === 'harvest' && w.order.src === d.id)) continue;
    const dist = Math.hypot(d.x - u.x, d.y - u.y);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

/**
 * The resource this Worker should gather: the biggest shortfall (owed plus a small floor, less the
 * bank) per Worker already on it; with no shortfall, whatever is furthest below its share of the
 * side's gatherers. `u` itself isn't counted, so asking again gives the same answer once settled.
 */
export function pickResource(u: Ent, can: Res[] = options(u)): Res | null {
  if (!can.length) return null;
  if (can.length === 1) return can[0];
  const team = u.team, debt = owed(team);
  const crew = { ore: 0, wood: 0, oil: 0 };
  for (const e of G.ents) {
    if (e === u || e.dead || e.team !== team) continue;
    const j = jobOf(e);
    if (j) crew[j]++;
  }
  let best: Res | null = null, bs = 0;
  for (const r of can) {
    const short = Math.max(0, debt[r] + FLOOR[r] - have(team, r)) * WORTH[r] / (crew[r] + 1);
    if (short > bs) { bs = short; best = r; }
  }
  if (best) return best;
  const total = can.reduce((s, r) => s + crew[r], 0) + 1;
  const share = can.reduce((s, r) => s + SHARE[r], 0);
  let low = Infinity;
  for (const r of can) {
    const behind = (crew[r] + 1) / total - SHARE[r] / share; // its share if this Worker joins, against the aim
    if (behind < low) { low = behind; best = r; }
  }
  return best;
}

/** Give a Worker a gathering job of its own choosing. */
function gather(u: Ent, r: Res): void {
  const [x, y] = r === 'ore' ? oreStart(u) : [tileOf(u.x), tileOf(u.y)];
  if (r === 'oil') {
    const d = derrickFor(u);
    if (!d) return;
    setOrder(u, { t: 'harvest', st: 'go', tx: d.tx, ty: d.ty, wait: 0, res: 'oil', src: d.id, auto: true });
  } else setOrder(u, { t: 'harvest', st: 'go', tx: x, ty: y, wait: 0, res: r === 'wood' ? 'wood' : undefined, auto: true });
}

/**
 * Where an ore job starts: the drop-off's own tile, which holds no ore, so the gatherer picks the
 * ore nearest the base (unit.ts pickOre) rather than digging wherever it stands.
 */
function oreStart(u: Ent): [number, number] {
  const b = bankAt(u, ['refinery', 'yard']);
  return b ? [b.tx, b.ty] : [tileOf(u.x), tileOf(u.y)];
}

/** Under the computer's hand: it splits its own Workers (ai.ts assignHaulers), so it only sends idle ones to the ore. */
const computer = (team: number): boolean => !!ais[team]?.on;

/** An idle gatherer goes to work. Returns true if it was given a job. */
export function autoGather(u: Ent): boolean {
  if (u.type !== 'worker' || computer(u.team)) {
    if (!bankAt(u, ['refinery', 'yard'])) return false;
    const [tx, ty] = oreStart(u);
    setOrder(u, { t: 'harvest', st: u.carry > 0 && (u.cargo ?? 'ore') === 'ore' ? 'ret' : 'go', tx, ty, wait: 0 });
    return true;
  }
  const r = pickResource(u);
  if (r) gather(u, r);
  // nothing worth gathering close by: take any load home and dig ore wherever it's left, rather than stand about
  if (!u.order && bankAt(u, ['refinery', 'yard'])) { const [tx, ty] = oreStart(u); setOrder(u, { t: 'harvest', st: u.carry > 0 ? 'ret' : 'go', tx, ty, wait: 0, auto: true }); }
  return !!u.order;
}

/** A Worker that chose its own job has just dropped a load off: switch if the side now needs something else more. */
export function rethink(u: Ent, o: HarvestOrder): void {
  if (!o.auto || u.type !== 'worker' || computer(u.team)) return;
  const now = o.res ?? 'ore', r = pickResource(u);
  if (!r || r === now) return;
  gather(u, r);
}
