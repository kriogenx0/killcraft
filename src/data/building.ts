import type { WeaponType } from './weapon.ts';
import type { Producer } from './unit.ts';

export type BldType = 'yard' | 'power' | 'mill' | 'refinery' | 'barracks' | 'factory' | 'tower' | 'turret' | 'derrick' | 'airfield' | 'flak' | 'hospital';

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
  /** preferred hotkey letter; otherwise one is picked from the name (views/game/hotkeys.ts) */
  key?: string;
  desc: string;
}

export const BUILDING: Record<BldType, BldDef> = {
  yard: { name: 'Construction Yard', size: 3, top: 40, hp: 1400, cost: 3000, t: 60, era: 0, power: 15, sight: 6, requires: [], produces: 'structure', buildable: false, desc: 'Builds every other structure.' },
  power: { name: 'Power Plant', size: 2, top: 38, hp: 400, cost: 300, wood: 50, t: 8, era: 0, power: 100, sight: 4, requires: [], buildable: true, desc: 'Provides 100 power.' },
  mill: { name: 'Lumber Mill', size: 2, top: 30, hp: 450, cost: 400, t: 10, era: 0, power: -10, sight: 5, requires: [], buildable: true, desc: 'Cuts wood from the trees around it. Place it next to woods: more trees, more wood. Cut trees slowly grow back.' },
  refinery: { name: 'Refinery', size: 3, top: 34, hp: 900, cost: 2000, wood: 200, t: 18, era: 0, power: -40, sight: 5, requires: ['power'], buildable: true, desc: 'Harvesters unload ore here. Comes with a free harvester.' },
  barracks: { name: 'Barracks', size: 2, top: 22, hp: 500, cost: 300, wood: 100, t: 8, era: 0, power: -20, sight: 5, requires: ['power'], produces: 'infantry', buildable: true, desc: 'Trains infantry.' },
  factory: { name: 'War Factory', size: 3, top: 34, hp: 1000, cost: 2000, wood: 300, t: 18, era: 0, power: -30, sight: 5, requires: ['refinery'], produces: 'vehicle', buildable: true, desc: 'Builds vehicles.' },
  hospital: { name: 'Hospital', size: 2, top: 30, hp: 500, cost: 500, wood: 150, t: 12, era: 0, power: -20, sight: 5, requires: ['barracks'], buildable: true, desc: 'Tends the wounded: your infantry and knights heal a little faster while you have one. The Barracks can train Medics.' },
  tower: { name: 'Watchtower', size: 1, top: 44, hp: 420, cost: 400, wood: 150, t: 9, era: 0, power: -10, sight: 7, requires: ['barracks'], weapon: 'ballista', buildable: true, desc: 'Stone tower with a ballista on top. Strong against infantry and cavalry.' },
  turret: { name: 'Gun Turret', size: 1, top: 12, hp: 450, cost: 600, t: 10, era: 1, power: -20, sight: 7, requires: ['barracks'], weapon: 'turretcannon', buildable: true, desc: 'Defensive cannon. Strong against vehicles.' },
  derrick: { name: 'Oil Derrick', size: 2, top: 40, hp: 500, cost: 1200, t: 16, era: 1, power: -30, sight: 4, requires: ['refinery'], buildable: true, desc: 'Pumps oil for tanks, jeeps and rockets. Build it on an oil well (the dark pools); wells run dry and never refill.' },
  airfield: { name: 'Airfield', size: 3, top: 30, hp: 900, cost: 1200, wood: 300, t: 20, era: 1, power: -30, sight: 6, requires: ['refinery'], produces: 'air', buildable: true, desc: 'Builds aircraft: balloons, then biplanes and helicopters in later ages.' },
  flak: { name: 'Flak Cannon', size: 1, top: 14, hp: 420, cost: 700, t: 10, era: 1, power: -20, sight: 8, requires: ['barracks'], weapon: 'flak', buildable: true, desc: 'Anti-aircraft gun with a long reach. Only fires at aircraft.' },
};

/** Order the structures appear in the sidebar. */
export const BLD_TYPES: BldType[] = ['power', 'mill', 'refinery', 'barracks', 'hospital', 'factory', 'tower', 'turret', 'derrick', 'airfield', 'flak'];

/** New structures must be placed within this many tiles of an existing one. */
export const BUILD_RADIUS = 3;

/** Fraction of a building's cost returned when it is sold. */
export const SELL_REFUND = 0.5;

/** Repairs restore this much health per second and cost proportionally to the building's price. */
export const REPAIR_RATE = 25;
