// Wood and oil tuning. Ore comes from harvesters (see data/ore.ts).
// Prices follow what a thing is made of and runs on: steel and stone cost ore, timber costs wood,
// and anything with an engine or rocket costs oil. Nothing that runs on oil exists before the Industrial age.

/** A Lumber Mill cuts wood from trees within this many tiles of its footprint. */
export const MILL_RADIUS = 5;
/** Wood per second for each tree near a team's mills (a tree counts once even if two mills reach it). */
export const WOOD_PER_TREE = 0.3;
/** Most trees a single mill can work. */
export const MILL_MAX_TREES = 24;
/** Oil per second from each Oil Derrick. */
export const OIL_PER_DERRICK = 3;
