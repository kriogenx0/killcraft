// Sidebar production: structures are placed first and then build on site (any number at once, see
// startSite and building.ts); one research (an age, or the Aether Ward) at a time from the Town Hall,
// one healing research at a time at the Hospital and one weapons or armor upgrade at a time at the Armory,
// and queues of infantry and vehicles. What can be built depends on the team's age (data/era.ts).
// The whole price (ore, wood, oil, Aether) is paid when an order starts. A player's order the side
// can't afford yet waits (in the queue, or as a placed site) and starts on its own once the side can
// pay; cancelling refunds what was paid, so a waiting order costs nothing to call off. The computer
// only orders what it can pay for now. Production runs at half speed on low power.
import { refitBonus } from './refit.ts';
import { G, say, type Ent, type Production, type ProductionItem, type ProductionLine } from './state.ts';
import { TS } from './const.ts';
import { UNIT, UNIT_TYPES, isUnitType, type UnitType } from '../data/unit.ts';
import { BUILDING, BLD_TYPES, isWall, type BldType } from '../data/building.ts';
import { ERA, LAST_ERA, MAX_HEAL, TECH, TECH_TYPES, UPGRADE_TRACKS, isTechType, type TechType } from '../data/era.ts';
import { noUpgrades, upgradeOf } from './upgrade.ts';
import { addUnit, countOf, hasBuilding, lowPower } from './entity.ts';
import { MAX_WAYGATES } from '../data/aether.ts';
import { cancelSite, canPlace, exitTile, placeBuilding, wallLine } from './building.ts';
import { orderFix, orderHarvest, orderMove } from './order.ts';
import { tileOf } from './state.ts';

export type Buildable = UnitType | BldType | TechType;

const QUEUE_MAX = 5;
const PRODUCER: Record<ProductionLine, BldType> = { structure: 'yard', infantry: 'barracks', vehicle: 'factory', air: 'airfield', tech: 'yard', hospital: 'hospital', armory: 'armory' };
const LINES: ProductionLine[] = ['structure', 'infantry', 'vehicle', 'air', 'tech', 'hospital', 'armory'];
const FUNDS_NOTICE = 6;
const SHORT_MSG = { ore: 'Not enough ore', wood: 'Not enough wood', oil: 'Not enough oil', aether: 'Not enough Aether' };
const RES_NAME = { ore: 'ore', wood: 'wood', oil: 'oil', aether: 'Aether' };
const lastFundsNotice: number[] = [];

export const emptyProduction = (): Production => ({ structure: [], infantry: [], vehicle: [], air: [], tech: [], hospital: [], armory: [] });
export const lineOf = (t: Buildable): ProductionLine => (isUnitType(t) ? UNIT[t].producer : isTechType(t) ? TECH[t].at ?? 'tech' : 'structure');
const defOf = (t: Buildable) => (isUnitType(t) ? UNIT[t] : isTechType(t) ? TECH[t] : BUILDING[t]);
/** Ore price. */
export const costOf = (t: Buildable): number => defOf(t).cost;
export interface Price { ore: number; wood: number; oil: number; aether: number }
export const priceOf = (t: Buildable): Price => { const d = defOf(t); return { ore: d.cost, wood: d.wood ?? 0, oil: d.oil ?? 0, aether: 'aether' in d ? d.aether ?? 0 : 0 }; };
/** Does the team have enough of every resource for the whole price? */
export const canAfford = (team: number, t: Buildable): boolean => { const p = priceOf(t); return G.credits[team] >= p.ore && G.wood[team] >= p.wood && G.oil[team] >= p.oil && (G.aether[team] ?? 0) >= p.aether; };
/**
 * Things that cost Aether stay hidden until the side first finds some. Creatures of myth only show
 * once the side has captured one of their kind (data/creatures.ts).
 */
const revealed = (team: number, t: Buildable): boolean =>
  isUnitType(t) && UNIT[t].beast ? !!G.tamed[team]?.includes(t) : priceOf(t).aether <= 0 || !!G.aetherFound[team];
const timeOf = (t: Buildable): number => defOf(t).t;
export const nameOf = (t: Buildable): string => defOf(t).name;
export const descOf = (t: Buildable): string => defOf(t).desc;

/** A structure that advances the age is built once: not after its age, and not while one stands or rises. */
const spentAdvance = (team: number, t: BldType): boolean => {
  const to = BUILDING[t].advances;
  return to != null && (eraOf(team) >= to || countOf(team, t) > 0);
};

/** The team's current age (index into ERA). */
export const eraOf = (team: number): number => G.era[team] ?? 0;

/** The team's healing level (index into HEAL_RATE). */
export const healOf = (team: number): number => G.heal[team] ?? 0;

/** The research that would take a team into its next age, if there is one. */
export function nextTech(team: number): TechType | null {
  return TECH_TYPES.find((t) => TECH[t].age === eraOf(team) + 1) ?? null;
}

/** The next healing research, once the team's age allows it. */
export function nextHeal(team: number): TechType | null {
  return TECH_TYPES.find((t) => TECH[t].heal === healOf(team) + 1 && TECH[t].era <= eraOf(team)) ?? null;
}

/** The Aether Ward, once the side has found Aether and until it's researched. */
export function nextWard(team: number): TechType | null {
  return G.ward[team] ? null : TECH_TYPES.find((t) => TECH[t].ward && TECH[t].era <= eraOf(team)) ?? null;
}

/** The next level on each Armory track that the team's age allows. */
export function nextUpgrades(team: number): TechType[] {
  return UPGRADE_TRACKS.flatMap((track) => TECH_TYPES.filter((t) => {
    const u = TECH[t].upg;
    return u && u.track === track && u.level === upgradeOf(team, track) + 1 && TECH[t].era <= eraOf(team);
  }));
}

/** Infantry the Town Hall trains while the side has no Barracks, so it can always get Workers back. */
const YARD_INFANTRY: readonly UnitType[] = ['worker'];

export function producerOf(team: number, line: ProductionLine): Ent | null {
  const own = (type: BldType) => G.ents.find((e) => !e.dead && e.team === team && e.type === type && e.done) ?? null;
  return own(PRODUCER[line]) ?? (line === 'infantry' ? own('yard') : null);
}

/** What a team can build right now on a production line. */
export function available(team: number, line: ProductionLine): Buildable[] {
  if (!producerOf(team, line)) return [];
  const era = eraOf(team);
  if (line === 'structure') {
    return BLD_TYPES.filter((t) => BUILDING[t].era <= era && revealed(team, t) && BUILDING[t].requires.every((r) => hasBuilding(team, r)) && !spentAdvance(team, t) &&
      (t !== 'waygate' || countOf(team, 'waygate') < MAX_WAYGATES));
  }
  if (line === 'armory') return nextUpgrades(team).filter((t) => revealed(team, t));
  if (line === 'hospital') { const t = nextHeal(team); return t ? [t] : []; }
  if (line === 'tech') {
    return [nextTech(team), nextWard(team)].filter((t): t is TechType => !!t && revealed(team, t) && TECH[t].requires.every((r) => hasBuilding(team, r)));
  }
  const yardOnly = line === 'infantry' && producerOf(team, line)?.type === 'yard';
  return UNIT_TYPES.filter((t) => UNIT[t].producer === line && (!yardOnly || YARD_INFANTRY.includes(t)) && UNIT[t].era <= era && era < (UNIT[t].until ?? Infinity) && revealed(team, t) && (UNIT[t].requires ?? []).every((r) => hasBuilding(team, r)));
}

/** The first resource the team lacks for the whole price, or null if it can pay. */
export function shortOf(team: number, t: Buildable): keyof typeof SHORT_MSG | null {
  const p = priceOf(t);
  return G.credits[team] < p.ore ? 'ore' : G.wood[team] < p.wood ? 'wood' : G.oil[team] < p.oil ? 'oil' : (G.aether[team] ?? 0) < p.aether ? 'aether' : null;
}

function fundsNotice(team: number, short: keyof typeof SHORT_MSG, waiting = false): void {
  if (G.gameT - (lastFundsNotice[team] ?? -99) > FUNDS_NOTICE) {
    lastFundsNotice[team] = G.gameT;
    say(team, waiting ? `${SHORT_MSG[short]}: it starts when you have it` : SHORT_MSG[short]);
  }
}

/** The resource a waiting order is short of, as the player reads it ("ore", "Aether"), or null. */
export const waitingFor = (team: number, t: Buildable): string | null => { const s = shortOf(team, t); return s && RES_NAME[s]; };

function pay(team: number, type: Buildable): void {
  const p = priceOf(type);
  G.credits[team] -= p.ore;
  G.wood[team] -= p.wood;
  G.oil[team] -= p.oil;
  if (p.aether) G.aether[team] -= p.aether;
}

/**
 * Queue an order. It starts (and is paid for in full) once it reaches the front of its line and the
 * side can pay. With `wait` (a player's order) one the side can't afford yet still queues and waits;
 * without it (the computer) it's turned down, and paid for up front. Returns false if it wasn't queued.
 * Structures don't queue: they start when placed (startSite), so for one this only reports a shortfall.
 */
export function enqueue(team: number, type: Buildable, wait = false): boolean {
  const line = lineOf(type), q = G.prod[team][line];
  if (!available(team, line).includes(type)) return false;
  const short = shortOf(team, type);
  if (line === 'structure') { if (short) fundsNotice(team, short); return false; }
  const research = line === 'tech' || line === 'hospital' || line === 'armory', max = research ? 1 : QUEUE_MAX;
  if (q.length >= max) { say(team, research ? 'Already researching' : 'Queue is full'); return false; }
  if (short && !wait) { fundsNotice(team, short); return false; }
  const it: ProductionItem = { type, prog: 0, spent: 0, ready: false, hold: false, paid: false };
  q.push(it);
  // the computer pays up front for everything it queues, so it never counts the same ore twice
  if (!wait) { pay(team, type); it.paid = true; it.spent = priceOf(type).ore; }
  else payWaiting(team);
  if (!it.paid && q[0] === it && short) fundsNotice(team, short, true);
  return true;
}

/**
 * Start whatever is waiting for funds that the side can now pay for: the front order of each line,
 * then sites placed before they could be paid for, oldest first. A cheaper order can start while a
 * dearer one on another line still waits.
 */
export function payWaiting(team: number): void {
  for (const line of LINES) {
    const it = G.prod[team][line][0];
    if (!it || it.paid || it.hold || shortOf(team, it.type)) continue;
    pay(team, it.type);
    it.paid = true;
    it.spent = priceOf(it.type).ore;
  }
  for (const b of G.ents) {
    if (b.unpaid && !b.dead && b.team === team && !shortOf(team, b.type as BldType)) {
      pay(team, b.type as BldType);
      b.unpaid = false;
    }
  }
}

/** Can the team lay out this structure here right now (available, affordable, and a free spot)? */
export function canStartSite(team: number, type: BldType, tx: number, ty: number): boolean {
  return available(team, 'structure').includes(type) && canAfford(team, type) && canPlace(tx, ty, BUILDING[type].size, team);
}

/**
 * Place a structure: pay its whole price and lay out a site for Workers to build. A wall can be laid
 * as a line to (ex, ey): every segment is its own site, paid in full as it goes down (segments where
 * something is in the way are skipped). With `wait` (a player's order) a site the side can't pay for
 * yet is still laid out and waits, unbuilt, until it can (payWaiting); without it (the computer)
 * placing stops where the money runs out.
 */
export function startSite(team: number, type: BldType, tx: number, ty: number, ex = tx, ey = ty, wait = false): Ent | null {
  if (!available(team, 'structure').includes(type)) return null;
  const line = isWall(type) ? wallLine(tx, ty, ex, ey) : [[tx, ty] as const];
  let first: Ent | null = null, n = 0, waiting: keyof typeof SHORT_MSG | null = null;
  for (const [x, y] of line) {
    // once one segment waits, the rest wait behind it so they're paid for in the order they went down
    const short: keyof typeof SHORT_MSG | null = waiting ?? shortOf(team, type);
    if (short && !wait) { fundsNotice(team, short); break; }
    const b = placeBuilding(team, type, x, y, line.length > 1);
    if (!b) continue;
    if (short) { b.unpaid = true; waiting = short; }
    else pay(team, type);
    first ??= b;
    n++;
  }
  if (waiting) fundsNotice(team, shortOf(team, type) ?? waiting, true);
  if (!first && line.length > 1) say(team, 'Cannot place there');
  if (n > 1) say(team, `${n} wall segments placed`);
  if (first) sendBuilder(team, first);
  return first;
}

/** A Worker free to build: idle, or digging ore (not hauling from a mill or derrick, nor building already). */
const freeToBuild = (w: Ent): boolean => !w.order || (w.order.t === 'harvest' && !w.order.res) || w.order.t === 'move';

/** Sites only go up while Workers build them: send the nearest free Worker to a new one. */
export function sendBuilder(team: number, site: Ent): Ent | null {
  const workers = G.ents.filter((e) => !e.dead && e.team === team && e.type === 'worker');
  if (!workers.length) { say(team, 'Needs a Worker to build it'); return null; }
  // building comes before chopping wood: with nobody else free, take a chopper
  let free = workers.filter(freeToBuild);
  if (!free.length) free = workers.filter((w) => w.order?.t === 'harvest' && w.order.res === 'wood');
  const w = free.sort((a, c) => Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(c.x - site.x, c.y - site.y))[0];
  if (w) orderFix(w, site);
  else say(team, 'No Worker free: right-click the site with Workers selected');
  return w ?? null;
}

/** A team's structures still going up, oldest first (optionally of one type). */
export function sitesOf(team: number, type?: BldType): Ent[] {
  return G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld' && !e.done && (!type || e.type === type));
}

/** Cancel the newest queued item of a type (or the newest site of a structure) and refund what was paid for it. */
export function cancel(team: number, type: Buildable): boolean {
  if (lineOf(type) === 'structure') {
    const site = sitesOf(team, type as BldType).pop();
    if (site) cancelSite(site);
    return !!site;
  }
  const q = G.prod[team][lineOf(type)];
  for (let i = q.length - 1; i >= 0; i--)
    if (q[i].type === type) {
      if (!q[i].paid) { q.splice(i, 1); return true; } // still waiting for funds: nothing to give back
      const p = priceOf(q[i].type);
      G.credits[team] += p.ore;
      G.wood[team] += p.wood;
      G.oil[team] += p.oil;
      G.aether[team] = (G.aether[team] ?? 0) + p.aether;
      q.splice(i, 1);
      return true;
    }
  return false;
}

export function toggleHold(team: number, type: Buildable): void {
  const it = G.prod[team][lineOf(type)].find((x) => x.type === type);
  if (it && !it.ready) it.hold = !it.hold;
}

export function itemsOf(team: number, type: Buildable): ProductionItem[] {
  return G.prod[team][lineOf(type)].filter((x) => x.type === type);
}

function deliver(team: number, type: UnitType): void {
  const b = producerOf(team, UNIT[type].producer);
  if (!b) return;
  const [x, y] = exitTile(b, b.rally ?? undefined), u = addUnit(type, team, (x + 0.5) * TS, (y + 0.5) * TS);
  u.face = u.tface = Math.PI / 2;
  say(team, `${UNIT[type].name} ready`);
  if (UNIT[type].haul) orderHarvest(u, x, y);
  else if (b.rally) orderMove(u, tileOf(b.rally.x), tileOf(b.rally.y));
}

function advance(team: number, type: TechType): void {
  const { age, heal, ward, upg, name } = TECH[type];
  if (upg) {
    G.upg[team] ??= noUpgrades();
    G.upg[team][upg.track] = Math.max(G.upg[team][upg.track], upg.level);
    say(team, `${name} researched`);
    return;
  }
  if (ward) {
    G.ward[team] = true;
    say(team, `${name} researched`);
    return;
  }
  if (heal != null) {
    G.heal[team] = Math.min(MAX_HEAL, Math.max(healOf(team), heal));
    say(team, `${name} researched`);
    return;
  }
  G.era[team] = Math.min(LAST_ERA, Math.max(eraOf(team), age ?? 0));
  say(team, `${ERA[G.era[team]].name} age reached`);
}

export function updProduction(team: number, dt: number): void {
  const speed = lowPower(team) ? 0.5 : 1;
  payWaiting(team);
  for (const line of LINES) {
    const q = G.prod[team][line], it = q[0];
    if (!it || it.ready || it.hold) continue;
    const at = producerOf(team, line);
    // gone, or only a yard left, which trains nothing but Workers: refunded
    if (!at || (at.type === 'yard' && line === 'infantry' && !YARD_INFANTRY.includes(it.type as UnitType))) { cancel(team, it.type); continue; }
    if (!it.paid) continue; // waiting until the side can pay for it
    it.prog += Math.min((speed * refitBonus(at) * dt) / timeOf(it.type), 1 - it.prog);
    if (it.prog < 1 - 1e-9) continue;
    if (line === 'tech' || line === 'hospital' || line === 'armory') { q.shift(); advance(team, it.type as TechType); }
    else { q.shift(); deliver(team, it.type as UnitType); }
  }
}
