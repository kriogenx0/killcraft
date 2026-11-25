// Player commands. Every player action goes through here, whether applied locally (solo) or
// received from a network client (online), so the server can validate everything a client asks for.
import { G, STANCES, hostile, isHarvester, say, unitDef, valid, type Ent, type Stance } from './state.ts';
import { MW, MH, TREE, TS } from './const.ts';
import { UNIT_TYPES } from '../data/unit.ts';
import { BLD_TYPES, type BldType } from '../data/building.ts';
import { TECH_TYPES } from '../data/era.ts';
import { groupMove, orderAttack, orderChop, orderFix, orderHarvest, orderHaul, orderReturn, orderStop, setStance } from './order.ts';
import { cancel, enqueue, startSite, toggleHold, type Buildable } from './production.ts';
import { scrap, toggleRepair } from './building.ts';
import { toggleRefit } from './refit.ts';
import { rallyArmy } from './rally.ts';
import { GATHER, forgetAether, forgetResume, recruitTo, sendGather, type GatherRes } from './autogather.ts';
import { revive } from './revive.ts';

export type Command =
  | { c: 'move'; ids: number[]; tx: number; ty: number; form?: boolean }
  | { c: 'patrol'; ids: number[]; tx: number; ty: number; form?: boolean }
  | { c: 'stance'; ids: number[]; stance: Stance }
  | { c: 'stop'; ids: number[] }
  | { c: 'tend'; ids: number[] }
  | { c: 'harvest'; ids: number[]; tx: number; ty: number }
  | { c: 'return'; ids: number[] }
  | { c: 'haul'; ids: number[]; target: number }
  /** set Workers to Auto, or to gather one resource from what's nearest the base */
  | { c: 'gather'; ids: number[]; res: GatherRes }
  | { c: 'fix'; ids: number[]; target: number }
  /** fight one enemy unit or building until it falls */
  | { c: 'attack'; ids: number[]; target: number }
  | { c: 'rally'; id: number; x: number; y: number }
  /** the army rally point: every producer's new troops go there, and with `send` the whole army too */
  | { c: 'muster'; x: number; y: number; send: boolean }
  | { c: 'build'; type: Buildable }
  | { c: 'hold'; type: Buildable }
  | { c: 'cancel'; type: Buildable }
  | { c: 'place'; type: BldType; tx: number; ty: number; ex?: number; ey?: number }
  | { c: 'repair'; id: number }
  /** send a Worker to haul from an Oil Derrick */
  | { c: 'recruit'; id: number }
  | { c: 'scrap'; id: number }
  | { c: 'upgrade'; id: number }
  /** give a fallen ally a new Town Hall and two Workers (team games) */
  | { c: 'revive'; team: number };

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
    case 'patrol':
      return isIds(o.ids) && inMap(o.tx, o.ty) ? { c: o.c, ids: o.ids, tx: o.tx as number, ty: o.ty as number, ...(o.form === true ? { form: true } : {}) } : null;
    case 'stance':
      return isIds(o.ids) && (STANCES as readonly unknown[]).includes(o.stance) ? { c: 'stance', ids: o.ids, stance: o.stance as Stance } : null;
    case 'stop':
    case 'tend':
    case 'return':
      return isIds(o.ids) ? { c: o.c, ids: o.ids } : null;
    case 'gather':
      return isIds(o.ids) && (GATHER as readonly unknown[]).includes(o.res) ? { c: 'gather', ids: o.ids, res: o.res as GatherRes } : null;
    case 'haul':
    case 'fix':
    case 'attack':
      return isIds(o.ids) && isInt(o.target) ? { c: o.c, ids: o.ids, target: o.target } : null;
    case 'harvest':
      return isIds(o.ids) && inMap(o.tx, o.ty) ? { c: 'harvest', ids: o.ids, tx: o.tx as number, ty: o.ty as number } : null;
    case 'rally':
      return isInt(o.id) && inWorld(o.x, o.y) ? { c: 'rally', id: o.id, x: o.x as number, y: o.y as number } : null;
    case 'muster':
      return inWorld(o.x, o.y) && typeof o.send === 'boolean' ? { c: 'muster', x: o.x as number, y: o.y as number, send: o.send } : null;
    case 'build':
    case 'hold':
    case 'cancel':
      return typeof o.type === 'string' && BUILDABLE.has(o.type) ? { c: o.c as 'build' | 'hold' | 'cancel', type: o.type as Buildable } as Command : null;
    case 'place':
      if (typeof o.type !== 'string' || !(BLD_TYPES as readonly string[]).includes(o.type) || !inMap(o.tx, o.ty)) return null;
      // walls: the far end of a dragged line
      if (o.ex !== undefined || o.ey !== undefined) return inMap(o.ex, o.ey) ? { c: 'place', type: o.type as BldType, tx: o.tx as number, ty: o.ty as number, ex: o.ex as number, ey: o.ey as number } : null;
      return { c: 'place', type: o.type as BldType, tx: o.tx as number, ty: o.ty as number };
    case 'repair':
    case 'recruit':
    case 'scrap':
    case 'upgrade':
      return isInt(o.id) ? { c: o.c, id: o.id } : null;
    case 'revive':
      return isInt(o.team) && o.team >= 0 && o.team < 4 ? { c: 'revive', team: o.team } : null;
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
  // any other order for a Worker ends "fix, then harvest"
  // a new order replaces the job a Worker meant to go back to (a change of stance doesn't)
  if ('ids' in cmd && cmd.c !== 'tend' && cmd.c !== 'stance') for (const u of ownUnits(team, cmd.ids)) { forgetResume(u); forgetAether(u); }
  switch (cmd.c) {
    case 'tend':
      // Workers fix everything damaged nearby (buildings, sites, wounded units), then go back to harvesting
      // the Fix, then harvest stance (sent by older clients as its own command)
      for (const u of ownUnits(team, cmd.ids)) if (u.type === 'worker') { setStance(u, 'tend'); u.scan = 0; }
      break;
    case 'move':
      groupMove(ownUnits(team, cmd.ids), cmd.tx, cmd.ty, false, cmd.form);
      break;
    case 'patrol':
      // only units that can fight patrol
      groupMove(ownUnits(team, cmd.ids).filter((u) => unitDef(u).weapon), cmd.tx, cmd.ty, true, cmd.form);
      break;
    case 'stance':
      for (const u of ownUnits(team, cmd.ids)) setStance(u, cmd.stance);
      break;
    case 'stop':
      ownUnits(team, cmd.ids).forEach(orderStop);
      break;
    case 'harvest':
      // on a tree, Workers chop wood; elsewhere, harvesters and Workers dig ore
      for (const u of ownUnits(team, cmd.ids)) if (isHarvester(u)) (G.terr[cmd.ty * MW + cmd.tx] === TREE ? orderChop : orderHarvest)(u, cmd.tx, cmd.ty);
      break;
    case 'return':
      for (const u of ownUnits(team, cmd.ids)) if (isHarvester(u)) orderReturn(u);
      break;
    case 'gather': {
      let sent = 0;
      for (const u of ownUnits(team, cmd.ids)) if (sendGather(u, cmd.res)) sent++;
      if (!sent && ownUnits(team, cmd.ids).some((u) => u.type === 'worker')) say(team, cmd.res === 'oil' ? 'No Oil Derrick with oil to haul' : cmd.res === 'aether' ? 'No Aether left on the map' : cmd.res === 'wood' ? 'Nowhere to take wood' : cmd.res === 'auto' ? 'Nothing to gather near a drop-off' : 'Nowhere to take ore');
      break;
    }
    case 'haul': {
      const b = ownBuilding(team, cmd.target);
      if (b && b.done && (b.type === 'mill' || b.type === 'derrick')) for (const u of ownUnits(team, cmd.ids)) if (isHarvester(u)) orderHaul(u, b);
      break;
    }
    case 'fix': {
      // Workers mend one of the side's own buildings or units
      const t = valid(cmd.target);
      if (t && t.team === team && t.kind !== 'source') for (const u of ownUnits(team, cmd.ids)) if (u.type === 'worker' && u !== t) orderFix(u, t);
      break;
    }
    case 'attack': {
      // armed units go for that enemy and stay on it; Workers and Medics carry on with their jobs
      const t = valid(cmd.target);
      if (t && t.kind !== 'source' && hostile(t.team, team)) for (const u of ownUnits(team, cmd.ids)) if (unitDef(u).weapon && !isHarvester(u)) orderAttack(u, t);
      break;
    }
    case 'rally': {
      const b = ownBuilding(team, cmd.id);
      if (b) b.rally = { x: cmd.x, y: cmd.y };
      break;
    }
    case 'muster':
      rallyArmy(team, cmd.x, cmd.y, cmd.send);
      break;
    case 'build':
      enqueue(team, cmd.type); // paid in full the moment it's queued; turned down if the side can't pay
      break;
    case 'hold':
      toggleHold(team, cmd.type);
      break;
    case 'cancel':
      cancel(team, cmd.type);
      break;
    case 'place':
      startSite(team, cmd.type, cmd.tx, cmd.ty, cmd.ex, cmd.ey, true);
      break;
    case 'recruit': {
      const b = ownBuilding(team, cmd.id);
      if (b && b.type === 'derrick' && b.done && !recruitTo(b)) say(team, 'No Worker to send');
      break;
    }
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
    case 'upgrade': {
      const b = ownBuilding(team, cmd.id);
      if (b) toggleRefit(b);
      break;
    }
    case 'revive':
      revive(team, cmd.team);
      break;
  }
}
