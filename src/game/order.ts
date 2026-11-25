// Giving orders to units. Every order goes through setOrder so stale paths are dropped.
import { G, tileOf, unitDef, type Ent, type Order, type Stance, type Tile } from './state.ts';
import { MW, MH, TS, walkable } from './const.ts';
import { clamp } from '../util/math.ts';
import { nearestFree, pathFor } from './path.ts';

/** How far (tiles) a passive unit runs from a threat. */
const FLEE_DIST = 6;

export function setOrder(u: Ent, o: Order | null): void {
  u.order = o;
  u.breach = null;
  u.path = null;
  u.goal = null;
  u.rep = 0;
}

export function orderMove(u: Ent, tx: number, ty: number): void {
  setOrder(u, { t: 'move', gx: tx, gy: ty, sub: null });
  u.goal = [tx, ty];
  u.path = pathFor(u, tx, ty);
}

/**
 * A move finished. A patrolling unit turns around and heads for the other end of its beat;
 * anyone else stops. Returns true if the order is over.
 */
export function arrive(u: Ent): boolean {
  const o = u.order;
  u.path = null;
  if (o?.t === 'move' && o.pat) {
    const back = o.pat;
    o.pat = [o.gx, o.gy];
    [o.gx, o.gy] = back;
    o.sub = null;
    u.goal = [o.gx, o.gy];
    u.path = pathFor(u, o.gx, o.gy);
    return false;
  }
  u.order = null;
  return true;
}

export function orderAttack(u: Ent, t: Ent): void {
  setOrder(u, { t: 'attack', tgt: t.id, auto: false, ox: u.x, oy: u.y });
}

/** Run directly away from a threat. */
export function orderFlee(u: Ent, from: { x: number; y: number }): void {
  const dx = u.x - from.x, dy = u.y - from.y, d = Math.hypot(dx, dy) || 1;
  const gx = clamp(Math.round(tileOf(u.x) + (dx / d) * FLEE_DIST), 0, MW - 1), gy = clamp(Math.round(tileOf(u.y) + (dy / d) * FLEE_DIST), 0, MH - 1);
  const t: Tile | null = G.blk[gy * MW + gx] ? nearestFree(gx, gy, 4) : [gx, gy];
  if (t) orderMove(u, t[0], t[1]);
}

export const orderStop = (u: Ent): void => setOrder(u, null);

/** Change how a unit fights. A unit that stops attacking drops the fight it was in. */
export function setStance(u: Ent, stance: Stance): void {
  if (stance === 'tend' && u.type !== 'worker') return; // only Workers fix things
  u.stance = stance;
  u.shot = null;
  if (stance !== 'engage' && u.order?.t === 'attack') orderStop(u);
  if (u.order?.t === 'move' && u.order.sub) { u.order.sub = null; u.path = null; }
}

/** Harvest starting at a tile (or the nearest ore to it). */
export function orderHarvest(u: Ent, tx: number, ty: number): void {
  setOrder(u, { t: 'harvest', st: 'go', tx, ty, wait: 0 });
}

/** Chop wood in a Lumber Mill's woods (Workers only), or haul oil from an Oil Derrick back to base, over and over. */
export function orderHaul(u: Ent, src: Ent): void {
  if (src.type === 'mill' && u.type !== 'worker') return;
  setOrder(u, { t: 'harvest', st: 'go', tx: src.tx, ty: src.ty, wait: 0, res: src.type === 'mill' ? 'wood' : 'oil', src: src.id });
}

/** Chop a tree (or the nearest one with wood) and carry the wood home, over and over. Workers only. */
export function orderChop(u: Ent, tx: number, ty: number): void {
  if (u.type !== 'worker') return;
  setOrder(u, { t: 'harvest', st: 'go', tx, ty, wait: 0, res: 'wood' });
}

/** Send a Worker to mend an ally or building (a site: help build it). */
export function orderFix(u: Ent, t: Ent): void {
  setOrder(u, { t: 'heal', tgt: t.id, ox: u.x, oy: u.y, sent: true });
}

/** Take the current load to a refinery, then carry on harvesting. */
export function orderReturn(u: Ent): void {
  setOrder(u, { t: 'harvest', st: 'ret', tx: tileOf(u.x), ty: tileOf(u.y), wait: 0 });
}

/**
 * Move a group, giving each unit its own free tile around the goal. In formation (`form`) each unit
 * keeps its place in the group (squeezed in if the group is spread wide) and nobody walks faster
 * than the slowest of them, so they arrive together and in shape.
 */
export function groupMove(us: Ent[], gx: number, gy: number, patrol = false, form = false): void {
  const n = us.length;
  if (!n) return;
  const pace = form && n > 1 ? Math.min(...us.map((u) => unitDef(u).spd)) : undefined;
  const send = (u: Ent, t: Tile) => {
    const from: Tile = [tileOf(u.x), tileOf(u.y)];
    orderMove(u, t[0], t[1]);
    if (u.order?.t !== 'move') return;
    if (patrol) u.order.pat = from;
    if (pace) u.order.pace = pace;
  };
  if (n === 1) { send(us[0], [gx, gy]); return; }
  const tiles: Tile[] = [], seen = new Set<number>([gy * MW + gx]), q: Tile[] = [[gx, gy]];
  while (q.length && tiles.length < n * (form ? 3 : 1)) {
    const [x, y] = q.shift() as Tile;
    if (!G.blk[y * MW + x]) tiles.push([x, y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy, k = ny * MW + nx;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || seen.has(k) || !walkable(G.terr[k])) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  const cx = us.reduce((s, u) => s + u.x, 0) / n, cy = us.reduce((s, u) => s + u.y, 0) / n;
  if (form) { formationSlots(us, gx, gy, cx, cy, tiles).forEach((t, i) => send(us[i], t)); return; }
  // keep the group's shape: sort units and slots along the axis across the direction of travel
  const ax = gx * TS - cx, ay = gy * TS - cy, al = Math.hypot(ax, ay) || 1, px = -ay / al, py = ax / al;
  const su = [...us].sort((a, b) => a.x * px + a.y * py - (b.x * px + b.y * py));
  const st = [...tiles].sort((a, b) => a[0] * px + a[1] * py - (b[0] * px + b[1] * py));
  su.forEach((u, i) => send(u, st[i] ?? st[st.length - 1] ?? [gx, gy]));
}

/**
 * Each unit's tile in formation: where it stands relative to the group's middle, moved to the goal.
 * A group spread wider than a tidy block is drawn in toward its middle; a spot that's blocked, water
 * or already taken goes to the nearest free tile around the goal (`free`) instead.
 */
function formationSlots(us: Ent[], gx: number, gy: number, cx: number, cy: number, free: Tile[]): Tile[] {
  const off = us.map((u) => [(u.x - cx) / TS, (u.y - cy) / TS]);
  const reach = Math.max(...off.map(([x, y]) => Math.hypot(x, y))), tidy = Math.max(1.5, Math.sqrt(us.length) * 0.9);
  const k = reach > tidy ? tidy / reach : 1;
  const taken = new Set<number>(), slots: Tile[] = [];
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < MW && y < MH && !G.blk[y * MW + x] && walkable(G.terr[y * MW + x]) && !taken.has(y * MW + x);
  for (const [ox, oy] of off) {
    let t: Tile = [Math.round(gx + ox * k), Math.round(gy + oy * k)];
    if (!open(t[0], t[1])) {
      let best: Tile | null = null, bd = Infinity;
      for (const f of free) {
        const d = Math.hypot(f[0] - t[0], f[1] - t[1]);
        if (d < bd && open(f[0], f[1])) { bd = d; best = f; }
      }
      t = best ?? [gx, gy];
    }
    taken.add(t[1] * MW + t[0]);
    slots.push(t);
  }
  return slots;
}
