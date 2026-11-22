// Computer player: grows a base along a build plan, keeps harvesters working, trains a mixed army
// and attacks in waves.
import { G, isOrganic, tileOf, unitDef, type Ent, type Tile } from './state.ts';
import { TECH, isTechType } from '../data/era.ts';
import { TS } from './const.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import type { UnitType } from '../data/unit.ts';
import { countOf, hasBuilding, power } from './entity.ts';
import { canPlace } from './building.ts';
import { available, cancel, costOf, enqueue, placeReady, readyStructure } from './production.ts';
import { orderMove, setStance } from './order.ts';

interface AiState { on: boolean; attackAt: number; attacking: boolean }

export const ais: AiState[] = [
  { on: false, attackAt: 8, attacking: false },
  { on: true, attackAt: 8, attacking: false },
];

const PLAN: BldType[] = ['power', 'refinery', 'barracks', 'tower', 'power', 'factory', 'tower', 'turret', 'power', 'refinery', 'turret', 'power', 'turret'];
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
  if (G.credits[team] > 3000 && countOf(team, 'refinery') < 3) return 'refinery';
  if (G.credits[team] > 2500 && countOf(team, 'turret') < 6 && can.includes('turret')) return 'turret';
  return null;
}

function findSite(team: number, type: BldType): Tile | null {
  const s = BUILDING[type].size, own = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld');
  const yard = own.find((e) => e.type === 'yard') ?? own[0];
  if (!yard) return null;
  const foe = G.ents.find((e) => !e.dead && e.team === 1 - team && e.kind === 'bld');
  for (let k = 0; k < 200; k++) {
    // turrets face the enemy; everything else clusters around the yard
    const a = (type === 'turret' || type === 'tower') && foe ? Math.atan2(foe.y - yard.y, foe.x - yard.x) + (Math.random() - 0.5) * 1.8 : Math.random() * Math.PI * 2;
    const rad = (type === 'turret' || type === 'tower' ? 4 : 2.5) + Math.random() * (4 + k / 25);
    const tx = Math.round(yard.x / TS + Math.cos(a) * rad - s / 2), ty = Math.round(yard.y / TS + Math.sin(a) * rad - s / 2);
    if (canPlace(tx, ty, s, team, true)) return [tx, ty];
  }
  return null;
}

function construction(team: number): void {
  const ready = readyStructure(team);
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
  if (age && credits > costOf(age) * 0.6 + 400) { enqueue(team, age); return; }
  const infantry = G.ents.filter((e) => !e.dead && e.team === team && isOrganic(e)).length;
  if (heal && infantry >= 4 && credits > costOf(heal) * 0.6 + 300) enqueue(team, heal);
}

/** Pick from weighted options, skipping anything the team can't build yet. */
function pick(team: number, line: 'infantry' | 'vehicle', options: [UnitType, number][]): UnitType | null {
  const can = available(team, line), ok = options.filter(([t]) => can.includes(t));
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
