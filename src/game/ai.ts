// Computer player: grows a base along a build plan, keeps harvesters working, trains a mixed army
// and attacks in waves. A couple of troops go and hold an Aether deposit once the army can spare them.
import { G, isAir, isOrganic, tileOf, unitDef, type Ent, type Tile } from './state.ts';
import { TECH, isTechType, type TechType } from '../data/era.ts';
import { TS } from './const.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import type { UnitType } from '../data/unit.ts';
import { countOf, hasBuilding, power } from './entity.ts';
import { canPlace } from './building.ts';
import { available, cancel, costOf, enqueue, placeReady, priceOf, readyStructure } from './production.ts';
import { oilNear, treesNear } from './economy.ts';
import { orderMove, setStance } from './order.ts';
import { deposits, holderOf } from './aether.ts';

interface AiState { on: boolean; attackAt: number; attacking: boolean; guards: Set<number> }

export const ais: AiState[] = [
  { on: false, attackAt: 8, attacking: false, guards: new Set() },
  { on: true, attackAt: 8, attacking: false, guards: new Set() },
];

/** Troops sent to hold an Aether deposit, and how big the army must be before any go. */
const GUARDS = 2;
const GUARD_ARMY = 5;

const PLAN: BldType[] = ['power', 'refinery', 'mill', 'barracks', 'tower', 'power', 'factory', 'derrick', 'works', 'hospital', 'mill', 'tower', 'turret', 'power', 'refinery', 'turret', 'derrick', 'power', 'airfield', 'turret', 'flak', 'power'];
const MAX_WAVE = 30;
const SKIRMISHERS = new Set<string>(['jeep']);

export function resetAi(): void {
  for (const a of ais) { a.attackAt = 8; a.attacking = false; a.guards.clear(); }
}

function nextStructure(team: number): BldType | null {
  const p = power(team), can = available(team, 'structure');
  if (p.used + 20 > p.made && can.includes('power')) return 'power';
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
  const foeAir = G.ents.filter((e) => !e.dead && e.team === 1 - team && isAir(e)).length;
  if (foeAir > 0 && countOf(team, 'flak') < Math.min(4, 1 + foeAir) && can.includes('flak') && G.credits[team] > 900) return 'flak';
  if (G.credits[team] > 3000 && countOf(team, 'refinery') < 3) return 'refinery';
  if (G.credits[team] > 2500 && countOf(team, 'turret') < 6 && can.includes('turret')) return 'turret';
  return null;
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
    const def = type === 'turret' || type === 'tower' || type === 'flak';
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
  if (heal && infantry >= 4 && credits > costOf(heal) * 0.6 + 300 && hasHalf(team, heal)) { enqueue(team, heal); return; }
  const ward = can.find((t) => TECH[t].ward);
  // the Ward is a luxury: only once past the first age, with the bank to spare
  if (ward && G.era[team] >= 1 && credits > costOf(ward) + 1500 && G.aether[team] >= priceOf(ward).aether) enqueue(team, ward);
}

/** At least half the wood and oil a research needs is in the bank. */
const hasHalf = (team: number, t: TechType): boolean => { const p = priceOf(t); return G.wood[team] >= p.wood * 0.5 && G.oil[team] >= p.oil * 0.5; };

/** Pick from weighted options, skipping anything the team can't build yet or lacks the wood or oil for. */
function pick(team: number, line: 'infantry' | 'vehicle' | 'air', options: [UnitType, number][]): UnitType | null {
  const can = available(team, line), enough = (t: UnitType) => { const p = priceOf(t); return G.wood[team] >= p.wood && G.oil[team] >= p.oil && (G.aether[team] ?? 0) >= p.aether; };
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
      t = pick(team, 'vehicle', [['heavy', credits > 1600 ? 3 : 0], ['catapult', credits > 1200 ? 2 : 0.5], ['jeep', 2], ['tank', 5], ['phantom', 1.5], ['starfall', 2.5]]);
    if (t) enqueue(team, t);
  }
  // a few aircraft once there's money to spare
  if (!saving && hasBuilding(team, 'airfield') && prod.air.length < 1 && credits > 900) {
    const t = pick(team, 'air', [['balloon', 1], ['biplane', 2], ['helicopter', 3], ['drone', 2]]);
    if (t) enqueue(team, t);
  }
  // spend a growing bank on more troops
  const infantryQueue = credits > 2500 ? 4 : 2;
  if (!saving && hasBuilding(team, 'barracks') && prod.infantry.length < infantryQueue && credits > 150) {
    // about one medic for every six fighters on foot
    const medics = countOf(team, 'medic'), foot = G.ents.filter((e) => !e.dead && e.team === team && isOrganic(e) && e.type !== 'medic').length;
    const t = pick(team, 'infantry', [['medic', medics * 6 < foot ? 2.5 : 0], ['knight', credits > 700 ? 1.5 : 0], ['swordsman', 2.5], ['crossbowman', 2], ['rocket', 2], ['rifleman', 3], ['gunner', 1.5], ['wraith', credits > 700 ? 1.5 : 0], ['hexblade', 1.5]]);
    if (t) enqueue(team, t);
  }
}

function upkeep(team: number): void {
  for (const b of G.ents)
    if (!b.dead && b.team === team && b.kind === 'bld' && b.hp < b.maxhp * 0.6 && G.credits[team] > 600) b.repairing = true;
}

/** Keep a couple of troops on the nearest Aether deposit nobody else holds. */
function holdAether(team: number, army: Ent[], home: Ent | undefined): void {
  const A = ais[team];
  for (const id of A.guards) { const g = G.byId.get(id); if (!g || g.dead) A.guards.delete(id); }
  const left = deposits();
  if (!left.length || !home) { A.guards.clear(); return; }
  const near = (d: Ent) => Math.hypot(d.x - home.x, d.y - home.y);
  const target = left.filter((d) => holderOf(d) !== 1 - team).sort((a, b) => near(a) - near(b))[0] ?? left.sort((a, b) => near(a) - near(b))[0];
  if (A.guards.size < GUARDS && army.length >= GUARD_ARMY) {
    const free = army.filter((u) => !A.guards.has(u.id) && !u.order).sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
    for (const u of free.slice(0, GUARDS - A.guards.size)) A.guards.add(u.id);
  }
  // guards drift back to the deposit whenever they're idle away from it
  for (const id of A.guards) {
    const g = G.byId.get(id);
    if (g && !g.order && Math.hypot(g.x - target.x, g.y - target.y) > 1.5 * TS) orderMove(g, tileOf(target.x), tileOf(target.y) + 1);
  }
}

function military(team: number): void {
  const A = ais[team], foe = 1 - team;
  const all = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && unitDef(e).weapon);
  holdAether(team, all, G.ents.find((e) => !e.dead && e.team === team && e.type === 'yard'));
  const army = all.filter((e) => !A.guards.has(e.id));
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
