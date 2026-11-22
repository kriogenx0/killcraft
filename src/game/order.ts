// Giving orders to units. Every order goes through setOrder so stale paths are dropped.
import { G, tileOf, type Ent, type Order, type Tile } from './state.ts';
import { MW, MH, TS, WATER } from './const.ts';
import { pathFor } from './path.ts';

export function setOrder(u: Ent, o: Order | null): void {
  u.order = o;
  u.path = null;
  u.goal = null;
  u.rep = 0;
}

export function orderMove(u: Ent, tx: number, ty: number): void {
  setOrder(u, { t: 'move' });
  u.goal = [tx, ty];
  u.path = pathFor(u, tx, ty);
}

export function orderAttack(u: Ent, t: Ent): void {
  setOrder(u, { t: 'attack', tgt: t.id, auto: false, ox: u.x, oy: u.y });
}

export function orderAMove(u: Ent, gx: number, gy: number): void {
  setOrder(u, { t: 'amove', gx, gy, sub: null });
}

export const orderStop = (u: Ent): void => setOrder(u, null);

/** Harvest starting at a tile (or the nearest ore to it). */
export function orderHarvest(u: Ent, tx: number, ty: number): void {
  setOrder(u, { t: 'harvest', st: 'go', tx, ty, wait: 0 });
}

/** Take the current load to a refinery, then carry on harvesting. */
export function orderReturn(u: Ent): void {
  setOrder(u, { t: 'harvest', st: 'ret', tx: tileOf(u.x), ty: tileOf(u.y), wait: 0 });
}

/** Move (or attack-move) a group, giving each unit its own free tile around the goal. */
export function groupMove(us: Ent[], gx: number, gy: number, amove = false): void {
  const n = us.length;
  if (!n) return;
  const send = (u: Ent, t: Tile) => (amove ? orderAMove(u, t[0], t[1]) : orderMove(u, t[0], t[1]));
  if (n === 1) { send(us[0], [gx, gy]); return; }
  const tiles: Tile[] = [], seen = new Set<number>([gy * MW + gx]), q: Tile[] = [[gx, gy]];
  while (q.length && tiles.length < n) {
    const [x, y] = q.shift() as Tile;
    if (!G.blk[y * MW + x]) tiles.push([x, y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy, k = ny * MW + nx;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || seen.has(k) || G.terr[k] === WATER) continue;
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
