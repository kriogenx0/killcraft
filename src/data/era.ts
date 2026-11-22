// Ages of technology. Every side starts in the Medieval age and researches its way forward at the
// Construction Yard; each age unlocks newer units and structures, and older ones stay available.
import type { BldType } from './building.ts';

export interface EraDef {
  name: string;
  desc: string;
}

export const ERA: EraDef[] = [
  { name: 'Medieval', desc: 'Swords, crossbows, knights and catapults.' },
  { name: 'Gunpowder', desc: 'Riflemen and the Gun Turret.' },
  { name: 'Industrial', desc: 'Scout Jeeps and Battle Tanks.' },
  { name: 'Modern', desc: 'Rocket Soldiers and Heavy Tanks.' },
];

export const START_ERA = 0;
export const LAST_ERA = ERA.length - 1;

export type TechType = 'age1' | 'age2' | 'age3';

export interface TechDef {
  name: string;
  /** the age this research reaches */
  era: number;
  cost: number;
  /** research time in seconds at full power */
  t: number;
  /** buildings that must exist before the research can start */
  requires: BldType[];
  desc: string;
}

export const TECH: Record<TechType, TechDef> = {
  age1: { name: 'Gunpowder Age', era: 1, cost: 1000, t: 35, requires: ['barracks'], desc: `Advance to the Gunpowder age. Unlocks ${ERA[1].desc}` },
  age2: { name: 'Industrial Age', era: 2, cost: 2000, t: 50, requires: ['factory'], desc: `Advance to the Industrial age. Unlocks ${ERA[2].desc}` },
  age3: { name: 'Modern Age', era: 3, cost: 3000, t: 65, requires: ['factory'], desc: `Advance to the Modern age. Unlocks ${ERA[3].desc}` },
};

export const TECH_TYPES = Object.keys(TECH) as TechType[];

export const isTechType = (t: string): t is TechType => t in TECH;
