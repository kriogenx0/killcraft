// Walking along paths, approaching targets, and keeping units from stacking on each other.
import { G, blkAt, isAir, unitDef, type Ent, type Target } from './state.ts';
import { MW, MH, TS } from './const.ts';
import { clamp } from '../util/math.ts';
import { edgeDist, isJump, pathFor, pathTo } from './path.ts';
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

/** Facing more than this far off its heading, a unit stops and turns on the spot before moving on. */
const PIVOT = 1.3;

/**
 * Turn toward a point at the unit's own turn speed and move straight at it, at most `max` px.
 * A ground unit facing well away turns on the spot first, and slows down while it is still turning;
 * aircraft fly on while they turn and are never blocked. Returns 'arrived' when it reached the point this step,
 * 'blocked' when the way is shut, else 'moving'.
 */
export function steer(u: Ent, tx: number, ty: number, max: number, dt: number, air: boolean): 'arrived' | 'moving' | 'blocked' {
  const dx = tx - u.x, dy = ty - u.y, dist = Math.hypot(dx, dy);
  u.moving = true;
  if (dist > 0.01) u.face = turnToward(u.face, Math.atan2(dy, dx), unitDef(u).turn * dt);
  let off = dist > 0.01 ? angleDiff(u.face, Math.atan2(dy, dx)) : 0;
  if (air) off = 0; // aircraft keep flying straight on while they swing round
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
  const nx = u.x + (dx / dist) * step, ny = u.y + (dy / dist) * step;
  if (!air && blkAt(nx, ny) && !blkAt(u.x, u.y)) return 'blocked';
  u.x = nx; u.y = ny;
  return 'moving';
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
  if (!air && G.blk[wp[1] * MW + wp[0]]) return repath();
  const d = unitDef(u), tx = (wp[0] + 0.5) * TS, ty = (wp[1] + 0.5) * TS;
  const r = steer(u, tx, ty, d.spd * slowFactor(u) * TS * dt, dt, air);
  if (r === 'blocked') return repath(); // something was built in the way
  if (r === 'arrived') {
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
  return false;
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
  // no path left but still out of reach (a unit target on the same or a diagonal tile): step straight in
  if (t.w) return false;
  if (Math.hypot(t.x - u.x, t.y - u.y) < 1) return null;
  return steer(u, t.x, t.y, unitDef(u).spd * slowFactor(u) * TS * dt, dt, false) === 'blocked' ? null : false; // across a blocked corner: can't get there from here
}

/** Aircraft head straight for a target, turning at their own speed. Never unreachable. */
function fly(u: Ent, t: Target, dt: number): false {
  u.path = null;
  if (Math.hypot(t.x - u.x, t.y - u.y) < 1) return false;
  steer(u, t.x, t.y, unitDef(u).spd * slowFactor(u) * TS * dt, dt, true);
  return false;
}

/** A harvester scooping or unloading stays put; everyone else steps around it. */
const anchored = (u: Ent): boolean => u.order?.t === 'harvest' && (u.order.st === 'gather' || u.order.st === 'unload');

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
      if (air[i] || !blkAt(a.x + ax, a.y + ay)) { a.x += ax; a.y += ay; }
      if (air[j] || !blkAt(b.x - bx, b.y - by)) { b.x -= bx; b.y -= by; }
    }
  }
  for (const a of us) {
    a.x = clamp(a.x, 8, MW * TS - 8);
    a.y = clamp(a.y, 8, MH * TS - 8);
  }
}
