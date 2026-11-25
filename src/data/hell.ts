// The Gate of Hell: a neutral portal in the middle of the map that lets demons out. They belong to
// nobody. While no side stands out they lurk round the gate and only fight back if attacked; once a
// side has trained enough fighting units to count, the one with the strongest army becomes the
// leader, and every few minutes the demons waiting at the gate go out and raid it. Now and then a
// giant Archfiend climbs out too. A catch-up rule, like the bounty on the leader (data/economy.ts),
// meant to slow a runaway side down a little, never to decide the game on its own.
import type { Tile } from '../game/state.ts';
import type { UnitType } from './unit.ts';

/** The gate is this many tiles square. */
export const GATE_SIZE = 3;
/**
 * Top-left tile of the gate. It stands at the middle of the map, where both layouts (one against
 * one and four players) have their shared middle ore field: it takes the place of that field's
 * crystal rock, and the ore keeps growing back round it.
 */
export const GATE_TILE: Tile = [47, 46];
/** Ground cleared and levelled round the gate (tiles from its middle). */
export const GATE_CLEAR = 2.5;

/** Game seconds before the first demon climbs out. */
export const GATE_OPENS = 120;
/** Seconds between demons while there's room for more. */
export const SPAWN_EVERY = 45;
/** Most demons (not counting the Archfiend) out at once, at the gate and raiding together. */
export const DEMON_CAP = 6;
/** Share of new demons that are Hell Fiends; the rest are Imps. */
export const FIEND_SHARE = 0.35;

/** A side can't be the leader until it has trained this many fighting units (not Workers, Harvesters or Medics) in the match (Alex). */
export const LEADER_TRAINED = 20;
/** Seconds between raids on the leader, at random within this range (Alex: occasionally, not constantly). */
export const RAID_EVERY: [number, number] = [150, 240];
/** Seconds after a side first becomes the leader before the first raid sets out. */
export const FIRST_RAID = 60;
/** Fewest demons worth sending: with fewer at the gate the raid waits for more. */
export const RAID_MIN = 3;

/** The giant demon: seconds of there being a leader before the first one appears, then between one and the next. Only one at a time. */
export const ARCHFIEND_FIRST = 240;
export const ARCHFIEND_EVERY = 480;
export const ARCHFIEND: UnitType = 'archfiend';

/** Demons waiting at the gate stay within this many tiles of its middle… */
export const LURK_RADIUS = 4;
/** …and chase someone who hurt them at most this far from it before going back. */
export const GATE_LEASH = 9;
/** Share of health a demon waiting at the gate heals each second. */
export const LURK_REGEN = 0.01;
