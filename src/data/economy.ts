// Wood, oil and salvage tuning. Ore comes from harvesters (see data/ore.ts).
// Prices follow what a thing is made of and runs on: steel and stone cost ore, timber costs wood,
// and anything with an engine or rocket costs oil. Nothing that runs on oil exists before the World War age.
// Ore and wood grow back; oil does not.

/** A Lumber Mill cuts wood from trees within this many tiles of its footprint. */
export const MILL_RADIUS = 5;
/** Wood per second a mill cuts from each tree it reaches, while the tree has wood left. */
export const WOOD_PER_TREE = 0.3;
/** Most trees a single mill can work. */
export const MILL_MAX_TREES = 24;
/** Wood a full-grown tree holds, and how fast a cut tree grows back (per second). */
export const TREE_WOOD = 150;
export const TREE_REGROW = 0.1;

/**
 * Nothing is banked until a unit carries it home. A Lumber Mill and an Oil Derrick fill their own
 * store, up to this much, and stop when it's full; Workers carry it to a Construction Yard or a Refinery.
 */
export const MILL_STORE = 300;
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
