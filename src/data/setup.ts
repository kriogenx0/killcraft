// Choices for a new game against the computer (the setup screen), and what each computer difficulty
// means. Difficulty changes how the computer plays (how often it thinks, how many Workers it keeps,
// how fast it trains and builds, how big its army gets, and how early and how big it attacks). Easy
// and Normal also work slower than a player can (pace); Brutal works faster and gets a head start: a
// quarter more starting ore and wood.
import type { UnitType } from './unit.ts';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';

export interface AiLevel {
  name: string;
  desc: string;
  /** seconds between decisions: its reaction time to attacks, idle troops and an empty queue */
  think: number;
  /** army size of the first attack wave, and how much bigger each later wave gets */
  firstWave: number;
  waveStep: number;
  /** no attack waves before this many seconds (it still defends) */
  firstAttack: number;
  /** Workers on the ore per refinery, and the most Workers it keeps */
  workers: number;
  maxWorkers: number;
  /** Harvesters per refinery in the Modern age */
  harvesters: number;
  /** building sites it keeps going at once when the bank is deep */
  sites: number;
  /** troops it queues at the Barracks at once (two more with a deep bank) */
  queue: number;
  /** the most fighting units it keeps */
  armyCap: number;
  /** enemy units this close to its base (tiles) pull its army back to defend */
  defendRange: number;
  /** starting ore and wood, as a share of the normal amount */
  bonus: number;
  /** how fast its Barracks, factories, research and building sites work (1 = full speed) */
  pace: number;
}

export const AI_LEVEL: Record<Difficulty, AiLevel> = {
  easy: {
    name: 'Easy', desc: 'Slow to react and to build, a small economy and at most 8 troops. Leaves you alone for 12 minutes, then attacks in small groups.',
    think: 3, firstWave: 3, waveStep: 1, firstAttack: 720, workers: 2, maxWorkers: 6, harvesters: 1, sites: 1, queue: 1, armyCap: 8, defendRange: 9, bonus: 1, pace: 0.5,
  },
  normal: {
    name: 'Normal', desc: 'A relaxed opponent. Builds slower than you can, keeps at most 25 troops, and gives you 8 minutes before its first small attack.',
    think: 2, firstWave: 5, waveStep: 1, firstAttack: 480, workers: 3, maxWorkers: 11, harvesters: 2, sites: 1, queue: 1, armyCap: 25, defendRange: 11, bonus: 1, pace: 0.7,
  },
  hard: {
    name: 'Hard', desc: 'Reacts fast, runs a bigger economy, builds three sites at once and attacks in larger waves after 5½ minutes.',
    think: 1, firstWave: 6, waveStep: 2, firstAttack: 330, workers: 4, maxWorkers: 16, harvesters: 3, sites: 3, queue: 2, armyCap: 50, defendRange: 16, bonus: 1, pace: 0.75,
  },
  brutal: {
    name: 'Brutal', desc: 'Plays like Hard but builds faster, starts with 25% more ore and wood, and attacks in bigger waves after 2 minutes.',
    think: 0.5, firstWave: 10, waveStep: 4, firstAttack: 120, workers: 4, maxWorkers: 22, harvesters: 3, sites: 3, queue: 3, armyCap: 80, defendRange: 18, bonus: 1.25, pace: 1.15,
  },
};

export type StartResources = 'low' | 'standard' | 'high';
/** Starting ore and wood, as a share of the normal amount. */
export const START_RESOURCES: Record<StartResources, { name: string; share: number }> = {
  low: { name: 'Low', share: 0.5 },
  standard: { name: 'Standard', share: 1 },
  high: { name: 'High', share: 2 },
};

export type StartArmy = 'workers' | 'squad' | 'army';
/** What each side starts with beside its Town Hall. */
export const START_ARMY: Record<StartArmy, { name: string; desc: string; units: UnitType[] }> = {
  workers: { name: '2 Workers', desc: 'Two Workers and nothing else.', units: ['worker', 'worker'] },
  squad: { name: 'Squad', desc: 'Two Workers, two Footmen, a Crossbowman and a Knight.', units: ['worker', 'worker', 'swordsman', 'swordsman', 'crossbowman', 'knight'] },
  army: { name: 'Army', desc: 'Four Workers, two Footmen, two Crossbowmen and two Knights.', units: ['worker', 'worker', 'worker', 'worker', 'swordsman', 'swordsman', 'crossbowman', 'crossbowman', 'knight', 'knight'] },
};

/** How the sides line up: one against one, two teams of two (allies share sight and win together), or everyone for themselves. */
export type Mode = '1v1' | '2v2' | 'ffa';
export const MODES: Record<Mode, { name: string; short: string; desc: string; teams: number; ally: number[] }> = {
  '1v1': { name: 'One vs one', short: '1v1', desc: 'You against one computer.', teams: 2, ally: [0, 1] },
  '2v2': { name: 'Two vs two', short: '2v2', desc: 'Two teams of two. Allies share what they see, never fight each other and win together.', teams: 4, ally: [0, 1, 0, 1] },
  ffa: { name: 'Free-for-all', short: 'FFA', desc: 'Four sides, one base in each corner, everyone for themselves.', teams: 4, ally: [0, 1, 2, 3] },
};
export const isMode = (m: unknown): m is Mode => typeof m === 'string' && m in MODES;

/** Who sits in a seat: a computer at a difficulty, or nobody (the corner stays empty). */
export type SeatPick = Difficulty | 'closed';
export const isSeatPick = (v: unknown): v is SeatPick => v === 'closed' || (typeof v === 'string' && v in AI_LEVEL);

/**
 * Can a match be played with these seats closed? There must be at least two sides with someone on them.
 * `closed[t]` is true for an empty seat.
 */
export function playable(mode: Mode, closed: readonly boolean[]): boolean {
  const m = MODES[mode], sides = new Set<number>();
  for (let t = 0; t < m.teams; t++) if (!closed[t]) sides.add(m.ally[t]);
  return sides.size >= 2;
}

/** Seats in the order the setup screens list them: your side first, then the other side (2v2 pairs seats 0+2 and 1+3). */
export const seatOrder = (mode: Mode): number[] => (mode === '1v1' ? [0, 1] : mode === '2v2' ? [0, 2, 1, 3] : [0, 1, 2, 3]);

/**
 * Fog of war (Alex, 2026-11-25): Reveal (the default) keeps ground fully visible once explored, enemy
 * troops included; Regrow is the classic fog: explored ground stays mapped with the buildings on it,
 * but enemy troops show only while your side can see them; Off shows the whole map.
 */
export type FogMode = 'reveal' | 'regrow' | 'off';
export const FOG_MODES: Record<FogMode, { name: string; desc: string }> = {
  reveal: { name: 'Reveal', desc: 'Once you have explored ground it stays visible, enemy troops and all.' },
  regrow: { name: 'Regrow', desc: 'Explored ground stays mapped, but fog grows back over it: enemy troops show only while you can see them.' },
  off: { name: 'Off', desc: 'No fog: see the whole map.' },
};
export const isFogMode = (v: unknown): v is FogMode => typeof v === 'string' && v in FOG_MODES;

/**
 * Weather (Alex, 2026-11-27, data/weather.ts): Storms (the default) brings passing rain and, rarely, a
 * hailstorm or meteor shower that sweeps across the map; Rain keeps only the harmless rain; Off is clear skies.
 */
export type WeatherMode = 'storms' | 'rain' | 'off';
export const WEATHER_MODES: Record<WeatherMode, { name: string; desc: string }> = {
  storms: { name: 'Storms', desc: 'Passing rain, and now and then a hailstorm or meteor shower that sweeps across the map and hurts everything under it.' },
  rain: { name: 'Rain', desc: 'Passing rain only: it looks good and puts fires out, and never does harm.' },
  off: { name: 'Off', desc: 'Clear skies all game.' },
};
export const isWeatherMode = (v: unknown): v is WeatherMode => typeof v === 'string' && v in WEATHER_MODES;

/**
 * Day and night (Alex, 2026-11-27, views/game/render3d/daynight.ts): Cycle runs dawn, day, dusk and
 * night with the sun moving across the sky; Day keeps the map's own fixed light. Only changes the look.
 */
export type DayNightMode = 'cycle' | 'day';
export const DAYNIGHT_MODES: Record<DayNightMode, { name: string; desc: string }> = {
  cycle: { name: 'Cycle', desc: 'Dawn, day, dusk and night come round every 20 minutes, and the sun moves so shadows move with it. Only the look changes.' },
  day: { name: 'Always day', desc: 'A fixed daylight all game.' },
};
export const isDayNightMode = (v: unknown): v is DayNightMode => typeof v === 'string' && v in DAYNIGHT_MODES;

export interface GameSetup {
  mode: Mode;
  /** the computer in each seat (index = team); seat 0 is you, except in a match to watch */
  seats: SeatPick[];
  /** map seed; null picks a random map */
  seed: number | null;
  resources: StartResources;
  army: StartArmy;
  /** game speed at the start */
  speed: number;
  fog: FogMode;
  weather: WeatherMode;
  /** day and night cycle, or always day (only the look; each player's own choice online) */
  daynight: DayNightMode;
  /** a campaign mission (data/campaign.ts): caps the ages and records a win */
  mission?: string;
}

export const DEFAULT_SETUP: GameSetup = { mode: '1v1', seats: ['normal', 'normal', 'normal', 'normal'], seed: null, resources: 'standard', army: 'workers', speed: 1, fog: 'reveal', weather: 'storms', daynight: 'cycle' };
export const SPEEDS = [0.5, 1, 2];

/** The match a setup makes: how many teams, each one's side, which seats are empty, and each computer's difficulty. */
export function matchOf(s: GameSetup, watch: boolean): { teams: number; ally: number[]; absent: boolean[]; levels: (Difficulty | null)[] } {
  const m = MODES[s.mode];
  const absent = Array.from({ length: m.teams }, (_, t) => (t > 0 || watch) && s.seats[t] === 'closed');
  const levels = Array.from({ length: m.teams }, (_, t) => (t === 0 && !watch) || absent[t] ? null : (s.seats[t] === 'closed' ? 'normal' : s.seats[t]));
  return { teams: m.teams, ally: [...m.ally], absent, levels };
}
