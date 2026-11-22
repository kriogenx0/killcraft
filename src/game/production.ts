// Sidebar production: one structure at a time from the Construction Yard, and queues of infantry
// and vehicles. Credits are spent as work progresses; production stalls when money runs out and
// runs at half speed on low power.
import { G, say, type Ent, type Production, type ProductionItem, type ProductionLine } from './state.ts';
import { TS } from './const.ts';
import { UNIT, UNIT_TYPES, isUnitType, type UnitType } from '../data/unit.ts';
import { BUILDING, BLD_TYPES, type BldType } from '../data/building.ts';
import { addUnit, hasBuilding, lowPower } from './entity.ts';
import { exitTile, placeBuilding } from './building.ts';
import { orderHarvest, orderMove } from './order.ts';
import { tileOf } from './state.ts';

export type Buildable = UnitType | BldType;

const QUEUE_MAX = 5;
const PRODUCER: Record<ProductionLine, BldType> = { structure: 'yard', infantry: 'barracks', vehicle: 'factory' };
const FUNDS_NOTICE = 6;
const lastFundsNotice: number[] = [];

export const emptyProduction = (): Production => ({ structure: [], infantry: [], vehicle: [] });
export const lineOf = (t: Buildable): ProductionLine => (isUnitType(t) ? UNIT[t].producer : 'structure');
export const costOf = (t: Buildable): number => (isUnitType(t) ? UNIT[t].cost : BUILDING[t].cost);
const timeOf = (t: Buildable): number => (isUnitType(t) ? UNIT[t].t : BUILDING[t].t);

export function producerOf(team: number, line: ProductionLine): Ent | null {
  return G.ents.find((e) => !e.dead && e.team === team && e.type === PRODUCER[line] && e.done) ?? null;
}

/** What a team can build right now on a production line. */
export function available(team: number, line: ProductionLine): Buildable[] {
  if (!producerOf(team, line)) return [];
  if (line === 'structure') return BLD_TYPES.filter((t) => BUILDING[t].requires.every((r) => hasBuilding(team, r)));
  return UNIT_TYPES.filter((t) => UNIT[t].producer === line);
}

export function enqueue(team: number, type: Buildable): boolean {
  const line = lineOf(type), q = G.prod[team][line];
  if (!available(team, line).includes(type)) return false;
  if (q.length >= (line === 'structure' ? 1 : QUEUE_MAX)) { say(team, line === 'structure' ? 'Already building' : 'Queue is full'); return false; }
  q.push({ type, prog: 0, spent: 0, ready: false, hold: false });
  return true;
}

/** Remove the last queued item of a type and refund what was spent on it. */
export function cancel(team: number, type: Buildable): boolean {
  const q = G.prod[team][lineOf(type)];
  for (let i = q.length - 1; i >= 0; i--)
    if (q[i].type === type) {
      G.credits[team] += q[i].spent;
      q.splice(i, 1);
      return true;
    }
  return false;
}

export function toggleHold(team: number, type: Buildable): void {
  const it = G.prod[team][lineOf(type)].find((x) => x.type === type);
  if (it && !it.ready) it.hold = !it.hold;
}

export function itemsOf(team: number, type: Buildable): ProductionItem[] {
  return G.prod[team][lineOf(type)].filter((x) => x.type === type);
}

function deliver(team: number, type: UnitType): void {
  const b = producerOf(team, UNIT[type].producer);
  if (!b) return;
  const [x, y] = exitTile(b, b.rally ?? undefined), u = addUnit(type, team, (x + 0.5) * TS, (y + 0.5) * TS);
  u.face = u.tface = Math.PI / 2;
  say(team, `${UNIT[type].name} ready`);
  if (type === 'harvester') orderHarvest(u, x, y);
  else if (b.rally) orderMove(u, tileOf(b.rally.x), tileOf(b.rally.y));
}

export function updProduction(team: number, dt: number): void {
  const speed = lowPower(team) ? 0.5 : 1;
  for (const line of ['structure', 'infantry', 'vehicle'] as ProductionLine[]) {
    const q = G.prod[team][line], it = q[0];
    if (!it || it.ready || it.hold) continue;
    if (!producerOf(team, line)) { cancel(team, it.type); continue; }
    const dp = Math.min((speed * dt) / timeOf(it.type), 1 - it.prog), cost = costOf(it.type) * dp;
    if (G.credits[team] < cost) {
      if (G.gameT - (lastFundsNotice[team] ?? -99) > FUNDS_NOTICE) { lastFundsNotice[team] = G.gameT; say(team, 'Insufficient funds'); }
      continue;
    }
    G.credits[team] -= cost;
    it.spent += cost;
    it.prog += dp;
    if (it.prog < 1 - 1e-9) continue;
    if (line === 'structure') { it.ready = true; say(team, 'Construction complete'); }
    else { q.shift(); deliver(team, it.type as UnitType); }
  }
}

/** The structure waiting to be placed, if any. */
export function readyStructure(team: number): BldType | null {
  const it = G.prod[team].structure[0];
  return it?.ready ? (it.type as BldType) : null;
}

export function placeReady(team: number, tx: number, ty: number): Ent | null {
  const type = readyStructure(team);
  if (!type) return null;
  const b = placeBuilding(team, type, tx, ty);
  if (b) G.prod[team].structure.shift();
  return b;
}
