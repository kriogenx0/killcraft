// Idle Workers put themselves to work: they gather whichever of ore, wood and oil the side needs
// most (what its waiting orders still lack first, then whatever it has least of against how many
// Workers already bring it in), and Workers that picked their own job look again each time they
// drop a load off, so the split follows the bank. Orders a player gives a Worker are left alone.
import { G, tileOf, type Ent, type HarvestOrder } from './state.ts';
import { MH, MW, TREE } from './const.ts';
import { CHOP_WORTH } from '../data/economy.ts';
import { ORE_BANKS, bankAt, banksOf } from './haul.ts';
import { WOOD_BANKS } from './chop.ts';
import { priceOf } from './production.ts';
import { setOrder } from './order.ts';
import { ais } from './ai.ts';
import { oilLeft as oilLeftOf } from './economy.ts';

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

/** How far the side is from paying for what's waiting on a resource, plus a small floor (0 if it has enough). */
export function shortfall(team: number, r: Res): number {
  return Math.max(0, owed(team)[r] + FLOOR[r] - have(team, r));
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
  // ore by any drop-off counts: a Mining Camp or second Town Hall by a far field keeps Workers digging
  const oreHome = bankAt(u, ORE_BANKS);
  if (banksOf(u.team, ORE_BANKS).some((b) => near(b, (i) => G.ore[i] > 0))) out.push('ore');
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
  const b = bankAt(u, ORE_BANKS);
  return b ? [b.tx, b.ty] : [tileOf(u.x), tileOf(u.y)];
}

/** Under the computer's hand: it splits its own Workers (ai.ts assignHaulers), so it only sends idle ones to the ore. */
const computer = (team: number): boolean => !!ais[team]?.on;

/** An idle gatherer goes to work. Returns true if it was given a job. */
export function autoGather(u: Ent): boolean {
  if (u.type !== 'worker' || computer(u.team)) {
    if (!bankAt(u, ORE_BANKS)) return false;
    const [tx, ty] = oreStart(u);
    setOrder(u, { t: 'harvest', st: u.carry > 0 && (u.cargo ?? 'ore') === 'ore' ? 'ret' : 'go', tx, ty, wait: 0 });
    return true;
  }
  const r = pickResource(u);
  if (r) gather(u, r);
  // nothing worth gathering close by: take any load home and dig ore wherever it's left, rather than stand about
  if (!u.order && bankAt(u, ORE_BANKS)) { const [tx, ty] = oreStart(u); setOrder(u, { t: 'harvest', st: u.carry > 0 ? 'ret' : 'go', tx, ty, wait: 0, auto: true }); }
  return !!u.order;
}

/** A Worker that chose its own job has just dropped a load off: switch if the side now needs something else more. */
export function rethink(u: Ent, o: HarvestOrder): void {
  if (!o.auto || u.type !== 'worker' || computer(u.team)) return;
  const now = o.res ?? 'ore', can = options(u), r = pickResource(u, can);
  // a derrick pumps slowly: rather than shuttle back and forth with a few drops each time, do
  // something else until it has a load waiting again
  if (now === 'oil' && !can.includes('oil')) { if (r) gather(u, r); return; }
  // short of something and not of this: go and get it
  if (r && r !== now && shortfall(u.team, now) <= 0 && shortfall(u.team, r) > 0) { gather(u, r); return; }
  if (shortfall(u.team, now) > 0) return; // still needed here
  // nothing short: even out the split, but only when it's off by a whole Worker either way, so
  // nobody flits back and forth over a fraction
  const b = imbalance(u, can, now);
  if (b) gather(u, b);
}

/** The resource a self-directed Worker should move to from `now` to even out the side's split, if any. */
function imbalance(u: Ent, can: Res[], now: Res): Res | null {
  if (can.length < 2 || !can.includes(now)) return null;
  const crew = { ore: 0, wood: 0, oil: 0 };
  for (const e of G.ents) if (e !== u && !e.dead && e.team === u.team && e.type === 'worker') { const j = jobOf(e); if (j) crew[j]++; }
  const total = can.reduce((n, r) => n + crew[r], 0) + 1, share = can.reduce((n, r) => n + SHARE[r], 0);
  const want = (r: Res) => (SHARE[r] / share) * total;
  if (crew[now] + 1 - want(now) < 1) return null;
  let best: Res | null = null, most = 0;
  for (const r of can) if (r !== now && want(r) - crew[r] >= 1 && want(r) - crew[r] > most) { most = want(r) - crew[r]; best = r; }
  return best;
}

/** The gathering job each Worker set aside to go and fix something, to take up again after. */
const resume = new WeakMap<Ent, HarvestOrder>();
export const keepResume = (u: Ent, o: HarvestOrder): void => { resume.set(u, o); };
export function takeResume(u: Ent): HarvestOrder | null {
  const o = resume.get(u);
  resume.delete(u);
  return o ?? null;
}
/** A player's order replaces whatever the Worker meant to go back to. */
export const forgetResume = (u: Ent): void => { resume.delete(u); };

/** What a player can send Workers to gather. */
export const GATHER = ['ore', 'wood', 'oil', 'aether'] as const;
export type GatherRes = (typeof GATHER)[number];

/** The Aether deposit each Worker was sent to draw from, to go back to after banking what it carries. */
const aetherJob = new WeakMap<Ent, number>();
export const aetherJobOf = (u: Ent): Ent | null => {
  const id = aetherJob.get(u), d = id === undefined ? null : G.byId.get(id) ?? null;
  if (d && (d.dead || d.type !== 'aether')) { aetherJob.delete(u); return null; }
  return d;
};
export const forgetAether = (u: Ent): void => { aetherJob.delete(u); };

/** Walking-free distance (tiles) from the side's nearest Town Hall, Refinery or Mining Camp. */
function fromBase(team: number, x: number, y: number): number {
  let d = Infinity;
  for (const b of banksOf(team, ORE_BANKS)) d = Math.min(d, Math.hypot(b.x - x, b.y - y));
  return d;
}

/**
 * The player sends a Worker to gather one resource: the ore, trees, Oil Derrick or Aether deposit
 * nearest the base. It's the player's choice, so it sticks to it (no switching to even things out).
 * Returns false if there's none of that to gather.
 */
export function sendGather(u: Ent, r: GatherRes): boolean {
  if (u.type !== 'worker') return false;
  forgetAether(u);
  if (r === 'ore' || r === 'wood') {
    // start from the drop-off itself: the Worker then picks the ore (unit.ts pickOre) or tree
    // (chop.ts nextTree) nearest the base, not the one nearest where it stands
    const b = bankAt(u, r === 'ore' ? ORE_BANKS : [...WOOD_BANKS]);
    if (!b) return false;
    setOrder(u, { t: 'harvest', st: u.carry > 0 && (u.cargo ?? 'ore') !== r ? 'ret' : 'go', tx: b.tx, ty: b.ty, wait: 0, res: r === 'wood' ? 'wood' : undefined });
    return true;
  }
  if (r === 'oil') {
    let best: Ent | null = null, bd = Infinity;
    for (const d of G.ents) {
      if (d.dead || d.team !== u.team || d.type !== 'derrick' || !d.done || (d.carry <= 1 && oilLeftOf(d) <= 0)) continue;
      const crew = G.ents.filter((w) => w !== u && !w.dead && w.order?.t === 'harvest' && w.order.src === d.id).length;
      const s = crew * 8 + fromBase(u.team, d.x, d.y) / 32; // spread over the derricks, nearest the base first
      if (s < bd) { bd = s; best = d; }
    }
    if (!best) return false;
    setOrder(u, { t: 'harvest', st: u.carry > 0 && u.cargo !== 'oil' ? 'ret' : 'go', tx: best.tx, ty: best.ty, wait: 0, res: 'oil', src: best.id });
    return true;
  }
  // Aether: the deposit nearest the base; the Worker draws it, banks it and goes back for more
  let best: Ent | null = null, bd = Infinity;
  for (const d of G.ents) if (!d.dead && d.type === 'aether') { const dist = fromBase(u.team, d.x, d.y); if (dist < bd) { bd = dist; best = d; } }
  if (!best) return false;
  aetherJob.set(u, best.id);
  setOrder(u, null);
  u.scan = 0;
  return true;
}
