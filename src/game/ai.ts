// Computer player: grows a base along a build plan, keeps harvesters working, trains a mixed army
// and attacks in waves. A couple of troops go and hold an Aether deposit once the army can spare them,
// and a small hunting party goes to beat down and capture the nearest wild creature of myth.
import { WEAPON, type WeaponType } from '../data/weapon.ts';
import { REVIVE_PRICE, fallenAllies, revive } from './revive.ts';
import { G, oreLoadOf, allied, bldDef, hostile, isAir, isHarvester, isOrganic, tileOf, unitDef, valid, type Ent, type Tile } from './state.ts';
import { found } from './fog.ts';
import { TECH, isTechType, type TechType } from '../data/era.ts';
import { MH, MW, TS } from './const.ts';
import { clamp } from '../util/math.ts';
import { BUILDING, EXPAND_GAP, isExpansion, isWall, type BldType } from '../data/building.ts';
import { UNIT, type UnitType } from '../data/unit.ts';
import { countOf, hasBuilding, power } from './entity.ts';
import { canPlace, clearOfFoes, exitTile, wallLine } from './building.ts';
import { ORE_BANKS, banksOf } from './haul.ts';
import { ORE_WORTH } from '../data/ore.ts';
import { walkDist } from './ore.ts';
import { findPath } from './path.ts';
import { atLimit, available, canAfford, costOf, enqueue, priceOf, sitesOf, startSite, type Buildable } from './production.ts';
import { oilLeft, oilNear, treesNear, woodNear } from './economy.ts';
import { CHOPPERS_PER_MILL } from '../data/economy.ts';
import { orderFix, orderHarvest, orderMove, setStance, orderHaul, setOrder } from './order.ts';
import { deposits, holderOf } from './aether.ts';
import { wildBeasts } from './creatures.ts';
import { canAttack } from './combat.ts';
import { canRefit, refitPrice, toggleRefit } from './refit.ts';
import { CAPTURE_REACH } from '../data/creatures.ts';
import { AETHER_BANK_REACH, AETHER_CARRY } from '../data/aether.ts';
import { AI_LEVEL, type AiLevel, type Difficulty } from '../data/setup.ts';

interface AiState {
  on: boolean;
  /** how well it plays (see AI_LEVEL), and seconds until it next thinks */
  level: Difficulty;
  thinkT: number;
  attackAt: number;
  attacking: boolean;
  /** the side this player is fighting (in a free-for-all, the nearest one still standing) */
  foe: number;
  /** units kept home to guard an Aether crystal */
  guards: Set<number>;
  /** ore set aside for the next structure, which must be paid for in full before it starts */
  reserve: number;
  /** wood set aside for that structure: troops that cost wood wait so they don't starve the build plan */
  reserveWood?: number;
  /** ore troops leave untouched while saving for the next building upgrade (see refits) */
  refitSave?: number;
  /** a Heavy Tank or Cyborg the War Factory is saving up for, in the Modern age (every other vehicle) */
  big?: UnitType | null;
  /** the last vehicle was a big one, so the next is a regular one */
  bigDone?: boolean;
  /** units sent to capture a wild creature, and the creature */
  hunters: Set<number>;
  prey: number | null;
  /** troops kept at home while a wave is out (see HOME_GUARD) */
  home?: Set<number>;
  /** when the base was last raided (game seconds), and until when a beaten wave regroups before going out again */
  raidT?: number;
  regroupT?: number;
  /** early raids made so far, and when the next may go (G.raids) */
  raids?: number;
  raidAt?: number;
}

export const ais: AiState[] = [
  { on: false, level: 'normal', thinkT: 0, attackAt: 8, attacking: false, foe: 1, guards: new Set(), reserve: 0, hunters: new Set(), prey: null },
  { on: true, level: 'normal', thinkT: 0, attackAt: 8, attacking: false, foe: 0, guards: new Set(), reserve: 0, hunters: new Set(), prey: null },
];

/** Entries kept in G.aiLog. */
const AI_LOG_MAX = 400;
/**
 * Note a computer decision and the reason for it in G.aiLog (Alex: logs to see why things happen).
 * A note with the same key as the side's last one (still saving for the same thing) adds nothing, so the log stays small.
 */
export function aiNote(team: number, why: string, key = why): void {
  if (noteKey[team] === key) return;
  noteKey[team] = key;
  G.aiLog ??= []; // a game saved before the log existed
  G.aiLog.push({ team, t: Math.round(G.gameT), why });
  if (G.aiLog.length > AI_LOG_MAX) G.aiLog.splice(0, G.aiLog.length - AI_LOG_MAX);
}
/** The computer log as text, oldest first: one line per note, "m:ss Side: what it did and why". */
export function aiLogText(sideName: (team: number) => string): string {
  const clock = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  return (G.aiLog ?? []).map((l) => `${clock(l.t)} ${sideName(l.team)}: ${l.why}`).join('\n');
}
/** Each side's last note, so one that is still saving for the same thing isn't noted again. */
const noteKey: string[] = [];
const label = (t: string): string => { const n = named(t); return `${/^[AEIOU]/.test(n) ? 'an' : 'a'} ${n}`; };
const named = (t: string): string => (BUILDING[t as BldType]?.name ?? UNIT[t as UnitType]?.name ?? TECH[t as keyof typeof TECH]?.name ?? t);
const shortOf = (team: number, t: Parameters<typeof priceOf>[0]): string => {
  const p = priceOf(t), have = [`${Math.floor(G.credits[team])}/${p.ore} ore`];
  if (p.wood) have.push(`${Math.floor(G.wood[team])}/${p.wood} wood`);
  if (p.oil) have.push(`${Math.floor(G.oil[team])}/${p.oil} oil`);
  return have.join(', ');
};

const lvl = (team: number): AiLevel => AI_LEVEL[ais[team]?.level ?? 'normal'];

/** How fast a side's production and building sites work: the computer's difficulty pace, full speed for players. */
export const aiPace = (team: number): number => (ais[team]?.on && !G.human[team] ? AI_LEVEL[ais[team].level].pace : 1);
/**
 * Whether the leader's handicaps (slower building, weaker Power Plants) hold back this side now. A
 * Brutal computer shrugs them off: it leads from the start, and with them it lost to Hard.
 */
export const leaderHandicap = (team: number): boolean => team === G.leader && !(ais[team]?.on && !G.human[team] && ais[team].level === 'brutal');

/** Set one computer player's difficulty, or every one's (after resetAi, which puts them back to Normal). */
export function setAiLevel(level: Difficulty, team?: number): void {
  for (const [t, a] of ais.entries()) if (team == null || t === team) { a.level = level; a.attackAt = AI_LEVEL[level].firstWave; }
}

/** Troops sent to hold an Aether deposit, and how big the army must be before any go. */
const GUARDS = 2;
const GUARD_ARMY = 5;
/** The hunting party sent after a wild creature, the fewest worth sending, and the army it takes first. */
const HUNTERS = 5;
const MIN_HUNTERS = 3;
const HUNT_ARMY = 9;

const PLAN: BldType[] = ['power', 'refinery', 'mill', 'barracks', 'tower', 'power', 'factory', 'derrick', 'works', 'hospital', 'armory', 'barracks', 'mill', 'tower', 'turret', 'power', 'refinery', 'magetower', 'turret', 'factory', 'derrick', 'power', 'airfield', 'pillbox', 'turret', 'flak', 'power', 'atturret', 'pillbox', 'atturret', 'bertha'];
const MAX_WAVE = 30;
const SKIRMISHERS = new Set<string>(['jeep']);

/** Reset every computer player for a new match of `teams` sides (extra sides start switched on). */
export function resetAi(teams = 2): void {
  while (ais.length < teams) ais.push({ on: true, level: 'normal', thinkT: 0, attackAt: 8, attacking: false, foe: -1, guards: new Set(), reserve: 0, hunters: new Set(), prey: null });
  wallPause.length = 0;
  noteKey.length = 0;
  scouted.length = 0;
  ais.forEach((a, team) => { a.level = 'normal'; a.thinkT = 0; a.attackAt = AI_LEVEL.normal.firstWave; a.attacking = false; a.guards.clear(); a.reserve = 0; a.hunters.clear(); a.prey = null; a.home = undefined; a.raidT = undefined; a.regroupT = undefined; a.raids = 0; a.raidAt = undefined; a.big = null; a.bigDone = false; a.foe = teams === 2 ? 1 - team : -1; });
}

const homeOf = (team: number): Ent | undefined =>
  G.ents.find((e) => !e.dead && e.team === team && e.type === 'yard') ?? G.ents.find((e) => !e.dead && e.team === team && e.kind === 'bld');
const standing = (team: number) => G.ents.some((e) => !e.dead && e.team === team && ((e.kind === 'bld' && !isWall(e.type)) || (e.kind === 'unit' && !!unitDef(e).weapon && !isHarvester(e))));

/** Keep fighting the same side until it falls, then turn on the nearest one left. */
function foeOf(team: number): number {
  const A = ais[team];
  // everyone turns on a side with a bounty on it (see bounty.ts)
  if (hostile(G.leader, team) && standing(G.leader)) {
    if (A.foe !== G.leader) { A.foe = G.leader; A.attacking = false; }
    return G.leader;
  }
  if (hostile(A.foe, team) && standing(A.foe)) return A.foe;
  const home = homeOf(team) ?? G.ents.find((e) => !e.dead && e.team === team);
  let best = -1, bestD = Infinity;
  for (let t = 0; t < G.teams; t++) {
    if (!hostile(t, team) || !standing(t)) continue;
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
  // raided lately: a defense by the base before anything else in the plan
  const guard = alarmDefense(team, can);
  if (guard) return guard;
  // walls are cheap and go up alongside the build plan, not after it: a stretch for each defensive structure
  const wall = walling ? null : wallWanted(team, can);
  if (wall) return wall;
  // Aether: a Ward Stone once the enemy fields cloaked jeeps, and a Star Shrine once past the first
  // age (troops leave the Aether for it, see shrineAether); these jump the build plan
  const aether = G.aether[team] ?? 0;
  if (can.includes('wardstone') && countOf(team, 'wardstone') < 1 && aether >= (BUILDING.wardstone.aether ?? 0) && G.ents.some((e) => !e.dead && hostile(e.team, team) && e.type === 'phantom')) return 'wardstone';
  if (shrineAether(team) && aether >= shrineAether(team) && G.credits[team] > 800) return 'shrine';
  // islands (campaign): nothing reaches the enemy but aircraft, so an Airfield as soon as there can be one
  if (G.islands && can.includes('airfield') && countOf(team, 'airfield') < 1) {
    // wood is what holds an Airfield up there: a second Lumber Mill rather than wait minutes for it
    if (G.wood[team] < priceOf('airfield').wood && countOf(team, 'mill') < 2 && can.includes('mill') && G.credits[team] >= priceOf('airfield').ore) return 'mill';
    return 'airfield';
  }
  // islands (Alex: the enemy base focuses on air attacks and defense): a ring of Flak Cannons, more as
  // enemy aircraft show up, and a second Airfield once the bank allows
  if (G.islands && countOf(team, 'airfield') > 0) {
    const foeAir = G.ents.filter((e) => !e.dead && hostile(e.team, team) && isAir(e) && !e.bee).length;
    if (can.includes('flak') && countOf(team, 'flak') < Math.min(5, 2 + Math.floor(foeAir / 2)) && G.credits[team] > 700) return 'flak';
    if (can.includes('airfield') && countOf(team, 'airfield') < 2 && G.credits[team] > 1600) return 'airfield';
  }
  const grow = expansion(team, can);
  if (grow) return grow;
  const need: Partial<Record<BldType, number>> = {};
  for (const t of PLAN) {
    // structures from a later age wait until the research is done
    if (BUILDING[t].era > G.era[team] || G.banned.includes(t) || (G.islands && GROUND_ONLY.includes(t))) continue;
    // the Engine Works only matters until its age is researched
    const to = BUILDING[t].opens;
    if (to != null && (G.era[team] >= to || to > G.maxEra)) continue;
    need[t] = (need[t] ?? 0) + 1;
    if (countOf(team, t) < (need[t] ?? 0)) {
      if (!can.includes(t)) return null;
      // short of the wood it costs with nothing bringing wood in: a Lumber Mill first, or the plan stalls
      // for good (Low starting resources leave too little wood for the Refinery after the Power Plant)
      if (G.wood[team] < priceOf(t).wood && !woodComing(team) && can.includes('mill')) { aiNote(team, `needs wood for ${label(t)} and has no Lumber Mill: building one first`); return 'mill'; }
      return t;
    }
  }
  // answer enemy aircraft with flak
  const foeAir = G.ents.filter((e) => !e.dead && hostile(e.team, team) && isAir(e) && !e.bee).length;
  if (foeAir > 0 && countOf(team, 'flak') < Math.min(4, 1 + foeAir) && can.includes('flak') && G.credits[team] > 900) return 'flak';
  // short of wood with ore to spare: another mill, by fresh trees
  if (G.wood[team] < 200 && G.credits[team] > 1500 && countOf(team, 'mill') < 5 && can.includes('mill')) return 'mill';
  if (G.credits[team] > 3000 && countOf(team, 'refinery') < 3) return 'refinery';
  // a bank piling up: another Barracks (and War Factory) to train troops side by side
  if (G.credits[team] > 2000 && countOf(team, 'barracks') < 2 && can.includes('barracks')) return 'barracks';
  if (G.credits[team] > 2500 && G.era[team] >= 1 && countOf(team, 'factory') < 2 && can.includes('factory')) return 'factory';
  return defense(team, can);
}

/** Aether to keep for a Star Shrine: one per side once it has reached the Industrial age and has a Barracks. */
function shrineAether(team: number): number {
  if (G.era[team] < 1 || countOf(team, 'shrine') > 0 || !hasBuilding(team, 'barracks') || !available(team, 'structure').includes('shrine')) return 0;
  return BUILDING.shrine.aether ?? 0;
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
  const credits = G.credits[team], foe = G.ents.filter((e) => !e.dead && hostile(e.team, team) && e.kind === 'unit' && !isAir(e));
  const infantry = foe.filter(isOrganic).length, vehicles = foe.length - infantry;
  const turrets = DEFENSES.reduce((n, t) => n + countOf(team, t), 0);
  if (credits > 2400 && countOf(team, 'bertha') < 1 && can.includes('bertha') && G.wood[team] >= 100) return 'bertha';
  if (credits > 1500 && turrets < 9) {
    const vsInfantry: BldType = can.includes('pillbox') ? 'pillbox' : 'tower';
    const vsArmor: BldType = can.includes('atturret') && G.oil[team] >= 150 ? 'atturret' : can.includes('turret') ? 'turret' : 'tower';
    const pick = G.islands ? antiAir(can) : infantry > vehicles ? vsInfantry : vehicles > infantry ? vsArmor : Math.random() < 0.5 ? vsInfantry : vsArmor;
    if (can.includes(pick)) return pick;
  }
  return null;
}

const DEFENSES: BldType[] = ['tower', 'turret', 'pillbox', 'atturret'];
/** The defenses an alarm counts: on islands Flak too */
const alarmDefenses = (): BldType[] => G.islands ? [...DEFENSES, 'flak'] : DEFENSES;
/** Islands (campaign): only aircraft come, so defenses that can't hit them are no use; Flak once there is one, else a Watchtower. */
const antiAir = (can: readonly string[]): BldType => can.includes('flak') ? 'flak' : 'tower';
const GROUND_ONLY: BldType[] = ['turret', 'pillbox', 'atturret'];

/** Seconds a raid on the base keeps a computer on a war footing: troops before buildings, and defenses sooner. */
const ALARM = 60;
/** Defenses a raided computer puts up in a hurry: this many, plus two for each age past the first. */
const ALARM_DEFENSES = 2;

/** Easy plays the old, careless way: it never pulls its army home, keeps no guard and never falls back. */
const careful = (team: number): boolean => lvl(team) !== AI_LEVEL.easy;
const alarmed = (team: number): boolean => careful(team) && G.gameT - (ais[team].raidT ?? -Infinity) < ALARM;

/**
 * After a raid on the base, a defense to answer it, whatever the bank (beyond a Worker's price): up to
 * ALARM_DEFENSES (more in later ages), one site at a time.
 */
function alarmDefense(team: number, can: readonly string[], note = true): BldType | null {
  if (!alarmed(team) || sitesOf(team).some((e) => alarmDefenses().includes(e.type as BldType))) return null;
  const turrets = alarmDefenses().reduce((n, t) => n + countOf(team, t), 0);
  if (turrets >= ALARM_DEFENSES + 2 * G.era[team]) return null;
  const foe = G.ents.filter((e) => !e.dead && hostile(e.team, team) && e.kind === 'unit' && !isAir(e) && unitDef(e).weapon);
  const infantry = foe.filter(isOrganic).length;
  const vsInfantry: BldType = can.includes('pillbox') ? 'pillbox' : 'tower';
  const vsArmor: BldType = can.includes('atturret') && G.oil[team] >= 150 ? 'atturret' : can.includes('turret') ? 'turret' : 'tower';
  const pick = G.islands ? antiAir(can) : infantry * 2 >= foe.length ? vsInfantry : vsArmor;
  if (!can.includes(pick)) return null;
  if (note) aiNote(team, `raided: putting up ${label(pick)}`, `alarm ${pick}`);
  return pick;
}

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
    if (ok && !sealsIn(team, yard, line.map(([x, y]) => y * MW + x))) return [line[0], line[line.length - 1]];
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

/** How far out from the yard (tiles) the computer checks that a new structure doesn't shut anything in. */
const SEAL_BOX = 26;

// scratch space for the flood fill, reused: the computer runs it for every spot it considers
const fillSeen = new Uint8Array(MW * MH), fillExtra = new Uint8Array(MW * MH), fillStack = new Int32Array(MW * MH);

/**
 * Own ground units, and own structures, that can walk (or be walked up to) from the yard, with the
 * given extra tiles blocked. A 4-way flood fill over a box around the yard.
 */
function reachableFromYard(team: number, yard: Ent, extra: number[]): number {
  const x0 = Math.max(0, yard.tx - SEAL_BOX), y0 = Math.max(0, yard.ty - SEAL_BOX);
  const x1 = Math.min(MW - 1, yard.tx + yard.w + SEAL_BOX), y1 = Math.min(MH - 1, yard.ty + yard.h + SEAL_BOX);
  const inBox = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const seen = fillSeen, ex = fillExtra, stack = fillStack, blk = G.blk;
  seen.fill(0);
  for (const i of extra) ex[i] = 1;
  let sp = 0;
  const visit = (x: number, y: number) => {
    if (!inBox(x, y)) return;
    const i = y * MW + x;
    if (blk[i] || ex[i] || seen[i]) return;
    seen[i] = 1;
    stack[sp++] = i;
  };
  const ring = (e: Ent, fn: (x: number, y: number) => void) => {
    for (let x = e.tx - 1; x <= e.tx + e.w; x++) { fn(x, e.ty - 1); fn(x, e.ty + e.h); }
    for (let y = e.ty; y < e.ty + e.h; y++) { fn(e.tx - 1, y); fn(e.tx + e.w, y); }
  };
  ring(yard, visit);
  while (sp) {
    const i = stack[--sp], x = i % MW, y = (i / MW) | 0;
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
  }
  let n = 0;
  for (const e of G.ents) {
    if (e.dead || e.team !== team || e === yard) continue;
    if (e.kind === 'unit') {
      const i = tileOf(e.y) * MW + tileOf(e.x);
      if (!isAir(e) && !ex[i] && seen[i]) n++;
    } else if (e.kind === 'bld' && !isWall(e.type)) {
      let open = false;
      ring(e, (x, y) => { if (inBox(x, y) && seen[y * MW + x]) open = true; });
      if (open) n++;
    }
  }
  for (const i of extra) ex[i] = 0;
  return n;
}

/** Would blocking these tiles shut any of the side's own units or structures off from its yard? */
export function sealsIn(team: number, yard: Ent, tiles: number[]): boolean {
  // the count as things stand only changes as the game moves on: work it out once a tick
  if (sealBase.t !== G.gameT || sealBase.yard !== yard) sealBase = { t: G.gameT, yard, n: reachableFromYard(team, yard, []) };
  return reachableFromYard(team, yard, tiles) < sealBase.n;
}
let sealBase: { t: number; yard: Ent | null; n: number } = { t: -1, yard: null, n: 0 };

export function findSite(team: number, type: BldType): Tile | null {
  const s = BUILDING[type].size, own = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld');
  const yard = own.find((e) => e.type === 'yard') ?? own[0];
  if (!yard) return null;
  if (type === 'derrick') return wellSite(team, s, yard);
  if (isExpansion(type)) {
    const at = scouted[team]?.site ?? expandSite(team, BUILDING.yard.size, yard);
    scouted[team] = undefined; // look afresh next time
    return at && canPlace(at[0], at[1], s, team, true, false, 'far') ? at : null;
  }
  const foe = G.ents.find((e) => !e.dead && e.team === ais[team]?.foe && e.kind === 'bld');
  // a mill goes wherever it reaches the most trees
  let best: Tile | null = null, bestTrees = -1;
  for (let k = 0; k < 200; k++) {
    // turrets face the enemy; everything else clusters around the yard
    const def = DEFENSES.includes(type) || type === 'flak';
    const a = def && foe ? Math.atan2(foe.y - yard.y, foe.x - yard.x) + (Math.random() - 0.5) * 1.8 : Math.random() * Math.PI * 2;
    const rad = (def ? 4 : 2.5) + Math.random() * (4 + k / 25);
    const tx = Math.round(yard.x / TS + Math.cos(a) * rad - s / 2), ty = Math.round(yard.y / TS + Math.sin(a) * rad - s / 2);
    if (!canPlace(tx, ty, s, team, true) || sealsIn(team, yard, footprint(tx, ty, s))) continue;
    if (type !== 'mill') return [tx, ty];
    const n = treesNear(tx, ty, s);
    if (n > bestTrees) { bestTrees = n; best = [tx, ty]; }
  }
  return best;
}

/** The tiles a square structure of size s at (tx, ty) covers. */
function footprint(tx: number, ty: number, s: number): number[] {
  const out: number[] = [];
  for (let y = ty; y < ty + s; y++) for (let x = tx; x < tx + s; x++) out.push(y * MW + x);
  return out;
}

/** The placeable spot that reaches the most oil, the nearest of those if several tie, if any reaches some. */
function wellSite(team: number, s: number, yard: Ent): Tile | null {
  let best: Tile | null = null, most = 0, near = Infinity;
  const cx = Math.round(yard.x / TS), cy = Math.round(yard.y / TS);
  for (let ty = cy - 16; ty <= cy + 16; ty++)
    for (let tx = cx - 16; tx <= cx + 16; tx++) {
      const oil = oilNear(tx, ty, s), d = Math.hypot(tx - cx, ty - cy);
      if ((oil > most || (oil === most && oil > 0 && d < near)) && canPlace(tx, ty, s, team, true, false, true) && !sealsIn(team, yard, footprint(tx, ty, s))) { most = oil; near = d; best = [tx, ty]; }
    }
  return best;
}

/** Ore (in tiles worth a trip) the side has found within r tiles of a tile. */
function oreWithin(team: number, cx: number, cy: number, r: number): number {
  let sum = 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(MH - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(MW - 1, cx + r); x++) if (G.ore[y * MW + x] >= ORE_WORTH && found(team, y * MW + x)) sum += G.ore[y * MW + x];
  return sum;
}

/** How far (tiles) around a drop-off its Workers dig before the trips count as long. */
const DIG_REACH = 8;
/** Below this much ore around all its drop-offs, the computer goes looking for a new field. */
const LOW_ORE = 2500;
/** The least ore a far field must hold to be worth a camp. */
const FIELD_ORE = 1200;
/** Most Resource Drops and Town Halls the computer adds beyond its first hall. */
const MAX_EXPANSIONS = 2;
/** The computer keeps its new bases this much further from the enemy than the rule requires. */
const SAFE_GAP = EXPAND_GAP + 4;
/** The computer only expands this far (tiles) from its first Town Hall, where its army can cover it. */
const HOME_REACH = 22;

/**
 * A new drop-off by far ore once the fields by the current ones run low: a Resource Drop, or a second
 * Town Hall once well off in a later age. One at a time.
 */
function expansion(team: number, can: readonly string[]): BldType | null {
  if (!can.includes('camp') || countOf(team, 'barracks') < 1 || countOf(team, 'refinery') < 1) return null;
  if (sitesOf(team).some((e) => isExpansion(e.type))) return null;
  if (countOf(team, 'camp') + countOf(team, 'yard') - 1 >= MAX_EXPANSIONS) return null;
  const banks = banksOf(team, ORE_BANKS);
  const left = banks.reduce((s, b) => s + oreWithin(team, b.tx + (b.w >> 1), b.ty + (b.h >> 1), DIG_REACH), 0);
  if (left >= LOW_ORE) return null;
  // only worth it once the nearest ore left is a long walk away
  if (nearestTrip(team, banks) < LONG_TRIP) return null;
  // only with somewhere to put it: looked for now and then, not every think
  const yard = homeOf(team);
  if (!yard) return null;
  const look = scouted[team];
  if (!look || G.gameT - look.t > EXPAND_LOOK) scouted[team] = { t: G.gameT, site: expandSite(team, BUILDING.yard.size, yard) };
  if (!scouted[team]?.site) return null;
  const hall = can.includes('yard') && countOf(team, 'yard') < 2 && G.era[team] >= 1 && G.credits[team] > costOf('yard') + 2500;
  return hall ? 'yard' : G.credits[team] > costOf('camp') + 400 ? 'camp' : null;
}

/** Tiles of walking from a drop-off to the nearest ore worth a trip that make a new drop-off worth building. */
const LONG_TRIP = 14;
/** Walking distance from the side's drop-offs to the nearest ore worth a trip (Infinity if none). */
function nearestTrip(team: number, banks: Ent[]): number {
  const walk = walkDist(banks);
  let best = Infinity;
  for (let i = 0; i < MW * MH; i++) if (G.ore[i] >= ORE_WORTH && !G.blk[i] && walk[i] < best && found(team, i)) best = walk[i];
  return best;
}

/** Seconds between the computer's looks for a far ore field. */
const EXPAND_LOOK = 15;
/** Where each computer side last found a spot for a new drop-off (sized for a Town Hall, so a camp fits too). */
const scouted: ({ t: number; site: Tile | null } | undefined)[] = [];

/** The richest ore field away from the side's drop-offs and the enemy that its Workers can walk to, nearer home breaking ties. */
function expandSite(team: number, s: number, yard: Ent): Tile | null {
  const banks = banksOf(team, ORE_BANKS);
  const cx = Math.floor(yard.x / TS), cy = Math.floor(yard.y / TS);
  let best: Tile | null = null, bs = -Infinity;
  const halls = G.ents.filter((e) => !e.dead && e.type === 'yard' && e.team >= 0 && e.team !== team).map((e) => [Math.floor(e.x / TS), Math.floor(e.y / TS)]);
  for (let ty = 1; ty + s < MH - 1; ty++)
    for (let tx = 1; tx + s < MW - 1; tx++) {
      // far enough from every drop-off that it shortens trips, not just doubles up
      if (banks.some((b) => Math.max(b.tx - (tx + s), tx - (b.tx + b.w), b.ty - (ty + s), ty - (b.ty + b.h)) < DIG_REACH)) continue;
      const ore = oreWithin(team, tx + (s >> 1), ty + (s >> 1), 5);
      if (ore < FIELD_ORE) continue;
      // don't bury ore under the camp
      let onOre = false;
      for (let y = ty; y < ty + s && !onOre; y++) for (let x = tx; x < tx + s; x++) if (G.ore[y * MW + x] > 0) { onOre = true; break; }
      if (onOre) continue;
      // on our side of the map: nearer our Town Hall than any enemy's, by a good margin
      const mine = Math.hypot(tx - cx, ty - cy);
      if (mine > HOME_REACH || halls.some((h) => Math.hypot(tx - h[0], ty - h[1]) * 0.6 < mine)) continue;
      const score = ore - mine * 60;
      if (score <= bs || !clearOfFoes(tx, ty, s, team, SAFE_GAP) || !canPlace(tx, ty, s, team, true, false, 'far')) continue;
      bs = score; best = [tx, ty];
    }
  if (!best) return null;
  // Workers must be able to walk there (not across water or cliffs)
  const [sx, sy] = exitTile(yard), path = findPath(sx, sy, best[0], best[1], team), end = path[path.length - 1];
  if (!end || Math.max(Math.abs(end[0] - best[0]), Math.abs(end[1] - best[1])) > 1) return null;
  return sealsIn(team, yard, footprint(best[0], best[1], s)) ? null : best;
}

/** Sites the computer keeps going at once: one, or more (by difficulty) with money in the bank. */
const maxSites = (team: number): number => (G.credits[team] > 2500 ? lvl(team).sites : 1);

/**
 * Ore the computer never spends on anything but a Worker: a side with no units that can't pay for one
 * has lost (world.ts stranded), so losing every Worker at once must not leave it broke.
 */
const workerKeep = (): number => costOf('worker');
/** Can the computer pay for this and still have a Worker's price left? */
const affordKeeping = (team: number, t: Parameters<typeof canAfford>[1]): boolean => canAfford(team, t) && G.credits[team] - costOf(t) >= workerKeep();

/**
 * The Industrial age, once the Engine Works stands and nothing is being researched at the Town Hall:
 * it comes before the rest of the build plan, the way building the Engine Works used to take the side there.
 */
function firstAge(team: number): TechType | null {
  if (G.era[team] !== 0 || G.prod[team].tech.length) return null;
  return available(team, 'tech').filter(isTechType).find((t) => TECH[t].age === 1) ?? null;
}

function construction(team: number): void {
  // a wall line is many small sites: it doesn't hold up the rest of the base
  ais[team].reserveWood = 0;
  const age = firstAge(team);
  // save for the Industrial age rather than start more buildings (power and raid defenses still go up)
  if (age && !affordKeeping(team, age)) {
    const t = nextStructure(team, true);
    if (!t || (t !== 'power' && !BUILDING[t].weapon)) { ais[team].reserve = costOf(age); ais[team].reserveWood = priceOf(age).wood; aiNote(team, `saving for ${named(age)} (${shortOf(team, age)})`, `save ${age}`); return; }
  }
  const sites = sitesOf(team), walling = sites.some((e) => isWall(e.type));
  if (sites.filter((e) => !isWall(e.type)).length >= maxSites(team)) { ais[team].reserve = 0; return; }
  const t = nextStructure(team, walling);
  if (!t) { ais[team].reserve = 0; return; }
  // structures are paid for up front: save up for one rather than spend everything on troops
  if (!affordKeeping(team, t)) { ais[team].reserve = costOf(t); ais[team].reserveWood = priceOf(t).wood; aiNote(team, `saving for ${label(t)} (${shortOf(team, t)})`, `save ${t}`); return; }
  if (isWall(t)) {
    const own = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld');
    const yard = own.find((e) => e.type === 'yard') ?? own[0], foe = G.ents.find((e) => !e.dead && e.kind === 'bld' && (ais[team].foe >= 0 ? e.team === ais[team].foe : hostile(e.team, team)));
    const line = yard ? wallSite(team, yard, foe) : null;
    // nowhere to put a stretch: give up on walls for a while rather than hold up the base
    if (!line || !startSite(team, t, line[0][0], line[0][1], line[1][0], line[1][1])) { wallPause[team] = G.gameT + WALL_RETRY; aiNote(team, `no room for ${label(t)} line: walls wait`); }
    else aiNote(team, `walling with ${label(t)}`);
    ais[team].reserve = 0;
    return;
  }
  const site = findSite(team, t), started = !!site && startSite(team, t, site[0], site[1]);
  ais[team].reserve = started ? 0 : costOf(t);
  aiNote(team, started ? `placed ${label(t)}` : site ? `could not start ${label(t)} at ${site[0]},${site[1]}` : `no room to place ${label(t)}`);
}

/**
 * Advance an age once the base is running and the bank can spare it. Faster healing (at the Hospital)
 * comes once there's an infantry force worth healing.
 */
function research(team: number): void {
  if (countOf(team, 'refinery') < 1 || gatherers(team) < 1) return;
  const credits = G.credits[team] - workerKeep();
  // healing is researched at the Hospital, alongside the yard
  const heal = available(team, 'hospital').filter(isTechType)[0];
  const infantry = G.ents.filter((e) => !e.dead && e.team === team && isOrganic(e)).length;
  if (heal && !G.prod[team].hospital.length && infantry >= 4 && credits > costOf(heal) + 300 && canAfford(team, heal)) enqueue(team, heal);
  // Field Mechanics once Medics are walking with a few vehicles to look after
  const mech = available(team, 'hospital').filter(isTechType).find((t) => TECH[t].mech);
  const vehicles = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && unitDef(e).cls === 'vehicle' && !unitDef(e).haul).length;
  if (mech && !G.prod[team].hospital.length && countOf(team, 'medic') >= 1 && vehicles >= 3 && credits > costOf(mech) + 400 && canAfford(team, mech)) enqueue(team, mech);
  if (G.prod[team].tech.length) return;
  const can = available(team, 'tech').filter(isTechType);
  const age = can.find((t) => TECH[t].age != null);
  if (age && (age === firstAge(team) ? affordKeeping(team, age) : credits > costOf(age) + 200 && canAfford(team, age))) { enqueue(team, age); aiNote(team, `researching ${named(age)}`); return; }
  const ward = can.find((t) => TECH[t].ward);
  // the Ward is a luxury: only once past the first age, with the bank to spare
  if (ward && G.era[team] >= 1 && credits > costOf(ward) + 1500 && G.aether[team] >= priceOf(ward).aether) enqueue(team, ward);
}

/** Which buildings the computer upgrades to its age first: the base's heart, then its defenses. */
const REFIT_FIRST: BldType[] = ['yard', 'refinery', 'power', 'barracks', 'factory', 'tower', 'turret', 'flak', 'airfield', 'works', 'hospital', 'armory', 'magetower', 'derrick', 'mill'];
const refitRank = (b: Ent): number => { const i = REFIT_FIRST.indexOf(b.type as BldType); return i < 0 ? REFIT_FIRST.length : i; };

/** Ore the computer keeps back for troops and repairs when paying for an upgrade. */
const REFIT_RESERVE = 100;
/** The army it takes before the computer puts training aside to save for an upgrade, and the dearest upgrade it saves for. */
const REFIT_ARMY = 6;
const REFIT_SAVE_MAX = 700;

/**
 * Upgrade one building at a time to the side's age: the most important one it can afford, so an
 * expensive Town Hall waiting for funds doesn't hold up the cheaper ones.
 */
function refits(team: number): void {
  const own = G.ents.filter((b) => !b.dead && b.team === team && b.kind === 'bld');
  if (own.some((b) => b.upT != null)) return;
  const due = own.filter(canRefit).sort((x, y) => refitRank(x) - refitRank(y));
  const b = due.find((c) => {
    const p = refitPrice(c);
    return G.credits[team] >= p.ore + Math.max(REFIT_RESERVE, workerKeep()) && G.wood[team] >= p.wood;
  });
  if (b) { toggleRefit(b); ais[team].refitSave = 0; return; }
  // can't afford one yet: once there's an army to hold the base, troops wait while it saves up
  const next = due.find((c) => refitPrice(c).ore <= REFIT_SAVE_MAX);
  const army = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e)).length;
  ais[team].refitSave = next && army >= REFIT_ARMY ? refitPrice(next).ore + REFIT_RESERVE : 0;
}

/** A Lumber Mill going up, or one standing by trees: wood is (or soon will be) coming in. */
const woodComing = (team: number): boolean => G.ents.some((e) => !e.dead && e.team === team && e.type === 'mill' && (!e.done || woodNear(e) > 0));
const ownDone = (team: number, type: BldType): Ent[] => G.ents.filter((e) => !e.dead && e.team === team && e.type === type && e.done);

/** How the side stands on a resource against what it wants to buy next. */
type Stock = 'short' | 'ok' | 'plenty';

/** Below the first number a side is short of a resource; above the second it has plenty. */
const STOCK = { ore: [500, 3000], wood: [200, 1500], oil: [150, 1000] } as const;

/** Short, fine or flush on ore, wood and oil, counting what it's saving up for. */
export function stockOf(team: number): Record<'ore' | 'wood' | 'oil', Stock> {
  const A = ais[team];
  const one = (have: number, want: number, [lo, hi]: readonly [number, number]): Stock =>
    have < Math.max(lo, want) ? 'short' : have > Math.max(hi, want * 3) ? 'plenty' : 'ok';
  return {
    ore: one(G.credits[team], A?.reserve ?? 0, STOCK.ore),
    wood: one(G.wood[team], A?.reserveWood ?? 0, STOCK.wood),
    oil: one(G.oil[team], 0, STOCK.oil),
  };
}

/**
 * Workers wanted on each Lumber Mill and each Oil Derrick: CHOPPERS_PER_MILL and one as a rule,
 * more while the side is short of that resource (and not of ore), none while it has plenty, so
 * Workers move to whatever the side is short of and back once it isn't.
 */
function crewOf(team: number): { mill: number; derrick: number } {
  // settle on a split for a while rather than march Workers back and forth as the bank goes up and down
  const was = crewSet[team];
  if (was && G.gameT >= was.t && G.gameT < was.t + CREW_HOLD) return was;
  const s = stockOf(team);
  const crew = (r: Stock, base: number, extra: number) => (r === 'plenty' ? 0 : r === 'short' && s.ore !== 'short' ? base + extra : s.ore === 'short' && r === 'ok' ? Math.max(1, base - 1) : base);
  const now = { t: G.gameT, mill: crew(s.wood, CHOPPERS_PER_MILL, 2), derrick: crew(s.oil, 1, 1) };
  crewSet[team] = now;
  return now;
}
/** Seconds the computer keeps its Workers' split between ore, wood and oil before looking again. */
const CREW_HOLD = 20;
const crewSet: { t: number; mill: number; derrick: number }[] = [];

/** Wood and oil jobs, one entry per Worker wanted: the first at every mill and derrick, then the rest. */
function stores(team: number): Ent[] {
  const mills = ownDone(team, 'mill').filter((m) => woodNear(m) > 0);
  const derricks = ownDone(team, 'derrick').filter((d) => d.carry > 1 || oilLeft(d) > 0);
  const c = crewOf(team), jobs: Ent[] = [];
  for (let k = 0; k < Math.max(c.mill, c.derrick); k++) jobs.push(...(k < c.mill ? mills : []), ...(k < c.derrick ? derricks : []));
  return jobs;
}

function workersWanted(team: number): number {
  const L = lvl(team), ore = G.era[team] >= UNIT.harvester.era ? 0 : countOf(team, 'refinery') * L.workers;
  // plus a pair to build with (sites only go up while Workers build them)
  return Math.min(L.maxWorkers, Math.max(4, ore + stores(team).length + 2));
}

/** Keep the choppers and haulers each mill and derrick wants, taken off the ore if need be. */
export function assignHaulers(team: number): void {
  const workers = G.ents.filter((e) => !e.dead && e.team === team && e.type === 'worker');
  const jobs = stores(team), seen = new Map<number, number>();
  const hauling = (b: Ent) => {
    const k = (seen.get(b.id) ?? 0) + 1;
    seen.set(b.id, k);
    return workers.filter((w) => w.order?.t === 'harvest' && w.order.src === b.id).length >= k;
  };
  // more on a mill or derrick than it wants now (the side has plenty of that, or is short of ore):
  // send the extra back to digging ore
  const wanted = new Map<number, number>();
  for (const b of jobs) wanted.set(b.id, (wanted.get(b.id) ?? 0) + 1);
  for (const b of [...ownDone(team, 'mill'), ...ownDone(team, 'derrick')]) {
    const crew = workers.filter((w) => w.order?.t === 'harvest' && w.order.src === b.id);
    for (const w of crew.slice(wanted.get(b.id) ?? 0)) orderHarvest(w, tileOf(w.x), tileOf(w.y));
  }
  for (const b of jobs) {
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
  const can = available(team, line), wood = G.wood[team] - (ais[team].reserveWood ?? 0);
  const enough = (t: UnitType) => { const p = priceOf(t); return (p.wood <= 0 || wood >= p.wood) && G.oil[team] >= p.oil && (!p.aether || (G.aether[team] ?? 0) >= p.aether + shrineAether(team)); };
  const ok = options.filter(([t, w]) => w > 0 && can.includes(t) && enough(t) && !atLimit(team, t));
  let r = Math.random() * ok.reduce((s, [, w]) => s + w, 0);
  for (const [t, w] of ok) if ((r -= w) < 0) return t;
  return ok[0]?.[0] ?? null;
}

function training(team: number): void {
  // troops always leave the price of a Worker in hand. Nothing else reliably brings ore home, so a side that loses them all must be able to train one.
  const keep = workerKeep();
  // raided lately: troops come before the structure being saved for (but not before an alarm defense)
  const alarm = alarmed(team) && !alarmDefense(team, available(team, 'structure'), false);
  const prod = G.prod[team], credits = G.credits[team] - (alarm ? keep : Math.max(ais[team].reserve, keep)) - (alarm ? 0 : ais[team].refitSave ?? 0);
  // saving up for the next structure
  const saving = credits < 150;
  // an army at the difficulty's limit trains no more fighters
  const L = lvl(team), full = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e)).length >= L.armyCap;
  // every Barracks (War Factory, Airfield) trains one order at a time: keep each of them busy
  const n = (t: BldType) => G.ents.filter((e) => !e.dead && e.team === team && e.type === t && e.done).length;
  const factories = n('factory'), barracks = n('barracks');
  // islands (campaign): ground troops can't reach the enemy, so only a few for defense; the rest is aircraft
  const groundFull = full || (G.islands && G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && !isAir(e) && unitDef(e).weapon && !isHarvester(e)).length >= 4);
  if (factories && prod.vehicle.length < 1 + factories) {
    const refineries = countOf(team, 'refinery');
    let t: UnitType | null = null;
    if (available(team, 'vehicle').includes('harvester') && countOf(team, 'harvester') < Math.min(6, refineries * lvl(team).harvesters) && !prod.vehicle.some((x) => x.type === 'harvester')) t = 'harvester';
    else if (!groundFull) {
      // in the Modern age every other vehicle is a big one (Heavy Tank or Cyborg), saved up for
      const A = ais[team];
      if (!A.big && !A.bigDone && !prod.vehicle.length) A.big = pick(team, 'vehicle', [['heavy', 3], ['juggernaut', 2.5], ['titan', 1.5]]);
      if (A.big) {
        if (G.credits[team] - keep - (A.refitSave ?? 0) >= costOf(A.big) && canAfford(team, A.big)) { t = A.big; A.big = null; A.bigDone = true; }
      } else if (!saving && credits > 500) {
        // a few Artillery Tanks to shell defenses and packed troops from behind the tanks, about one in five of the army
        const guns = countOf(team, 'artillery'), army = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e)).length;
        t = pick(team, 'vehicle', [['catapult', credits > 1200 ? 2 : 0.5], ['jeep', 2], ['tank', 5], ['phantom', 1.5], ['starfall', 2.5], ['artillery', guns * 5 < army ? 2.5 : 0]]);
        if (t) A.bigDone = false;
      }
    }
    if (t) enqueue(team, t);
  }
  // a few aircraft once there's money to spare
  // (islands: the whole army is aircraft, two orders at each Airfield and on a small bank)
  if (!saving && !full && hasBuilding(team, 'airfield') && prod.air.length < n('airfield') * (G.islands ? 2 : 1) && credits > (G.islands ? 250 : 900)) {
    // fighters answer enemy aircraft; strike jets go after bases once there's money for them
    const foeAir = G.ents.filter((e) => !e.dead && e.kind === 'unit' && hostile(e.team, team) && isAir(e)).length;
    const t = pick(team, 'air', [['balloon', 1], ['biplane', 2], ['helicopter', 3], ['drone', 2], ['fighter', foeAir >= 3 ? 4 : foeAir ? 1.5 : 0.3], ['striker', credits > 1300 ? 2 : 0], ['harpy', 1.5], ['pegasus', 2], ['griffin', 2], ['phoenix', 2], ['dragon', credits > 1400 ? 1.5 : 0], ['beequeen', 1.5]]);
    if (t) enqueue(team, t);
  }
  // Workers: a few per refinery (by difficulty) for ore before the Modern age, plus the mills' choppers and derricks' haulers
  // (the Town Hall trains them too, before there's a Barracks)
  if (available(team, 'infantry').includes('worker') && countOf(team, 'worker') < workersWanted(team) &&
    !prod.infantry.some((x) => x.type === 'worker') && (prod.infantry.length < 5 || !countOf(team, 'worker'))) enqueue(team, 'worker');
  // spend a growing bank on more troops
  const infantryQueue = (credits > 2500 ? L.queue + 2 : L.queue) + Math.max(0, barracks - 1) + (alarm ? 1 : 0);
  // an idle War Factory in the Industrial age or later: save up for a vehicle instead of spending every
  // last coin on cheap infantry
  const big = ais[team].big, forVehicle = !alarm && hasBuilding(team, 'factory') && !prod.vehicle.length && G.era[team] >= 1 && credits < (big ? costOf(big) : 900);
  if (!saving && !groundFull && !forVehicle && hasBuilding(team, 'barracks') && prod.infantry.length < infantryQueue && credits > 150) {
    // about one medic for every six fighters on foot
    const medics = countOf(team, 'medic'), foot = G.ents.filter((e) => !e.dead && e.team === team && isOrganic(e) && e.type !== 'medic').length;
    const t = pick(team, 'infantry', [['medic', medics * 6 < foot ? 2.5 : 0], ['knight', credits > 700 ? 1.5 : 0], ['swordsman', 2.5], ['guardian', credits > 800 ? 1.5 : 0], ['crossbowman', 2], ['rocket', 2], ['rifleman', 3], ['gunner', 1.5], ['wraith', credits > 700 ? 1.5 : 0], ['hexblade', 1.5], ['mage', 1.5], ['stormcaller', 1.5], ['archmage', credits > 900 ? 1.2 : 0], ['tidecaller', 1.2], ['plaguewitch', 1.2], ['sludgewarlock', credits > 900 ? 1 : 0],
      ['centaur', 2], ['minotaur', 1.5], ['cyclops', credits > 900 ? 1.5 : 0], ['hydra', credits > 900 ? 1.5 : 0], ['cerberus', 1.5], ['giant', credits > 4200 ? 1 : 0], ['mystery', credits > 1200 ? 0.6 : 0],
      ['medusa', 1.5], ['nemean', 1.5], ['sphinx', 1], ['chimera', 1.5], ['satyr', countOf(team, 'satyr') * 8 < foot ? 1.5 : 0]]);
    if (t) enqueue(team, t);
  }
}

/** Workers a computer player takes off the ore, at most, to help sites go up and fix badly damaged buildings. */
const MENDERS = 2;

function upkeep(team: number): void {
  const rich = G.credits[team] > 600;
  for (const b of G.ents)
    if (!b.dead && b.team === team && b.kind === 'bld' && b.done && b.hp < b.maxhp * 0.6 && rich) b.repairing = true;
  const workers = G.ents.filter((e) => !e.dead && e.team === team && e.type === 'worker');
  const on = (b: Ent) => workers.filter((w) => w.order?.t === 'heal' && w.order.tgt === b.id).length;
  const free = () => workers.filter((w) => !w.order || w.order.t === 'move' || (w.order.t === 'harvest' && !w.order.res && w.carry < oreLoadOf(w) * 0.5));
  const digging = () => workers.filter((w) => w.order?.t === 'harvest' && !w.order.res).length;
  const chopping = () => workers.filter((w) => w.order?.t === 'harvest' && w.order.res === 'wood');
  const nearest = (list: Ent[], b: Ent) => list.sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
  // sites only go up with Workers on them: one each always (off the ore if need be), a second while
  // there are spare hands, oldest site first
  for (const b of sitesOf(team)) {
    const want = on(b) === 0 ? 1 : on(b) === 1 && (digging() > 2 || !countOf(team, 'refinery')) ? 1 : 0;
    // a site with nobody on it takes a chopper off the wood if no one else is free
    const w = want ? nearest(free(), b) ?? (on(b) === 0 ? nearest(chopping(), b) : undefined) : undefined;
    if (w) orderFix(w, b);
  }
  // with ore to spare, a couple more fix what's badly hurt, leaving at least two on the ore
  let menders = workers.filter((w) => w.order?.t === 'heal' && w.order.sent && valid(w.order.tgt)?.done).length;
  for (const b of G.ents) {
    if (menders >= MENDERS || !rich) return;
    if (b.dead || b.team !== team || b.kind !== 'bld' || !b.done || b.hp >= b.maxhp * 0.6 || on(b)) continue;
    if (digging() <= 2) return;
    const w = nearest(free(), b);
    if (!w || Math.hypot(w.x - b.x, w.y - b.y) > 16 * TS) continue;
    orderFix(w, b);
    menders++;
  }
}

/** Workers a computer lends, at most, to a teammate that's short of hands. */
const LEND = 4;
/** A teammate with this many Workers or fewer gets help building (it's starting over). */
const SHORT_HANDED = 5;
/** A computer keeps at least this many Workers of its own before lending any. */
const LEND_KEEP = 4;

/**
 * Lend Workers to a teammate that's rebuilding (a revived or hard-hit side with few Workers): they
 * walk over and help its sites go up, then go back to gathering. The teammate pays for its own sites.
 */
function lendHands(team: number): void {
  const workers = G.ents.filter((e) => !e.dead && e.team === team && e.type === 'worker');
  if (workers.length < LEND_KEEP) return;
  let lent = workers.filter((w) => w.order?.t === 'heal' && (valid(w.order.tgt)?.team ?? team) !== team).length;
  for (let t = 0; t < G.teams && lent < LEND; t++) {
    if (t === team || !allied(t, team) || G.absent[t]) continue;
    if (G.ents.filter((e) => !e.dead && e.team === t && e.type === 'worker').length > SHORT_HANDED) continue;
    const hurtHalls = G.ents.filter((e) => !e.dead && e.team === t && e.type === 'yard' && e.done && e.hp < e.maxhp * 0.5 && G.credits[t] >= 1);
    for (const b of [...sitesOf(t), ...hurtHalls]) {
      if (lent >= LEND) return;
      if (b.unpaid) continue;
      const crew = G.ents.filter((w) => !w.dead && w.type === 'worker' && w.order?.t === 'heal' && w.order.tgt === b.id).length;
      if (crew >= 2) continue;
      const free = workers.filter((w) => !w.order || (w.order.t === 'harvest' && !w.order.res && w.carry < oreLoadOf(w) * 0.5));
      const w = free.sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
      if (!w) return;
      orderFix(w, b);
      lent++;
      aiNote(team, `lending Workers to side ${t + 1} to rebuild`, `lend ${t}`);
    }
  }
}

/** An armed computer unit carrying Aether with armed enemies this close (tiles) fights on instead of walking it home. */
const AETHER_FIGHT_NEAR = 8;

/**
 * Return Aether for the computer: a unit carrying Aether takes it home, unless it's a fighter with
 * armed enemies about. Then it stays in the fight (walking off would leave its comrades short and
 * the Aether would likely be lost anyway) and heads home once things are quiet.
 */
function aetherReturn(team: number): void {
  let foes: Ent[] | null = null;
  for (const u of G.ents) {
    if (u.dead || u.team !== team || u.kind !== 'unit' || (!u.ae && !u.aeKeep)) continue;
    let fight = false;
    if (u.ae && unitDef(u).weapon && !isHarvester(u)) {
      foes ??= G.ents.filter((e) => !e.dead && e.kind === 'unit' && e.team >= 0 && hostile(e.team, team) && !!unitDef(e).weapon && !isHarvester(e));
      fight = foes.some((e) => Math.hypot(e.x - u.x, e.y - u.y) < AETHER_FIGHT_NEAR * TS);
    }
    u.aeKeep = fight ? true : undefined;
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
    if (prey.wild.down) { if (!h.order && d > CAPTURE_REACH * TS * 0.75) orderMove(h, tileOf(prey.x), tileOf(prey.y) + 1); }
    else if (!h.order) orderMove(h, tileOf(prey.x), tileOf(prey.y));
  }
}

/**
 * Send a unit toward a tile, unless it is already fighting someone on the way there, or already
 * heading close enough to it. Re-giving the same order every think would make it drop the fight
 * (or its path) and pick it up again: attack, stop, attack, stop.
 */
/** Weapons that reach this far (tiles) are siege guns: they shell from behind the army instead of marching in with it. */
const SIEGE_RANGE = 7;

function advance(u: Ent, tx: number, ty: number): void {
  // a siege gun (the Artillery Tank, the Catapult) stops short, a little inside its reach of the
  // target, and shells it from behind the troops rather than walking into the fight
  const w = unitDef(u).weapon ? WEAPON[unitDef(u).weapon as WeaponType] : null;
  if (w && w.range >= SIEGE_RANGE && !isAir(u)) {
    const cx = (tx + 0.5) * TS, cy = (ty + 0.5) * TS, d = Math.hypot(u.x - cx, u.y - cy), keep = (w.range - 1.5) * TS;
    if (d > keep) { tx = clamp(tileOf(cx + ((u.x - cx) / d) * keep), 0, MW - 1); ty = clamp(tileOf(cy + ((u.y - cy) / d) * keep), 0, MH - 1); }
    else if (!u.order) return; // already in place: it shells whatever is in reach
  }
  const o = u.order;
  if (o?.t === 'move' && (valid(o.sub) || Math.max(Math.abs(o.gx - tx), Math.abs(o.gy - ty)) <= 3)) return;
  orderMove(u, tx, ty);
}

/** The first enemy unit close to a base (as close as this computer's level watches its own). */
function raiderNear(team: number, base: Ent): Ent | undefined {
  const r = lvl(team).defendRange * TS;
  return G.ents.find((e) => !e.dead && hostile(e.team, base.team) && e.kind === 'unit' && Math.hypot(e.x - base.x, e.y - base.y) < r);
}

/** Seconds after a teammate's building or unit was hit that it still counts as calling for help. */
const CALL_FOR_HELP = 6;

/**
 * An enemy unit raiding the base: close to the Town Hall, or one that lately hit any building or
 * Worker of ours (an expansion, a refinery or mill out by the ore and trees). The nearest to `home`.
 */
function baseRaid(team: number, home: Ent): Ent | undefined {
  const near = raiderNear(team, home);
  if (near || !careful(team)) return near;
  let best: Ent | undefined, bd = Infinity;
  for (const e of G.ents) {
    if (e.dead || e.team !== team || e.foe == null || G.gameT - e.foeT >= CALL_FOR_HELP || !(e.kind === 'bld' || isHarvester(e))) continue;
    const f = valid(e.foe);
    if (!f || f.kind !== 'unit' || !hostile(f.team, team)) continue;
    const d = Math.hypot(f.x - home.x, f.y - home.y);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

/** Fighting worth of a unit or a defensive structure: its price, scaled by the health it has left. */
const worth = (e: Ent): number => costOf(e.type as Buildable) * Math.max(0, e.hp) / Math.max(1, e.maxhp);
const armed = (e: Ent): boolean => e.kind === 'unit' ? !!unitDef(e).weapon && !isHarvester(e) : e.kind === 'bld' && !!bldDef(e).weapon && e.done;
/** Total worth of the armed units and defenses on the sides that match `whose`, within r tiles of (x, y). */
function forceNear(x: number, y: number, r: number, whose: (team: number) => boolean): number {
  let n = 0;
  for (const e of G.ents) if (!e.dead && e.team >= 0 && whose(e.team) && armed(e) && Math.hypot(e.x - x, e.y - y) < r * TS) n += worth(e);
  return n;
}

/** Total worth of the armed enemies of `team` within r tiles of any of `us`. */
function foesAround(us: readonly Ent[], r: number, team: number): number {
  let n = 0;
  for (const e of G.ents) {
    if (e.dead || e.team < 0 || !hostile(e.team, team) || !armed(e)) continue;
    if (us.some((u) => Math.hypot(e.x - u.x, e.y - u.y) < r * TS)) n += worth(e);
  }
  return n;
}

/** Troops this far (tiles) from the Town Hall are away from home. */
const AWAY = 22;
/** Raiders worth more than this share of what's at home to meet them call the whole army back. */
const RECALL = 0.8;
/** Share of the army kept at home when a wave goes out, once it has GUARD_FROM troops. */
const HOME_GUARD = 0.2;
const GUARD_FROM = 8;
/** A wave worth less than this share of what faces it at the front falls back home to regroup. */
const FALL_BACK = 0.4;
/** Seconds a beaten wave regroups before the next one goes out. */
const REGROUP = 45;
/** Early raids a computer makes in a mission with raids (G.raids), and the seconds between them (the first goes at that time too). */
const EARLY_RAIDS = 3, RAID_EVERY = 150;
/** A teammate's troops this far (tiles) from its Town Hall are out on the attack. */
const OUT_ON_ATTACK = 20;
/** Fewest of a teammate's troops out together that count as an attack worth joining. */
const JOIN_PARTY = 4;
/** An enemy building this close (tiles) to a teammate's army is what that army is going for. */
const JOIN_REACH = 18;

const teammates = (team: number): number[] =>
  Array.from({ length: G.ally.length }, (_, t) => t).filter((t) => t !== team && allied(t, team) && !G.absent[t]);

/**
 * A teammate (computer or person) under attack: enemy troops at its Town Hall, or any of its
 * buildings or troops hit lately. Returns the attacker nearest to `from` (our army).
 */
function allyInTrouble(team: number, from: { x: number; y: number }): { ally: number; foe: Ent } | undefined {
  let best: { ally: number; foe: Ent } | undefined, bd = Infinity;
  const consider = (ally: number, foe: Ent | undefined) => {
    if (!foe || foe.dead || !hostile(foe.team, ally) || foe.kind !== 'unit') return;
    const d = Math.hypot(foe.x - from.x, foe.y - from.y);
    if (d < bd) { bd = d; best = { ally, foe }; }
  };
  for (const t of teammates(team)) {
    const base = homeOf(t);
    if (base) consider(t, raiderNear(team, base));
    for (const e of G.ents)
      if (!e.dead && e.team === t && (e.kind === 'bld' || e.kind === 'unit') && e.foe != null && G.gameT - e.foeT < CALL_FOR_HELP) consider(t, valid(e.foe) ?? undefined);
  }
  return best;
}

/**
 * A teammate's army out on the attack (a person's push, or a computer's wave): where to join it.
 * Goes for the enemy building nearest that army, else to the army itself.
 */
function allyPush(team: number): { ally: number; x: number; y: number } | undefined {
  for (const t of teammates(team)) {
    const base = homeOf(t);
    const out = G.ents.filter((e) => !e.dead && e.team === t && e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e) &&
      (!base || Math.hypot(e.x - base.x, e.y - base.y) > OUT_ON_ATTACK * TS));
    if (out.length < JOIN_PARTY) continue;
    const cx = out.reduce((a, e) => a + e.x, 0) / out.length, cy = out.reduce((a, e) => a + e.y, 0) / out.length;
    let tgt: Ent | undefined, bd = JOIN_REACH * TS;
    for (const e of G.ents) {
      if (e.dead || e.kind !== 'bld' || !hostile(e.team, t) || isWall(e.type)) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < bd) { bd = d; tgt = e; }
    }
    return { ally: t, x: tgt?.x ?? cx, y: tgt?.y ?? cy };
  }
  return undefined;
}

function military(team: number): void {
  const A = ais[team], foe = foeOf(team);
  if (foe < 0) return;
  const all = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e));
  holdAether(team, all, homeOf(team));
  huntBeasts(team, all.filter((e) => !A.guards.has(e.id)), homeOf(team));
  // islands: ground troops can't cross the sea, so they guard home and only aircraft go out in waves
  const army = all.filter((e) => !A.guards.has(e.id) && !A.hunters.has(e.id) && (!G.islands || isAir(e)));
  // fast raiders shoot on the move; everyone else stops to fight (the default stance)
  for (const u of army) if (SKIRMISHERS.has(u.type) && u.stance !== 'skirmish') setStance(u, 'skirmish');
  const home = homeOf(team);
  // defend against anyone, not just the side we're fighting
  const threat = home && baseRaid(team, home);
  // only a raid bigger than what's at home holds the next wave back; a few raiders are the home guard's job
  let bigRaid = false;
  if (home && threat) {
    A.raidT = G.gameT;
    // a raid bigger than what's at home calls the whole army back, whatever it's doing out there
    const away = (u: Ent) => Math.hypot(u.x - home.x, u.y - home.y) >= AWAY * TS && Math.hypot(u.x - threat.x, u.y - threat.y) >= AWAY * TS;
    const raid = forceNear(threat.x, threat.y, 10, (t) => hostile(t, team));
    const held = forceNear(threat.x, threat.y, 10, (t) => t === team) + army.filter((u) => !away(u) && Math.hypot(u.x - threat.x, u.y - threat.y) >= 10 * TS).reduce((n, u) => n + worth(u), 0);
    bigRaid = careful(team) && raid > held * RECALL;
    const recall = bigRaid && army.some(away);
    if (recall) {
      if (A.attacking) aiNote(team, `base raided (${Math.round(raid)} against ${Math.round(held)}): pulling the army home`, 'recall');
      A.attacking = false;
    }
    for (const u of army)
      if (recall ? u.order?.t !== 'attack' || away(u) : (!u.order || u.order.t === 'move') && !away(u)) advance(u, tileOf(threat.x), tileOf(threat.y));
  }
  // our own base is safe: go and help a teammate whose base is under attack (this is the army's
  // whole job until the raiders there are gone, so the waves and the muster wait)
  // the hunting party drops the hunt for it too
  if (!threat && army.length) {
    const mid = { x: army.reduce((a, u) => a + u.x, 0) / army.length, y: army.reduce((a, u) => a + u.y, 0) / army.length };
    const call = allyInTrouble(team, mid);
    if (call) {
      aiNote(team, `helping side ${call.ally + 1} against an attack`, `help ${call.ally}`);
      for (const u of all) {
        if (A.guards.has(u.id)) continue;
        if (A.hunters.delete(u.id)) setOrder(u, null);
        if (!u.order || u.order.t === 'move') advance(u, tileOf(call.foe.x), tileOf(call.foe.y));
      }
      return;
    }
    // a teammate is on the attack: join it rather than go our own way
    const push = army.length >= 3 ? allyPush(team) : undefined;
    if (push) {
      aiNote(team, `joining side ${push.ally + 1}'s attack with ${army.length} troops`, `join ${push.ally}`);
      for (const u of army) if (!u.order || u.order.t === 'move') advance(u, tileOf(push.x), tileOf(push.y));
      return;
    }
  }
  // march on the enemy's buildings, never its walls: those only get broken when they're in the way
  const targets = G.ents.filter((e) => !e.dead && e.team === foe && e.kind === 'bld' && !isWall(e.type));
  if (!targets.length) targets.push(...G.ents.filter((e) => !e.dead && e.team === foe && e.kind === 'unit'));
  if (!targets.length) return;
  const from: Ent | { x: number; y: number } = home ?? army[0] ?? { x: 0, y: 0 };
  const tgt = targets.reduce((a, p) => (Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(a.x - from.x, a.y - from.y) ? p : a));
  const idle = army.filter((u) => !u.order);
  // a few small raids early on (campaign, Alex): a couple of troops at a time, every couple of minutes
  if (G.raids && hostile(team, 0) && (A.raids ?? 0) < EARLY_RAIDS && G.gameT >= (A.raidAt ??= RAID_EVERY) && !threat) {
    const party = army.filter((u) => !u.order || u.order.t === 'move').slice(0, 3);
    if (party.length >= 2) {
      A.raids = (A.raids ?? 0) + 1;
      A.raidAt = G.gameT + RAID_EVERY;
      // at the player, wherever the wave would go
      const mine = G.ents.filter((e) => !e.dead && e.team === 0 && e.kind === 'bld' && !isWall(e.type));
      const at = mine.length ? mine.reduce((a, p) => (Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(a.x - from.x, a.y - from.y) ? p : a)) : tgt;
      aiNote(team, `early raid ${A.raids} with ${party.length} troops`);
      for (const u of party) advance(u, tileOf(at.x), tileOf(at.y));
    }
  }
  const enemyArmy = G.ents.filter((e) => !e.dead && e.team === foe && e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e)).length;
  // attack in waves, or press on whenever the enemy army is clearly smaller
  const L = lvl(team), ready = G.gameT >= L.firstAttack && G.gameT >= (A.regroupT ?? 0) && !bigRaid;
  // a guard stays home while the wave is out (Normal and up)
  const guard = A.home ??= new Set();
  for (const id of guard) { const g = G.byId.get(id); if (!g || g.dead) guard.delete(id); }
  const out = army.filter((u) => !guard.has(u.id));
  if (ready && (army.length >= A.attackAt || (army.length >= 6 && army.length >= enemyArmy * 2))) {
    if (!A.attacking) {
      guard.clear();
      if (home && careful(team) && army.length >= GUARD_FROM) {
        const keep = Math.round(army.length * HOME_GUARD);
        for (const u of [...army].sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y)).slice(0, keep)) guard.add(u.id);
      }
      aiNote(team, `attacking side ${foe + 1} with ${army.length - guard.size} troops, ${guard.size} kept home (enemy has ${enemyArmy})`);
    }
    A.attacking = true;
    A.attackAt = Math.min(MAX_WAVE, A.attackAt + L.waveStep);
    for (const u of army) if (!guard.has(u.id) && (!u.order || u.order.t === 'move')) advance(u, tileOf(tgt.x), tileOf(tgt.y));
  } else if (A.attacking && home) {
    for (const u of idle) if (!guard.has(u.id) && Math.hypot(u.x - home.x, u.y - home.y) > 10 * TS) orderMove(u, tileOf(tgt.x), tileOf(tgt.y));
  }
  // a wave clearly beaten at the front falls back home to regroup, rather than die to the last troop
  // and leave the base bare (Normal and up)
  if (A.attacking && home && careful(team)) {
    const front = out.filter((u) => Math.hypot(u.x - home.x, u.y - home.y) >= AWAY * TS);
    if (front.length >= 3) {
      // weigh the wave against what's armed and close to any of it (a wave strung out across the map has
      // no middle worth measuring at)
      const ours = front.reduce((n, u) => n + worth(u), 0), theirs = foesAround(front, 8, team);
      if (ours < theirs * FALL_BACK) {
        aiNote(team, `wave beaten (${Math.round(ours)} against ${Math.round(theirs)}): falling back to regroup`, 'fall back');
        A.attacking = false;
        A.regroupT = G.gameT + REGROUP;
        guard.clear();
        const a = Math.atan2(tgt.y - home.y, tgt.x - home.x);
        for (const u of front) orderMove(u, tileOf(home.x + Math.cos(a) * 6 * TS), tileOf(home.y + Math.sin(a) * 6 * TS));
      }
    }
  }
  // medics trail the army: each idle one keeps a couple of tiles behind the nearest fighter (on the
  // side away from the enemy), close enough to heal it from there
  for (const m of G.ents) {
    if (m.dead || m.team !== team || m.type !== 'medic' || m.order || !army.length) continue;
    const near = army.reduce((a, p) => (Math.hypot(p.x - m.x, p.y - m.y) < Math.hypot(a.x - m.x, a.y - m.y) ? p : a));
    if (Math.hypot(near.x - m.x, near.y - m.y) <= 3 * TS) continue;
    const back = Math.atan2(near.y - tgt.y, near.x - tgt.x);
    orderMove(m, tileOf(near.x + Math.cos(back) * 2 * TS), tileOf(near.y + Math.sin(back) * 2 * TS));
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

/** Revive a teammate who has lost their Town Hall as soon as the bank allows, saving up for it meanwhile. */
function revival(team: number): void {
  const t = fallenAllies(team)[0];
  if (t == null || !G.ents.some((e) => !e.dead && e.team === team && e.type === 'yard' && e.done)) return;
  if (G.credits[team] - REVIVE_PRICE.ore >= workerKeep() && revive(team, t)) return;
  ais[team].reserve = Math.max(ais[team].reserve, REVIVE_PRICE.ore);
  ais[team].reserveWood = Math.max(ais[team].reserveWood ?? 0, REVIVE_PRICE.wood);
}

/** Seconds at the start of a mission before its camps answer fights, so the player can get their army in hand. */
const CAMP_CALM = 30;

/**
 * A mission's scattered enemy camps (G.camps, no AI running them) come to each other's help: an idle
 * enemy trooper within G.camps tiles of the player's troops marches on the nearest of them.
 */
export function campAlarm(): void {
  if (!G.camps || G.gameT < CAMP_CALM) return;
  const ours = G.ents.filter((e) => !e.dead && e.kind === 'unit' && allied(e.team, 0) && !e.bee);
  if (!ours.length) return;
  const R = G.camps * TS;
  for (const u of G.ents) {
    if (u.dead || u.kind !== 'unit' || u.order || allied(u.team, 0) || !unitDef(u).weapon || isHarvester(u) || u.wild) continue;
    let near: Ent | null = null, nd = R;
    for (const p of ours) { const d = Math.hypot(p.x - u.x, p.y - u.y); if (d < nd && canAttack(u, p)) { nd = d; near = p; } }
    if (near) advance(u, tileOf(near.x), tileOf(near.y));
  }
}

export function aiThink(team: number): void {
  construction(team);
  revival(team);
  assignHaulers(team);
  research(team);
  refits(team);
  armory(team);
  training(team);
  upkeep(team);
  lendHands(team);
  aetherReturn(team);
  military(team);
}
