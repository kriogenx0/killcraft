// Walking along paths, approaching targets, and keeping units from stacking on each other.
import { G, blkAt, isAir, isJet, tileOf, unitDef, type Ent, type Target } from './state.ts';
import { MW, MH, TS, SHALLOW } from './const.ts';
import { SHALLOW_SPEED } from '../data/map.ts';
import { clamp } from '../util/math.ts';
import { edgeDist, isJump, los, pathFor, pathTo } from './path.ts';
import { warpFx } from './fx.ts';
import { PORTAL_RADIUS } from '../data/map.ts';
import { isMapPortal } from './map.ts';
import { slowFactor } from './aether.ts';
import { spellSpeed } from './spells.ts';
import { canBreach, wallInWay } from './breach.ts';
import { isWall } from '../data/building.ts';

/** Turn an angle toward a target angle by at most `max` radians. */
export function turnToward(a: number, target: number, max: number): number {
  let d = target - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= max ? target : a + Math.sign(d) * max;
}

export function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/** Ground units wade slowly through shallow water. */
export const terrainSpeed = (u: Ent): number => (!isAir(u) && G.terr[tileOf(u.y) * MW + tileOf(u.x)] === SHALLOW ? SHALLOW_SPEED : 1);

/** Facing more than this far off its heading, a ground unit stops and turns on the spot before moving on. */
const PIVOT = 1.3;

/**
 * Turn toward a point at the unit's own turn speed (UnitDef.turn) and move straight at it, at most
 * `max` px. A ground unit facing well away turns on the spot first, and slows down while it is still
 * turning; aircraft fly on while they turn and are never blocked. Returns 'arrived' when it reached
 * the point this step, 'blocked' when the way is shut, else 'moving'.
 */
export function steer(u: Ent, tx: number, ty: number, max: number, dt: number, air: boolean): 'arrived' | 'moving' | 'blocked' {
  const dx = tx - u.x, dy = ty - u.y, dist = Math.hypot(dx, dy);
  u.moving = true;
  let off = 0;
  if (dist > 0.01) {
    const want = Math.atan2(dy, dx);
    u.face = turnToward(u.face, want, unitDef(u).turn * dt);
    if (!air) off = angleDiff(u.face, want);
  }
  if (off > PIVOT) {
    // turning on the spot is not being stuck: restart the stuck timer (see unstick in unit.ts)
    u.stkT = 0.6; u.px = u.x; u.py = u.y;
    return 'moving';
  }
  const step = max * Math.max(0.35, Math.cos(off));
  u.walk += Math.min(step, dist) / 24;
  if (dist <= step) {
    u.x = tx; u.y = ty;
    return 'arrived';
  }
  const [mx, my, pace] = air ? [dx / dist, dy / dist, 1] : avoid(u, dx / dist, dy / dist, Math.min(dist, lookahead(u)), dt);
  let nx = u.x + mx * step * pace, ny = u.y + my * step * pace;
  // stepping round someone would take it into a wall (a one-tile gap): keep straight on instead
  if (!air && !canStep(u.x, u.y, nx, ny) && canStep(u.x, u.y, u.x + (dx / dist) * step * pace, u.y + (dy / dist) * step * pace)) {
    nx = u.x + (dx / dist) * step * pace; ny = u.y + (dy / dist) * step * pace;
  }
  if (!air && !canStep(u.x, u.y, nx, ny) && !blkAt(u.x, u.y)) {
    // clipping a corner: slide along it; only a wall straight ahead blocks the way
    // (sliding has to get somewhere: a wall square ahead leaves nothing to slide along)
    const min = step * 0.02;
    if (Math.abs(nx - u.x) > min && canStep(u.x, u.y, nx, u.y)) ny = u.y;
    else if (Math.abs(ny - u.y) > min && canStep(u.x, u.y, u.x, ny)) nx = u.x;
    else return 'blocked';
    // heading straight into a wall: "sliding" along the other axis goes nowhere
    if (nx === u.x && ny === u.y) return 'blocked';
  }
  u.x = nx; u.y = ny;
  return 'moving';
}

/** Ground units bucketed into CELL-px squares, rebuilt once per step: who is near whom. */
const CELL = 64;
const crowd = new Map<number, Ent[]>();
let crowdT = -1;
function nearby(x: number, y: number): Ent[] {
  if (crowdT !== G.gameT) {
    crowdT = G.gameT;
    crowd.clear();
    for (const e of G.ents) {
      if (e.dead || e.kind !== 'unit' || isAir(e)) continue;
      const k = Math.floor(e.y / CELL) * 1024 + Math.floor(e.x / CELL);
      const c = crowd.get(k);
      if (c) c.push(e); else crowd.set(k, [e]);
    }
  }
  const out: Ent[] = [], cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) { const c = crowd.get(j * 1024 + i); if (c) out.push(...c); }
  return out;
}

/** How far ahead (px) a walking unit looks for others in its way. */
/**
 * How much room a unit's body takes towards a point in direction (dx, dy) (px), when units bump into
 * each other. A ground vehicle's hull is longer than it is wide: its round `radius` (which sets reach
 * and what splash hits) fits its sides, and nose and tail reach VEHICLE_BODY times further, so tanks
 * driving up behind or into each other stop short instead of overlapping.
 */
export function bodyRadius(u: Ent, dx = 0, dy = 0): number {
  const d = unitDef(u), l = Math.hypot(dx, dy);
  if (d.cls !== 'vehicle' || !l) return d.radius;
  return d.radius * (1 + (VEHICLE_BODY - 1) * Math.abs((Math.cos(u.face) * dx + Math.sin(u.face) * dy) / l));
}
const VEHICLE_BODY = 1.35;

const lookahead = (u: Ent): number => Math.max(40, unitDef(u).radius * 4);

/** A unit that is just standing about, with nothing to do, and so can make way. */
const idle = (e: Ent): boolean => !e.order && !e.moving;

/**
 * A side's Workers out on a gathering trip walk through each other (and through those gathering),
 * so a stream of them going out and coming home never jams in a narrow gap.
 */
const hauling = (e: Ent): boolean => e.type === 'worker' && e.order?.t === 'harvest';
const passThrough = (a: Ent, b: Ent): boolean => a.team === b.team && hauling(a) && hauling(b);

/** Both marching in the same formation. */
const sameFormation = (a: Ent, b: Ent): boolean => a.order?.t === 'move' && b.order?.t === 'move' && a.order.fid != null && a.order.fid === b.order.fid;

/**
 * Local avoidance: bend a walking unit's heading (ux, uy) around others before it walks into them,
 * looking `look` px ahead. Units coming the other way both keep to their right; anyone else in the
 * way is passed on the side it isn't; a friend walking the same way just ahead is followed at a
 * distance rather than shoved; units alongside are given a little room. An idle unit of the same
 * side standing in the way steps aside. Returns the heading to walk along and a speed factor.
 */
function avoid(u: Ent, ux: number, uy: number, look: number, dt: number): [number, number, number] {
  const ru = bodyRadius(u, ux, uy), px = -uy, py = ux, heading = Math.atan2(uy, ux); // (px, py): the unit's right
  let side = 0, pace = 1;
  for (const e of nearby(u.x, u.y)) {
    if (e === u || passThrough(u, e)) continue;
    const rx = e.x - u.x, ry = e.y - u.y, along = rx * ux + ry * uy, lat = rx * px + ry * py;
    const re = bodyRadius(e, ux, uy), clear = ru + re + 4;
    if (Math.abs(lat) >= clear + 4 || along <= -clear || along > look) continue;
    if (along <= 0) {
      // alongside: ease away so we don't rub shoulders
      side -= Math.sign(lat || 1) * 0.3 * (1 - Math.abs(lat) / (clear + 4));
      continue;
    }
    if (Math.abs(lat) >= clear) continue;
    const together = e.moving && Math.cos(e.face - heading) > 0.5;
    // (in the same formation each has its own spot to keep level with, so it steps round instead)
    if (together && e.team === u.team && !sameFormation(u, e)) {
      // a friend going our way: fall in behind it instead of pushing past
      pace = Math.min(pace, Math.max(0.3, (along - ru - re) / 12));
      continue;
    }
    if (e.team === u.team && idle(e) && !anchored(e) && along < ru + re + 16) {
      // a friend standing in the way steps off our line
      // (no room either side, as in a lane between buildings: it walks on ahead of us and out the far end)
      const s = lat >= 0 ? 1 : -1, d = stepOf(e, dt) * 0.8;
      if (canStep(e.x, e.y, e.x + px * s * d, e.y + py * s * d)) { e.x += px * s * d; e.y += py * s * d; }
      else if (canStep(e.x, e.y, e.x + ux * d, e.y + uy * d)) { e.x += ux * d; e.y += uy * d; }
    }
    const urgency = (1 - along / look) * (1 - Math.abs(lat) / clear);
    const oncoming = e.moving && Math.cos(e.face - heading) < -0.5;
    // pass oncoming traffic on the right; anything else on whichever side it isn't
    side += (oncoming ? 1 : lat > 0 ? -1 : lat < 0 ? 1 : e.id < u.id ? 1 : -1) * urgency;
  }
  if (!side) return [ux, uy, pace];
  // bend by up to about 50 degrees
  const k = Math.max(-1.2, Math.min(1.2, side * 1.5)), vx = ux + px * k, vy = uy + py * k, vl = Math.hypot(vx, vy);
  return [vx / vl, vy / vl, pace];
}

/**
 * Can a ground unit move between two nearby points? Not into a blocked tile, and not diagonally
 * between two blocked tiles that touch at a corner (that squeezes it into a pocket it can't path out of).
 */
export function canStep(x0: number, y0: number, x1: number, y1: number): boolean {
  if (blkAt(x1, y1)) return false;
  const ax = tileOf(x0), ay = tileOf(y0), bx = tileOf(x1), by = tileOf(y1);
  return ax === bx || ay === by || (!blkAt(x1, y0) && !blkAt(x0, y1));
}

/** How far a unit may move this step, in px. */
/**
 * Holding formation. Each formation has a marker that walks to the goal at the group's pace,
 * measured as distance still to go; every unit keeps level with it by how far it still has to go to
 * its own spot. One behind speeds up (up to its full speed), one ahead eases off, harder the further
 * out of line it is (GAIN of the pace per tile, never below FLOOR of it). The marker never runs more
 * than SLACK tiles ahead of the group's middle unit, so a group held up by a crowd or a detour isn't
 * sent racing after it. A unit more than LOOSE tiles ahead (its spot is nearer, round a wall, say)
 * just walks at the pace. A unit more than NEAR tiles from its spot in the moving block, behind or
 * off to one side, hurries to it at full speed; within NEAR it keeps in step.
 */
const GAIN = 2, FLOOR = 0.5, SLACK = 1, LOOSE = 6;
/** Within this many tiles of its spot in the moving block a unit keeps in step; further off it hurries there. */
const NEAR = 1.5;
/** each formation's marker: distance (tiles) still to go, as of game time `t` */
const marks = new Map<number, { left: number; t: number; dx: number; dy: number }>();
let marksAt = -1;

/** Tiles a unit still has to walk to its spot. */
const toGo = (u: Ent, o: { gx: number; gy: number }): number => Math.hypot((o.gx + 0.5) * TS - u.x, (o.gy + 0.5) * TS - u.y) / TS;

function markOf(fid: number): { left: number; dx: number; dy: number } | undefined {
  if (marksAt !== G.gameT) {
    marksAt = G.gameT;
    const left = new Map<number, { l: number[]; pace: number; dx: number; dy: number }>();
    for (const e of G.ents) {
      const o = e.order;
      // (a unit still on its way to its place in the block isn't marching yet)
      if (e.dead || o?.t !== 'move' || o.fid == null || !o.pace || o.fu) continue;
      const g = left.get(o.fid) ?? { l: [], pace: o.pace, dx: 0, dy: 0 };
      g.l.push(toGo(e, o));
      g.dx += (o.gx + 0.5) * TS - e.x; g.dy += (o.gy + 0.5) * TS - e.y;
      left.set(o.fid, g);
    }
    for (const f of marks.keys()) if (!left.has(f)) marks.delete(f);
    for (const [f, g] of left) {
      const mid = g.l.sort((a, b) => a - b)[Math.floor(g.l.length / 2)], m = marks.get(f), fresh = !m || m.t > G.gameT;
      // the way the group is heading, fixed when the order is given
      const gl = Math.hypot(g.dx, g.dy) || 1;
      marks.set(f, {
        left: fresh ? mid : Math.max(m.left - g.pace * (G.gameT - m.t), mid - SLACK), t: G.gameT,
        dx: fresh ? g.dx / gl : m.dx, dy: fresh ? g.dy / gl : m.dy,
      });
    }
  }
  return marks.get(fid);
}

/** How far (tiles) along the way it's going one spot or unit must be beyond another to count as in front of it. */
const RANK_GAP = 0.6;
/** units in formation waiting for those whose spots are in front of theirs to go by, worked out once a tick */
let waiting = new Set<Ent>();
let waitingAt = -1;
/** The longest (s) a unit in formation waits for the front to go by before it sets off anyway. */
const WAIT_MAX = 3;
/** when each unit began waiting, and in which formation (a new order starts the clock again) */
const waitSince = new WeakMap<Ent, { fid: number; t: number }>();

/**
 * A unit whose spot is at the back of a formation waits while any unit whose spot is in front of it
 * hasn't yet got in front of it (as when a group turns round, or Medics are swapped to the back), so
 * the front moves off first and the back falls in behind. It never waits on a unit that is itself
 * waiting, and never more than WAIT_MAX seconds in all, so nobody is left standing.
 */
function waitsForFront(u: Ent): boolean {
  if (waitingAt !== G.gameT) {
    waitingAt = G.gameT;
    // a unit that was itself waiting last tick isn't one to wait for: that could hold a group still forever
    const was = waiting;
    waiting = new Set<Ent>();
    const groups = new Map<number, Ent[]>();
    for (const e of G.ents) {
      const o = e.order;
      if (e.dead || o?.t !== 'move' || o.fid == null || o.sub || o.fu) continue;
      const g = groups.get(o.fid) ?? [];
      g.push(e);
      groups.set(o.fid, g);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      // the way the group is going: from its middle to the middle of its spots
      let dx = 0, dy = 0;
      for (const e of g) { const o = e.order as { gx: number; gy: number }; dx += (o.gx + 0.5) * TS - e.x; dy += (o.gy + 0.5) * TS - e.y; }
      const l = Math.hypot(dx, dy);
      if (l < TS * g.length) continue; // nearly there
      dx /= l; dy /= l;
      const spot = (e: Ent) => { const o = e.order as { gx: number; gy: number }; return (o.gx + 0.5) * dx + (o.gy + 0.5) * dy; };
      const at = (e: Ent) => (e.x * dx + e.y * dy) / TS;
      for (const u of g) {
        const fid = (u.order as { fid: number }).fid, w = waitSince.get(u);
        if (w && w.fid === fid && G.gameT - w.t > WAIT_MAX) continue; // waited long enough: go
        const su = spot(u), pu = at(u);
        if (g.some((f) => f !== u && !was.has(f) && spot(f) - su > RANK_GAP && at(f) - pu < RANK_GAP && Math.hypot(f.x - u.x, f.y - u.y) < 8 * TS)) {
          waiting.add(u);
          if (!w || w.fid !== fid) waitSince.set(u, { fid, t: G.gameT });
        }
      }
    }
  }
  return waiting.has(u);
}

/** In formation: the group's pace, faster for a unit fallen behind, slower for one out in front. */
function formationPace(u: Ent): number {
  const o = u.order;
  if (o?.t !== 'move' || o.sub || !o.pace) return Infinity;
  // on its way to its place in the block: hurry there, then march with the rest
  if (o.fu) {
    // (until it's there, or its path no longer goes there: pushed past it in a crowd, or sent round)
    const [fx, fy] = o.fu;
    if (Math.hypot((fx + 0.5) * TS - u.x, (fy + 0.5) * TS - u.y) > 1.5 * TS && u.path?.some((t) => t[0] === fx && t[1] === fy)) return Infinity;
    o.fu = undefined;
  }
  if (waitsForFront(u)) return 0;
  const m = o.fid != null ? markOf(o.fid) : undefined;
  if (!m) return o.pace;
  // how far it is from its spot in the moving block: behind (or ahead) along the way, and to one side
  const vx = (o.gx + 0.5) * TS - u.x, vy = (o.gy + 0.5) * TS - u.y;
  const behind = toGo(u, o) - m.left, side = Math.abs(vx * m.dy - vy * m.dx) / TS;
  if (behind < -LOOSE) return o.pace;
  // well out of place behind or to the side: hurry there at full speed (Alex, 2026-11-28)
  if (behind > 0 && Math.hypot(behind, side) > NEAR) return Infinity;
  // close to its spot: keep in step with the group
  return o.pace * Math.max(FLOOR, 1 + GAIN * behind);
}

/** Standing still on purpose: in formation, waiting for the units in front to move off (not stuck). */
export const holdingFormation = (u: Ent): boolean => formationPace(u) === 0;

export const stepOf = (u: Ent, dt: number): number => Math.min(unitDef(u).spd, formationPace(u)) * slowFactor(u) * spellSpeed(u) * terrainSpeed(u) * TS * dt;

/** How near (px) the end of its walk a unit must be before a friend standing in the way counts as getting there. */
const SHORT = TS * 2.5;

/** Is (x, y) in a gap or lane one tile wide, where a unit stopping would block the way? */
export function narrow(x: number, y: number): boolean {
  return (blkAt(x - TS, y) && blkAt(x + TS, y)) || (blkAt(x, y - TS) && blkAt(x, y + TS));
}

/** On a move order, within SHORT of (gx, gy), with a friend standing still right in front of it, between it and that spot. */
function blockedShort(u: Ent, gx: number, gy: number): boolean {
  const dx = gx - u.x, dy = gy - u.y, d = Math.hypot(dx, dy);
  if (u.order?.t !== 'move' || d > SHORT || d < 1 || narrow(u.x, u.y)) return false;
  for (const e of nearby(u.x, u.y)) {
    if (e === u || e.team !== u.team || e.moving) continue;
    const rx = e.x - u.x, ry = e.y - u.y, gap = Math.hypot(rx, ry) - bodyRadius(u, rx, ry) - bodyRadius(e, rx, ry);
    if (gap < 6 && (rx * dx + ry * dy) / d > Math.hypot(rx, ry) * 0.5) return true;
  }
  return false;
}

/** Step along the unit's path. Returns true when the path is finished. */
export function followPath(u: Ent, dt: number): boolean {
  if (!u.path || !u.path.length) return true;
  const repath = () => {
    const path = u.path ?? [];
    const g = u.goal ?? path[path.length - 1];
    u.path = g ? pathFor(u, g[0], g[1]) : [];
    return !u.path.length;
  };
  const wp = u.path[0], air = isAir(u);
  // a jet can't stop on a spot: flying over near it counts as getting there (it then circles)
  if (air && u.path.length === 1 && isJet(u) && Math.hypot((wp[0] + 0.5) * TS - u.x, (wp[1] + 0.5) * TS - u.y) < turnRadius(u) * 0.6) { u.path.shift(); return true; }
  if (!air && G.blk[wp[1] * MW + wp[0]]) return repath();
  // anywhere on a map portal's swirl counts as entering it, so a crowd doesn't have to queue for the centre
  const through = u.path[1];
  if (!air && through && isJump(wp, through) && isMapPortal(wp[0], wp[1]) && G.warp[wp[1] * MW + wp[0]] === through[1] * MW + through[0]
    && Math.hypot((wp[0] + 0.5) * TS - u.x, (wp[1] + 0.5) * TS - u.y) <= PORTAL_RADIUS * TS) {
    u.path.shift();
    warp(u, through);
    return !u.path.length;
  }
  // A crowd can't all stand on a waypoint's centre: near enough to one on the way counts as passing
  // it, as long as the next one is in a clear straight line (and neither is a portal gate).
  // In a crowd, being level with it (pushed off to one side, but no longer short of it) counts too.
  const after = u.path[1];
  if (after && !air && !isJump(wp, after) && G.warp[wp[1] * MW + wp[0]] < 0 && G.warp[after[1] * MW + after[0]] < 0) {
    const wx = (wp[0] + 0.5) * TS, wy = (wp[1] + 0.5) * TS, off = Math.hypot(wx - u.x, wy - u.y);
    const level = (u.x - wx) * (after[0] - wp[0]) + (u.y - wy) * (after[1] - wp[1]) >= 0;
    if ((off < TS * 0.5 || (level && off < TS * 2)) && los(u.x, u.y, (after[0] + 0.5) * TS, (after[1] + 0.5) * TS)) {
      u.path.shift();
      return false;
    }
  }
  // the last stretch: a friend already standing between it and the spot means it's there (in a
  // crowd sent to one place not everyone fits on the spot itself; pressing on only jostles)
  if (!air && u.path.length === 1 && G.warp[wp[1] * MW + wp[0]] < 0 && blockedShort(u, (wp[0] + 0.5) * TS, (wp[1] + 0.5) * TS)) { u.path.shift(); return true; }
  const r = steer(u, (wp[0] + 0.5) * TS, (wp[1] + 0.5) * TS, stepOf(u, dt), dt, air);
  if (r === 'blocked') return repath(); // something was built in the way
  if (r === 'moving') return false;
  u.path.shift();
  const next = u.path[0];
  if (next && isJump(wp, next) && G.warp[wp[1] * MW + wp[0]] === next[1] * MW + next[0]) warp(u, next);
  return !u.path.length;
}

/** Step through a portal: come out at the centre of the exit gate (its tile is the path's next waypoint). */
function warp(u: Ent, exit: [number, number]): void {
  warpFx(u.x, u.y);
  u.x = u.px = (exit[0] + 0.5) * TS; u.y = u.py = (exit[1] + 0.5) * TS;
  warpFx(u.x, u.y);
  u.path?.shift();
}

/** Walk toward a target until within range. true = in range, false = still walking, null = unreachable. */
export function approach(u: Ent, t: Target, range: number, dt: number): boolean | null {
  if (isJet(u)) return pass(u, t, range, dt);
  if (edgeDist(u, t) <= range) { u.path = null; return true; }
  if (isAir(u)) return fly(u, t, dt);
  u.rep -= dt;
  if (!u.path || (u.rep <= 0 && (!u.path.length || !t.w))) {
    u.rep = 0.5;
    u.path = pathTo(u, t);
    if (!u.path) return null;
    // can't get there for enemy walls: break through the one in the way (combatStep aims at it)
    if (u.kind === 'unit' && !isWall((t as Ent).type ?? '') && canBreach(u)) {
      const end = u.path[u.path.length - 1] ?? [tileOf(u.x), tileOf(u.y)], g = u.goal;
      const reached = !!g && end[0] === g[0] && end[1] === g[1];
      u.breach = reached || !g ? null : wallInWay(u, g[0], g[1])?.id ?? null;
    }
  }
  if (u.path.length) {
    if (followPath(u, dt)) u.path = [];
    return false;
  }
  // No path left but still out of reach: a unit on the same or a diagonal tile, or a building whose
  // nearest free tile is a corner (too far for a sword) or that we're standing off-centre beside.
  // Step straight toward the closest point of it.
  const [gx, gy] = t.w ? closestPoint(u, t) : [t.x, t.y];
  if (Math.hypot(gx - u.x, gy - u.y) < 1) return null;
  return steer(u, gx, gy, stepOf(u, dt), dt, false) === 'blocked' ? null : false; // across a blocked corner: can't get there from here
}

/** The point on a footprint's edge closest to a unit. */
const closestPoint = (u: { x: number; y: number }, t: Target): [number, number] =>
  [clamp(u.x, t.tx * TS, (t.tx + t.w) * TS), clamp(u.y, t.ty * TS, (t.ty + t.h) * TS)];

/** Aircraft head straight for a target, turning at their own speed as they go. Never unreachable. */
function fly(u: Ent, t: Target, dt: number): false {
  u.path = null;
  if (Math.hypot(t.x - u.x, t.y - u.y) >= 1) steer(u, t.x, t.y, stepOf(u, dt), dt, true);
  return false;
}

/** How tight a circle an aircraft can fly at full speed, px. */
export const turnRadius = (u: Ent): number => (unitDef(u).spd / unitDef(u).turn) * TS;

/** Fly straight on along the current heading (a jet can't stop), banking back toward the middle at the map's edge. */
function flyOn(u: Ent, dt: number): void {
  const ax = u.x + Math.cos(u.face) * TS * 3, ay = u.y + Math.sin(u.face) * TS * 3, m = TS * 2;
  const off = ax < m || ay < m || ax > MW * TS - m || ay > MH * TS - m;
  steer(u, off ? (MW * TS) / 2 : ax, off ? (MH * TS) / 2 : ay, stepOf(u, dt), dt, true);
}

/** Longest a jet flies on out after a pass before it turns back, s. */
const RUN_OUT = 4;

/**
 * A jet's attack run: it can't hover, so it heads in at full speed, fires as it comes in range,
 * overflies the target and flies on out a few turning circles away before it loops back for
 * another pass. A target inside its turning circle would leave it circling forever, so that also
 * sends it out to come round again. Returns whether the target is in range right now.
 * `runT` > 0 while it flies out (seconds left), < 0 while it loops back round (counting up to 0:
 * no breaking off again until it faces the target or that runs out), 0 on the way in.
 */
function pass(u: Ent, t: Target, range: number, dt: number): boolean {
  u.path = null;
  const d = unitDef(u), dist = Math.hypot(t.x - u.x, t.y - u.y), r = turnRadius(u);
  const off = angleDiff(u.face, Math.atan2(t.y - u.y, t.x - u.x));
  let run = u.runT ?? 0;
  if (run > 0) {
    run -= dt;
    if (dist > r * 2.5 || run <= 0) run = -(Math.PI / d.turn + 1);
  } else if (run < 0) {
    run = off < 0.5 ? 0 : Math.min(0, run + dt);
  } else if (dist < r * 1.1 && off > 1.4) run = RUN_OUT;
  u.runT = run;
  if (run > 0) flyOn(u, dt);
  else steer(u, t.x, t.y, stepOf(u, dt), dt, true);
  return edgeDist(u, t) <= range;
}

/** A jet with nothing to do circles where it is, banking round at a steady rate. */
export function cruise(u: Ent, dt: number): void {
  u.runT = 0;
  u.face += unitDef(u).turn * 0.8 * dt;
  flyOn(u, dt);
}

/** A harvester scooping or unloading stays put; everyone else steps around it. */
const anchored = (u: Ent): boolean => u.order?.t === 'harvest' && (u.order.st === 'gather' || u.order.st === 'unload');

/** Push a unit by (dx, dy); against a wall, slide along it instead of not moving at all. */
function nudge(u: Ent, dx: number, dy: number, air: boolean): void {
  if (air || canStep(u.x, u.y, u.x + dx, u.y + dy)) { u.x += dx; u.y += dy; }
  else if (canStep(u.x, u.y, u.x + dx, u.y)) u.x += dx;
  else if (canStep(u.x, u.y, u.x, u.y + dy)) u.y += dy;
}

/** How far (px) collisions have shoved walking units about, in total: a measure of units walking into each other. */
export const shoved = { px: 0 };

/** Soft collision: overlapping units push apart; idle units yield to moving ones. */
export function separate(): void {
  const us = G.ents.filter((e) => !e.dead && e.kind === 'unit').sort((a, b) => a.x - b.x);
  const rad = us.map((u) => unitDef(u).radius * (u.kind === 'unit' && unitDef(u).cls === 'vehicle' ? VEHICLE_BODY : 1) + 2), air = us.map(isAir), maxRad = Math.max(17, ...rad);
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j];
      if (air[i] !== air[j]) continue;
      let dx = a.x - b.x;
      if (dx < -(rad[i] + maxRad)) break;
      let dy = a.y - b.y;
      // rad is the most room each could take; the room between them depends on which way each faces
      if (Math.abs(dx) >= rad[i] + rad[j] || Math.abs(dy) >= rad[i] + rad[j] || ((a.moving || b.moving) && passThrough(a, b))) continue;
      let d = Math.hypot(dx, dy);
      const min = air[i] ? rad[i] + rad[j] : bodyRadius(a, dx, dy) + bodyRadius(b, dx, dy) + 4;
      if (d >= min) continue;
      if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
      const weight = (u: Ent) => (anchored(u) ? 0.05 : u.moving ? 0.3 : 1);
      // a Queen's Bees buzz round her and everything else: they get out of the way, never shove anyone
      const bee = !!a.bee !== !!b.bee;
      const wa = bee ? (a.bee ? 1 : 0) : weight(a) / rad[i], wb = bee ? (b.bee ? 1 : 0) : weight(b) / rad[j], p = Math.min(min - d, 4);
      const sa = (p * wa) / (wa + wb), sb = (p * wb) / (wa + wb);
      const ax = (dx / d) * sa, ay = (dy / d) * sa, bx = (dx / d) * sb, by = (dy / d) * sb;
      nudge(a, ax, ay, air[i]);
      nudge(b, -bx, -by, air[j]);
      if (a.moving && !air[i]) shoved.px += sa;
      if (b.moving && !air[j]) shoved.px += sb;
    }
  }
  for (const a of us) {
    a.x = clamp(a.x, 8, MW * TS - 8);
    a.y = clamp(a.y, 8, MH * TS - 8);
  }
}
