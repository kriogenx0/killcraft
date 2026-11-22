// Ages of technology. Every side starts in the Medieval age. Oil is the way forward: an Oil Derrick
// on a well lets a side build the Engine Works, which takes it into the World War age, and the
// Modern age is researched at the Construction Yard for oil alone. Each age unlocks newer units and
// structures, and older ones stay available.
// The Hospital researches faster healing for organic units, and the Armory weapon and armor upgrades.
import type { BldType } from './building.ts';

export interface EraDef {
  name: string;
  desc: string;
}

export const ERA: EraDef[] = [
  { name: 'Medieval', desc: 'Swords, crossbows, knights and catapults.' },
  { name: 'World War', desc: 'Riflemen, Machine Gunners, Scout Jeeps, Battle Tanks, the Gun Turret and Flak Cannon, and War Balloons and Biplanes from the Airfield.' },
  { name: 'Modern', desc: 'Rocket Soldiers, Heavy Tanks, Attack Helicopters and Combat Drones.' },
];

export const START_ERA = 0;
export const LAST_ERA = ERA.length - 1;

export type TechType = 'age2' | 'heal1' | 'heal2' | 'heal3' | 'ward'
  | 'infWeapon1' | 'infWeapon2' | 'infWeapon3' | 'infArmor1' | 'infArmor2' | 'infArmor3'
  | 'vehWeapon1' | 'vehWeapon2' | 'vehWeapon3' | 'vehArmor1' | 'vehArmor2' | 'vehArmor3';

/**
 * Armory upgrades come in four tracks: weapons and armor for troops on foot (infantry and knights),
 * and for machines (vehicles and aircraft). Each track has a level per age.
 */
export type UpgradeTrack = 'infWeapon' | 'infArmor' | 'vehWeapon' | 'vehArmor';
export const UPGRADE_TRACKS: UpgradeTrack[] = ['infWeapon', 'infArmor', 'vehWeapon', 'vehArmor'];
/** Each weapons level adds this much damage; each armor level takes this much off damage received. */
export const WEAPON_BONUS = 0.1;
export const ARMOR_BONUS = 0.1;

export interface TechDef {
  name: string;
  /** the age a team must be in to start this research */
  era: number;
  /** the age this research reaches (age research) */
  age?: number;
  /** the healing level this research reaches (see HEAL_RATE) */
  heal?: number;
  /** the Aether Ward: buildings take less damage (see WARD_FACTOR) */
  ward?: boolean;
  /** an Armory upgrade: the track and the level it reaches */
  upg?: { track: UpgradeTrack; level: number };
  /** the building that researches it, if not the Construction Yard */
  at?: 'hospital' | 'armory';
  /** ore */
  cost: number;
  wood?: number;
  oil?: number;
  /** Aether; research that needs it is hidden until the side first finds some */
  aether?: number;
  /** research time in seconds at full power */
  t: number;
  /** buildings that must exist before the research can start */
  requires: BldType[];
  /** preferred hotkey letter; otherwise one is picked from the name (views/game/hotkeys.ts) */
  key?: string;
  desc: string;
}

/**
 * Organic units (infantry, knights) slowly heal on their own. Fraction of max health regained per
 * second at each healing level: level 0 takes over eight minutes to heal fully, level 3 about a minute.
 */
export const HEAL_RATE = [0.002, 0.004, 0.008, 0.016];
export const MAX_HEAL = HEAL_RATE.length - 1;
/** Having a Hospital makes organic units heal this much faster. */
export const HOSPITAL_HEAL = 1.5;
const fullIn = (lvl: number) => `${Math.round(1 / HEAL_RATE[lvl])}s`;

export const TECH: Record<TechType, TechDef> = {
  age2: { name: 'Modern Age', era: 1, age: 2, cost: 0, oil: 800, t: 60, requires: [], desc: `Advance to the Modern age. Paid for in oil alone. Unlocks ${ERA[2].desc}` },
  heal1: { name: 'Field Dressing', era: 0, heal: 1, at: 'hospital', cost: 400, t: 25, requires: ['hospital'], desc: `Infantry and knights heal twice as fast (full health in ${fullIn(1)}).` },
  heal2: { name: 'Surgeons', era: 1, heal: 2, at: 'hospital', cost: 800, t: 35, requires: ['hospital'], desc: `Infantry and knights heal twice as fast again (full health in ${fullIn(2)}).` },
  heal3: { name: 'Antibiotics', era: 2, heal: 3, at: 'hospital', cost: 1200, t: 45, requires: ['hospital'], desc: `Infantry and knights heal twice as fast again (full health in ${fullIn(3)}).` },
  // Armory upgrades, priced by what they're made of: wood and iron early, oil-hungry later
  infWeapon1: { name: 'Tempered Steel', era: 0, upg: { track: 'infWeapon', level: 1 }, at: 'armory', cost: 300, wood: 100, t: 25, requires: ['armory'], desc: 'Infantry and knights deal 10% more damage.' },
  infWeapon2: { name: 'Rifled Barrels', era: 1, upg: { track: 'infWeapon', level: 2 }, at: 'armory', cost: 700, wood: 100, t: 35, requires: ['armory'], desc: 'Infantry and knights deal 10% more damage again (+20%).' },
  infWeapon3: { name: 'Smart Optics', era: 2, upg: { track: 'infWeapon', level: 3 }, at: 'armory', cost: 1200, oil: 200, t: 45, requires: ['armory'], desc: 'Infantry and knights deal 10% more damage again (+30%).' },
  infArmor1: { name: 'Chainmail', era: 0, upg: { track: 'infArmor', level: 1 }, at: 'armory', cost: 300, wood: 50, t: 25, requires: ['armory'], desc: 'Infantry and knights take 10% less damage.' },
  infArmor2: { name: 'Steel Helmets', era: 1, upg: { track: 'infArmor', level: 2 }, at: 'armory', cost: 700, t: 35, requires: ['armory'], desc: 'Infantry and knights take 10% less damage again (-20%).' },
  infArmor3: { name: 'Kevlar Vests', era: 2, upg: { track: 'infArmor', level: 3 }, at: 'armory', cost: 1200, oil: 200, t: 45, requires: ['armory'], desc: 'Infantry and knights take 10% less damage again (-30%).' },
  vehWeapon1: { name: 'Siege Engineering', era: 0, upg: { track: 'vehWeapon', level: 1 }, at: 'armory', cost: 250, wood: 300, t: 25, requires: ['armory'], desc: 'Vehicles and aircraft deal 10% more damage.' },
  vehWeapon2: { name: 'High-Explosive Shells', era: 1, upg: { track: 'vehWeapon', level: 2 }, at: 'armory', cost: 800, oil: 150, t: 40, requires: ['armory'], desc: 'Vehicles and aircraft deal 10% more damage again (+20%).' },
  vehWeapon3: { name: 'Guided Munitions', era: 2, upg: { track: 'vehWeapon', level: 3 }, at: 'armory', cost: 1400, oil: 300, t: 50, requires: ['armory'], desc: 'Vehicles and aircraft deal 10% more damage again (+30%).' },
  vehArmor1: { name: 'Iron Banding', era: 0, upg: { track: 'vehArmor', level: 1 }, at: 'armory', cost: 350, wood: 200, t: 25, requires: ['armory'], desc: 'Vehicles and aircraft take 10% less damage.' },
  vehArmor2: { name: 'Riveted Plate', era: 1, upg: { track: 'vehArmor', level: 2 }, at: 'armory', cost: 800, oil: 150, t: 40, requires: ['armory'], desc: 'Vehicles and aircraft take 10% less damage again (-20%).' },
  vehArmor3: { name: 'Composite Armor', era: 2, upg: { track: 'vehArmor', level: 3 }, at: 'armory', cost: 1400, oil: 300, t: 50, requires: ['armory'], desc: 'Vehicles and aircraft take 10% less damage again (-30%).' },
  ward: { name: 'Aether Ward', era: 0, ward: true, cost: 500, aether: 100, t: 40, requires: [], desc: 'Aether woven into the walls: your buildings take 10% less damage.' },
};

export const TECH_TYPES = Object.keys(TECH) as TechType[];

export const isTechType = (t: string): t is TechType => t in TECH;
