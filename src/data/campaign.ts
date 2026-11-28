// The campaign (Alex, 2026-11-27): twelve solo missions against the computer, starting super simple.
// Missions 1-3 are against Easy computers in the Medieval age with no magic and no oil; the
// Industrial age opens on mission 4, scarce wood on mission 7, magic on mission 8, the Modern age on mission 9, creatures against creatures on mission 10, and Aether, creatures and storms on mission 11.
// Each mission unlocks more to build (UNLOCKS): everything a later mission unlocks is banned for
// every side until then. Some missions are on a winter map (snow). Winning a mission unlocks the
// next one; progress is kept in this browser.
import { DEFAULT_SETUP, MODES, type GameSetup } from './setup.ts';
import { ERA, TECH, TECH_TYPES, type TechType } from './era.ts';
import { UNIT, UNIT_TYPES, type UnitType } from './unit.ts';
import { BUILDING, BLD_TYPES, type BldType } from './building.ts';
import { SPARSE, smallBounds, type MapLayout } from './map.ts';
import { mulberry32 } from '../util/math.ts';
import { BEASTS } from './creatures.ts';
import type { Goal, Rush, Tile } from '../game/state.ts';

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
  // 3: healing and siege (Alex: no vehicle upgrades yet; they come with the vehicles on 4)
  ['hospital', 'medic', 'heal1', 'guardian', 'factory', 'catapult'],
  // 4: oil and engines; the Industrial age (Alex: all about finding oil)
  ['derrick', 'works', 'age1', 'rifleman', 'gunner', 'flamer', 'jeep', 'tank', 'turret', 'pillbox', 'concretewall', 'heal2', 'mech', 'infWeapon2', 'infArmor2', 'vehWeapon1', 'vehArmor1', 'vehWeapon2', 'vehArmor2'],
  // 5: air power (Alex: islands, airplanes)
  ['airfield', 'balloon', 'biplane', 'flak'],
  // 6: big guns
  ['artillery'],
  // 7: the wood is all in one small grove in the middle (Alex: "scarce wood"); Big Bertha to shell it from afar
  ['bertha'],
  // 8: magic (Alex: "Discover magic": the Arcane Circle and the spellcasters of the first two ages)
  ['magetower', 'mage', 'tidecaller', 'stormcaller', 'plaguewitch'],
  // 9: the Modern age (Alex: "introduction to Modern. Expand to more things"): Modern troops, aircraft,
  // jets and cyborgs, the Modern casters
  ['age2', 'harvester', 'rocket', 'heavy', 'helicopter', 'drone', 'atturret', 'archmage', 'sludgewarlock', 'heal3', 'infWeapon3', 'infArmor3', 'vehWeapon3', 'vehArmor3',
    'fighter', 'striker', 'carrier', 'juggernaut'],
  // 10: creatures only, on both sides (Alex): the Mystery Egg, which hatches them
  ['mystery'],
  // 11: Aether, creatures, storms and all the rest (Alex: "introduction to aether, creatures, weather, all the other things"); the Spy, with the Ward Stone that finds it
  ['shrine', 'wardstone', 'ward', 'waygate', 'wraith', 'hexblade', 'phantom', 'starfall', 'giant', 'titan', 'spy'],
  // 12: everything is open (Alex: "2v2 hard")
  [],
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
  /** a single oil well on the whole map, as far from every base as the land allows (instead of one by each base) */
  oneOil?: boolean;
  /** with oneOil, how many such hidden oil patches (default 1) */
  oilPatches?: number;
  /** no wood but one small grove in the middle of the map (Alex: "scarce wood") */
  oneWood?: boolean;
  /** wild creatures guarding the middle of the map (Alex: The Last Grove "could have creatures guarding it"); the only creatures before mission 10 */
  guards?: UnitType[];
  /** what else must be done to win, beside destroying the enemy */
  goals?: Goal[];
  /** each side on its own island: only aircraft cross */
  islands?: boolean;
  /** a few small early raids by the enemy (Alex), who starts with these raiders too */
  raids?: UnitType[];
  /** the scattered enemies stand in this many patches spread over the land, well away from the player */
  patches?: number;
  /** the player's own troops at the start, beside the Workers */
  guard?: UnitType[];
  /** seconds before the computers send their main attack waves (early raids aside) */
  calm?: number;
  /** how the raids go, if not three small ones every 150s */
  rush?: Rush;
  /** the scattered enemy camps come to each other's help from this many tiles (Alex: mission 6 was too easy) */
  camps?: number;
  /** no towns: the player starts with just this army (no Workers, no buildings) */
  army?: UnitType[];
  /** the game it plays (fixed map, so a mission is the same each time) */
  setup: GameSetup;
}

// every mission uses the Regrow fog of war (Alex, 2026-11-27)
const game = (s: Partial<GameSetup>): GameSetup => ({ ...DEFAULT_SETUP, seats: [...DEFAULT_SETUP.seats], speed: 1, ...s, fog: 'regrow' });
const rep = <T extends UnitType>(t: T, n: number): UnitType[] => Array.from({ length: n }, () => t);
/** `n` creatures picked at random from the seed (the same every time), no Dragons */
const randomBeasts = (seed: number, n: number): UnitType[] => {
  const rnd = mulberry32(seed), kinds = BEASTS.filter((t) => t !== 'dragon');
  return Array.from({ length: n }, () => kinds[Math.floor(rnd() * kinds.length)]);
};
const vs = (level: GameSetup['seats'][number]): GameSetup['seats'] => [level, level, level, level];

export const MISSIONS: Mission[] = [
  {
    id: 'first-camp', name: 'First Camp', maxEra: 0, small: 52,
    // Alex: "First camp should not have buildings. Just some beginning units"
    army: [...rep('swordsman', 5), ...rep('crossbowman', 3)], patches: 7, // Alex: "too many enemies nearby. There should be just 7 patches"
    scatter: ['swordsman', 'swordsman', 'crossbowman', 'swordsman', 'crossbowman', 'swordsman', 'swordsman', 'crossbowman'],
    brief: 'No town to look after yet: just a band of Footmen and Crossbowmen on a small island. Enemy soldiers are camped across it. Hunt them all down.',
    setup: game({ mode: '1v1', seats: vs('easy'), resources: 'low', army: 'squad', seed: 1101 }),
  },
  {
    id: 'two-workers', name: 'Two Workers', maxEra: 0, small: 68, // half the full map's area (Alex: "Level 2 map half size")
    guard: ['swordsman', 'swordsman', 'crossbowman'], calm: 900, // Alex: "Level 2 is too difficult"
    brief: 'The usual start: a Town Hall and two Workers, plus two Footmen and a Crossbowman, against one Easy computer. It won\'t attack in earnest for the first 15 minutes, so build up.',
    setup: game({ mode: '1v1', seats: vs('easy'), resources: 'standard', army: 'workers', seed: 2202 }),
  },
  {
    id: 'with-a-friend', name: 'Winter Friends', maxEra: 0, snow: true, raids: ['swordsman', 'swordsman'], rush: { count: 2, every: 120, size: 2 }, guard: ['swordsman', 'swordsman', 'crossbowman'], calm: 900, // Alex: introduces early attacks with small rushes; then "too difficult": fewer rushes, a starting guard, main attacks from 15 minutes
    brief: 'Snow on the ground. A computer ally fights beside you against two Easy computers, who teach you about early attacks: in the first minutes they send a few small rushes of a couple of soldiers. Your two Footmen and a Crossbowman can meet them while you build up; their real attacks only come later.',
    setup: game({ mode: '2v2', seats: vs('easy'), resources: 'standard', army: 'workers', seed: 3303 }),
  },
  {
    // Alex: "Level 4 all about finding oil. One oil patch. Small map."
    id: 'engines', name: 'Black Gold', maxEra: 1, small: 60, oneOil: true, oilPatches: 2, raids: ['swordsman', 'swordsman'], goals: ['derrick', 'industrial'], // Alex: not won until an Oil Derrick is built, the Town Hall reaches the Industrial age and the enemy is destroyed
    brief: 'There are just two oil patches on this small map, somewhere out in the fog. Find one and hold it: oil builds the Engine Works that opens the Industrial age. One Easy computer is looking too, and will send small raids your way early on.',
    setup: game({ mode: '1v1', seats: vs('easy'), resources: 'standard', army: 'workers', seed: 4404 }),
  },
  {
    // Alex: "Level 5 airplanes. Small map. Each player is on an island. Player can build air plane hanger"
    id: 'thin-pickings', name: 'Frozen Isles', maxEra: 1, snow: true, small: 64, islands: true, raids: ['balloon', 'balloon'], // Alex: a few early (air) attacks
    brief: 'You and a Normal computer each hold an island, with icy sea between. Only aircraft can cross: reach the Industrial age, build an Airfield and take the war to them by air. Expect their War Balloons over your town early on.',
    setup: game({ mode: '1v1', seats: vs('normal'), resources: 'standard', army: 'workers', seed: 5505 }),
  },
  {
    // Alex: "Start with 20 army units. No workers. No buildings and enemy has no buildings. Enemy just
    // has random units around. Still more difficult"
    id: 'iron-and-steam', name: 'Iron and Steam', maxEra: 1, small: 68,
    army: [...rep('rifleman', 8), ...rep('gunner', 4), ...rep('tank', 4), ...rep('jeep', 2), ...rep('artillery', 2)],
    // Alex: "Mission 6 and 7 were too easy", then "Iron & Steam is too hard"
    // so back to 24, mostly infantry, and only close camps answer a fight
    scatter: [...rep('rifleman', 10), ...rep('gunner', 5), ...rep('tank', 4), ...rep('jeep', 3), ...rep('artillery', 2)], camps: 8, patches: 8, // Alex: "the enemy units are too close": 8 camps, none near the start
    brief: 'No town and no Workers: just your army of 20. Enemy troops are camped in small groups all over the map, a few more of them than you, and a camp close by may join a fight it hears. Take the camps one at a time and wipe them out.',
    setup: game({ mode: '1v1', seats: vs('normal'), resources: 'standard', army: 'workers', seed: 6606 }),
  },
  {
    // Alex: "a new mission between 6 and 7. One with scarce wood. Only a small patch in the center"
    id: 'last-grove', name: 'The Last Grove', maxEra: 1, small: 72, oneWood: true, guards: ['centaur', 'minotaur', 'cyclops'], raids: ['rifleman', 'rifleman', 'gunner'], // Alex: creatures guard it; the enemy raids
    brief: 'Hardly a tree stands on this land: the only wood is one small grove in the middle of the map. Wild creatures guard it: beat one down and it kneels, ready to be captured. One Normal computer needs the wood as badly as you do, and raids you early. Take the grove and hold it. New: Big Bertha, to shell the grove from afar.',
    setup: game({ mode: '1v1', seats: vs('normal'), resources: 'standard', army: 'workers', seed: 6707 }),
  },
  {
    // Alex: "Mission 7. Discover magic. Can now build magic units and build the magic tower"
    id: 'modern-war', name: 'Discover Magic', maxEra: 1, raids: ['rifleman', 'rifleman', 'gunner'], // Alex: was too easy
    brief: 'Magic is found: build an Arcane Circle and train Battle Mages, Tide Callers, Storm Callers and Plague Witches at the Barracks. You and a Normal ally against two Hard computers, who raid you early.',
    setup: game({ mode: '2v2', seats: ['normal', 'hard', 'normal', 'hard'], resources: 'standard', army: 'workers', seed: 7707 }),
  },
  {
    // Alex: "Mission 8 - introduction to Modern. Expand to more things. 1v1 Normal difficulty"
    id: 'frozen-front', name: 'Frozen Front', maxEra: 2, snow: true,
    brief: 'The Modern age opens, with jets, helicopters, cyborgs and more. One Normal computer on a frozen map.',
    setup: game({ mode: '1v1', seats: vs('normal'), resources: 'standard', army: 'workers', seed: 8808 }),
  },
  {
    // Alex: "Between mission 9 and 10 add a mission where player only has creatures and goes against random creatures"
    id: 'beast-war', name: 'Beast War', maxEra: 2, small: 68,
    army: [...rep('centaur', 3), ...rep('minotaur', 2), ...rep('cyclops', 2), ...rep('harpy', 2), ...rep('griffin', 2), 'medusa', 'nemean', 'dragon'],
    scatter: randomBeasts(9505, 18), camps: 12, patches: 6,
    brief: 'No town, no soldiers: you lead a band of 14 creatures of myth. Creatures of every kind roam the land against you, more of them than you, and packs nearby come running when they hear a fight. Hunt them all down.',
    setup: game({ mode: '1v1', seats: vs('normal'), resources: 'standard', army: 'workers', seed: 9505 }),
  },
  {
    // Alex: "Mission 9 - introduction to aether, creatures, weather, all the other things"
    id: 'last-stand', name: 'Wonders', maxEra: 2, wild: true,
    brief: 'Aether, wild creatures to capture and storms appear for the first time, and everything is unlocked. One Normal computer.',
    setup: game({ mode: '1v1', seats: vs('normal'), resources: 'standard', army: 'workers', seed: 9909 }),
  },
  {
    // Alex: "Mission 10 - 2v2 hard"
    id: 'last-stand-2v2', name: 'Last Stand', maxEra: 2, wild: true,
    brief: 'You and a computer ally against two Hard computers, with everything in play. Win this and the campaign is yours.',
    setup: game({ mode: '2v2', seats: vs('hard'), resources: 'standard', army: 'workers', seed: 10010 }),
  },
];

// Weather (Alex, 2026-11-27: "no weather besides rain until level 8"): passing rain only on missions
// 1-9 (a snow map's falling snow is its weather, so no rain there), and storms from mission 10 (Alex).
MISSIONS.forEach((m) => { m.setup.weather = m.wild ? 'storms' : m.snow ? 'off' : 'rain'; });

/**
 * The world options a mission plays with (initWorld's StartOptions). Missions before 8 have no Aether
 * and no creature lairs (`wild` is left out on them, so it must be read as false here, not defaulted).
 */
/**
 * A mission's own layout (Alex: "Missions with town halls should be randomized locations but always
 * set the same for that mission"): the Town Halls stand at spots picked from the mission's seed, not
 * the usual mirrored corners, and each base gets its ore field, oil well and wood beside it, toward the
 * middle. The same mission always gets the same spots, on every device.
 */
export function missionLayout(m: Mission): MapLayout {
  const teams = MODES[m.setup.mode].teams, size = m.small ?? 0, [lo, hi] = size ? smallBounds(size) : [4, 92];
  const lean = size > 0 && size < SPARSE, span = hi - lo, rnd = mulberry32((m.setup.seed ?? 1) * 7 + 13);
  const inside = ([x, y]: Tile, pad: number) => x >= lo + pad && y >= lo + pad && x <= hi - pad - 3 && y <= hi - pad - 3;
  // islands: one Town Hall each side of the sound that runs along x = y
  const sideOk = (t: number, [x, y]: Tile) => !m.islands || (t === 0 ? y - x > 14 : x - y > 14);
  const yards: Tile[] = [];
  for (let t = 0; t < teams; t++) {
    let best: Tile = [lo + 6, hi - 9], bestD = -1;
    for (let k = 0; k < 400; k++) {
      const p: Tile = [Math.round(lo + 4 + rnd() * (span - 11)), Math.round(lo + 4 + rnd() * (span - 11))];
      if (!sideOk(t, p)) continue;
      const d = Math.min(...yards.map(([x, y]) => Math.hypot(x - p[0], y - p[1])), 999);
      // far enough from every other base; the first spot that is, else the farthest found
      if (d >= span * (teams > 2 ? 0.42 : 0.6)) { best = p; break; }
      if (d > bestD) { best = p; bestD = d; }
    }
    yards.push(best);
  }
  // each base's ore, oil and wood, turned toward the middle of the land
  const mid = (lo + hi) / 2, ore: Tile[] = [], oil: Tile[] = [], forests: [number, number, number][] = [];
  const at = ([x, y]: Tile, a: number, r: number): Tile => [Math.round(x + 1 + Math.cos(a) * r), Math.round(y + 1 + Math.sin(a) * r)];
  const clampIn = (p: Tile): Tile => [Math.min(hi - 3, Math.max(lo + 3, p[0])), Math.min(hi - 3, Math.max(lo + 3, p[1]))];
  for (const y of yards) {
    const a = Math.atan2(mid - y[1] - 1, mid - y[0] - 1);
    ore.push(clampIn(at(y, a + 0.9, 8)));
    oil.push(clampIn(at(y, a - 0.9, 9)));
    forests.push([...clampIn(at(y, a + Math.PI, 7)), lean ? 3 : 4]);
  }
  // more ore out in the open: one in the middle (not under the islands' sea), and more on a roomier map
  // (the one grove takes the middle instead)
  if (!m.islands && !m.oneWood) ore.push([Math.round(mid), Math.round(mid)]);
  for (let k = 0, extra = lean ? 0 : teams > 2 ? 4 : 2; k < 200 && extra > 0; k++) {
    const p: Tile = [Math.round(lo + 6 + rnd() * (span - 12)), Math.round(lo + 6 + rnd() * (span - 12))];
    if (!inside(p, 4) || (m.islands && Math.abs(p[0] - p[1]) < 12)) continue;
    if ([...yards.map(([x, y]) => [x + 1, y + 1] as Tile), ...ore, ...oil].some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 11)) continue;
    ore.push(p);
    extra--;
  }
  // a lean map keeps one small wood, by the player
  if (m.oneOil) {
    // the hidden oil patches (Alex: one, then "another oil derrick"): each the open spot farthest from
    // every base and every patch already placed, out where it has to be found
    oil.length = 0;
    for (let k = 0; k < (m.oilPatches ?? 1); k++) {
      let best: Tile = [Math.round(mid), Math.round(mid)], bestD = -1;
      for (let y = lo + 5; y <= hi - 5; y++)
        for (let x = lo + 5; x <= hi - 5; x++) {
          const d = Math.min(...yards.map(([a, b]) => Math.hypot(a + 1 - x, b + 1 - y)), ...ore.map(([a, b]) => Math.hypot(a - x, b - y) * 2), ...oil.map(([a, b]) => Math.hypot(a - x, b - y)));
          if (d > bestD) { bestD = d; best = [x, y]; }
        }
      oil.push(best);
    }
  }
  if (m.oneWood) return { yards, ore, oil, forests: [[Math.round(mid), Math.round(mid), 3]], portals: [] };
  return { yards, ore, oil, forests: lean ? forests.slice(0, 1) : forests, portals: [] };
}

export const missionWorld = (m: Mission) => ({
  maxEra: m.maxEra, ban: bannedIn(m), snow: !!m.snow, small: m.small ?? 0, scatter: m.scatter, layout: missionLayout(m), islands: !!m.islands, goals: m.goals ?? [], raiders: m.raids, rush: m.rush, guard: m.guard, calm: m.calm, patches: m.patches, camps: m.camps, oneWood: !!m.oneWood, guards: m.guards,
  ...(m.army ? { units: m.army, noTown: true } : {}),
  wild: !!m.wild, aether: !!m.wild, gate: false,
});

/** What nobody may build, train or research in a mission: everything a later mission unlocks. */
export const bannedIn = (m: Mission): string[] => UNLOCKS.slice(MISSIONS.indexOf(m) + 1).flat();

/** The names of what a mission unlocks, for the mission list ("Knight, Watchtower, ...") */
export const newIn = (m: Mission): string[] => (UNLOCKS[MISSIONS.indexOf(m)] ?? [])
  .filter((t) => !TECH_TYPES.includes(t as TechType) || TECH[t as TechType].age != null)
  // a mission with just an army and no town: only the troops it has are new to see there
  .filter((t) => !m.army || m.army.includes(t as UnitType))
  .map(nameOf);

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
/** Every mission won: the whole campaign is finished. */
export const campaignDone = (won = wonMissions()): boolean => MISSIONS.every((m) => won.has(m.id));

/** The congratulations for finishing the campaign (Alex): on the last mission's victory screen and the campaign screen. */
export const CAMPAIGN_DONE = `Congratulations, Commander! You have won all ${MISSIONS.length} missions of the Killcraft campaign, from a lone camp on a small island to the last stand of the modern age. Every age, every machine and every spell is yours. Replay any mission, or take your army online.`;

export const nextMission = (id: string): Mission | null => MISSIONS[MISSIONS.findIndex((m) => m.id === id) + 1] ?? null;
