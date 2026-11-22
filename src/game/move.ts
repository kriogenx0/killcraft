// Walking along paths, approaching targets, and keeping units from stacking on each other.
import { G, blkAt, isAir, tileOf, unitDef, type Ent, type Target } from './state.ts';
import { MW, MH, TS, SHALLOW } from './const.ts';
import { SHALLOW_SPEED } from '../data/map.ts';
import { clamp } from '../util/math.ts';
import { edgeDist, isJump, los, pathFor, pathTo } from './path.ts';
import { warpFx } from './fx.ts';
import { slowFactor } from './aether.ts';

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
  let nx = u.x + (dx / dist) * step, ny = u.y + (dy / dist) * step;
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
const stepOf = (u: Ent, dt: number): number => unitDef(u).spd * slowFactor(u) * terrainSpeed(u) * TS * dt;

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
  if (!air && G.blk[wp[1] * MW + wp[0]]) return repath();
  // A crowd can't all stand on a waypoint's centre: near enough to one on the way counts as passing
  // it, as long as the next one is in a clear straight line (and neither is a portal gate).
  const after = u.path[1];
  if (after && !air && Math.hypot((wp[0] + 0.5) * TS - u.x, (wp[1] + 0.5) * TS - u.y) < TS * 0.5 && !isJump(wp, after)
    && G.warp[wp[1] * MW + wp[0]] < 0 && G.warp[after[1] * MW + after[0]] < 0 && los(u.x, u.y, (after[0] + 0.5) * TS, (after[1] + 0.5) * TS)) {
    u.path.shift();
    return false;
  }
  const r = steer(u, (wp[0] + 0.5) * TS, (wp[1] + 0.5) * TS, stepOf(u, dt), dt, air);
  if (r === 'blocked') return repath(); // something was built in the way
  if (r === 'moving') return false;
  u.path.shift();
  const next = u.path[0];
  if (next && isJump(wp, next) && G.warp[wp[1] * MW + wp[0]] === next[1] * MW + next[0]) {
    // step through the portal
    warpFx(u.x, u.y);
    u.x = u.px = (next[0] + 0.5) * TS; u.y = u.py = (next[1] + 0.5) * TS;
    warpFx(u.x, u.y);
    u.path.shift();
  }
  return !u.path.length;
}

/** Walk toward a target until within range. true = in range, false = still walking, null = unreachable. */
export function approach(u: Ent, t: Target, range: number, dt: number): boolean | null {
  if (edgeDist(u, t) <= range) { u.path = null; return true; }
  if (isAir(u)) return fly(u, t, dt);
  u.rep -= dt;
  if (!u.path || (u.rep <= 0 && (!u.path.length || !t.w))) {
    u.rep = 0.5;
    u.path = pathTo(u, t);
    if (!u.path) return null;
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

/** A harvester scooping or unloading stays put; everyone else steps around it. */
const anchored = (u: Ent): boolean => u.order?.t === 'harvest' && (u.order.st === 'gather' || u.order.st === 'unload');

/** Push a unit by (dx, dy); against a wall, slide along it instead of not moving at all. */
function nudge(u: Ent, dx: number, dy: number, air: boolean): void {
  if (air || canStep(u.x, u.y, u.x + dx, u.y + dy)) { u.x += dx; u.y += dy; }
  else if (canStep(u.x, u.y, u.x + dx, u.y)) u.x += dx;
  else if (canStep(u.x, u.y, u.x, u.y + dy)) u.y += dy;
}

/** Soft collision: overlapping units push apart; idle units yield to moving ones. */
export function separate(): void {
  const us = G.ents.filter((e) => !e.dead && e.kind === 'unit').sort((a, b) => a.x - b.x);
  const rad = us.map((u) => unitDef(u).radius + 2), air = us.map(isAir);
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j], min = rad[i] + rad[j];
      if (air[i] !== air[j]) continue;
      let dx = a.x - b.x;
      if (dx < -34) break;
      let dy = a.y - b.y;
      if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
      const weight = (u: Ent) => (anchored(u) ? 0.05 : u.moving ? 0.3 : 1);
      const wa = weight(a) / rad[i], wb = weight(b) / rad[j], p = Math.min(min - d, 4);
      const sa = (p * wa) / (wa + wb), sb = (p * wb) / (wa + wb);
      const ax = (dx / d) * sa, ay = (dy / d) * sa, bx = (dx / d) * sb, by = (dy / d) * sb;
      nudge(a, ax, ay, air[i]);
      nudge(b, -bx, -by, air[j]);
    }
  }
  for (const a of us) {
    a.x = clamp(a.x, 8, MW * TS - 8);
    a.y = clamp(a.y, 8, MH * TS - 8);
  }
}
