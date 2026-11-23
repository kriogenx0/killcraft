// Production hotkeys, worked out from the unit, structure and research definitions so that anything
// added to data/ gets a key with no extra work. Keys are scoped to the building that makes the item:
// select the Construction Yard (H) and press a structure's or research's key, select a Barracks and
// press an infantry key, and so on. A def can ask for a letter with `key`.
import { UNIT, UNIT_TYPES } from '../../data/unit.ts';
import { BUILDING, BLD_TYPES, isWall, type BldType } from '../../data/building.ts';
import { TECH, TECH_TYPES } from '../../data/era.ts';
import type { Buildable } from '../../game/production.ts';
import type { ProductionLine } from '../../game/state.ts';
import { BUILDING_KEYS, assignKeys, type Keyed } from './keyboard.ts';

/** The production lines a building runs: the yard builds structures and researches. */
export function linesOf(b: BldType): ProductionLine[] {
  const p = BUILDING[b].produces;
  return !p ? [] : p === 'structure' ? ['structure', 'tech'] : [p];
}

/** Things bought with Aether are rare: they get keys after everything else, and may go mouse-only. */
export const isRare = (t: string): boolean => ((t in UNIT ? UNIT[t as keyof typeof UNIT] : t in TECH ? TECH[t as keyof typeof TECH] : BUILDING[t as BldType])?.aether ?? 0) > 0;

/** Rare items and wall segments get keys last: the yard has more structures than free letters. */
export const keyedLast = (t: string): boolean => isRare(t) || isWall(t);

function itemsOn(line: ProductionLine): Keyed[] {
  if (line === 'structure') return BLD_TYPES.filter((t) => BUILDING[t].buildable).map((t) => ({ id: t, name: BUILDING[t].name, key: BUILDING[t].key }));
  if (line === 'tech' || line === 'hospital' || line === 'armory') return TECH_TYPES.filter((t) => (TECH[t].at ?? 'tech') === line).map((t) => ({ id: t, name: TECH[t].name, key: TECH[t].key }));
  return UNIT_TYPES.filter((t) => UNIT[t].producer === line).map((t) => ({ id: t, name: UNIT[t].name, key: UNIT[t].key }));
}

/** Every producing building's item → key map. */
export const PRODUCTION_KEYS: ReadonlyMap<BldType, ReadonlyMap<Buildable, string>> = new Map(
  (Object.keys(BUILDING) as BldType[]).filter((b) => linesOf(b).length).map((b) => [
    b,
    assignKeys([...linesOf(b).flatMap(itemsOn)].sort((x, y) => Number(keyedLast(x.id)) - Number(keyedLast(y.id))), Object.values(BUILDING_KEYS)) as Map<Buildable, string>,
  ]),
);

const PRODUCER_OF = new Map<Buildable, BldType>();
for (const [b, m] of PRODUCTION_KEYS) for (const t of m.keys()) PRODUCER_OF.set(t, b);

/** The building that makes an item (and must be selected for its hotkey). */
export const producerOfType = (t: Buildable): BldType | undefined => PRODUCER_OF.get(t);

/** An item's hotkey, or '' if it has none. */
export const hotkeyOf = (t: Buildable): string => {
  const b = PRODUCER_OF.get(t);
  return (b && PRODUCTION_KEYS.get(b)?.get(t)) ?? '';
};

/** The item a key builds while a building of type `b` is selected. */
export function itemForKey(b: BldType, key: string): Buildable | undefined {
  for (const [t, k] of PRODUCTION_KEYS.get(b) ?? []) if (k.toLowerCase() === key) return t;
  return undefined;
}
