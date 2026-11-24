// Army rally point: one spot per side that every Barracks, Factory and Airfield sends its new troops
// to (now and when built later), and that the whole army is called to when it's set. A building's
// own rally point (right-click with it selected) still overrides it for that building.
import { G, bldDef, isHarvester, tileOf, type Ent } from './state.ts';
import { isUnitProducer } from '../data/building.ts';
import { groupMove } from './order.ts';

/** A side's finished buildings that train troops. */
export const producers = (team: number): Ent[] =>
  G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld' && e.done && isUnitProducer(bldDef(e).produces));

/** A side's fighting units: everything but Workers and harvesters, which keep working. */
export const army = (team: number): Ent[] => G.ents.filter((e) => !e.dead && e.kind === 'unit' && e.team === team && !isHarvester(e));

/** Set the army rally point (world px): every producer sends new troops there, and with `send` the army marches there now. */
export function rallyArmy(team: number, x: number, y: number, send: boolean): void {
  G.rally ??= [];
  G.rally[team] = { x, y };
  for (const b of producers(team)) b.rally = { x, y };
  if (send) groupMove(army(team), tileOf(x), tileOf(y));
}

/** A newly finished Barracks, Factory or Airfield starts out pointing at the army rally point. */
export function joinRally(b: Ent): void {
  const r = G.rally?.[b.team];
  if (r && !b.rally && isUnitProducer(bldDef(b).produces)) b.rally = { x: r.x, y: r.y };
}
