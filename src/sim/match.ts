// Plays one computer-only match headlessly and records what happened: who won and when, how fast
// each side advanced through the ages, what it built, what killed what, and how it spent its ore.
// Used by the balance runner (run.ts); runs in Node with no DOM.
import type { WeatherMode } from '../data/setup.ts';
import { G, hooks, unitDef, type Ent } from '../game/state.ts';
import { STEP } from '../game/const.ts';
import { ais, setAiLevel } from '../game/ai.ts';
import { AI_LEVEL, type Difficulty } from '../data/setup.ts';
import { alive, initWorld, update } from '../game/world.ts';
import { START_CREDITS } from '../data/map.ts';
import { UNIT, isUnitType } from '../data/unit.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import { mulberry32 } from '../util/math.ts';

/** What a unit or structure is worth: its ore, wood and oil added together. */
export const priceOf = (type: string): number => {
  const d = isUnitType(type) ? UNIT[type] : BUILDING[type as BldType];
  return d ? d.cost + (d.wood ?? 0) + (d.oil ?? 0) : 0;
};

export interface TeamStats {
  team: number;
  /** game seconds when each age was reached (index = age; age 0 is 0) */
  ageAt: (number | null)[];
  /** game seconds when each healing level was researched */
  healAt: (number | null)[];
  /** units and structures this side finished, by type (starting units and yard not counted) */
  built: Record<string, number>;
  /** this side's losses, by type */
  lost: Record<string, number>;
  /** enemy units and structures destroyed, by the type that landed the killing blow */
  killsBy: Record<string, number>;
  /** enemy units and structures destroyed, by the victim's type */
  killed: Record<string, number>;
  /** value of what each type destroyed (the victims' prices) */
  killValueBy: Record<string, number>;
  /** ore harvested */
  income: number;
  /** wood, oil and Aether brought home (ore is `income`) */
  gathered?: { wood: number; oil: number; aether: number };
  /** ore banked from bounty loot for destroying the leader's things */
  bounty: number;
  /** ore spent (start + income - bank; sales and refunds count as negative spending) */
  spent: number;
  /** average ore in the bank, sampled every second */
  avgBank: number;
  /** average wood and oil in store, sampled every second */
  avgWood: number;
  avgOil: number;
  peakBank: number;
  /** largest armed force at once */
  peakArmy: number;
  /** every 5 minutes: ore harvested so far and the price of the armed units alive */
  timeline: { t: number; income: number; army: number }[];
  /** game seconds when this side was eliminated, or null if it survived */
  outAt: number | null;
  /** 1 for the winner, 2 for the last side knocked out, and so on */
  place: number;
}

export interface MatchResult {
  seed: number;
  teams: number;
  /** game seconds the match lasted */
  length: number;
  /** -1 when nobody won (time ran out, or the last sides fell together) */
  winner: number;
  timedOut: boolean;
  /** game seconds of the first kill between sides (first contact) */
  firstBlood: number | null;
  errors: number;
  /** each side's computer difficulty */
  levels: Difficulty[];
  stats: TeamStats[];
  /** every 5 minutes: ore left on the map, as a share of what it started with */
  oreLeft: number[];
}

export interface MatchOptions {
  seed: number;
  teams?: number;
  /** stop after this many game seconds */
  maxSeconds?: number;
  /** every computer player's difficulty (default Normal), or one per side */
  level?: Difficulty | Difficulty[];
  /** starting ore and wood, as a share of the normal amount */
  share?: number;
  /** each side's alliance (e.g. [0, 0, 2, 2] for two against two) */
  ally?: number[];
  /** rain and storms (default Storms, as in a real game) */
  weather?: WeatherMode;
}

const bump = (r: Record<string, number>, k: string, n = 1) => { r[k] = (r[k] ?? 0) + n; };

export function playMatch({ seed, teams = 4, maxSeconds = 3600, level = 'normal', share, ally, weather }: MatchOptions): MatchResult {
  G.headless = true;
  G.demo = true;
  G.reveal = false;
  G.viewer = -1; // nobody watches, so no fog is computed
  G.human = [];
  let errors = 0, firstBlood: number | null = null;
  const prevHooks = { ...hooks }, prevRandom = Math.random;
  // the computer players and combat roll dice; seed them so a match can be replayed
  Math.random = mulberry32(seed ^ 0x5eed);
  hooks.error = () => { errors++; };
  initWorld(seed, teams, { share, ally, weather });
  G.viewer = -1;
  for (let t = 0; t < G.teams; t++) ais[t].on = true;
  if (Array.isArray(level)) level.forEach((l, t) => { if (ais[t]) { ais[t].level = l; ais[t].attackAt = AI_LEVEL[l].firstWave; } });
  else setAiLevel(level);
  // a head start, as a real game gives it (game_view.ts): Brutal starts with more ore and wood
  for (let t = 0; t < G.teams; t++) {
    const bonus = AI_LEVEL[ais[t].level].bonus;
    if (bonus !== 1) { G.credits[t] = Math.round(G.credits[t] * bonus); G.wood[t] = Math.round(G.wood[t] * bonus); }
  }
  const startCredits = G.credits.slice(0, G.teams);

  const stats: TeamStats[] = Array.from({ length: G.teams }, (_, team) => ({
    team, ageAt: [0, null, null, null], healAt: [0, null, null, null], built: {}, lost: {}, killsBy: {}, killed: {}, killValueBy: {},
    timeline: [], gathered: { wood: 0, oil: 0, aether: 0 }, income: 0, bounty: 0, spent: 0, avgBank: 0, avgWood: 0, avgOil: 0, peakBank: START_CREDITS, peakArmy: 0, outAt: null, place: 0,
  }));
  const seen = new Set<number>(G.ents.map((e) => e.id));
  hooks.income = (team, a) => { stats[team].income += a; };
  hooks.bounty = (team, a) => { stats[team].bounty += a; };
  hooks.gain = (team, _x, _y, kind, a) => { const g = stats[team]?.gathered; if (g && kind !== 'ore') g[kind] += a; };
  hooks.killedBy = (v: Ent, by: Ent | null) => {
    if (v.team < 0) return;
    bump(stats[v.team].lost, v.type);
    if (by && by.team >= 0 && by.team !== v.team) {
      bump(stats[by.team].killsBy, by.type);
      bump(stats[by.team].killed, v.type);
      bump(stats[by.team].killValueBy, by.type, priceOf(v.type));
      firstBlood ??= G.gameT;
    }
  };

  const mapOre = () => { let n = 0; for (const v of G.ore) n += v; return n; };
  const startOre = Math.max(1, mapOre()), oreLeft: number[] = [];
  let samples = 0, nextSample = 0;
  const out: number[] = [];
  while (!G.over && G.gameT < maxSeconds) {
    update(STEP);
    if (G.gameT < nextSample) continue;
    nextSample += 1;
    samples++;
    const army = new Array(G.teams).fill(0), armyValue = new Array(G.teams).fill(0);
    for (const e of G.ents) {
      if (e.dead || e.team < 0) continue;
      if (e.kind === 'unit' && unitDef(e).weapon) { army[e.team]++; armyValue[e.team] += priceOf(e.type); }
      if (seen.has(e.id) || e.kind === 'source') continue;
      seen.add(e.id);
      bump(stats[e.team].built, e.type);
    }
    const checkpoint = samples % 300 === 0;
    if (checkpoint) oreLeft.push(Math.round((mapOre() / startOre) * 100) / 100);
    for (const s of stats) {
      const t = s.team, bank = G.credits[t];
      if (checkpoint) s.timeline.push({ t: samples, income: Math.round(s.income), army: armyValue[t] });
      s.avgBank += bank;
      s.avgWood += G.wood[t];
      s.avgOil += G.oil[t];
      s.peakBank = Math.max(s.peakBank, bank);
      s.peakArmy = Math.max(s.peakArmy, army[t]);
      for (let a = 1; a < s.ageAt.length; a++) if (s.ageAt[a] == null && G.era[t] >= a) s.ageAt[a] = Math.round(G.gameT);
      for (let h = 1; h < s.healAt.length; h++) if (s.healAt[h] == null && (G.heal[t] ?? 0) >= h) s.healAt[h] = Math.round(G.gameT);
      if (s.outAt == null && !alive(t)) { s.outAt = Math.round(G.gameT); out.push(t); }
    }
  }
  for (const s of stats) {
    s.avgBank = Math.round(s.avgBank / Math.max(1, samples));
    s.avgWood = Math.round(s.avgWood / Math.max(1, samples));
    s.avgOil = Math.round(s.avgOil / Math.max(1, samples));
    s.income = Math.round(s.income);
    if (s.gathered) for (const k of ['wood', 'oil', 'aether'] as const) s.gathered[k] = Math.round(s.gathered[k]);
    s.spent = Math.round((startCredits[s.team] ?? START_CREDITS) + s.income + s.bounty - G.credits[s.team]);
    s.peakBank = Math.round(s.peakBank);
  }
  // places: survivors share first (or the winner alone), then in reverse order of elimination
  const survivors = stats.filter((s) => s.outAt == null);
  for (const s of survivors) s.place = 1;
  out.reverse().forEach((t, i) => { stats[t].place = survivors.length + 1 + i; });
  Object.assign(hooks, prevHooks);
  Math.random = prevRandom;
  return {
    seed: G.seed, teams: G.teams, length: Math.round(G.gameT), winner: G.over ? G.winner : -1, timedOut: !G.over,
    firstBlood: firstBlood == null ? null : Math.round(firstBlood), errors, levels: ais.slice(0, G.teams).map((a) => a.level), stats, oreLeft,
  };
}
