// Each side's share of all the armies on the map, by what the units cost to make.
import { G, isHarvester, type Ent } from './state.ts';
import { UNIT, isUnitType } from '../data/unit.ts';

/**
 * What a unit is worth: its whole price, every resource counted alike. Value, not head count,
 * so a Titan weighs more than a crowd of archers.
 */
export function unitValue(e: Ent): number {
  if (!isUnitType(e.type)) return 0;
  const d = UNIT[e.type];
  return d.cost + (d.wood ?? 0) + (d.oil ?? 0) + (d.aether ?? 0);
}

export interface ArmyShare { team: number; value: number; share: number }

/** Every side still fielding an army, with its share of the total (0 to 1). Workers don't count. */
export function armyShares(): ArmyShare[] {
  const value = Array.from({ length: G.teams }, () => 0);
  for (const e of G.ents)
    if (!e.dead && e.kind === 'unit' && e.team >= 0 && e.team < G.teams && !isHarvester(e)) value[e.team] += unitValue(e);
  const total = value.reduce((a, b) => a + b, 0);
  return total <= 0 ? [] : value.map((v, team) => ({ team, value: v, share: v / total })).filter((s) => s.value > 0);
}
