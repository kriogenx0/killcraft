// Forest fires (Alex, 2026-11-27: "Woods can occasionally catch fire from accidental fire attacks next
// to the woods or from meteor showers"). A fire shot or blast that lands by the trees now and then
// sets one alight; a burning tree slowly burns down to a stump and may catch the trees touching it,
// but rarely enough that a fire dies out after a few trees rather than taking the whole wood. Rain
// puts it out. A burnt tree grows back at the usual (slow) rate, from a stump.
// Times are seconds, distances tiles.

/** Chance a fire attack (a dragon's breath, a fireball, a burning blade...) landing by the woods sets a tree alight. */
export const FIRE_CATCH = 0.05;
/** Chance a falling meteor-shower stone that lands by the woods sets a tree alight. */
export const STONE_CATCH = 0.15;
/** How far beyond a blast's edge (tiles) a tree can catch from it. */
export const CATCH_REACH = 0.6;
/** Seconds a tree burns, its wood going up in smoke as it does, before only a charred stump is left. */
export const TREE_BURN = 16;
/**
 * Chance per second that a burning tree catches each tree beside it (half that across a corner).
 * In the thick of a wood a fire takes about 1 to 10 trees (3 or 4 on average) before it gutters out,
 * rather than sweeping the map.
 */
export const TREE_SPREAD = 0.013;
/** A tree with less wood left than this (a stump) won't burn. */
export const TREE_FUEL = 30;
/** At most this many trees burn at once on the whole map: past it, fires don't spread. */
export const TREE_FIRE_CAP = 24;
/** Chance per second a soldier or creature standing against a burning tree catches fire. */
export const TREE_SINGE = 0.25;
/** How close (tiles, from the tree's middle) a unit must stand to be singed. */
export const SINGE_REACH = 0.95;
/** Any rain slows the spreading this much; rain heavy enough to douse burning units (RAIN_DOUSE) puts the trees out. */
export const RAIN_DAMP = 0.4;
