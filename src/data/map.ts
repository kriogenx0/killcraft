// Fixed layout of the skirmish map; terrain between these points is generated from a seed.
import type { Tile } from '../game/state.ts';

/** Top-left tile of each team's Construction Yard (index = team). */
export const START_YARDS: Tile[] = [
  [6, 50],
  [55, 11],
];

/** Ore crystal rocks. Each grows an ore field around it. The first two sit by the bases. */
export const ORE_SOURCES: Tile[] = [
  [14, 54],
  [49, 9],
  [16, 28],
  [47, 35],
  [32, 31],
  [6, 34],
  [57, 29],
];

/** Oil wells: pools of oil that never refill. One near each base, two in the contested middle. */
export const OIL_WELLS: Tile[] = [
  [15, 45],
  [48, 18],
  [24, 37],
  [39, 26],
];

/** Guaranteed woods near each base, in reach of a Lumber Mill: [centerX, centerY, radius]. */
export const FORESTS: [number, number, number][] = [
  [4, 41, 4],
  [59, 22, 4],
];

export const START_CREDITS = 3500;
export const START_WOOD = 400;
export const START_OIL = 0;
export const START_UNITS = ['swordsman', 'swordsman', 'crossbowman', 'knight'] as const;
