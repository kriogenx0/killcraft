import type { WeaponType } from './weapon.ts';
import type { Producer } from './unit.ts';

export type BldType = 'yard' | 'power' | 'refinery' | 'barracks' | 'factory' | 'turret' | 'tower';

export interface BldDef {
  name: string;
  /** footprint in tiles (square) */
  size: number;
  /** pixels the art extends above the footprint */
  top: number;
  hp: number;
  cost: number;
  /** build time in seconds at full power */
  t: number;
  /** the age (see data/era.ts) that unlocks this structure */
  era: number;
  /** power produced (positive) or used (negative) */
  power: number;
  sight: number;
  /** buildings that must exist before this one can be built */
  requires: BldType[];
  /** what this building produces, if anything */
  produces?: Producer | 'structure';
  weapon?: WeaponType;
  /** false for buildings that can't be built from the sidebar */
  buildable: boolean;
  desc: string;
}

export const BUILDING: Record<BldType, BldDef> = {
  yard: { name: 'Construction Yard', size: 3, top: 40, hp: 1400, cost: 3000, t: 60, era: 0, power: 15, sight: 6, requires: [], produces: 'structure', buildable: false, desc: 'Builds every other structure.' },
  power: { name: 'Power Plant', size: 2, top: 38, hp: 400, cost: 300, t: 8, era: 0, power: 100, sight: 4, requires: [], buildable: true, desc: 'Provides 100 power.' },
  refinery: { name: 'Refinery', size: 3, top: 34, hp: 900, cost: 2000, t: 18, era: 0, power: -40, sight: 5, requires: ['power'], buildable: true, desc: 'Turns ore into gold. Comes with a free harvester.' },
  barracks: { name: 'Barracks', size: 2, top: 22, hp: 500, cost: 300, t: 8, era: 0, power: -20, sight: 5, requires: ['power'], produces: 'infantry', buildable: true, desc: 'Trains infantry.' },
  factory: { name: 'War Factory', size: 3, top: 34, hp: 1000, cost: 2000, t: 18, era: 0, power: -30, sight: 5, requires: ['refinery'], produces: 'vehicle', buildable: true, desc: 'Builds vehicles.' },
  tower: { name: 'Watchtower', size: 1, top: 44, hp: 420, cost: 400, t: 9, era: 0, power: -10, sight: 7, requires: ['barracks'], weapon: 'ballista', buildable: true, desc: 'Stone tower with a ballista on top. Strong against infantry and cavalry.' },
  turret: { name: 'Gun Turret', size: 1, top: 12, hp: 450, cost: 600, t: 10, era: 1, power: -20, sight: 7, requires: ['barracks'], weapon: 'turretcannon', buildable: true, desc: 'Defensive cannon. Strong against vehicles.' },
};

/** Order the structures appear in the sidebar. */
export const BLD_TYPES: BldType[] = ['power', 'refinery', 'barracks', 'factory', 'tower', 'turret'];

/** New structures must be placed within this many tiles of an existing one. */
export const BUILD_RADIUS = 3;

/** Fraction of a building's cost returned when it is sold. */
export const SELL_REFUND = 0.5;

/** Repairs restore this much health per second and cost proportionally to the building's price. */
export const REPAIR_RATE = 25;
