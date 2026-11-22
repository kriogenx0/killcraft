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

/** Guaranteed woods near each base: [centerX, centerY, radius]. */
export const FORESTS: [number, number, number][] = [
  [3, 44, 3],
  [60, 19, 3],
];

export const START_CREDITS = 3000;
export const START_UNITS = ['swordsman', 'swordsman', 'crossbowman', 'knight'] as const;
