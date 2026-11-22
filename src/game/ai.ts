// Computer player: grows a base along a build plan, keeps harvesters working, trains a mixed army
// and attacks in waves.
import { G, isAir, isOrganic, tileOf, unitDef, type Ent, type Tile } from './state.ts';
import { TECH, isTechType, type TechType } from '../data/era.ts';
import { MW, TS } from './const.ts';
import { BUILDING, isWall, type BldType } from '../data/building.ts';
import type { UnitType } from '../data/unit.ts';
import { countOf, hasBuilding, power } from './entity.ts';
import { canPlace, wallLine } from './building.ts';
import { available, cancel, costOf, enqueue, placeReady, priceOf, readyStructure } from './production.ts';
import { oilNear, treesNear } from './economy.ts';
import { orderMove, setStance } from './order.ts';

interface AiState { on: boolean; attackAt: number; attacking: boolean }

export const ais: AiState[] = [
  { on: false, attackAt: 8, attacking: false },
  { on: true, attackAt: 8, attacking: false },
];

const PLAN: BldType[] = ['power', 'refinery', 'mill', 'barracks', 'tower', 'power', 'factory', 'mill', 'tower', 'turret', 'derrick', 'power', 'refinery', 'turret', 'derrick', 'power', 'airfield', 'turret', 'flak', 'power'];
const MAX_WAVE = 30;
const SKIRMISHERS = new Set<string>(['jeep']);

export function resetAi(): void {
  for (const a of ais) { a.attackAt = 8; a.attacking = false; }
}

function nextStructure(team: number): BldType | null {
  const p = power(team), can = available(team, 'structure');
  if (p.used + 20 > p.made && can.includes('power')) return 'power';
  const need: Partial<Record<BldType, number>> = {};
  for (const t of PLAN) {
    // structures from a later age wait until the research is done
    if (BUILDING[t].era > G.era[team]) continue;
    need[t] = (need[t] ?? 0) + 1;
    if (countOf(team, t) < (need[t] ?? 0)) return can.includes(t) ? t : null;
  }
  // answer enemy aircraft with flak
  const foeAir = G.ents.filter((e) => !e.dead && e.team === 1 - team && isAir(e)).length;
  if (foeAir > 0 && countOf(team, 'flak') < Math.min(4, 1 + foeAir) && can.includes('flak') && G.credits[team] > 900) return 'flak';
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
  // a stretch of wall for every defensive structure, so the two go up together
  const wall = (['concretewall', 'stonewall', 'palisade'] as BldType[]).find((t) => can.includes(t) && G.wood[team] >= (BUILDING[t].wood ?? 0) * AI_WALL_RUN);
  const walls = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld' && isWall(e.type)).length;
  if (wall && credits > 1200 && turrets >= 1 && walls < Math.min(AI_WALLS, turrets * AI_WALL_RUN)) return wall;
  if (credits > 2500 && turrets < 8) {
    const vsInfantry: BldType = can.includes('pillbox') ? 'pillbox' : 'tower';
    const vsArmor: BldType = can.includes('atturret') && G.oil[team] >= 150 ? 'atturret' : can.includes('turret') ? 'turret' : 'tower';
    const pick = infantry > vehicles ? vsInfantry : vehicles > infantry ? vsArmor : Math.random() < 0.5 ? vsInfantry : vsArmor;
    if (can.includes(pick)) return pick;
  }
  return null;
}

const DEFENSES: BldType[] = ['tower', 'turret', 'pillbox', 'atturret'];

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
  const foe = G.ents.find((e) => !e.dead && e.team === 1 - team && e.kind === 'bld');
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

function construction(team: number): void {
  const ready = readyStructure(team);
  if (ready && isWall(ready)) {
    const own = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld');
    const yard = own.find((e) => e.type === 'yard') ?? own[0], foe = G.ents.find((e) => !e.dead && e.team === 1 - team && e.kind === 'bld');
    const site = yard ? wallSite(team, yard, foe) : null;
    if (site) placeReady(team, site[0][0], site[0][1], site[1][0], site[1][1]);
    else cancel(team, ready);
    return;
  }
  if (ready) {
    const site = findSite(team, ready);
    if (site) placeReady(team, site[0], site[1]);
    else cancel(team, ready);
    return;
  }
  if (G.prod[team].structure.length) return;
  const t = nextStructure(team);
  if (t) enqueue(team, t);
}

/**
 * Advance an age once the base is running and the bank can spare it. Faster healing is cheaper and
 * comes once there's an infantry force worth healing.
 */
function research(team: number): void {
  if (G.prod[team].tech.length) return;
  if (countOf(team, 'refinery') < 1 || countOf(team, 'harvester') < 1) return;
  const can = available(team, 'tech').filter(isTechType), credits = G.credits[team];
  const age = can.find((t) => TECH[t].age != null), heal = can.find((t) => TECH[t].heal != null);
  if (age && credits > costOf(age) * 0.6 + 200 && hasHalf(team, age)) { enqueue(team, age); return; }
  const infantry = G.ents.filter((e) => !e.dead && e.team === team && isOrganic(e)).length;
  if (heal && infantry >= 4 && credits > costOf(heal) * 0.6 + 300 && hasHalf(team, heal)) enqueue(team, heal);
}

/** At least half the wood and oil a research needs is in the bank. */
const hasHalf = (team: number, t: TechType): boolean => { const p = priceOf(t); return G.wood[team] >= p.wood * 0.5 && G.oil[team] >= p.oil * 0.5; };

/** Pick from weighted options, skipping anything the team can't build yet or lacks the wood or oil for. */
function pick(team: number, line: 'infantry' | 'vehicle' | 'air', options: [UnitType, number][]): UnitType | null {
  const can = available(team, line), enough = (t: UnitType) => { const p = priceOf(t); return G.wood[team] >= p.wood && G.oil[team] >= p.oil; };
  const ok = options.filter(([t, w]) => w > 0 && can.includes(t) && enough(t));
  let r = Math.random() * ok.reduce((s, [, w]) => s + w, 0);
  for (const [t, w] of ok) if ((r -= w) < 0) return t;
  return ok[0]?.[0] ?? null;
}

function training(team: number): void {
  const prod = G.prod[team], credits = G.credits[team];
  // leave money for the next structure while it's being built
  const saving = prod.structure.length > 0 && credits < 500;
  if (hasBuilding(team, 'factory') && prod.vehicle.length < 2) {
    const harvesters = countOf(team, 'harvester'), refineries = countOf(team, 'refinery');
    let t: UnitType | null = null;
    if (harvesters < Math.min(6, refineries * 2) && !prod.vehicle.some((x) => x.type === 'harvester')) t = 'harvester';
    else if (!saving && credits > 500)
      t = pick(team, 'vehicle', [['heavy', credits > 1600 ? 3 : 0], ['catapult', credits > 1200 ? 2 : 0.5], ['jeep', 2], ['tank', 5]]);
    if (t) enqueue(team, t);
  }
  // a few aircraft once there's money to spare
  if (!saving && hasBuilding(team, 'airfield') && prod.air.length < 1 && credits > 900) {
    const t = pick(team, 'air', [['balloon', 1], ['biplane', 2], ['helicopter', 3]]);
    if (t) enqueue(team, t);
  }
  // spend a growing bank on more troops
  const infantryQueue = credits > 2500 ? 4 : 2;
  if (!saving && hasBuilding(team, 'barracks') && prod.infantry.length < infantryQueue && credits > 150) {
    const t = pick(team, 'infantry', [['knight', credits > 700 ? 1.5 : 0], ['swordsman', 2.5], ['crossbowman', 2], ['rocket', 2], ['rifleman', 3]]);
    if (t) enqueue(team, t);
  }
}

function upkeep(team: number): void {
  for (const b of G.ents)
    if (!b.dead && b.team === team && b.kind === 'bld' && b.hp < b.maxhp * 0.6 && G.credits[team] > 600) b.repairing = true;
}

function military(team: number): void {
  const A = ais[team], foe = 1 - team;
  const army = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && unitDef(e).weapon);
  // fast raiders shoot on the move; everyone else stops to fight (the default stance)
  for (const u of army) if (SKIRMISHERS.has(u.type) && u.stance !== 'skirmish') setStance(u, 'skirmish');
  const home = G.ents.find((e) => !e.dead && e.team === team && e.type === 'yard') ?? G.ents.find((e) => !e.dead && e.team === team && e.kind === 'bld');
  if (home) {
    const threat = G.ents.find((e) => !e.dead && e.team === foe && e.kind === 'unit' && Math.hypot(e.x - home.x, e.y - home.y) < 14 * TS);
    if (threat)
      for (const u of army)
        if ((!u.order || u.order.t === 'move') && Math.hypot(u.x - home.x, u.y - home.y) < 22 * TS) orderMove(u, tileOf(threat.x), tileOf(threat.y));
  }
  const targets = G.ents.filter((e) => !e.dead && e.team === foe && e.kind === 'bld');
  if (!targets.length) targets.push(...G.ents.filter((e) => !e.dead && e.team === foe && e.kind === 'unit'));
  if (!targets.length) return;
  const from: Ent | { x: number; y: number } = home ?? army[0] ?? { x: 0, y: 0 };
  const tgt = targets.reduce((a, p) => (Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(a.x - from.x, a.y - from.y) ? p : a));
  const idle = army.filter((u) => !u.order);
  const enemyArmy = G.ents.filter((e) => !e.dead && e.team === foe && e.kind === 'unit' && unitDef(e).weapon).length;
  // attack in waves, or press on whenever the enemy army is clearly smaller
  if (army.length >= A.attackAt || (army.length >= 6 && army.length >= enemyArmy * 2)) {
    A.attacking = true;
    A.attackAt = Math.min(MAX_WAVE, A.attackAt + 3);
    for (const u of army) if (!u.order || u.order.t === 'move') orderMove(u, tileOf(tgt.x), tileOf(tgt.y));
  } else if (A.attacking && home) {
    for (const u of idle) if (Math.hypot(u.x - home.x, u.y - home.y) > 10 * TS) orderMove(u, tileOf(tgt.x), tileOf(tgt.y));
  }
  if (!home) return;
  // muster new troops in front of the base
  const a = Math.atan2(tgt.y - home.y, tgt.x - home.x);
  for (const u of idle) {
    const d = Math.hypot(u.x - home.x, u.y - home.y);
    if (d > 9 * TS && (!A.attacking || d < 12 * TS)) orderMove(u, tileOf(home.x + Math.cos(a) * 6 * TS), tileOf(home.y + Math.sin(a) * 6 * TS));
  }
}

export function aiThink(team: number): void {
  construction(team);
  research(team);
  training(team);
  upkeep(team);
  military(team);
}
