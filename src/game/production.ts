// Sidebar production: structures are placed first and then build on site (any number at once, see
// startSite and building.ts); one research (an age, or the Aether Ward) at a time from the Construction Yard,
// one healing research at a time at the Hospital and one weapons or armor upgrade at a time at the Armory,
// and queues of infantry and vehicles. What can be built depends on the team's age (data/era.ts).
// The whole price (ore, wood, oil, Aether) is paid when an order starts; an order the side can't
// afford doesn't start, and cancelling refunds it in full. Production runs at half speed on low power.
import { G, say, type Ent, type Production, type ProductionItem, type ProductionLine } from './state.ts';
import { TS } from './const.ts';
import { UNIT, UNIT_TYPES, isUnitType, type UnitType } from '../data/unit.ts';
import { BUILDING, BLD_TYPES, type BldType } from '../data/building.ts';
import { ERA, LAST_ERA, MAX_HEAL, TECH, TECH_TYPES, UPGRADE_TRACKS, isTechType, type TechType } from '../data/era.ts';
import { noUpgrades, upgradeOf } from './upgrade.ts';
import { addUnit, countOf, hasBuilding, lowPower } from './entity.ts';
import { MAX_WAYGATES } from '../data/aether.ts';
import { cancelSite, canPlace, exitTile, placeBuilding } from './building.ts';
import { orderHarvest, orderMove } from './order.ts';
import { tileOf } from './state.ts';

export type Buildable = UnitType | BldType | TechType;

const QUEUE_MAX = 5;
const PRODUCER: Record<ProductionLine, BldType> = { structure: 'yard', infantry: 'barracks', vehicle: 'factory', air: 'airfield', tech: 'yard', hospital: 'hospital', armory: 'armory' };
const LINES: ProductionLine[] = ['structure', 'infantry', 'vehicle', 'air', 'tech', 'hospital', 'armory'];
const FUNDS_NOTICE = 6;
const SHORT_MSG = { ore: 'Not enough ore', wood: 'Not enough wood', oil: 'Not enough oil', aether: 'Not enough Aether' };
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
/** Things that cost Aether stay hidden until the side first finds some. */
const revealed = (team: number, t: Buildable): boolean => priceOf(t).aether <= 0 || !!G.aetherFound[team];
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

export function producerOf(team: number, line: ProductionLine): Ent | null {
  return G.ents.find((e) => !e.dead && e.team === team && e.type === PRODUCER[line] && e.done) ?? null;
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
  return UNIT_TYPES.filter((t) => UNIT[t].producer === line && UNIT[t].era <= era && era < (UNIT[t].until ?? Infinity) && revealed(team, t) && (UNIT[t].requires ?? []).every((r) => hasBuilding(team, r)));
}

/** The first resource the team lacks for the whole price, or null if it can pay. */
function shortOf(team: number, t: Buildable): keyof typeof SHORT_MSG | null {
  const p = priceOf(t);
  return G.credits[team] < p.ore ? 'ore' : G.wood[team] < p.wood ? 'wood' : G.oil[team] < p.oil ? 'oil' : (G.aether[team] ?? 0) < p.aether ? 'aether' : null;
}

function fundsNotice(team: number, short: keyof typeof SHORT_MSG): void {
  if (G.gameT - (lastFundsNotice[team] ?? -99) > FUNDS_NOTICE) { lastFundsNotice[team] = G.gameT; say(team, SHORT_MSG[short]); }
}

function pay(team: number, type: Buildable): void {
  const p = priceOf(type);
  G.credits[team] -= p.ore;
  G.wood[team] -= p.wood;
  G.oil[team] -= p.oil;
  if (p.aether) G.aether[team] -= p.aether;
}

/**
 * Start an order, paying its whole price now. Returns false if it can't start (or can't be afforded).
 * Structures don't queue: they start when placed (startSite), so for one this only reports a shortfall.
 */
export function enqueue(team: number, type: Buildable): boolean {
  const line = lineOf(type), q = G.prod[team][line];
  if (!available(team, line).includes(type)) return false;
  const short = shortOf(team, type);
  if (line === 'structure') { if (short) fundsNotice(team, short); return false; }
  const research = line === 'tech' || line === 'hospital' || line === 'armory', max = research ? 1 : QUEUE_MAX;
  if (q.length >= max) { say(team, research ? 'Already researching' : 'Queue is full'); return false; }
  if (short) { fundsNotice(team, short); return false; }
  pay(team, type);
  q.push({ type, prog: 0, spent: priceOf(type).ore, ready: false, hold: false });
  return true;
}

/** Can the team lay out this structure here right now (available, affordable, and a free spot)? */
export function canStartSite(team: number, type: BldType, tx: number, ty: number): boolean {
  return available(team, 'structure').includes(type) && canAfford(team, type) && canPlace(tx, ty, BUILDING[type].size, team);
}

/** Place a structure: pay its whole price and lay out a site that builds itself. */
export function startSite(team: number, type: BldType, tx: number, ty: number): Ent | null {
  if (!available(team, 'structure').includes(type)) return null;
  const short = shortOf(team, type);
  if (short) { fundsNotice(team, short); return null; }
  const b = placeBuilding(team, type, tx, ty);
  if (b) pay(team, type);
  return b;
}

/** A team's structures still going up, oldest first (optionally of one type). */
export function sitesOf(team: number, type?: BldType): Ent[] {
  return G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld' && !e.done && (!type || e.type === type));
}

/** Cancel the newest queued item of a type (or the newest site of a structure) and refund its whole price. */
export function cancel(team: number, type: Buildable): boolean {
  if (lineOf(type) === 'structure') {
    const site = sitesOf(team, type as BldType).pop();
    if (site) cancelSite(site);
    return !!site;
  }
  const q = G.prod[team][lineOf(type)];
  for (let i = q.length - 1; i >= 0; i--)
    if (q[i].type === type) {
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
  for (const line of LINES) {
    const q = G.prod[team][line], it = q[0];
    if (!it || it.ready || it.hold) continue;
    if (!producerOf(team, line)) { cancel(team, it.type); continue; }
    it.prog += Math.min((speed * dt) / timeOf(it.type), 1 - it.prog);
    if (it.prog < 1 - 1e-9) continue;
    if (line === 'tech' || line === 'hospital' || line === 'armory') { q.shift(); advance(team, it.type as TechType); }
    else { q.shift(); deliver(team, it.type as UnitType); }
  }
}
