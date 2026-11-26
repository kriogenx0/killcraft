// Workers on Auto (the default, and what an idle Worker falls back to) gather whichever of ore,
// wood and oil the side has least of, counting what its waiting orders still owe and how many
// Workers already bring each in, and look again each time they drop a load off, so the split
// follows the bank. A Worker set to Ore, Wood or Oil sticks to it.
import { AETHER_DRY, AETHER_WORTH } from '../data/aether.ts';
import { G, tileOf, valid, type Ent, type HarvestOrder } from './state.ts';
import { MH, MW, TS } from './const.ts';
import { ORE_BANKS, bankAt, banksOf } from './haul.ts';
import { WOOD_BANKS, treeFor } from './chop.ts';
import { priceOf } from './production.ts';
import { setOrder } from './order.ts';
import { ais } from './ai.ts';
import { salvageFor } from './unit.ts';

export type Res = 'ore' | 'wood' | 'oil';

/** Seconds a Worker stands idle before it goes to gather on its own (a player who just moved it may have plans). */
export const IDLE_GRACE = 3;

/**
 * What each Worker already gathering a resource counts for when deciding which the side has least
 * of: about what it brings in over a minute, so Workers spread out rather than all rush the
 * lowest, and nobody switches back and forth over a few points.
 */
const PER_WORKER = 150;
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
  // ore by any drop-off counts: a Mining Camp or second Town Hall by a far field keeps Workers digging
  const oreHome = bankAt(u, ORE_BANKS);
  if (banksOf(u.team, ORE_BANKS).some((b) => near(b, (i) => G.ore[i] > 0))) out.push('ore');
  if (u.type === 'worker') {
    if (treeFor(u)) out.push('wood');
    if (oreHome && derrickFor(u)) out.push('oil');
  }
  return out;
}

/** Oil a derrick must hold before an idle Worker walks out for it: less isn't worth the trip. */
export const OIL_TRIP = 240;
/** What's worth fetching when an order is waiting on oil. */
const OIL_SHORT_TRIP = 60;

/**
 * The side's nearest Oil Derrick with a load waiting and no Worker on it. A derrick pumps slowly,
 * so one Worker keeps up with it; a second would only stand there holding a few drops.
 */
function derrickFor(u: Ent): Ent | null {
  let best: Ent | null = null, bd = Infinity;
  // something waiting on oil the side hasn't got: any useful amount is worth the trip
  const trip = owed(u.team).oil > G.oil[u.team] ? OIL_SHORT_TRIP : OIL_TRIP;
  for (const d of G.ents) {
    if (d.dead || d.team !== u.team || d.type !== 'derrick' || !d.done || d.carry < trip) continue;
    if (G.ents.some((w) => w !== u && !w.dead && w.team === u.team && w.order?.t === 'harvest' && w.order.src === d.id)) continue;
    const dist = Math.hypot(d.x - u.x, d.y - u.y);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

/** The side's Workers (other than `u`) gathering each resource. */
function crewOf(u: Ent): Record<Res, number> {
  const crew = { ore: 0, wood: 0, oil: 0 };
  for (const e of G.ents) if (e !== u && !e.dead && e.team === u.team && e.type === 'worker') { const j = jobOf(e); if (j) crew[j]++; }
  return crew;
}

/**
 * How well off the side is for a resource, as Auto sees it: what's in the bank, less what waiting
 * orders still owe, plus what the Workers already on it will bring. Lowest is what to gather.
 */
function standing(team: number, r: Res, crew: Record<Res, number>, debt = owed(team)): number {
  return have(team, r) - debt[r] + crew[r] * PER_WORKER;
}

/** The resource an Auto Worker should gather: whichever the side has least of (`u` itself not counted). */
export function pickResource(u: Ent, can: Res[] = options(u)): Res | null {
  if (!can.length) return salvageFor(u) ? 'ore' : null;
  if (can.length === 1) return can[0];
  const crew = crewOf(u), debt = owed(u.team);
  let best: Res | null = null, bs = Infinity;
  for (const r of can) { const v = standing(u.team, r, crew, debt); if (v < bs) { bs = v; best = r; } }
  // what's left of something destroyed comes before anything else, bar oil when that's what's short
  if (best !== 'oil' && salvageFor(u)) return 'ore';
  return best;
}

/** Give a Worker a gathering job of its own choosing. */
function gather(u: Ent, r: Res): void {
  const was = jobOf(u);
  // a load of oil is an errand: the Worker goes back to what it was doing once it's banked
  if (r === 'oil' && was && was !== 'oil') errandFrom.set(u, was);
  else if (was && was !== r && was !== 'oil') movedAt.set(u, G.gameT);
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

/**
 * An Auto Worker has just dropped a load off: move to whatever the side now has least of, but only
 * if it would still be the lowest with this Worker on it, so nobody flits back and forth.
 */
export function rethink(u: Ent, o: HarvestOrder): void {
  if (!o.auto || u.type !== 'worker' || computer(u.team)) return;
  const now = o.res ?? 'ore', can = options(u), r = pickResource(u, can);
  // a derrick pumps slowly: rather than shuttle back and forth with a few drops each time, do
  // something else until it has a load waiting again
  if (now === 'oil' && !can.includes('oil')) {
    const back = errandFrom.get(u);
    errandFrom.delete(u);
    const next = back && can.includes(back) ? back : r;
    if (next) gather(u, next);
    return;
  }
  // a load of oil is an errand, not a change of job: go whenever oil is what the side has least of
  if (now !== 'oil' && r === 'oil') { gather(u, 'oil'); return; }
  // salvage first: a trip out for it is an errand, and the Worker goes back to its own job once it's dug up
  const salvage = !!salvageFor(u);
  if (salvage && now === 'wood') { gather(u, 'ore'); errandFrom.set(u, now); return; }
  if (now === 'ore' && !salvage && errandFrom.has(u)) {
    const back = errandFrom.get(u);
    errandFrom.delete(u);
    if (back && can.includes(back)) { gather(u, back); movedAt.delete(u); return; }
  }
  if (!r || r === now || !can.includes(now)) return;
  // stay put a while after a move, so a Worker is seen to stick at a job
  if (G.gameT - (movedAt.get(u) ?? -Infinity) < SETTLE) return;
  const crew = crewOf(u), debt = owed(u.team), lo = standing(u.team, r, crew, debt), mine = standing(u.team, now, crew, debt);
  // only for a real gap: half as much again as the lower one has, and never less than GAP
  if (lo + PER_WORKER <= mine && mine - lo >= Math.max(GAP, lo * 0.5)) gather(u, r);
}

/** Seconds an Auto Worker keeps at a resource after moving to it, before it will move again. */
const SETTLE = 60;
/** The smallest gap between two resources that moves an Auto Worker from one to the other. */
const GAP = 500;
/** What each Auto Worker was gathering before it went to fetch a load of oil. */
const errandFrom = new WeakMap<Ent, Res>();
/** Out on an errand (a load of oil, or salvage), to go back to its own job after. */
export const onErrand = (u: Ent): boolean => errandFrom.has(u);
/** When each Auto Worker last moved to another resource. */
const movedAt = new WeakMap<Ent, number>();

/** The gathering job each Worker set aside to go and fix something, to take up again after. */
const resume = new WeakMap<Ent, HarvestOrder>();
export const keepResume = (u: Ent, o: HarvestOrder): void => { resume.set(u, o); };
export function takeResume(u: Ent): HarvestOrder | null {
  const o = resume.get(u);
  resume.delete(u);
  return o ?? null;
}
/** A player's order replaces whatever the Worker meant to go back to. */
export const forgetResume = (u: Ent): void => { resume.delete(u); fetching.delete(u); };
/** Workers that set off on their own to fetch dropped Aether (no pause for the player's plans when they get there). */
export const fetching = new WeakSet<Ent>();

/** What a player can set Workers to gather: Auto (whatever the side has least of) or one resource. */
export const GATHER = ['auto', 'ore', 'wood', 'oil', 'aether'] as const;
export type GatherRes = (typeof GATHER)[number];

/** A Worker's gather setting: Auto unless it was set to one resource and is working it. */
export function gatherSetting(u: Ent): GatherRes {
  if (aetherJobOf(u)) return 'aether';
  const o = u.order?.t === 'harvest' ? u.order : u.order?.t === 'heal' ? resume.get(u) : null;
  return !o || o.auto ? 'auto' : o.res ?? 'ore';
}

/** The Aether deposit each Worker was sent to draw from, to go back to after banking what it carries. */
const aetherJob = new WeakMap<Ent, number>();
export const aetherJobOf = (u: Ent): Ent | null => {
  const id = aetherJob.get(u), d = id === undefined ? null : G.byId.get(id) ?? null;
  if (d && (d.dead || d.type !== 'aether' || d.hp < AETHER_DRY)) { aetherJob.delete(u); return null; }
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
 * The player sets a Worker to Auto, or to gather one resource: the ore, trees, Oil Derrick or Aether
 * deposit nearest the base. One resource is the player's choice, so it sticks to it.
 * Returns false if there's none of that to gather.
 */
export function sendGather(u: Ent, r: GatherRes): boolean {
  if (u.type !== 'worker') return false;
  forgetAether(u);
  if (r === 'auto') {
    const job = pickResource(u);
    if (job) gather(u, job);
    else if (bankAt(u, ORE_BANKS)) { const [tx, ty] = oreStart(u); setOrder(u, { t: 'harvest', st: 'go', tx, ty, wait: 0, auto: true }); }
    return u.order?.t === 'harvest';
  }
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
      if (d.dead || d.team !== u.team || d.type !== 'derrick' || !d.done) continue; // a dry well still trickles into its tank
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
  for (const d of G.ents) if (!d.dead && d.type === 'aether' && d.hp >= AETHER_WORTH) { const dist = fromBase(u.team, d.x, d.y); if (dist < bd) { bd = dist; best = d; } }
  if (!best) return false;
  aetherJob.set(u, best.id);
  setOrder(u, null);
  u.scan = 0;
  return true;
}

/**
 * Recruit a Worker to an Oil Derrick (the derrick's "Send Worker" button): the nearest one that's
 * idle or on Auto, else the nearest that isn't putting up a building, set to haul oil from it.
 * Returns the Worker, or null if the side has none to send.
 */
export function recruitTo(d: Ent): Ent | null {
  if (d.type !== 'derrick' || !d.done || d.dead) return null;
  let best: Ent | null = null, bd = Infinity;
  for (const u of G.ents) {
    if (u.dead || u.team !== d.team || u.type !== 'worker') continue;
    if (u.order?.t === 'harvest' && u.order.src === d.id) continue; // on it already
    const building = u.order?.t === 'heal' && u.order.sent && valid(u.order.tgt)?.kind === 'bld' && !valid(u.order.tgt)?.done;
    // tiles of walk a Worker's current work is worth: a free one goes first, a builder last
    const busy = building ? 60 : gatherSetting(u) === 'auto' ? 0 : 25;
    const s = Math.hypot(u.x - d.x, u.y - d.y) / TS + busy;
    if (s < bd) { bd = s; best = u; }
  }
  if (!best) return null;
  forgetAether(best);
  resume.delete(best);
  setOrder(best, { t: 'harvest', st: best.carry > 0 && best.cargo !== 'oil' ? 'ret' : 'go', tx: d.tx, ty: d.ty, wait: 0, res: 'oil', src: d.id });
  return best;
}

/** How many of the side's Workers haul from a derrick. */
export const crewAt = (d: Ent): number => G.ents.filter((u) => !u.dead && u.team === d.team && u.order?.t === 'harvest' && u.order.src === d.id).length;

/**
 * The Worker that finished building an Oil Derrick stays on and hauls its oil (set to Oil), unless
 * another Worker already does.
 */
export function stayOnDerrick(u: Ent, d: Ent): void {
  if (d.type !== 'derrick' || !d.done || d.dead || u.type !== 'worker' || d.team !== u.team || computer(u.team) || crewAt(d)) return;
  forgetAether(u);
  resume.delete(u);
  setOrder(u, { t: 'harvest', st: u.carry > 0 && u.cargo !== 'oil' ? 'ret' : 'go', tx: d.tx, ty: d.ty, wait: 0, res: 'oil', src: d.id });
}
