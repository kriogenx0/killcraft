// Computer player: grows a base along a build plan, keeps harvesters working, trains a mixed army
// and attacks in waves. A couple of troops go and hold an Aether deposit once the army can spare them,
// and a small hunting party goes to beat down and capture the nearest wild creature of myth.
import { G, haulOf, isAir, isHarvester, isOrganic, tileOf, unitDef, valid, type Ent, type Tile } from './state.ts';
import { TECH, isTechType } from '../data/era.ts';
import { MW, TS } from './const.ts';
import { BUILDING, isWall, type BldType } from '../data/building.ts';
import { UNIT, type UnitType } from '../data/unit.ts';
import { countOf, hasBuilding, power } from './entity.ts';
import { canPlace, wallLine } from './building.ts';
import { available, canAfford, costOf, enqueue, priceOf, sitesOf, startSite } from './production.ts';
import { oilLeft, oilNear, treesNear } from './economy.ts';
import { orderFix, orderMove, setStance, orderHaul } from './order.ts';
import { deposits, holderOf } from './aether.ts';
import { wildBeasts } from './creatures.ts';
import { canAttack } from './combat.ts';
import { canRefit, refitPrice, toggleRefit } from './refit.ts';
import { CAPTURE_REACH } from '../data/creatures.ts';
import { AETHER_BANK_REACH, AETHER_CARRY } from '../data/aether.ts';

interface AiState {
  on: boolean;
  attackAt: number;
  attacking: boolean;
  /** the side this player is fighting (in a free-for-all, the nearest one still standing) */
  foe: number;
  /** units kept home to guard an Aether crystal */
  guards: Set<number>;
  /** ore set aside for the next structure, which must be paid for in full before it starts */
  reserve: number;
  /** units sent to capture a wild creature, and the creature */
  hunters: Set<number>;
  prey: number | null;
}

export const ais: AiState[] = [
  { on: false, attackAt: 8, attacking: false, foe: 1, guards: new Set(), reserve: 0, hunters: new Set(), prey: null },
  { on: true, attackAt: 8, attacking: false, foe: 0, guards: new Set(), reserve: 0, hunters: new Set(), prey: null },
];

/** Troops sent to hold an Aether deposit, and how big the army must be before any go. */
const GUARDS = 2;
const GUARD_ARMY = 5;
/** The hunting party sent after a wild creature, the fewest worth sending, and the army it takes first. */
const HUNTERS = 5;
const MIN_HUNTERS = 3;
const HUNT_ARMY = 9;

const PLAN: BldType[] = ['power', 'refinery', 'mill', 'barracks', 'tower', 'power', 'factory', 'derrick', 'works', 'hospital', 'armory', 'mill', 'tower', 'turret', 'power', 'refinery', 'turret', 'derrick', 'power', 'airfield', 'turret', 'flak', 'power'];
const MAX_WAVE = 30;
const SKIRMISHERS = new Set<string>(['jeep']);

/** Reset every computer player for a new match of `teams` sides (extra sides start switched on). */
export function resetAi(teams = 2): void {
  while (ais.length < teams) ais.push({ on: true, attackAt: 8, attacking: false, foe: -1, guards: new Set(), reserve: 0, hunters: new Set(), prey: null });
  wallPause.length = 0;
  ais.forEach((a, team) => { a.attackAt = 8; a.attacking = false; a.guards.clear(); a.reserve = 0; a.hunters.clear(); a.prey = null; a.foe = teams === 2 ? 1 - team : -1; });
}

const homeOf = (team: number): Ent | undefined =>
  G.ents.find((e) => !e.dead && e.team === team && e.type === 'yard') ?? G.ents.find((e) => !e.dead && e.team === team && e.kind === 'bld');
const standing = (team: number) => G.ents.some((e) => !e.dead && e.team === team && (e.kind === 'bld' || (e.kind === 'unit' && !!unitDef(e).weapon && !isHarvester(e))));

/** Keep fighting the same side until it falls, then turn on the nearest one left. */
function foeOf(team: number): number {
  const A = ais[team];
  // everyone turns on a side with a bounty on it (see bounty.ts)
  if (G.leader >= 0 && G.leader !== team && standing(G.leader)) {
    if (A.foe !== G.leader) { A.foe = G.leader; A.attacking = false; }
    return G.leader;
  }
  if (A.foe >= 0 && A.foe !== team && standing(A.foe)) return A.foe;
  const home = homeOf(team) ?? G.ents.find((e) => !e.dead && e.team === team);
  let best = -1, bestD = Infinity;
  for (let t = 0; t < G.teams; t++) {
    if (t === team || !standing(t)) continue;
    const there = homeOf(t) ?? G.ents.find((e) => !e.dead && e.team === t);
    const d = home && there ? Math.hypot(there.x - home.x, there.y - home.y) + Math.random() * TS : 0;
    if (d < bestD) { bestD = d; best = t; }
  }
  if (best !== A.foe) { A.foe = best; A.attacking = false; }
  return best;
}

function nextStructure(team: number, walling: boolean): BldType | null {
  const p = power(team), can = available(team, 'structure');
  // count what the sites going up will make and use once they're done
  for (const e of sitesOf(team)) { const w = BUILDING[e.type as BldType].power; if (w > 0) p.made += w; else p.used -= w; }
  if (p.used + 20 > p.made && can.includes('power')) return 'power';
  // walls are cheap and go up alongside the build plan, not after it: a stretch for each defensive structure
  const wall = walling ? null : wallWanted(team, can);
  if (wall) return wall;
  const need: Partial<Record<BldType, number>> = {};
  for (const t of PLAN) {
    // structures from a later age wait until the research is done
    if (BUILDING[t].era > G.era[team]) continue;
    // the Engine Works only matters until it has done its job
    const to = BUILDING[t].advances;
    if (to != null && G.era[team] >= to) continue;
    need[t] = (need[t] ?? 0) + 1;
    if (countOf(team, t) < (need[t] ?? 0)) return can.includes(t) ? t : null;
  }
  // answer enemy aircraft with flak
  const foeAir = G.ents.filter((e) => !e.dead && e.team >= 0 && e.team !== team && isAir(e)).length;
  if (foeAir > 0 && countOf(team, 'flak') < Math.min(4, 1 + foeAir) && can.includes('flak') && G.credits[team] > 900) return 'flak';
  // Aether: a Ward Stone once the enemy fields cloaked jeeps, and a Star Shrine when there's Aether to spare
  const aether = G.aether[team] ?? 0;
  if (can.includes('wardstone') && countOf(team, 'wardstone') < 1 && aether >= (BUILDING.wardstone.aether ?? 0) && G.ents.some((e) => !e.dead && e.team >= 0 && e.team !== team && e.type === 'phantom')) return 'wardstone';
  if (can.includes('shrine') && countOf(team, 'shrine') < 1 && aether >= (BUILDING.shrine.aether ?? 0) + 40 && G.credits[team] > 1200) return 'shrine';
  // short of wood with ore to spare: another mill, by fresh trees
  if (G.wood[team] < 200 && G.credits[team] > 1500 && countOf(team, 'mill') < 5 && can.includes('mill')) return 'mill';
  if (G.credits[team] > 3000 && countOf(team, 'refinery') < 3) return 'refinery';
  return defense(team, can);
}

/** Wall segments a computer player puts up, at most. */
const AI_WALLS = 28;
/** Segments in each stretch of wall; stretches are spread out, leaving gaps for the side's own units. */
const AI_WALL_RUN = 4;

/**
 * Spare money goes into defenses that answer what the enemy fields: pillboxes against infantry,
 * gun and missile turrets against vehicles, stretches of the best wall the age allows, and one
 * Big Bertha once the bank is deep.
 */
function defense(team: number, can: readonly string[]): BldType | null {
  const credits = G.credits[team], foe = G.ents.filter((e) => !e.dead && e.team === 1 - team && e.kind === 'unit' && !isAir(e));
  const infantry = foe.filter(isOrganic).length, vehicles = foe.length - infantry;
  const turrets = DEFENSES.reduce((n, t) => n + countOf(team, t), 0);
  if (credits > 4500 && countOf(team, 'bertha') < 1 && can.includes('bertha') && G.wood[team] >= 100) return 'bertha';
  if (credits > 2500 && turrets < 5) {
    const vsInfantry: BldType = can.includes('pillbox') ? 'pillbox' : 'tower';
    const vsArmor: BldType = can.includes('atturret') && G.oil[team] >= 150 ? 'atturret' : can.includes('turret') ? 'turret' : 'tower';
    const pick = infantry > vehicles ? vsInfantry : vehicles > infantry ? vsArmor : Math.random() < 0.5 ? vsInfantry : vsArmor;
    if (can.includes(pick)) return pick;
  }
  return null;
}

const DEFENSES: BldType[] = ['tower', 'turret', 'pillbox', 'atturret'];

/** Seconds before trying walls again after finding nowhere to put one, and until when each side waits. */
const WALL_RETRY = 30;
const wallPause: number[] = [];

/**
 * The wall to put up next, if any: a stretch of AI_WALL_RUN segments for every defensive structure
 * (so walls follow the first Watchtower), up to AI_WALLS, in the best wall the side can afford a
 * whole stretch of.
 */
function wallWanted(team: number, can: readonly string[]): BldType | null {
  const turrets = DEFENSES.reduce((n, t) => n + countOf(team, t), 0);
  const walls = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld' && isWall(e.type)).length;
  if (!turrets || walls >= Math.min(AI_WALLS, turrets * AI_WALL_RUN) || G.gameT < (wallPause[team] ?? 0)) return null;
  // keep enough ore for the next structure in the plan: walls are an extra, never a reason to stall
  return (['concretewall', 'stonewall', 'palisade'] as BldType[]).find((t) => {
    const p = priceOf(t);
    return can.includes(t) && G.credits[team] >= p.ore * AI_WALL_RUN + 300 && G.wood[team] >= p.wood * AI_WALL_RUN;
  }) ?? null;
}

/**
 * A short stretch of wall across the approach from the enemy, a few tiles out from the yard, kept
 * off ore and clear of other structures so harvesters and new units can still get around it.
 */
function wallSite(team: number, yard: Ent, foe: Ent | undefined): [Tile, Tile] | null {
  for (let k = 0; k < 300; k++) {
    const a = (foe ? Math.atan2(foe.y - yard.y, foe.x - yard.x) : Math.random() * Math.PI * 2) + (Math.random() - 0.5) * 2.4;
    const rad = 5 + Math.random() * (3 + k / 60), cx = yard.x / TS + Math.cos(a) * rad, cy = yard.y / TS + Math.sin(a) * rad;
    const px = -Math.sin(a), py = Math.cos(a), half = (AI_WALL_RUN - 1) / 2;
    const x0 = Math.round(cx - px * half), y0 = Math.round(cy - py * half), x1 = Math.round(cx + px * half), y1 = Math.round(cy + py * half);
    const line = wallLine(x0, y0, x1, y1);
    if (line.length < 2) continue;
    const ok = line.every(([x, y]) => canPlace(x, y, 1, team, false, true) && G.ore[y * MW + x] <= 0 && clearAround(x, y));
    if (ok) return [line[0], line[line.length - 1]];
  }
  return null;
}

/** A free tile between the wall and any structure, and two between stretches, so walls never seal a gap shut. */
function clearAround(x: number, y: number): boolean {
  return !G.ents.some((e) => {
    if (e.dead || e.kind !== 'bld') return false;
    const m = isWall(e.type) ? 2 : 1;
    return x >= e.tx - m && x < e.tx + e.w + m && y >= e.ty - m && y < e.ty + e.h + m;
  });
}

function findSite(team: number, type: BldType): Tile | null {
  const s = BUILDING[type].size, own = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld');
  const yard = own.find((e) => e.type === 'yard') ?? own[0];
  if (!yard) return null;
  if (type === 'derrick') return wellSite(team, s, yard);
  const foe = G.ents.find((e) => !e.dead && e.team === ais[team]?.foe && e.kind === 'bld');
  // a mill goes wherever it reaches the most trees
  let best: Tile | null = null, bestTrees = -1;
  for (let k = 0; k < 200; k++) {
    // turrets face the enemy; everything else clusters around the yard
    const def = DEFENSES.includes(type) || type === 'flak';
    const a = def && foe ? Math.atan2(foe.y - yard.y, foe.x - yard.x) + (Math.random() - 0.5) * 1.8 : Math.random() * Math.PI * 2;
    const rad = (def ? 4 : 2.5) + Math.random() * (4 + k / 25);
    const tx = Math.round(yard.x / TS + Math.cos(a) * rad - s / 2), ty = Math.round(yard.y / TS + Math.sin(a) * rad - s / 2);
    if (!canPlace(tx, ty, s, team, true)) continue;
    if (type !== 'mill') return [tx, ty];
    const n = treesNear(tx, ty, s);
    if (n > bestTrees) { bestTrees = n; best = [tx, ty]; }
  }
  return best;
}

/** The placeable spot near the base that reaches the most oil, if any reaches some. */
function wellSite(team: number, s: number, yard: Ent): Tile | null {
  let best: Tile | null = null, most = 0;
  const cx = Math.round(yard.x / TS), cy = Math.round(yard.y / TS);
  for (let ty = cy - 16; ty <= cy + 16; ty++)
    for (let tx = cx - 16; tx <= cx + 16; tx++) {
      const oil = oilNear(tx, ty, s);
      if (oil > most && canPlace(tx, ty, s, team, true)) { most = oil; best = [tx, ty]; }
    }
  return best;
}

/** Sites the computer keeps going at once: one, or two with money in the bank. */
const maxSites = (team: number): number => (G.credits[team] > 2500 ? 2 : 1);

function construction(team: number): void {
  // a wall line is many small sites: it doesn't hold up the rest of the base
  const sites = sitesOf(team), walling = sites.some((e) => isWall(e.type));
  if (sites.filter((e) => !isWall(e.type)).length >= maxSites(team)) { ais[team].reserve = 0; return; }
  const t = nextStructure(team, walling);
  if (!t) { ais[team].reserve = 0; return; }
  // structures are paid for up front: save up for one rather than spend everything on troops
  if (!canAfford(team, t)) { ais[team].reserve = costOf(t); return; }
  if (isWall(t)) {
    const own = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld');
    const yard = own.find((e) => e.type === 'yard') ?? own[0], foe = G.ents.find((e) => !e.dead && e.team === 1 - team && e.kind === 'bld');
    const line = yard ? wallSite(team, yard, foe) : null;
    // nowhere to put a stretch: give up on walls for a while rather than hold up the base
    if (!line || !startSite(team, t, line[0][0], line[0][1], line[1][0], line[1][1])) wallPause[team] = G.gameT + WALL_RETRY;
    ais[team].reserve = 0;
    return;
  }
  const site = findSite(team, t);
  ais[team].reserve = site && startSite(team, t, site[0], site[1]) ? 0 : costOf(t);
}

/**
 * Advance an age once the base is running and the bank can spare it. Faster healing (at the Hospital)
 * comes once there's an infantry force worth healing.
 */
function research(team: number): void {
  if (countOf(team, 'refinery') < 1 || gatherers(team) < 1) return;
  const credits = G.credits[team];
  // healing is researched at the Hospital, alongside the yard
  const heal = available(team, 'hospital').filter(isTechType)[0];
  const infantry = G.ents.filter((e) => !e.dead && e.team === team && isOrganic(e)).length;
  if (heal && !G.prod[team].hospital.length && infantry >= 4 && credits > costOf(heal) + 300 && canAfford(team, heal)) enqueue(team, heal);
  if (G.prod[team].tech.length) return;
  const can = available(team, 'tech').filter(isTechType);
  const age = can.find((t) => TECH[t].age != null);
  if (age && G.credits[team] > costOf(age) + 200 && canAfford(team, age)) { enqueue(team, age); return; }
  const ward = can.find((t) => TECH[t].ward);
  // the Ward is a luxury: only once past the first age, with the bank to spare
  if (ward && G.era[team] >= 1 && credits > costOf(ward) + 1500 && G.aether[team] >= priceOf(ward).aether) enqueue(team, ward);
}

/** Which buildings the computer upgrades to its age first: the base's heart, then its defenses. */
const REFIT_FIRST: BldType[] = ['yard', 'refinery', 'power', 'barracks', 'factory', 'tower', 'turret', 'flak', 'airfield', 'works', 'hospital', 'armory', 'derrick', 'mill'];
const refitRank = (b: Ent): number => { const i = REFIT_FIRST.indexOf(b.type as BldType); return i < 0 ? REFIT_FIRST.length : i; };

/** Ore the computer keeps back for troops and repairs when paying for an upgrade. */
const REFIT_RESERVE = 300;

/**
 * Upgrade one building at a time to the side's age: the most important one it can afford, so an
 * expensive Construction Yard waiting for funds doesn't hold up the cheaper ones.
 */
function refits(team: number): void {
  const own = G.ents.filter((b) => !b.dead && b.team === team && b.kind === 'bld');
  if (own.some((b) => b.upT != null)) return;
  const b = own.filter(canRefit).sort((x, y) => refitRank(x) - refitRank(y)).find((c) => {
    const p = refitPrice(c);
    return G.credits[team] >= p.ore + REFIT_RESERVE && G.wood[team] >= p.wood;
  });
  if (b) toggleRefit(b);
}

const ownDone = (team: number, type: BldType): Ent[] => G.ents.filter((e) => !e.dead && e.team === team && e.type === type && e.done);

/** Mills and derricks worth sending a hauler to (a dry derrick with an empty store isn't). */
const stores = (team: number): Ent[] => [...ownDone(team, 'mill'), ...ownDone(team, 'derrick').filter((d) => d.carry > 1 || oilLeft(d) > 0)];

function workersWanted(team: number): number {
  const ore = G.era[team] >= UNIT.harvester.era ? 0 : countOf(team, 'refinery') * 3;
  return Math.min(14, ore + stores(team).length);
}

/** Keep one Worker hauling from every mill and derrick, taken off the ore if need be. */
function assignHaulers(team: number): void {
  const workers = G.ents.filter((e) => !e.dead && e.team === team && e.type === 'worker');
  const hauling = (b: Ent) => workers.some((w) => w.order?.t === 'harvest' && w.order.src === b.id);
  for (const b of stores(team)) {
    if (hauling(b)) continue;
    const free = workers.filter((w) => !w.order || (w.order.t === 'harvest' && !w.order.res));
    // leave at least one on the ore while Workers are the only miners
    if (G.era[team] < UNIT.harvester.era && free.filter((w) => w.order?.t === 'harvest').length <= 1 && free.every((w) => w.order)) return;
    const w = free.sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
    if (!w) return;
    orderHaul(w, b);
  }
}

/** Workers and harvesters on the team. */
const gatherers = (team: number): number => G.ents.filter((e) => !e.dead && e.team === team && isHarvester(e)).length;

/** At least half the wood and oil a research needs is in the bank. */

/**
 * Armory upgrades once there's an army to improve, favoring whichever side (troops or machines) the
 * army has more of, and alternating weapons and armor by taking the cheaper level first.
 */
function armory(team: number): void {
  if (G.prod[team].armory.length) return;
  const can = available(team, 'armory').filter(isTechType);
  if (!can.length) return;
  const army = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e));
  if (army.length < 5) return;
  const foot = army.filter(isOrganic).length, side = foot * 2 >= army.length ? 'inf' : 'veh';
  const mine = can.filter((t) => TECH[t].upg?.track.startsWith(side));
  const t = (mine.length ? mine : can).reduce((a, b) => (costOf(b) < costOf(a) ? b : a));
  // don't starve the next age: keep its price in the bank too
  const age = available(team, 'tech').filter(isTechType).find((x) => TECH[x].age != null);
  if (G.credits[team] > costOf(t) * 0.6 + 600 + (age ? costOf(age) * 0.3 : 0)) enqueue(team, t);
}

/** Pick from weighted options, skipping anything the team can't build yet or lacks the wood or oil for. */
function pick(team: number, line: 'infantry' | 'vehicle' | 'air', options: [UnitType, number][]): UnitType | null {
  const can = available(team, line), enough = (t: UnitType) => { const p = priceOf(t); return G.wood[team] >= p.wood && G.oil[team] >= p.oil && (G.aether[team] ?? 0) >= p.aether; };
  const ok = options.filter(([t, w]) => w > 0 && can.includes(t) && enough(t));
  let r = Math.random() * ok.reduce((s, [, w]) => s + w, 0);
  for (const [t, w] of ok) if ((r -= w) < 0) return t;
  return ok[0]?.[0] ?? null;
}

function training(team: number): void {
  // down to its last gatherer: troops leave the price of a Worker in hand. Nothing else brings ore
  // home (scrapped buildings leave ore on the ground), so a side with none left could never recover.
  const keep = gatherers(team) < 2 ? costOf('worker') : 0;
  const prod = G.prod[team], credits = G.credits[team] - Math.max(ais[team].reserve, keep);
  // saving up for the next structure
  const saving = credits < 150;
  if (hasBuilding(team, 'factory') && prod.vehicle.length < 2) {
    const refineries = countOf(team, 'refinery');
    let t: UnitType | null = null;
    if (available(team, 'vehicle').includes('harvester') && countOf(team, 'harvester') < Math.min(6, refineries * 2) && !prod.vehicle.some((x) => x.type === 'harvester')) t = 'harvester';
    else if (!saving && credits > 500)
      t = pick(team, 'vehicle', [['heavy', credits > 1600 ? 3 : 0], ['catapult', credits > 1200 ? 2 : 0.5], ['jeep', 2], ['tank', 5], ['phantom', 1.5], ['starfall', 2.5]]);
    if (t) enqueue(team, t);
  }
  // a few aircraft once there's money to spare
  if (!saving && hasBuilding(team, 'airfield') && prod.air.length < 1 && credits > 900) {
    const t = pick(team, 'air', [['balloon', 1], ['biplane', 2], ['helicopter', 3], ['drone', 2], ['harpy', 1.5], ['pegasus', 2], ['griffin', 2]]);
    if (t) enqueue(team, t);
  }
  // Workers: about three per refinery for ore before the Modern age, plus one per mill and derrick to haul
  if (hasBuilding(team, 'barracks') && available(team, 'infantry').includes('worker') && countOf(team, 'worker') < workersWanted(team) &&
    !prod.infantry.some((x) => x.type === 'worker') && prod.infantry.length < 5) enqueue(team, 'worker');
  // spend a growing bank on more troops
  const infantryQueue = credits > 2500 ? 4 : 2;
  if (!saving && hasBuilding(team, 'barracks') && prod.infantry.length < infantryQueue && credits > 150) {
    // about one medic for every six fighters on foot
    const medics = countOf(team, 'medic'), foot = G.ents.filter((e) => !e.dead && e.team === team && isOrganic(e) && e.type !== 'medic').length;
    const t = pick(team, 'infantry', [['medic', medics * 6 < foot ? 2.5 : 0], ['knight', credits > 700 ? 1.5 : 0], ['swordsman', 2.5], ['crossbowman', 2], ['rocket', 2], ['rifleman', 3], ['gunner', 1.5], ['wraith', credits > 700 ? 1.5 : 0], ['hexblade', 1.5],
      ['centaur', 2], ['minotaur', 1.5], ['cyclops', credits > 900 ? 1.5 : 0], ['hydra', credits > 900 ? 1.5 : 0], ['cerberus', 1.5]]);
    if (t) enqueue(team, t);
  }
}

/** Workers a computer player takes off the ore, at most, to help sites go up and fix badly damaged buildings. */
const MENDERS = 2;

function upkeep(team: number): void {
  const rich = G.credits[team] > 600;
  for (const b of G.ents)
    if (!b.dead && b.team === team && b.kind === 'bld' && b.done && b.hp < b.maxhp * 0.6 && rich) b.repairing = true;
  // a couple of Workers off the ore (never the haulers) help sites go up and, with ore to spare, fix what's badly hurt
  const workers = G.ents.filter((e) => !e.dead && e.team === team && e.type === 'worker');
  let menders = workers.filter((w) => w.order?.t === 'heal' && w.order.sent).length;
  for (const b of G.ents) {
    if (menders >= MENDERS) return;
    if (b.dead || b.team !== team || b.kind !== 'bld' || !(!b.done || (rich && b.hp < b.maxhp * 0.6))) continue;
    if (workers.some((w) => w.order?.t === 'heal' && w.order.tgt === b.id)) continue;
    const free = workers.filter((w) => !w.order || (w.order.t === 'harvest' && !w.order.res && w.carry < haulOf(w) * 0.5));
    // leave at least two on the ore
    if (free.filter((w) => w.order?.t === 'harvest').length <= 2) return;
    const w = free.sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
    if (!w || Math.hypot(w.x - b.x, w.y - b.y) > 16 * TS) continue;
    orderFix(w, b);
    menders++;
  }
}

/** Keep a couple of troops on the nearest Aether deposit nobody else holds. */
function holdAether(team: number, army: Ent[], home: Ent | undefined): void {
  const A = ais[team];
  for (const id of A.guards) { const g = G.byId.get(id); if (!g || g.dead) A.guards.delete(id); }
  const left = deposits();
  if (!left.length || !home) { A.guards.clear(); return; }
  const near = (d: Ent) => Math.hypot(d.x - home.x, d.y - home.y);
  const target = left.filter((d) => { const h = holderOf(d); return h < 0 || h === team; }).sort((a, b) => near(a) - near(b))[0] ?? left.sort((a, b) => near(a) - near(b))[0];
  if (A.guards.size < GUARDS && army.length >= GUARD_ARMY) {
    const free = army.filter((u) => !A.guards.has(u.id) && !u.order).sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
    for (const u of free.slice(0, GUARDS - A.guards.size)) A.guards.add(u.id);
  }
  // guards drift back to the deposit whenever they're idle away from it, and carry Aether home when full
  for (const id of A.guards) {
    const g = G.byId.get(id);
    if (!g || g.order) continue;
    const atHome = Math.hypot(g.x - home.x, g.y - home.y) < (AETHER_BANK_REACH + 2) * TS;
    if ((g.ae ?? 0) >= AETHER_CARRY - 0.5 && !atHome) orderMove(g, tileOf(home.x), tileOf(home.y) + 3);
    else if ((g.ae ?? 0) > 0 && atHome) continue; // banking
    else if (Math.hypot(g.x - target.x, g.y - target.y) > 1.5 * TS) orderMove(g, tileOf(target.x), tileOf(target.y) + 1);
  }
}

/**
 * Send a hunting party after the nearest wild creature it can fight: they beat it down, then stand
 * beside it until it's captured. The party goes home to the army once the creature is gone.
 */
function huntBeasts(team: number, army: Ent[], home: Ent | undefined): void {
  const A = ais[team];
  for (const id of A.hunters) { const h = G.byId.get(id); if (!h || h.dead || h.team !== team) A.hunters.delete(id); }
  let prey = A.prey != null ? G.byId.get(A.prey) : undefined;
  if (!prey || prey.dead || !prey.wild || !A.hunters.size) { prey = undefined; A.prey = null; A.hunters.clear(); }
  if (!prey && home && army.length >= HUNT_ARMY) {
    const near = (e: Ent) => Math.hypot(e.x - home.x, e.y - home.y);
    for (const b of wildBeasts().sort((a, c) => near(a) - near(c))) {
      const party = army.filter((u) => !u.order && canAttack(u, b)).sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y)).slice(0, HUNTERS);
      if (party.length < MIN_HUNTERS) continue;
      prey = b;
      A.prey = b.id;
      for (const u of party) A.hunters.add(u.id);
      break;
    }
  }
  if (!prey?.wild) return;
  for (const id of A.hunters) {
    const h = G.byId.get(id);
    if (!h || h.order?.t === 'attack') continue;
    const d = Math.hypot(h.x - prey.x, h.y - prey.y);
    if (prey.wild.down) { if (!h.order && d > CAPTURE_REACH * TS * 0.6) orderMove(h, tileOf(prey.x), tileOf(prey.y) + 1); }
    else if (!h.order) orderMove(h, tileOf(prey.x), tileOf(prey.y));
  }
}

/**
 * Send a unit toward a tile, unless it is already fighting someone on the way there, or already
 * heading close enough to it. Re-giving the same order every think would make it drop the fight
 * (or its path) and pick it up again: attack, stop, attack, stop.
 */
function advance(u: Ent, tx: number, ty: number): void {
  const o = u.order;
  if (o?.t === 'move' && (valid(o.sub) || Math.max(Math.abs(o.gx - tx), Math.abs(o.gy - ty)) <= 3)) return;
  orderMove(u, tx, ty);
}

function military(team: number): void {
  const A = ais[team], foe = foeOf(team);
  if (foe < 0) return;
  const all = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e));
  holdAether(team, all, homeOf(team));
  huntBeasts(team, all.filter((e) => !A.guards.has(e.id)), homeOf(team));
  const army = all.filter((e) => !A.guards.has(e.id) && !A.hunters.has(e.id));
  // fast raiders shoot on the move; everyone else stops to fight (the default stance)
  for (const u of army) if (SKIRMISHERS.has(u.type) && u.stance !== 'skirmish') setStance(u, 'skirmish');
  const home = homeOf(team);
  if (home) {
    // defend against anyone, not just the side we're fighting
    const threat = G.ents.find((e) => !e.dead && e.team >= 0 && e.team !== team && e.kind === 'unit' && Math.hypot(e.x - home.x, e.y - home.y) < 14 * TS);
    if (threat)
      for (const u of army)
        if ((!u.order || u.order.t === 'move') && Math.hypot(u.x - home.x, u.y - home.y) < 22 * TS) advance(u, tileOf(threat.x), tileOf(threat.y));
  }
  const targets = G.ents.filter((e) => !e.dead && e.team === foe && e.kind === 'bld');
  if (!targets.length) targets.push(...G.ents.filter((e) => !e.dead && e.team === foe && e.kind === 'unit'));
  if (!targets.length) return;
  const from: Ent | { x: number; y: number } = home ?? army[0] ?? { x: 0, y: 0 };
  const tgt = targets.reduce((a, p) => (Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(a.x - from.x, a.y - from.y) ? p : a));
  const idle = army.filter((u) => !u.order);
  const enemyArmy = G.ents.filter((e) => !e.dead && e.team === foe && e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e)).length;
  // attack in waves, or press on whenever the enemy army is clearly smaller
  if (army.length >= A.attackAt || (army.length >= 6 && army.length >= enemyArmy * 2)) {
    A.attacking = true;
    A.attackAt = Math.min(MAX_WAVE, A.attackAt + 3);
    for (const u of army) if (!u.order || u.order.t === 'move') advance(u, tileOf(tgt.x), tileOf(tgt.y));
  } else if (A.attacking && home) {
    for (const u of idle) if (Math.hypot(u.x - home.x, u.y - home.y) > 10 * TS) orderMove(u, tileOf(tgt.x), tileOf(tgt.y));
  }
  // medics trail the army: each idle one walks to the nearest fighter that's away from it
  for (const m of G.ents) {
    if (m.dead || m.team !== team || m.type !== 'medic' || m.order || !army.length) continue;
    const near = army.reduce((a, p) => (Math.hypot(p.x - m.x, p.y - m.y) < Math.hypot(a.x - m.x, a.y - m.y) ? p : a));
    if (Math.hypot(near.x - m.x, near.y - m.y) > 3 * TS) orderMove(m, tileOf(near.x), tileOf(near.y));
  }
  if (!home) return;
  // muster new troops in front of the base
  const a = Math.atan2(tgt.y - home.y, tgt.x - home.x);
  for (const u of idle) {
    // idle troops carrying bounty loot take it home to bank it
    if (u.loot) { orderMove(u, tileOf(home.x), tileOf(home.y) + 3); continue; }
    const d = Math.hypot(u.x - home.x, u.y - home.y);
    if (d > 9 * TS && (!A.attacking || d < 12 * TS)) orderMove(u, tileOf(home.x + Math.cos(a) * 6 * TS), tileOf(home.y + Math.sin(a) * 6 * TS));
  }
}

export function aiThink(team: number): void {
  construction(team);
  assignHaulers(team);
  research(team);
  refits(team);
  armory(team);
  training(team);
  upkeep(team);
  military(team);
}
