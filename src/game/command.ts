// Player commands. Every player action goes through here, whether applied locally (solo) or
// received from a network client (online), so the server can validate everything a client asks for.
import { STANCES, isHarvester, valid, type Ent, type Stance } from './state.ts';
import { MW, MH, TS } from './const.ts';
import { UNIT_TYPES } from '../data/unit.ts';
import { BLD_TYPES } from '../data/building.ts';
import { TECH_TYPES } from '../data/era.ts';
import { groupMove, orderHarvest, orderHaul, orderReturn, orderStop, setStance } from './order.ts';
import { cancel, enqueue, placeReady, toggleHold, type Buildable } from './production.ts';
import { scrap, toggleRepair } from './building.ts';

export type Command =
  | { c: 'move'; ids: number[]; tx: number; ty: number }
  | { c: 'stance'; ids: number[]; stance: Stance }
  | { c: 'stop'; ids: number[] }
  | { c: 'harvest'; ids: number[]; tx: number; ty: number }
  | { c: 'return'; ids: number[] }
  | { c: 'haul'; ids: number[]; target: number }
  | { c: 'rally'; id: number; x: number; y: number }
  | { c: 'build'; type: Buildable }
  | { c: 'hold'; type: Buildable }
  | { c: 'cancel'; type: Buildable }
  | { c: 'place'; tx: number; ty: number }
  | { c: 'repair'; id: number }
  | { c: 'scrap'; id: number };

const MAX_IDS = 200;
const BUILDABLE = new Set<string>([...UNIT_TYPES, ...BLD_TYPES, ...TECH_TYPES]);

const isInt = (v: unknown): v is number => Number.isInteger(v);
const inMap = (x: unknown, y: unknown): boolean => isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < MW && y < MH;
const inWorld = (x: unknown, y: unknown): boolean => typeof x === 'number' && typeof y === 'number' && x >= 0 && y >= 0 && x <= MW * TS && y <= MH * TS;
const isIds = (v: unknown): v is number[] => Array.isArray(v) && v.length <= MAX_IDS && v.every(isInt);

/** Check the shape of an untrusted command. Returns null if anything is off. */
export function parseCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  switch (o.c) {
    case 'move':
      return isIds(o.ids) && inMap(o.tx, o.ty) ? { c: 'move', ids: o.ids, tx: o.tx as number, ty: o.ty as number } : null;
    case 'stance':
      return isIds(o.ids) && (STANCES as readonly unknown[]).includes(o.stance) ? { c: 'stance', ids: o.ids, stance: o.stance as Stance } : null;
    case 'stop':
    case 'return':
      return isIds(o.ids) ? { c: o.c, ids: o.ids } : null;
    case 'haul':
      return isIds(o.ids) && isInt(o.target) ? { c: 'haul', ids: o.ids, target: o.target } : null;
    case 'harvest':
      return isIds(o.ids) && inMap(o.tx, o.ty) ? { c: 'harvest', ids: o.ids, tx: o.tx as number, ty: o.ty as number } : null;
    case 'rally':
      return isInt(o.id) && inWorld(o.x, o.y) ? { c: 'rally', id: o.id, x: o.x as number, y: o.y as number } : null;
    case 'build':
    case 'hold':
    case 'cancel':
      return typeof o.type === 'string' && BUILDABLE.has(o.type) ? { c: o.c, type: o.type as Buildable } : null;
    case 'place':
      return inMap(o.tx, o.ty) ? { c: 'place', tx: o.tx as number, ty: o.ty as number } : null;
    case 'repair':
    case 'scrap':
      return isInt(o.id) ? { c: o.c, id: o.id } : null;
    default:
      return null;
  }
}

/** The team's own living units among the ids (anything else is ignored). */
function ownUnits(team: number, ids: number[]): Ent[] {
  return ids.map(valid).filter((e): e is Ent => !!e && e.team === team && e.kind === 'unit');
}

function ownBuilding(team: number, id: number): Ent | null {
  const b = valid(id);
  return b && b.team === team && b.kind === 'bld' ? b : null;
}

/** Carry out a command for a team. Silently ignores anything the team isn't allowed to do. */
export function applyCommand(team: number, cmd: Command): void {
  switch (cmd.c) {
    case 'move':
      groupMove(ownUnits(team, cmd.ids), cmd.tx, cmd.ty);
      break;
    case 'stance':
      for (const u of ownUnits(team, cmd.ids)) setStance(u, cmd.stance);
      break;
    case 'stop':
      ownUnits(team, cmd.ids).forEach(orderStop);
      break;
    case 'harvest':
      for (const u of ownUnits(team, cmd.ids)) if (isHarvester(u)) orderHarvest(u, cmd.tx, cmd.ty);
      break;
    case 'return':
      for (const u of ownUnits(team, cmd.ids)) if (isHarvester(u)) orderReturn(u);
      break;
    case 'haul': {
      const b = ownBuilding(team, cmd.target);
      if (b && b.done && (b.type === 'mill' || b.type === 'derrick')) for (const u of ownUnits(team, cmd.ids)) if (isHarvester(u)) orderHaul(u, b);
      break;
    }
    case 'rally': {
      const b = ownBuilding(team, cmd.id);
      if (b) b.rally = { x: cmd.x, y: cmd.y };
      break;
    }
    case 'build':
      enqueue(team, cmd.type);
      break;
    case 'hold':
      toggleHold(team, cmd.type);
      break;
    case 'cancel':
      cancel(team, cmd.type);
      break;
    case 'place':
      placeReady(team, cmd.tx, cmd.ty);
      break;
    case 'repair': {
      const b = ownBuilding(team, cmd.id);
      if (b) toggleRepair(b);
      break;
    }
    case 'scrap': {
      const b = ownBuilding(team, cmd.id);
      if (b) scrap(b);
      break;
    }
  }
}
