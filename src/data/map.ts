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

/**
 * Portal layouts. Some maps get one or two linked pairs, chosen by the map seed. Every pair
 * mirrors itself through the map centre (like the bases and ore), so neither side gets a better gate.
 */
export const PORTAL_LAYOUTS: [Tile, Tile][] = [
  [[4, 4], [59, 59]], // the two empty corners
  [[26, 6], [37, 57]], // top edge to bottom edge
  [[5, 20], [58, 43]], // left edge to right edge
  [[22, 44], [41, 19]], // a shortcut between the two front lines
];
/** Share of maps with portals, and of those, the share with two pairs. */
export const PORTAL_CHANCE = 0.5;
export const PORTAL_DOUBLE_CHANCE = 0.3;
/** Colour of each linked pair, so players can tell which gates go together. */
export const PORTAL_COLORS = ['#a070ff', '#3fd8c4'];
/** Ground kept clear around each gate (tiles). */
export const PORTAL_CLEAR = 2.5;

export const START_CREDITS = 3500;
export const START_WOOD = 400;
export const START_OIL = 0;
export const START_UNITS = ['swordsman', 'swordsman', 'crossbowman', 'knight'] as const;

// ---- terrain shape ----
/** Ground units in shallow water move at this share of their speed (paths count the cost). */
export const SHALLOW_SPEED = 0.5;
/** Height of the water's surface, in tiles. Shallow beds sit a little below it, deep beds well below. */
export const WATER_LEVEL = -0.12;
/** Height of rolling hills (peak to trough) and of the plateaus that rise above them on cliffs, in tiles. */
export const HILL_HEIGHT = 1.8;
export const PLATEAU_HEIGHT = 1.5;
/** Share of maps crossed by a river (with shallow fords), and with a sea in one of the empty corners. */
export const RIVER_CHANCE = 0.7;
export const COAST_CHANCE = 0.45;
