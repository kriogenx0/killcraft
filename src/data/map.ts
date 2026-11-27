// Fixed layout of the skirmish map; terrain between these points is generated from a seed.
import type { Tile } from '../game/state.ts';
import { MW, MH } from '../game/const.ts';

// The map is 96×96 tiles (Alex, 2026-11-24: "50% bigger map", 1.5× each side of the old 64×64).
// Each base keeps its old distance from its corner and its own ore, oil and woods sit where they
// did beside it; everything in between spread out 1.5× from the centre, with more ore fields, oil
// wells and lairs to fill the extra ground. Two-player layouts mirror through the centre:
// a tile (x, y) pairs with (95 - x, 95 - y), a 3×3 Town Hall's corner with (93 - x, 93 - y).

/** Top-left tile of each team's Town Hall (index = team). */
export const START_YARDS: Tile[] = [
  [6, 82],
  [87, 11],
];

/** Ore crystal rocks. Each grows an ore field around it. The first two sit by the bases. */
export const ORE_SOURCES: Tile[] = [
  [14, 86],
  [81, 9],
  [24, 42],
  [71, 53],
  [48, 47],
  [6, 51],
  [89, 44],
  [37, 89],
  [58, 6],
];

/** Oil wells: pools of oil that never refill. One near each base, two in the contested middle. */
export const OIL_WELLS: Tile[] = [
  [15, 77],
  [80, 18],
  [36, 56],
  [59, 39],
  [22, 26],
  [73, 69],
];

/** Guaranteed woods near each base, in reach of a Lumber Mill: [centerX, centerY, radius]. */
export const FORESTS: [number, number, number][] = [
  [4, 73, 4],
  [91, 22, 4],
];

/**
 * Portal layouts. Some maps get one or two linked pairs, chosen by the map seed. Every pair
 * mirrors itself through the map centre (like the bases and ore), so neither side gets a better gate.
 */
export const PORTAL_LAYOUTS: [Tile, Tile][] = [
  [[4, 4], [91, 91]], // the two empty corners
  [[39, 6], [56, 89]], // top edge to bottom edge
  [[5, 30], [90, 65]], // left edge to right edge
  [[33, 66], [62, 29]], // a shortcut between the two front lines
];
/** Share of maps with portals, and of those, the share with two pairs. */
export const PORTAL_CHANCE = 0.5;
export const PORTAL_DOUBLE_CHANCE = 0.3;
/** Colour of each linked pair, so players can tell which gates go together. */
export const PORTAL_COLORS = ['#a070ff', '#3fd8c4'];
/** How close (tiles) a unit heading through a gate must get to its centre to be carried across. The gate art matches it. */
export const PORTAL_RADIUS = 1.1;
/** Ground kept clear around each gate (tiles). */
export const PORTAL_CLEAR = 3;

/**
 * Four-player free-for-all layout: one base in each corner, mirrored left-right and top-bottom so no
 * corner is favoured. Each base keeps its own ore field, oil well and woods; four more ore fields sit
 * midway along the edges and one in the middle, with four oil wells around it, and one more ore field on the way out of each corner. No portals: the
 * two-player gates are placed for two bases, not four.
 */
const flipX = ([x, y]: Tile, s = 1): Tile => [MW - s - x, y];
const flipY = ([x, y]: Tile, s = 1): Tile => [x, MH - s - y];
/** The same point in each corner, in team order: bottom-left, top-right, top-left, bottom-right. */
const corners = (t: Tile, s = 1): Tile[] => [t, flipX(flipY(t, s), s), flipY(t, s), flipX(t, s)];
export const FFA_YARDS: Tile[] = corners(START_YARDS[0], 3);
export const FFA_ORE_SOURCES: Tile[] = [...corners(ORE_SOURCES[0]), [6, 47], [89, 48], [47, 6], [48, 89], [48, 47], ...corners([24, 66])];
export const FFA_OIL_WELLS: Tile[] = [...corners(OIL_WELLS[0]), ...corners(OIL_WELLS[2]).slice(0, 2), flipX(OIL_WELLS[2]), flipY(OIL_WELLS[2])];
export const FFA_FORESTS: [number, number, number][] = corners([FORESTS[0][0], FORESTS[0][1]]).map(([x, y]) => [x, y, FORESTS[0][2]]);

/**
 * A small map (campaign mission 1, Alex: "Level 1 map smaller"): the same 96x96 grid, but only the
 * middle SMALL_LO..SMALL_HI tiles are land; the rest is sea. Two bases, mirrored through the centre
 * like the full map (a tile (x, y) pairs with (95 - x, 95 - y), a Town Hall's corner with (93 - x, 93 - y)).
 */
export const SMALL_LO = 22, SMALL_HI = 74;
const SMALL_LAYOUT = {
  yards: [[27, 61], [66, 32]] as Tile[],
  // few resources (Alex: "much fewer resources"): one ore field by each base and one in the middle,
  // one small wood by the player's base, and sparse trees elsewhere (map.ts)
  ore: [[35, 65], [60, 30], [48, 47]] as Tile[],
  oil: [[36, 56], [59, 39]] as Tile[],
  forests: [[26, 52, 3]] as [number, number, number][],
};

export interface MapLayout { yards: Tile[]; ore: Tile[]; oil: Tile[]; forests: [number, number, number][]; portals: [Tile, Tile][] }
/** The map layout for a number of players (2, or 4 for a free-for-all). */
export const layoutFor = (teams: number, small = false): MapLayout =>
  small && teams <= 2 ? { ...SMALL_LAYOUT, portals: [] }
  : teams > 2
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
