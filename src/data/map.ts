// Fixed layout of the skirmish map; terrain between these points is generated from a seed.
import type { Tile } from '../game/state.ts';

/** Top-left tile of each team's Town Hall (index = team). */
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

/**
 * Four-player free-for-all layout: one base in each corner, mirrored left-right and top-bottom so no
 * corner is favoured. Each base keeps its own ore field, oil well and woods; four more ore fields sit
 * midway along the edges and one in the middle, with four oil wells around it. No portals: the
 * two-player gates are placed for two bases, not four.
 */
const flipX = ([x, y]: Tile, s = 1): Tile => [64 - s - x, y];
const flipY = ([x, y]: Tile, s = 1): Tile => [x, 64 - s - y];
/** The same point in each corner, in team order: bottom-left, top-right, top-left, bottom-right. */
const corners = (t: Tile, s = 1): Tile[] => [t, flipX(flipY(t, s), s), flipY(t, s), flipX(t, s)];
export const FFA_YARDS: Tile[] = corners(START_YARDS[0], 3);
export const FFA_ORE_SOURCES: Tile[] = [...corners(ORE_SOURCES[0]), [6, 31], [57, 32], [31, 6], [32, 57], [32, 31]];
export const FFA_OIL_WELLS: Tile[] = [...corners(OIL_WELLS[0]), ...corners(OIL_WELLS[2]).slice(0, 2), flipX(OIL_WELLS[2]), flipY(OIL_WELLS[2])];
export const FFA_FORESTS: [number, number, number][] = corners([FORESTS[0][0], FORESTS[0][1]]).map(([x, y]) => [x, y, FORESTS[0][2]]);

export interface MapLayout { yards: Tile[]; ore: Tile[]; oil: Tile[]; forests: [number, number, number][]; portals: [Tile, Tile][] }
/** The map layout for a number of players (2, or 4 for a free-for-all). */
export const layoutFor = (teams: number): MapLayout =>
  teams > 2
    ? { yards: FFA_YARDS, ore: FFA_ORE_SOURCES, oil: FFA_OIL_WELLS, forests: FFA_FORESTS, portals: [] }
    : { yards: START_YARDS, ore: ORE_SOURCES, oil: OIL_WELLS, forests: FORESTS, portals: PORTAL_LAYOUTS };

export const START_CREDITS = 3500;
export const START_WOOD = 400;
export const START_OIL = 0;
/** Every side starts with its Town Hall and two Workers to build with (Alex, 2026-11-23). */
export const START_UNITS = ['worker', 'worker'] as const;

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
