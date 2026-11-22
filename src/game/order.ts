// Giving orders to units. Every order goes through setOrder so stale paths are dropped.
import { G, tileOf, type Ent, type Order, type Stance, type Tile } from './state.ts';
import { MW, MH, TS, walkable } from './const.ts';
import { clamp } from '../util/math.ts';
import { nearestFree, pathFor } from './path.ts';

/** How far (tiles) a passive unit runs from a threat. */
const FLEE_DIST = 6;

export function setOrder(u: Ent, o: Order | null): void {
  u.order = o;
  u.path = null;
  u.goal = null;
  u.rep = 0;
}

export function orderMove(u: Ent, tx: number, ty: number): void {
  setOrder(u, { t: 'move', gx: tx, gy: ty, sub: null });
  u.goal = [tx, ty];
  u.path = pathFor(u, tx, ty);
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
  u.stance = stance;
  u.shot = null;
  if (stance !== 'engage' && u.order?.t === 'attack') orderStop(u);
  if (u.order?.t === 'move' && u.order.sub) { u.order.sub = null; u.path = null; }
}

/** Harvest starting at a tile (or the nearest ore to it). */
export function orderHarvest(u: Ent, tx: number, ty: number): void {
  setOrder(u, { t: 'harvest', st: 'go', tx, ty, wait: 0 });
}

/** Haul wood from a Lumber Mill or oil from an Oil Derrick back to base, over and over. */
export function orderHaul(u: Ent, src: Ent): void {
  setOrder(u, { t: 'harvest', st: 'go', tx: src.tx, ty: src.ty, wait: 0, res: src.type === 'mill' ? 'wood' : 'oil', src: src.id });
}

/** Take the current load to a refinery, then carry on harvesting. */
export function orderReturn(u: Ent): void {
  setOrder(u, { t: 'harvest', st: 'ret', tx: tileOf(u.x), ty: tileOf(u.y), wait: 0 });
}

/** Move a group, giving each unit its own free tile around the goal. */
export function groupMove(us: Ent[], gx: number, gy: number): void {
  const n = us.length;
  if (!n) return;
  const send = (u: Ent, t: Tile) => orderMove(u, t[0], t[1]);
  if (n === 1) { send(us[0], [gx, gy]); return; }
  const tiles: Tile[] = [], seen = new Set<number>([gy * MW + gx]), q: Tile[] = [[gx, gy]];
  while (q.length && tiles.length < n) {
    const [x, y] = q.shift() as Tile;
    if (!G.blk[y * MW + x]) tiles.push([x, y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy, k = ny * MW + nx;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || seen.has(k) || !walkable(G.terr[k])) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  // keep the group's shape: sort units and slots along the axis across the direction of travel
  const cx = us.reduce((s, u) => s + u.x, 0) / n, cy = us.reduce((s, u) => s + u.y, 0) / n;
  const ax = gx * TS - cx, ay = gy * TS - cy, al = Math.hypot(ax, ay) || 1, px = -ay / al, py = ax / al;
  const su = [...us].sort((a, b) => a.x * px + a.y * py - (b.x * px + b.y * py));
  const st = [...tiles].sort((a, b) => a[0] * px + a[1] * py - (b[0] * px + b[1] * py));
  su.forEach((u, i) => send(u, st[i] ?? st[st.length - 1] ?? [gx, gy]));
}
