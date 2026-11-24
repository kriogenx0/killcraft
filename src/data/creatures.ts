// Creatures of Greek myth. A few lairs lie between the bases, each guarded by a wild creature that
// fights anyone who comes close but never strays far. It can't be killed while wild: beat it down
// to a quarter of its health and it kneels, and the first side to stand next to it with no enemy
// there for a few seconds captures it. A side that has captured a kind can train more of it (ore
// plus Aether, see data/unit.ts). Meant to be a small edge that rewards scouting, like Aether.
import type { Tile } from '../game/state.ts';
import type { UnitType } from './unit.ts';

/** Every creature a lair can hold. */
export const BEASTS: UnitType[] = [
  'centaur', 'minotaur', 'cyclops', 'hydra', 'cerberus', 'harpy', 'pegasus', 'griffin',
  'medusa', 'nemean', 'sphinx', 'satyr', 'chimera', 'phoenix', 'dragon', 'unicorn',
];

/**
 * Lair sites, in pairs that mirror each other through the map centre (like the bases), so neither
 * side gets a closer lair. They keep clear of the bases, ore, oil, Aether and portal sites. Each
 * map uses some of the pairs, picked by its seed.
 */
export const LAIR_PAIRS: [Tile, Tile][] = [
  [[51, 20], [44, 75]],
  [[15, 39], [80, 56]],
  [[45, 30], [50, 65]],
  [[18, 15], [77, 80]],
  [[30, 79], [65, 16]],
];
/** Four-player free-for-all: one lair on the way out of each corner, toward the middle. */
export const LAIR_FFA_SITES: Tile[] = [
  [36, 59],
  [59, 36],
  [36, 36],
  [59, 59],
];
/** Pairs of lairs a two-player map gets (so twice as many creatures). */
export const LAIR_PAIRS_PER_MAP = 3;

/** A wild creature kneels once its health falls to this fraction. */
export const SUBDUE_AT = 0.25;
/** Seconds a side must hold a kneeling creature, uncontested, to capture it. */
export const CAPTURE_TIME = 5;
/** A unit holds a kneeling creature from within this many tiles. */
export const CAPTURE_REACH = 2.5;
/** A kneeling creature nobody captures gets back up after this many seconds. */
export const SUBDUE_RECOVER = 30;
/** Health (fraction) a creature has when it gets back up, or when it joins its captor. */
export const RISE_HP = 0.6;
/** A wild creature attacks anyone within this many tiles of it… */
export const GUARD_RADIUS = 3.5;
/** …but gives up the chase this many tiles from its lair. */
export const LEASH = 6;
/** Seconds after a creature from a lair dies (wild or captured) before it comes back, wild, at its lair. */
export const RESPAWN_TIME = 60;
/** Fraction of max health a wild creature regains each second while nobody is fighting it. */
export const WILD_REGEN = 0.02;

/** After a foe turns back from stone, the Medusa's gaze can't petrify it again for this many seconds. */
export const PETRIFY_IMMUNE = 3;
/** The Satyr's pipes reach friendly units within this many tiles. Several Satyrs don't heal faster. */
export const SONG_RANGE = 3.5;
/** Health (fraction) a Phoenix rises from its ashes with. */
export const REBIRTH_HP = 0.5;
