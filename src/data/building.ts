import type { WeaponType } from './weapon.ts';
import type { Producer } from './unit.ts';
import { LAST_ERA } from './era.ts';

export type BldType = 'yard' | 'power' | 'mill' | 'refinery' | 'camp' | 'barracks' | 'factory' | 'tower' | 'turret' | 'derrick' | 'works' | 'airfield' | 'flak' | 'hospital' | 'armory' | 'magetower'
  | 'shrine' | 'wardstone' | 'waygate'
  | 'palisade' | 'stonewall' | 'concretewall' | 'pillbox' | 'atturret' | 'bertha';

/** Structures bought with Aether. */
export type AetherBld = 'shrine' | 'wardstone' | 'waygate';
export const isAetherBld = (t: string): t is AetherBld => t === 'shrine' || t === 'wardstone' || t === 'waygate';

export interface BldDef {
  name: string;
  /** footprint in tiles (square) */
  size: number;
  /** pixels the art extends above the footprint */
  top: number;
  hp: number;
  /** ore */
  cost: number;
  wood?: number;
  oil?: number;
  /** Aether (data/aether.ts); structures that need it are hidden until the side first finds some */
  aether?: number;
  /** build time in seconds at full power */
  t: number;
  /** the age (see data/era.ts) that unlocks this structure */
  era: number;
  /** power produced (positive) or used (negative) */
  power: number;
  sight: number;
  /** this structure lets its side research this age at the Town Hall (see data/era.ts); one per side, and none after that age */
  opens?: number;
  /** buildings that must exist before this one can be built */
  requires: BldType[];
  /** what this building produces, if anything */
  produces?: Producer | 'structure' | 'hospital' | 'armory';
  weapon?: WeaponType;
  /** a wall segment: blocks movement, needs no power, is placed in lines and doesn't extend the base */
  wall?: boolean;
  /** false for buildings that can't be built from the sidebar */
  buildable: boolean;
  /** preferred hotkey letter; otherwise one is picked from the name (views/game/hotkeys.ts) */
  key?: string;
  /** the hotkey sub-menu it sits in at its producer; walls, defenses and Aether structures get one by default (views/game/hotkeys.ts) */
  group?: string;
  desc: string;
}

export const BUILDING: Record<BldType, BldDef> = {
  yard: { name: 'Town Hall', size: 3, top: 40, hp: 1400, cost: 3000, wood: 300, t: 60, era: 0, power: 15, sight: 6, requires: [], produces: 'structure', buildable: true, group: 'Expand', desc: 'The heart of your town: plans every structure, researches the ages and takes ore, oil and wood. Build another by distant ore to start a new base: it can go anywhere you have explored, and you stay in the game while any Town Hall stands.' },
  power: { name: 'Power Plant', size: 2, top: 38, hp: 400, cost: 300, wood: 50, t: 8, era: 0, power: 100, sight: 4, requires: [], buildable: true, desc: 'Powers your base (+100). Short on power, everything builds at half speed and defenses fire slower.' },
  mill: { name: 'Lumber Mill', size: 2, top: 30, hp: 450, cost: 400, t: 10, era: 0, power: -10, sight: 5, requires: [], buildable: true, desc: 'Where Workers drop off the wood they chop. Place it by the woods to shorten their trips. Right-click it with Workers to set them chopping nearby.' },
  refinery: { name: 'Refinery', size: 3, top: 34, hp: 900, cost: 2000, wood: 200, t: 18, era: 0, power: -40, sight: 5, requires: ['power'], buildable: true, desc: 'Ore is unloaded here. Comes with two free Workers, or a Harvester in the Modern age.' },
  camp: { name: 'Mining Camp', size: 2, top: 28, hp: 500, cost: 300, wood: 150, t: 12, era: 0, power: 0, sight: 5, requires: [], buildable: true, group: 'Expand', desc: 'A small drop-off for ore and oil. Build it by a far ore field or Oil Derrick so Workers and Harvesters stop walking all the way home. Can go anywhere you have explored.' },
  barracks: { name: 'Barracks', size: 2, top: 22, hp: 500, cost: 300, wood: 100, t: 8, era: 0, power: -20, sight: 5, requires: ['power'], produces: 'infantry', buildable: true, desc: 'Trains foot soldiers and Workers. New troops unlock with each age.' },
  factory: { name: 'War Factory', size: 3, top: 34, hp: 1000, cost: 2000, wood: 300, t: 18, era: 0, power: -30, sight: 5, requires: ['refinery'], produces: 'vehicle', buildable: true, desc: 'Builds vehicles: Catapults, then jeeps and tanks in later ages.' },
  hospital: { name: 'Hospital', size: 2, top: 30, hp: 500, cost: 500, wood: 150, t: 12, era: 0, power: -20, sight: 5, requires: ['barracks'], produces: 'hospital', buildable: true, desc: 'Tends the wounded: your infantry and knights heal a little faster while you have one. Researches faster healing, and the Barracks can train Medics.' },
  armory: { name: 'Armory', size: 2, top: 30, hp: 600, cost: 600, wood: 200, t: 14, era: 0, power: -20, sight: 5, requires: ['barracks'], produces: 'armory', buildable: true, desc: 'Forges better weapons and armor: researches damage and armor upgrades for troops and for vehicles and aircraft, one level per age.' },
  magetower: { name: 'Arcane Academy', size: 2, top: 60, hp: 550, cost: 500, wood: 200, t: 14, era: 0, power: -20, sight: 6, requires: ['barracks'], buildable: true, key: 'Z', desc: 'A school of magic where spellcasters learn their craft. The Barracks can train Battle Mages, Tide Callers and, in later ages, the other spellcasters only while you have one.' },
  tower: { name: 'Watchtower', size: 1, top: 44, hp: 420, cost: 400, wood: 150, t: 9, era: 0, power: -10, sight: 7, requires: ['barracks'], weapon: 'ballista', buildable: true, desc: 'Stone tower with a ballista on top. Strong against infantry and cavalry.' },
  turret: { name: 'Gun Turret', size: 1, top: 12, hp: 450, cost: 700, t: 10, era: 1, power: -20, sight: 7, requires: ['barracks'], weapon: 'turretcannon', buildable: true, desc: 'Defensive cannon. Strong against vehicles.' },
  derrick: { name: 'Oil Derrick', size: 2, top: 40, hp: 500, cost: 800, t: 16, era: 0, power: -30, sight: 4, requires: ['refinery'], buildable: true, desc: 'Pumps oil for tanks, jeeps and rockets. Build it on an oil well (the dark pools); wells run dry and never refill.' },
  works: { name: 'Engine Works', size: 2, top: 40, hp: 700, cost: 1000, wood: 150, t: 35, era: 0, opens: 1, power: -20, sight: 5, requires: ['derrick'], buildable: true, desc: 'Turns your oil into engines and gunpowder. Lets the Town Hall research the Industrial age. Needs an Oil Derrick.' },
  // walls: one-tile segments placed by dragging a line: timber and stone in the Medieval age, concrete from the Industrial age
  palisade: { name: 'Palisade', size: 1, top: 26, hp: 350, cost: 10, wood: 30, t: 2, era: 0, power: 0, sight: 1, requires: [], wall: true, buildable: true, desc: 'Sharpened log wall. Blocks the way until it is cut down. Drag to lay a line.' },
  stonewall: { name: 'Stone Wall', size: 1, top: 30, hp: 1000, cost: 60, t: 3, era: 0, power: 0, sight: 1, requires: [], wall: true, buildable: true, desc: 'Thick masonry wall. Holds off infantry; catapults and cannons break it. Drag to lay a line.' },
  concretewall: { name: 'Concrete Wall', size: 1, top: 28, hp: 1800, cost: 90, t: 3, era: 1, power: 0, sight: 1, requires: [], wall: true, buildable: true, desc: 'Reinforced concrete barrier. The toughest wall. Drag to lay a line.' },
  // defenses by role: Watchtower (Medieval, infantry), Gun Turret (Industrial, vehicles), Pillbox (Industrial, infantry),
  // Big Bertha (Industrial, long-range siege), Missile Turret (Modern, armor); anti-air comes with aircraft
  pillbox: { name: 'Pillbox', size: 1, top: 14, hp: 650, cost: 550, wood: 50, t: 11, era: 1, power: -10, sight: 7, requires: ['barracks'], weapon: 'pillboxmg', buildable: true, desc: 'Concrete bunker with a heavy machine gun. Shreds infantry; weak against tanks.' },
  atturret: { name: 'Missile Turret', size: 1, top: 18, hp: 550, cost: 900, oil: 150, t: 14, era: LAST_ERA, power: -30, sight: 8, requires: ['factory'], weapon: 'atmissile', buildable: true, desc: 'Guided anti-tank missiles with a long reach. Cracks heavy armor; poor against infantry.' },
  bertha: { name: 'Big Bertha', size: 2, top: 40, hp: 1100, cost: 2100, wood: 100, t: 30, era: 1, power: -40, sight: 10, requires: ['factory'], weapon: 'bertha', buildable: true, desc: 'Huge siege howitzer that fires across a third of the map at anything your side can see, and its spotters see far. Shells take seconds to land, so moving targets can dodge. Can\'t hit anything right next to it.' },
  airfield: { name: 'Airfield', size: 3, top: 30, hp: 900, cost: 1200, wood: 300, t: 20, era: 1, power: -30, sight: 6, requires: ['refinery'], produces: 'air', buildable: true, desc: 'Builds aircraft: balloons, then biplanes and helicopters in later ages.' },
  flak: { name: 'Flak Cannon', size: 1, top: 14, hp: 420, cost: 700, t: 10, era: 1, power: -20, sight: 8, requires: ['barracks'], weapon: 'flak', buildable: true, desc: 'Anti-aircraft gun with a long reach. Only fires at aircraft.' },
  // Aether structures, revealed once a side finds Aether (see data/aether.ts)
  shrine: { name: 'Star Shrine', size: 2, top: 40, hp: 500, cost: 300, aether: 80, t: 20, era: 0, power: 0, sight: 5, requires: [], buildable: true, desc: 'A ring of standing stones around a fallen-star shard. Slowly heals your units nearby, machines included.' },
  wardstone: { name: 'Ward Stone', size: 1, top: 36, hp: 300, cost: 150, aether: 40, t: 10, era: 0, power: 0, sight: 6, requires: [], buildable: true, desc: 'An obelisk with an Aether eye. Sees far and reveals cloaked enemies near it.' },
  waygate: { name: 'Waygate', size: 2, top: 44, hp: 600, cost: 400, aether: 75, t: 18, era: 1, power: -10, sight: 4, requires: [], buildable: true, desc: 'Build two and they link: your units step through one and out of the other. Enemies can\'t use them.' },
};

/** Does a building train units (and so take a rally point)? */
export const isUnitProducer = (p: BldDef['produces']): p is Producer => p === 'infantry' || p === 'vehicle' || p === 'air';

/** Order the structures appear in the sidebar. */
export const BLD_TYPES: BldType[] = ['power', 'mill', 'refinery', 'camp', 'yard', 'barracks', 'hospital', 'armory', 'magetower', 'factory', 'tower', 'turret', 'derrick', 'works', 'airfield', 'flak', 'pillbox', 'bertha', 'atturret', 'palisade', 'stonewall', 'concretewall', 'shrine', 'wardstone', 'waygate'];

export const WALL_TYPES: BldType[] = ['palisade', 'stonewall', 'concretewall'];
export const isWall = (t: string): boolean => !!BUILDING[t as BldType]?.wall;
/** Walls can go this many tiles from a structure that isn't a wall (walls themselves don't extend the base). */
export const WALL_RADIUS = 8;
/** Most segments in one dragged wall line. The first is built at the yard; the rest are paid for as they're laid. */
export const WALL_LINE_MAX = 16;

/**
 * Structures that start a new base away from home: they go anywhere the side has explored, as long
 * as no enemy structure stands within EXPAND_GAP tiles.
 */
export const EXPANSION: readonly BldType[] = ['yard', 'camp'];
export const isExpansion = (t: string): boolean => (EXPANSION as readonly string[]).includes(t);
export const EXPAND_GAP = 8;

/**
 * New structures must be placed within this many tiles of an existing one (it was 3; Alex asked for
 * 30% more room, and 4 is the nearest whole tile). The game shows this zone while placing.
 */
export const BUILD_RADIUS = 4;

/**
 * Scrapping a building pays this share of its whole price (ore, wood, oil and Aether, times its
 * remaining health) straight back into the bank (Alex, 2026-11-25: "Scrapping returns funds").
 */
export const SCRAP_SHARE = 0.5;

/** Repairs restore this much health per second and cost proportionally to the building's price. */
export const REPAIR_RATE = 25;

/**
 * Repairing a building from nothing to full health costs this share of its ore price (Alex,
 * 2026-11-26: "Fixing is too expensive"; was half).
 */
export const REPAIR_SHARE = 0.2;

/**
 * Buildings keep the look of the age they were built in. Each one is upgraded on its own to its
 * side's next age, for this share of its ore and wood price and of its build time (at least
 * UPGRADE_MIN_TIME seconds).
 */
export const UPGRADE_SHARE = 0.5;
export const UPGRADE_TIME = 0.6;
export const UPGRADE_MIN_TIME = 8;
/** Each age a building is upgraded through: this much more health, and this much more of what it does. */
export const UPGRADE_HP = 0.4;
export const UPGRADE_BONUS = 0.4;
