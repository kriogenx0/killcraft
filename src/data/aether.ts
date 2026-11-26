// Aether: a rare, supernatural resource. Violet shards from a fallen star lie in a few spots in the
// middle ground, away from both bases. They slowly grow back once drawn down. A side draws Aether from a deposit by
// holding it: any of its units standing next to the shards, with no enemy unit there too.
// Aether reveals hidden units (one per age) and the Aether Ward research. It is meant to be a small
// edge that rewards scouting and map control, never a game-winner.
import type { Tile } from '../game/state.ts';

/** Where the deposits go: two on the flanks, equally far from both bases, and sometimes one near the middle. */
export const AETHER_SITES: Tile[] = [
  [29, 23],
  [66, 72],
];
/** Four-player free-for-all: one deposit between each pair of neighbouring bases. */
export const AETHER_FFA_SITES: Tile[] = [
  [47, 29],
  [48, 66],
  [29, 48],
  [66, 47],
];
/** The middle deposit only appears on some maps. */
export const AETHER_MIDDLE: Tile = [41, 41];
/** Chance a map gets the middle deposit. */
export const AETHER_MIDDLE_CHANCE = 0.5;

/** Aether a deposit holds when full. */
export const AETHER_PER_DEPOSIT = 200;
/** Aether per second a deposit grows back, up to full (Alex, 2026-11-25: "Aether should slowly come back").
 * A drained deposit is full again in about 17 minutes; holding one draws 2/s, ten times faster. */
export const AETHER_REGROW = 0.2;
/** A deposit with less than this left is dry: nothing to draw until it grows back. */
export const AETHER_DRY = 1;
/** Workers don't set out for a deposit holding less than this (wait for it to grow back). */
export const AETHER_WORTH = 20;
/** Aether per second a side draws from a deposit it holds. Extra units don't draw any faster. */
export const AETHER_RATE = 2;
/** Aether one unit can carry. It counts once the unit brings it within AETHER_BANK_REACH tiles of its own Town Hall or Refinery, and is lost if the unit dies. */
export const AETHER_CARRY = 40;
export const AETHER_BANK_REACH = 3;
/** Return Aether (on by default): a unit carrying at least this much walks it home, whatever it was told. */
export const AETHER_RETURN_MIN = 1;
/** A unit with Return Aether on that can't reach a drop-off gives up for this long (seconds) and takes orders again. */
export const AETHER_RETURN_RETRY = 10;
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
/** ...by this share of their health per second (full in about 200 s). */
export const SHRINE_HEAL = 0.005;
/** A Ward Stone reveals cloaked enemies within this many tiles. */
export const WARD_STONE_SIGHT = 6;
/** A side links at most this many Waygates (one pair). */
export const MAX_WAYGATES = 2;
/** A unit picks up dropped Aether within this many tiles of it. */
export const SHARD_PICKUP = 0.8;
/** An idle Worker goes for dropped Aether within this many tiles. */
export const SHARD_SEEK = 8;
/** A Worker gathering on its own (Auto, or Aether) goes this far (tiles) out of its way for dropped Aether. */
export const SHARD_PULL = 14;
/** Dropped Aether this close (tiles) to an armed enemy is left until the fighting's over. */
export const SHARD_DANGER = 7;
