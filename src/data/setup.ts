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
    name: 'Hard', desc: 'Reacts fast, runs a bigger economy, builds three sites at once and attacks in larger waves after 2½ minutes.',
    think: 0.75, firstWave: 8, waveStep: 3, firstAttack: 150, workers: 4, maxWorkers: 20, harvesters: 3, sites: 3, queue: 3, armyCap: 60, defendRange: 16, bonus: 1, pace: 0.95,
  },
  brutal: {
    name: 'Brutal', desc: 'Plays like Hard, builds 15% faster and starts with 25% more ore and wood.',
    think: 0.5, firstWave: 10, waveStep: 4, firstAttack: 0, workers: 4, maxWorkers: 22, harvesters: 3, sites: 3, queue: 3, armyCap: 80, defendRange: 18, bonus: 1.25, pace: 1.15,
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
  fog: boolean;
}

export const DEFAULT_SETUP: GameSetup = { mode: '1v1', seats: ['normal', 'normal', 'normal', 'normal'], seed: null, resources: 'standard', army: 'workers', speed: 1, fog: true };
export const SPEEDS = [0.5, 1, 2];

/** The match a setup makes: how many teams, each one's side, which seats are empty, and each computer's difficulty. */
export function matchOf(s: GameSetup, watch: boolean): { teams: number; ally: number[]; absent: boolean[]; levels: (Difficulty | null)[] } {
  const m = MODES[s.mode];
  const absent = Array.from({ length: m.teams }, (_, t) => (t > 0 || watch) && s.seats[t] === 'closed');
  const levels = Array.from({ length: m.teams }, (_, t) => (t === 0 && !watch) || absent[t] ? null : (s.seats[t] === 'closed' ? 'normal' : s.seats[t]));
  return { teams: m.teams, ally: [...m.ally], absent, levels };
}
