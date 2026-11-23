// Ore economy tuning.

/** Most ore (in credits) a single tile can hold. */
export const ORE_TILE_MAX = 500;
/** Radius in tiles of the field seeded around each crystal rock at the start. */
export const ORE_FIELD_RADIUS = 5;
/** Every second each crystal rock adds this much ore to a tile near it (Alex: slow regrowth). */
export const ORE_REGROW = 8;
export const ORE_REGROW_TILES = 1;
export const ORE_REGROW_RADIUS = 5;
/**
 * Ore a tile needs before a gatherer bothers walking to it while richer ground exists anywhere:
 * a mined-out field is speckled with crumbs of regrowth that aren't worth a trip each.
 */
export const ORE_WORTH = 60;

/** Ore a harvester can carry (Workers carry less: see each unit's `haul`). */
export const HARVESTER_CAPACITY = 600;
/** Ore per second a harvester scoops while on ore (see each unit's `scoop`). */
export const HARVEST_RATE = 160;
/** Credits per second unloaded at a refinery. */
export const UNLOAD_RATE = 300;
