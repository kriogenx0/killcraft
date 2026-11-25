// Workers on Auto (the default, and what an idle Worker falls back to) gather whichever of ore,
// wood and oil the side has least of, counting what its waiting orders still owe and how many
// Workers already bring each in, and look again each time they drop a load off, so the split
// follows the bank. A Worker set to Ore, Wood or Oil sticks to it.
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
  if (!can.length) return null;
  if (can.length === 1) return can[0];
  const crew = crewOf(u), debt = owed(u.team);
  let best: Res | null = null, bs = Infinity;
  for (const r of can) { const v = standing(u.team, r, crew, debt); if (v < bs) { bs = v; best = r; } }
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

/**
 * An Auto Worker has just dropped a load off: move to whatever the side now has least of, but only
 * if it would still be the lowest with this Worker on it, so nobody flits back and forth.
 */
export function rethink(u: Ent, o: HarvestOrder): void {
  if (!o.auto || u.type !== 'worker' || computer(u.team)) return;
  const now = o.res ?? 'ore', can = options(u), r = pickResource(u, can);
  // a derrick pumps slowly: rather than shuttle back and forth with a few drops each time, do
  // something else until it has a load waiting again
  if (now === 'oil' && !can.includes('oil')) { if (r) gather(u, r); return; }
  if (!r || r === now || !can.includes(now)) return;
  const crew = crewOf(u), debt = owed(u.team);
  if (standing(u.team, r, crew, debt) + PER_WORKER <= standing(u.team, now, crew, debt)) gather(u, r);
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
