// The campaign (Alex, 2026-11-27): a short run of solo missions against the computer, starting
// super simple. The early missions are against Easy computers and stop every side in the Medieval
// age (nobody can research the Industrial age, so the Engine Works isn't offered either); the last
// one opens the Industrial age. Winning a mission unlocks the next one; progress is kept in this
// browser (localStorage).
import { DEFAULT_SETUP, type GameSetup } from './setup.ts';
import { ERA } from './era.ts';

export interface Mission {
  id: string;
  name: string;
  /** one or two sentences shown on the mission list */
  brief: string;
  /** the latest age anyone can research: 0 Medieval, 1 Industrial, 2 Modern */
  maxEra: number;
  /** the game it plays (fixed map, so a mission is the same each time) */
  setup: GameSetup;
}

const game = (s: Partial<GameSetup>): GameSetup => ({ ...DEFAULT_SETUP, seats: [...DEFAULT_SETUP.seats], fog: 'reveal', speed: 1, ...s });

export const MISSIONS: Mission[] = [
  {
    id: 'first-camp', name: 'First Camp', maxEra: 0,
    brief: 'One Easy computer, plenty of ore and wood and a small squad to start. Build a base and knock theirs down.',
    setup: game({ mode: '1v1', seats: ['easy', 'easy', 'easy', 'easy'], resources: 'high', army: 'squad', seed: 1101 }),
  },
  {
    id: 'two-workers', name: 'Two Workers', maxEra: 0,
    brief: 'The usual start: a Town Hall and two Workers against one Easy computer.',
    setup: game({ mode: '1v1', seats: ['easy', 'easy', 'easy', 'easy'], resources: 'standard', army: 'workers', seed: 2202 }),
  },
  {
    id: 'with-a-friend', name: 'With a Friend', maxEra: 0,
    brief: 'Two against two: a computer ally fights beside you against two Easy computers.',
    setup: game({ mode: '2v2', seats: ['easy', 'easy', 'easy', 'easy'], resources: 'standard', army: 'workers', seed: 3303 }),
  },
  {
    id: 'thin-pickings', name: 'Thin Pickings', maxEra: 0,
    brief: 'Half the usual ore and wood, and the fog grows back. Every Worker counts.',
    setup: game({ mode: '1v1', seats: ['easy', 'easy', 'easy', 'easy'], resources: 'low', army: 'workers', fog: 'regrow', seed: 4404 }),
  },
  {
    id: 'engines', name: 'Engines', maxEra: 1,
    brief: 'The Industrial age opens: build an Oil Derrick and the Engine Works, then research it at the Town Hall. One Normal computer.',
    setup: game({ mode: '1v1', seats: ['normal', 'normal', 'normal', 'normal'], resources: 'standard', army: 'workers', seed: 5505 }),
  },
];

/** "Medieval age only", "Up to the Industrial age" */
export const ageLimit = (m: Mission): string => (m.maxEra <= 0 ? `${ERA[0].name} age only` : m.maxEra >= ERA.length - 1 ? 'Every age' : `Up to the ${ERA[m.maxEra].name} age`);

export const missionById = (id: string | null | undefined): Mission | null => MISSIONS.find((m) => m.id === id) ?? null;

const KEY = 'killcraft.campaign';

/** The missions won in this browser. */
export function wonMissions(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { won?: unknown };
    return new Set(Array.isArray(v.won) ? v.won.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}

export function markWon(id: string): void {
  const won = wonMissions();
  won.add(id);
  try { localStorage.setItem(KEY, JSON.stringify({ won: [...won] })); } catch { /* private mode: progress isn't kept */ }
}

/** A mission can be played once every mission before it is won (the first is always open). */
export const unlocked = (i: number, won = wonMissions()): boolean => MISSIONS.slice(0, i).every((m) => won.has(m.id));

/** The mission after this one, if any. */
export const nextMission = (id: string): Mission | null => MISSIONS[MISSIONS.findIndex((m) => m.id === id) + 1] ?? null;
