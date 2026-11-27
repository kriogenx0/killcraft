// The campaign (Alex, 2026-11-27): nine solo missions against the computer, starting super simple.
// Missions 1-3 are against Easy computers in the Medieval age with no magic and no oil; the
// Industrial age opens on mission 4 and the Modern age on mission 7 (and 8 and 9 are Modern too).
// Each mission unlocks more to build (UNLOCKS): everything a later mission unlocks is banned for
// every side until then. Some missions are on a winter map (snow). Winning a mission unlocks the
// next one; progress is kept in this browser.
import { DEFAULT_SETUP, type GameSetup } from './setup.ts';
import { ERA, TECH, TECH_TYPES, type TechType } from './era.ts';
import { UNIT, UNIT_TYPES, type UnitType } from './unit.ts';
import { BUILDING, BLD_TYPES, type BldType } from './building.ts';

type Thing = BldType | UnitType | TechType;

/**
 * What each mission adds to build, train and research (Alex: "each level progressively unlocks more
 * to build"). The Town Hall is always there; ages come from each mission's maxEra. Creatures, demons
 * and things hatched from eggs aren't listed: they aren't built.
 */
export const UNLOCKS: Thing[][] = [
  // 1: a first base
  ['power', 'mill', 'refinery', 'camp', 'barracks', 'palisade', 'worker', 'swordsman', 'crossbowman'],
  // 2: defenses and the Armory
  ['tower', 'stonewall', 'knight', 'armory', 'infWeapon1', 'infArmor1'],
  // 3: healing and siege
  ['hospital', 'medic', 'heal1', 'guardian', 'factory', 'catapult', 'vehWeapon1', 'vehArmor1'],
  // 4: oil, engines and magic; the Industrial age
  ['derrick', 'works', 'age1', 'magetower', 'mage', 'tidecaller', 'rifleman', 'gunner', 'jeep', 'tank', 'turret', 'pillbox', 'concretewall', 'heal2', 'mech', 'infWeapon2', 'infArmor2', 'vehWeapon2', 'vehArmor2'],
  // 5: air power, big guns and Aether
  ['airfield', 'balloon', 'biplane', 'flak', 'stormcaller', 'plaguewitch'],
  // 6: big guns
  ['artillery', 'bertha'],
  // 7: the Modern age
  ['age2', 'harvester', 'rocket', 'heavy', 'helicopter', 'drone', 'atturret', 'archmage', 'sludgewarlock', 'heal3', 'infWeapon3', 'infArmor3', 'vehWeapon3', 'vehArmor3'],
  // 8: jets and cyborgs, and Aether (Alex: no Aether until mission 8): its buildings, units and the Titan
  ['fighter', 'striker', 'juggernaut', 'shrine', 'wardstone', 'ward', 'waygate', 'wraith', 'hexblade', 'phantom', 'starfall', 'giant', 'mystery'],
  // 9: the biggest of all
  ['titan'],
];

/** Everything the unlock schedule covers: every building, regular unit and research. */
export const SCHEDULED: readonly Thing[] = [
  ...BLD_TYPES.filter((t) => t !== 'yard'),
  ...UNIT_TYPES.filter((t) => !UNIT[t].beast && !UNIT[t].demon && !UNIT[t].hatched),
  ...TECH_TYPES,
];

const nameOf = (t: Thing): string => (t in BUILDING ? BUILDING[t as BldType].name : t in UNIT ? UNIT[t as UnitType].name : TECH[t as TechType].name);

export interface Mission {
  id: string;
  name: string;
  /** one or two sentences shown on the mission list */
  brief: string;
  /** the latest age anyone can research: 0 Medieval, 1 Industrial, 2 Modern */
  maxEra: number;
  /** a winter map */
  snow?: boolean;
  /** a small map: the land is a square this many tiles across (the full map is 96) */
  small?: number;
  /** creature lairs and Aether on the map (Alex: none until mission 8) */
  wild?: boolean;
  /** no enemy town: the enemy is just these units, in small groups across the map */
  scatter?: UnitType[];
  /** the game it plays (fixed map, so a mission is the same each time) */
  setup: GameSetup;
}

// every mission uses the Regrow fog of war (Alex, 2026-11-27)
const game = (s: Partial<GameSetup>): GameSetup => ({ ...DEFAULT_SETUP, seats: [...DEFAULT_SETUP.seats], speed: 1, ...s, fog: 'regrow' });
const vs = (level: GameSetup['seats'][number]): GameSetup['seats'] => [level, level, level, level];

export const MISSIONS: Mission[] = [
  {
    id: 'first-camp', name: 'First Camp', maxEra: 0, small: 52,
    scatter: ['swordsman', 'swordsman', 'crossbowman', 'swordsman', 'crossbowman', 'swordsman', 'swordsman', 'crossbowman'],
    brief: 'A small island with little ore and wood. No enemy town yet: hunt down the enemy soldiers camped across it.',
    setup: game({ mode: '1v1', seats: vs('easy'), resources: 'low', army: 'squad', seed: 1101 }),
  },
  {
    id: 'two-workers', name: 'Two Workers', maxEra: 0, small: 68, // half the full map's area (Alex: "Level 2 map half size")
    brief: 'The usual start: a Town Hall and two Workers against one Easy computer.',
    setup: game({ mode: '1v1', seats: vs('easy'), resources: 'standard', army: 'workers', seed: 2202 }),
  },
  {
    id: 'with-a-friend', name: 'Winter Friends', maxEra: 0, snow: true,
    brief: 'Snow on the ground. A computer ally fights beside you against two Easy computers.',
    setup: game({ mode: '2v2', seats: vs('easy'), resources: 'standard', army: 'workers', seed: 3303 }),
  },
  {
    id: 'engines', name: 'Engines', maxEra: 1,
    brief: 'The Industrial age opens: build an Oil Derrick and the Engine Works, then research it at the Town Hall. One Easy computer.',
    setup: game({ mode: '1v1', seats: vs('easy'), resources: 'standard', army: 'workers', seed: 4404 }),
  },
  {
    id: 'thin-pickings', name: 'Thin Pickings', maxEra: 1, snow: true,
    brief: 'A hard winter: half the usual ore and wood. Every Worker counts.',
    setup: game({ mode: '1v1', seats: vs('easy'), resources: 'low', army: 'workers', seed: 5505 }),
  },
  {
    id: 'iron-and-steam', name: 'Iron and Steam', maxEra: 1,
    brief: 'A Normal computer that builds faster and attacks sooner. Get your tanks rolling.',
    setup: game({ mode: '1v1', seats: vs('normal'), resources: 'standard', army: 'workers', seed: 6606 }),
  },
  {
    id: 'modern-war', name: 'Modern War', maxEra: 2,
    brief: 'The Modern age opens. You and an ally against two Normal computers.',
    setup: game({ mode: '2v2', seats: vs('normal'), resources: 'standard', army: 'workers', seed: 7707 }),
  },
  {
    id: 'frozen-front', name: 'Frozen Front', maxEra: 2, snow: true, wild: true,
    brief: 'Four sides on a frozen map, everyone for themselves, against three Normal computers. Aether and wild creatures appear for the first time.',
    setup: game({ mode: 'ffa', seats: vs('normal'), resources: 'standard', army: 'workers', seed: 8808 }),
  },
  {
    id: 'last-stand', name: 'Last Stand', maxEra: 2, wild: true,
    brief: 'One Hard computer and everything unlocked. Win this and the campaign is yours.',
    setup: game({ mode: '1v1', seats: vs('hard'), resources: 'standard', army: 'workers', seed: 9909 }),
  },
];

// Weather (Alex, 2026-11-27: "no weather besides rain until level 8"): passing rain only on missions
// 1-7 (a snow map's falling snow is its weather, so no rain there), and storms from mission 8.
MISSIONS.forEach((m, i) => { m.setup.weather = i >= 7 ? 'storms' : m.snow ? 'off' : 'rain'; });

/**
 * The world options a mission plays with (initWorld's StartOptions). Missions before 8 have no Aether
 * and no creature lairs (`wild` is left out on them, so it must be read as false here, not defaulted).
 */
export const missionWorld = (m: Mission) => ({
  maxEra: m.maxEra, ban: bannedIn(m), snow: !!m.snow, small: m.small ?? 0, scatter: m.scatter,
  wild: !!m.wild, aether: !!m.wild, gate: false,
});

/** What nobody may build, train or research in a mission: everything a later mission unlocks. */
export const bannedIn = (m: Mission): string[] => UNLOCKS.slice(MISSIONS.indexOf(m) + 1).flat();

/** The names of what a mission unlocks, for the mission list ("Knight, Watchtower, ...") */
export const newIn = (m: Mission): string[] => (UNLOCKS[MISSIONS.indexOf(m)] ?? []).filter((t) => !TECH_TYPES.includes(t as TechType) || TECH[t as TechType].age != null).map(nameOf);

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
