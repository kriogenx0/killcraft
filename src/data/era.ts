// Ages of technology. Every side starts in the Medieval age and researches its way forward at the
// Construction Yard; each age unlocks newer units and structures, and older ones stay available.
// The yard also researches faster healing for organic units.
import type { BldType } from './building.ts';

export interface EraDef {
  name: string;
  desc: string;
}

export const ERA: EraDef[] = [
  { name: 'Medieval', desc: 'Swords, crossbows, knights and catapults.' },
  { name: 'World War', desc: 'Riflemen, Scout Jeeps, Battle Tanks, the Gun Turret and Flak Cannon, Oil Derricks, and War Balloons and Biplanes from the Airfield.' },
  { name: 'Modern', desc: 'Rocket Soldiers, Heavy Tanks and Attack Helicopters.' },
];

export const START_ERA = 0;
export const LAST_ERA = ERA.length - 1;

export type TechType = 'age1' | 'age2' | 'heal1' | 'heal2' | 'heal3' | 'ward';

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
  age1: { name: 'World War', era: 0, age: 1, cost: 1000, wood: 150, t: 35, requires: ['barracks'], desc: `Advance to the World War age. Unlocks ${ERA[1].desc}` },
  age2: { name: 'Modern Age', era: 1, age: 2, cost: 3000, wood: 600, oil: 400, t: 65, requires: ['factory'], desc: `Advance to the Modern age. Unlocks ${ERA[2].desc}` },
  heal1: { name: 'Field Dressing', era: 0, heal: 1, cost: 400, t: 25, requires: ['barracks'], desc: `Infantry and knights heal twice as fast (full health in ${fullIn(1)}).` },
  heal2: { name: 'Surgeons', era: 1, heal: 2, cost: 800, t: 35, requires: ['barracks'], desc: `Infantry and knights heal twice as fast again (full health in ${fullIn(2)}).` },
  heal3: { name: 'Antibiotics', era: 2, heal: 3, cost: 1200, t: 45, requires: ['barracks'], desc: `Infantry and knights heal twice as fast again (full health in ${fullIn(3)}).` },
  ward: { name: 'Aether Ward', era: 0, ward: true, cost: 500, aether: 100, t: 40, requires: [], desc: 'Aether woven into the walls: your buildings take 10% less damage.' },
};

export const TECH_TYPES = Object.keys(TECH) as TechType[];

export const isTechType = (t: string): t is TechType => t in TECH;
