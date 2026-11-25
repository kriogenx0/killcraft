// The Mystery Egg (data/unit.ts `mystery`): a side warms one slowly on Aether at the Barracks, and when
// it's done something special walks out instead of an egg: a random pick from the hidden units,
// creatures of myth and heavy machines its age allows, or, now and then, a Titan Chicken.
import { UNIT, type UnitType } from '../data/unit.ts';
import { G } from './state.ts';
import { countOf } from './entity.ts';

/** What an egg can hatch into. Creatures come from it even if the side never caught one. */
export const MYSTERY_POOL: readonly UnitType[] = [
  'wraith', 'phantom', 'starfall',
  'giant', 'juggernaut', 'titan',
  'centaur', 'minotaur', 'cyclops', 'hydra', 'cerberus', 'medusa', 'nemean', 'sphinx', 'chimera', 'unicorn',
  'pegasus', 'griffin', 'phoenix', 'dragon',
];
/** Chance an egg hatches a Titan Chicken instead. */
export const CHICKEN_CHANCE = 0.15;

/** A unit with a `limit` (the Titan) only hatches while the side has fewer alive or in training. */
const underLimit = (team: number, t: UnitType): boolean => {
  const n = UNIT[t].limit;
  return n == null || countOf(team, t) + (G.prod[team]?.[UNIT[t].producer] ?? []).filter((x) => x.type === t).length < n;
};

/** The units an egg can hatch for a side now: of its age or earlier, and not one it already has its fill of (the Titan). */
export function hatchable(team: number, era: number): UnitType[] {
  return MYSTERY_POOL.filter((t) => UNIT[t].era <= era && era < (UNIT[t].until ?? Infinity) && underLimit(team, t));
}

/** Crack the egg: what comes out. `roll` is 0..1 (random by default). */
export function hatch(team: number, era: number, roll = Math.random()): UnitType {
  if (roll < CHICKEN_CHANCE) return 'chicken';
  const pool = hatchable(team, era);
  if (!pool.length) return 'chicken';
  const k = (roll - CHICKEN_CHANCE) / (1 - CHICKEN_CHANCE);
  return pool[Math.min(pool.length - 1, Math.floor(k * pool.length))];
}

