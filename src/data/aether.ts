// Aether: a rare, supernatural resource. Violet shards from a fallen star lie in a few spots in the
// middle ground, away from both bases. They never regrow. A side draws Aether from a deposit by
// holding it: any of its units standing next to the shards, with no enemy unit there too.
// Aether reveals hidden units (one per age) and the Aether Ward research. It is meant to be a small
// edge that rewards scouting and map control, never a game-winner.
import type { Tile } from '../game/state.ts';

/** Where the deposits go: two on the flanks, equally far from both bases, and sometimes one near the middle. */
export const AETHER_SITES: Tile[] = [
  [19, 15],
  [44, 47],
];
/** Four-player free-for-all: one deposit between each pair of neighbouring bases. */
export const AETHER_FFA_SITES: Tile[] = [
  [31, 19],
  [32, 44],
  [19, 32],
  [44, 31],
];
/** The middle deposit only appears on some maps. */
export const AETHER_MIDDLE: Tile = [27, 27];
/** Chance a map gets the middle deposit. */
export const AETHER_MIDDLE_CHANCE = 0.5;

/** Aether in each deposit. It never regrows. */
export const AETHER_PER_DEPOSIT = 200;
/** Aether per second a side draws from a deposit it holds. Extra units don't draw any faster. */
export const AETHER_RATE = 2;
/** A unit holds a deposit from within this many tiles of it. */
export const AETHER_REACH = 2.5;

/** Hidden units slow their target to this fraction of its speed for a moment (see WeaponDef.slow). */
export const SLOW_FACTOR = 0.5;
/** A cloaked unit shows for this many seconds after it fires. */
export const CLOAK_REVEAL = 2;
/** Enemy units and buildings within this many tiles see through a cloak. */
export const CLOAK_DETECT = 2;
/** Damage a building takes once its side has researched the Aether Ward. */
export const WARD_FACTOR = 0.9;

/** The Star Shrine heals your units within this many tiles of it... */
export const SHRINE_RANGE = 4;
/** ...by this share of their health per second (full in about 100 s). */
export const SHRINE_HEAL = 0.01;
/** A Ward Stone reveals cloaked enemies within this many tiles. */
export const WARD_STONE_SIGHT = 6;
/** A side links at most this many Waygates (one pair). */
export const MAX_WAYGATES = 2;
