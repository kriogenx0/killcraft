// The campaign (Alex, 2026-11-27): a run of solo missions against the computer, starting super
// simple. Missions 1-3 are against Easy computers, stop every side in the Medieval age (no Industrial
// Age research, so no Engine Works either) and have no magic and no oil: no Mage Tower, no
// spellcasters and no Oil Derrick, for anyone. The Industrial age opens on mission 4 and the Modern
// age on mission 7. Winning a mission unlocks the next one; progress is kept in this browser.
import { DEFAULT_SETUP, type GameSetup } from './setup.ts';
import { ERA } from './era.ts';
import { UNIT, UNIT_TYPES } from './unit.ts';

export interface Mission {
  id: string;
  name: string;
  /** one or two sentences shown on the mission list */
  brief: string;
  /** the latest age anyone can research: 0 Medieval, 1 Industrial, 2 Modern */
  maxEra: number;
  /** units, buildings and research nobody may use in it */
  ban?: string[];
  /** the game it plays (fixed map, so a mission is the same each time) */
  setup: GameSetup;
}

/** No magic (the Mage Tower and every spellcaster) and no oil (the Oil Derrick) */
const NO_MAGIC_OR_OIL = ['magetower', ...UNIT_TYPES.filter((t) => UNIT[t].magic), 'derrick'];

const game = (s: Partial<GameSetup>): GameSetup => ({ ...DEFAULT_SETUP, seats: [...DEFAULT_SETUP.seats], fog: 'reveal', speed: 1, ...s });

export const MISSIONS: Mission[] = [
  {
    id: 'first-camp', ban: NO_MAGIC_OR_OIL, name: 'First Camp', maxEra: 0,
    brief: 'One Easy computer, plenty of ore and wood and a small squad to start. Build a base and knock theirs down.',
    setup: game({ mode: '1v1', seats: ['easy', 'easy', 'easy', 'easy'], resources: 'high', army: 'squad', seed: 1101 }),
  },
  {
    id: 'two-workers', ban: NO_MAGIC_OR_OIL, name: 'Two Workers', maxEra: 0,
    brief: 'The usual start: a Town Hall and two Workers against one Easy computer.',
    setup: game({ mode: '1v1', seats: ['easy', 'easy', 'easy', 'easy'], resources: 'standard', army: 'workers', seed: 2202 }),
  },
  {
    id: 'with-a-friend', ban: NO_MAGIC_OR_OIL, name: 'With a Friend', maxEra: 0,
    brief: 'Two against two: a computer ally fights beside you against two Easy computers.',
    setup: game({ mode: '2v2', seats: ['easy', 'easy', 'easy', 'easy'], resources: 'standard', army: 'workers', seed: 3303 }),
  },
  {
    id: 'engines', name: 'Engines', maxEra: 1,
    brief: 'The Industrial age opens: build an Oil Derrick and the Engine Works, then research it at the Town Hall. One Easy computer.',
    setup: game({ mode: '1v1', seats: ['easy', 'easy', 'easy', 'easy'], resources: 'standard', army: 'workers', seed: 4404 }),
  },
  {
    id: 'thin-pickings', name: 'Thin Pickings', maxEra: 1,
    brief: 'Half the usual ore and wood, and the fog grows back. Every Worker counts.',
    setup: game({ mode: '1v1', seats: ['easy', 'easy', 'easy', 'easy'], resources: 'low', army: 'workers', fog: 'regrow', seed: 5505 }),
  },
  {
    id: 'iron-and-steam', name: 'Iron and Steam', maxEra: 1,
    brief: 'A Normal computer that builds faster and attacks sooner. Get your tanks rolling.',
    setup: game({ mode: '1v1', seats: ['normal', 'normal', 'normal', 'normal'], resources: 'standard', army: 'workers', seed: 6606 }),
  },
  {
    id: 'modern-war', name: 'Modern War', maxEra: 2,
    brief: 'Every age is open, up to jets and cyborgs. You and an ally against two Normal computers.',
    setup: game({ mode: '2v2', seats: ['normal', 'normal', 'normal', 'normal'], resources: 'standard', army: 'workers', seed: 7707 }),
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
