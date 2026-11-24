// World geometry and simulation timing shared by the engine and the renderer.

/** Tile size in pixels. */
export const TS = 32;
export const MW = 96;
export const MH = 96;
/** How close (px) a worker must be to a target's edge to use it. */
export const NEAR = 26;
/** Fixed simulation step in seconds. */
export const STEP = 1 / 60;

// terrain codes
export const GRASS = 0;
export const WATER = 1;
export const TREE = 2;
/** shallow water: ground units wade through it slowly */
export const SHALLOW = 3;
/** rock and cliffs: impassable, like deep water */
export const ROCK = 4;

/** Can ground units walk on this terrain (ignoring what's built on it)? */
export const walkable = (t: number): boolean => t === GRASS || t === SHALLOW;
