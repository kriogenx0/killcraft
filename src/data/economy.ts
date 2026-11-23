// Wood, oil and salvage tuning. Ore comes from harvesters (see data/ore.ts).
// Prices follow what a thing is made of and runs on: steel and stone cost ore, timber costs wood,
// and anything with an engine or rocket costs oil. Nothing that runs on oil exists before the World War age.
// Ore and wood grow back; oil does not.

/** Trees within this many tiles of a Lumber Mill count as its woods (for placing it, and where its choppers look first). */
export const MILL_RADIUS = 5;
/** Wood a full-grown tree holds, and how fast a cut tree grows back (per second). */
export const TREE_WOOD = 150;
export const TREE_REGROW = 0.1;

/**
 * Workers chop wood at trees themselves and carry it to a Lumber Mill (or a Refinery or the
 * Town Hall); nothing is banked until it's dropped off. A Worker chops this much wood per
 * second, carries at most WOOD_LOAD, and skips trees with less than CHOP_WORTH left.
 */
export const CHOP_RATE = 5;
export const WOOD_LOAD = 50;
export const CHOP_WORTH = 10;
/** Choppers the computer keeps at each Lumber Mill. */
export const CHOPPERS_PER_MILL = 2;

/**
 * An Oil Derrick fills its own store, up to this much, and stops when it's full; Workers carry it
 * to a Town Hall or a Refinery.
 */
export const DERRICK_STORE = 300;

/** Oil per second an Oil Derrick pumps while its well has oil. */
export const OIL_PER_DERRICK = 3;
/** A derrick pumps from oil tiles under its footprint and this many tiles around it. */
export const DERRICK_REACH = 1;
/** Oil in a pool tile at the middle of a well; pools are this many tiles across from the middle. */
export const OIL_TILE_MAX = 700;
export const OIL_WELL_RADIUS = 2;

/** Share of a unit's or building's ore price left behind as ore when it's destroyed. */
export const SALVAGE_SHARE = 0.3;

/**
 * Catch-up for a runaway leader. The side whose army and buildings are worth this many times the
 * runner-up's is "in the lead", and whoever destroys its units or buildings is paid this share of
 * their ore price.
 */
export const BOUNTY_LEAD = 1.3;
export const BOUNTY_SHARE = 0.5;
