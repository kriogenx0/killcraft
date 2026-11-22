// World geometry and simulation timing shared by the engine and the renderer.

/** Tile size in pixels. */
export const TS = 32;
export const MW = 64;
export const MH = 64;
/** How close (px) a worker must be to a target's edge to use it. */
export const NEAR = 26;
/** Fixed simulation step in seconds. */
export const STEP = 1 / 60;

// terrain codes
export const GRASS = 0;
export const WATER = 1;
export const TREE = 2;
