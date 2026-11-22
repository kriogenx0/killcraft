// Walking along paths, approaching targets, and keeping units from stacking on each other.
import { G, blkAt, isAir, unitDef, type Ent, type Target } from './state.ts';
import { MW, MH, TS } from './const.ts';
import { clamp } from '../util/math.ts';
import { edgeDist, pathFor, pathTo } from './path.ts';

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
  const d = unitDef(u), tx = (wp[0] + 0.5) * TS, ty = (wp[1] + 0.5) * TS, dx = tx - u.x, dy = ty - u.y;
  const dist = Math.hypot(dx, dy), want = Math.atan2(dy, dx);
  u.moving = true;
  if (d.cls === 'vehicle') {
    // vehicles turn on the spot before driving off
    u.face = turnToward(u.face, want, 7 * dt);
    if (angleDiff(u.face, want) > 1.3) return false;
  } else if (air) u.face = turnToward(u.face, want, 6 * dt); // aircraft bank around without stopping
  else u.face = want;
  // vehicles slow down while still turning
  const step = d.spd * TS * dt * (d.cls === 'vehicle' ? Math.max(0.35, Math.cos(angleDiff(u.face, want))) : 1);
  u.walk += step / 24;
  if (dist <= step) {
    u.x = tx; u.y = ty;
    u.path.shift();
    return !u.path.length;
  }
  const nx = u.x + (dx / dist) * step, ny = u.y + (dy / dist) * step;
  if (!air && blkAt(nx, ny) && !blkAt(u.x, u.y)) return repath(); // something was built in the way
  u.x = nx; u.y = ny;
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
  const d = Math.hypot(t.x - u.x, t.y - u.y), step = Math.min(d, unitDef(u).spd * TS * dt);
  const nx = u.x + ((t.x - u.x) / d) * step, ny = u.y + ((t.y - u.y) / d) * step;
  if (d < 1 || blkAt(nx, ny)) return null; // across a blocked corner: can't get there from here
  u.x = nx; u.y = ny; u.face = Math.atan2(t.y - u.y, t.x - u.x); u.moving = true;
  return false;
}

/** Aircraft head straight for a target, turning as they go. Never unreachable. */
function fly(u: Ent, t: Target, dt: number): false {
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  u.path = null;
  if (d < 1) return false;
  u.face = turnToward(u.face, Math.atan2(t.y - u.y, t.x - u.x), 6 * dt);
  const step = Math.min(d, unitDef(u).spd * TS * dt);
  u.x += ((t.x - u.x) / d) * step; u.y += ((t.y - u.y) / d) * step;
  u.moving = true;
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
