// Production hotkeys, worked out from the unit, structure and research definitions so that anything
// added to data/ gets a key with no extra work. Keys are scoped to the building that makes the item:
// select the Town Hall (H) and press a structure's or research's key, select a Barracks and
// press an infantry key, and so on. A def can ask for a letter with `key`.
//
// A building with more items than free letters (the yard) sorts some into groups: walls, defenses,
// expansions and Aether structures each sit behind one key, and their items are keyed again inside the group.
// So with the yard selected, L then S lays a Stone Wall. The Barracks does the same for creatures of
// myth and spellcasters. A def can name its own group with `group`. The age researches share one key:
// only the next age is ever on offer.
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

function defOf(t: string): { aether?: number; group?: string; key?: string } | undefined {
  return t in UNIT ? UNIT[t as keyof typeof UNIT] : t in TECH ? TECH[t as keyof typeof TECH] : BUILDING[t as BldType];
}

/** Things bought with Aether are rare. */
export const isRare = (t: string): boolean => (defOf(t)?.aether ?? 0) > 0;

/** The sub-menu a structure sits in, or undefined for the top level. */
export function groupOfType(t: string): string | undefined {
  const d = defOf(t);
  if (d?.group) return d.group;
  if (t in UNIT) { const u = UNIT[t as keyof typeof UNIT]; return u.beast ? 'Creatures' : u.magic ? 'Magic' : undefined; }
  if (!(t in BUILDING)) return undefined;
  if (isWall(t)) return 'Walls';
  if (isRare(t)) return 'Aether';
  if (BUILDING[t as BldType].weapon) return 'Defenses';
  return undefined;
}

function itemsOn(line: ProductionLine): Keyed[] {
  if (line === 'structure') return BLD_TYPES.filter((t) => BUILDING[t].buildable).map((t) => ({ id: t, name: BUILDING[t].name, key: BUILDING[t].key }));
  if (line === 'tech' || line === 'hospital' || line === 'armory') return TECH_TYPES.filter((t) => (TECH[t].at ?? 'tech') === line && (TECH[t].age == null || t === AGES[0])).map((t) => ({ id: t, name: TECH[t].name, key: TECH[t].key }));
  return UNIT_TYPES.filter((t) => UNIT[t].producer === line && !UNIT[t].hatched && !UNIT[t].demon).map((t) => ({ id: t, name: UNIT[t].name, key: UNIT[t].key }));
}

/** The age researches, in order: they take turns on one key (the first one's). */
const AGES = TECH_TYPES.filter((t) => TECH[t].age != null);

export interface KeyMap {
  /** item → its key at the top level, or inside its group */
  items: Map<Buildable, string>;
  /** group name → the key that opens it */
  groups: Map<string, string>;
}

const BLD_KEYS = Object.values(BUILDING_KEYS);

/**
 * Preferred keys for the default groups: G for guns, L for walls (W scrolls), T for the Aether's star
 * stones, X for expansions (Town Hall, Resource Drop; E scrolls); at the Barracks, Y for mythic creatures and Z for spellcasters (zap).
 */
const GROUP_KEYS: Record<string, string> = { Defenses: 'G', Walls: 'L', Aether: 'T', Expand: 'X', Creatures: 'Y', Magic: 'Z' };

/** Keys for one building's items: groups first, then the ungrouped items around them, then each group's items. */
export function keyMap(items: readonly Keyed[]): KeyMap {
  const names = [...new Set(items.map((i) => groupOfType(i.id)).filter((g): g is string => !!g))];
  const groups = assignKeys(names.map((n) => ({ id: n, name: n, key: GROUP_KEYS[n] })), BLD_KEYS);
  const out = assignKeys(items.filter((i) => !groupOfType(i.id)), [...BLD_KEYS, ...groups.values()]) as Map<Buildable, string>;
  for (const g of names) for (const [t, k] of assignKeys(items.filter((i) => groupOfType(i.id) === g), BLD_KEYS)) out.set(t as Buildable, k);
  const age = out.get(AGES[0]);
  if (age) for (const t of AGES.slice(1)) out.set(t, age);
  return { items: out, groups };
}

/** Every producing building's keys. */
export const PRODUCTION_KEYS: ReadonlyMap<BldType, KeyMap> = new Map(
  (Object.keys(BUILDING) as BldType[]).filter((b) => linesOf(b).length).map((b) => [b, keyMap(linesOf(b).flatMap(itemsOn))]),
);

const PRODUCER_OF = new Map<Buildable, BldType>();
for (const [b, m] of PRODUCTION_KEYS) for (const t of m.items.keys()) PRODUCER_OF.set(t, b);

/** The building that makes an item (and must be selected for its hotkey). */
export const producerOfType = (t: Buildable): BldType | undefined => PRODUCER_OF.get(t);

/** The keys to press for an item once its building is selected: "N", or "L S" inside a group. '' if none. */
export function hotkeyOf(t: Buildable): string {
  const b = PRODUCER_OF.get(t), m = b && PRODUCTION_KEYS.get(b), k = m?.items.get(t);
  if (!m || !k) return '';
  const g = groupOfType(t), gk = g && m.groups.get(g);
  return gk ? `${gk} ${k}` : k;
}

/** The groups a building's items are sorted into, as [name, key]. */
export const groupsOf = (b: BldType): [string, string][] => [...(PRODUCTION_KEYS.get(b)?.groups ?? [])];

/** The group a key opens while a building of type `b` is selected (and no group is open). */
export function groupForKey(b: BldType, key: string): string | undefined {
  for (const [g, k] of PRODUCTION_KEYS.get(b)?.groups ?? []) if (k.toLowerCase() === key) return g;
  return undefined;
}

/** The items a key builds while a building of type `b` is selected, at the top level or inside `group` (several only for the ages). */
export function itemsForKey(b: BldType, key: string, group?: string | null): Buildable[] {
  return [...(PRODUCTION_KEYS.get(b)?.items ?? [])].filter(([t, k]) => k.toLowerCase() === key && groupOfType(t) === (group ?? undefined)).map(([t]) => t);
}

/** The item a key builds while a building of type `b` is selected (the first, for the shared age key). */
export const itemForKey = (b: BldType, key: string, group?: string | null): Buildable | undefined => itemsForKey(b, key, group)[0];

/**
 * Whose production keys are live. A selected producing building's; otherwise, when no building of
 * ours is selected (nothing, or only units), the Town Hall's, so the letters on the structure buttons
 * always work. Unit commands still win for their own letters (M, X, G, F, V).
 */
export function hotkeyProducer(selected: readonly { kind: string; type: string; done?: boolean }[], hall: boolean): BldType | null {
  const b = selected.find((e) => e.kind === 'bld');
  if (b) return b.done && linesOf(b.type as BldType).length ? (b.type as BldType) : null;
  return hall ? 'yard' : null;
}
