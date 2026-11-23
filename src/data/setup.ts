// Choices for a new game against the computer (the setup screen), and what each computer difficulty
// means. Difficulty changes how the computer plays (how often it thinks, how many Workers it keeps,
// how fast it trains and builds, how big its army gets, and how early and how big it attacks). Only
// Brutal also gets a head start: a quarter more starting ore and wood.
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
}

export const AI_LEVEL: Record<Difficulty, AiLevel> = {
  easy: {
    name: 'Easy', desc: 'Slow to react, a small economy and at most 12 troops. Attacks in small groups from 6 minutes.',
    think: 2.5, firstWave: 5, waveStep: 1, firstAttack: 360, workers: 2, maxWorkers: 9, harvesters: 1, sites: 1, queue: 1, armyCap: 12, defendRange: 10, bonus: 1,
  },
  normal: {
    name: 'Normal', desc: 'A balanced opponent.',
    think: 1, firstWave: 8, waveStep: 3, firstAttack: 0, workers: 3, maxWorkers: 18, harvesters: 2, sites: 2, queue: 2, armyCap: 80, defendRange: 14, bonus: 1,
  },
  hard: {
    name: 'Hard', desc: 'Reacts twice as fast, runs a bigger economy, builds three sites at once and attacks in larger waves.',
    think: 0.5, firstWave: 10, waveStep: 4, firstAttack: 0, workers: 4, maxWorkers: 22, harvesters: 3, sites: 3, queue: 3, armyCap: 80, defendRange: 18, bonus: 1,
  },
  brutal: {
    name: 'Brutal', desc: 'Plays like Hard and starts with 25% more ore and wood.',
    think: 0.5, firstWave: 10, waveStep: 4, firstAttack: 0, workers: 4, maxWorkers: 22, harvesters: 3, sites: 3, queue: 3, armyCap: 80, defendRange: 18, bonus: 1.25,
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
  squad: { name: 'Squad', desc: 'Two Workers, two Swordsmen, a Crossbowman and a Knight.', units: ['worker', 'worker', 'swordsman', 'swordsman', 'crossbowman', 'knight'] },
  army: { name: 'Army', desc: 'Four Workers, two Swordsmen, two Crossbowmen and two Knights.', units: ['worker', 'worker', 'worker', 'worker', 'swordsman', 'swordsman', 'crossbowman', 'crossbowman', 'knight', 'knight'] },
};

export interface GameSetup {
  difficulty: Difficulty;
  /** computer opponents: 1 (one against one) or 3 (four-player free-for-all) */
  foes: 1 | 3;
  /** map seed; null picks a random map */
  seed: number | null;
  resources: StartResources;
  army: StartArmy;
  /** game speed at the start */
  speed: number;
  fog: boolean;
}

export const DEFAULT_SETUP: GameSetup = { difficulty: 'normal', foes: 1, seed: null, resources: 'standard', army: 'workers', speed: 1, fog: true };
export const SPEEDS = [0.5, 1, 2];
