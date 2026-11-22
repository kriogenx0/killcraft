// A* on the tile grid (portals count as a one-step link between their two gates), then
// string-pulled so units walk straight lines.
import { G, blkAt, tileOf, type Ent, type Target, type Tile } from './state.ts';
import { MW, MH, TS } from './const.ts';
import { clamp } from '../util/math.ts';

export const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Path cost of stepping through a portal, in tiles. */
export const PORTAL_COST = 1;

const gScore = new Float32Array(MW * MH);
const cameFrom = new Int32Array(MW * MH);
const openStamp = new Int32Array(MW * MH);
const closedStamp = new Int32Array(MW * MH);
let stamp = 0;

/** Closest unblocked tile in growing square rings around (gx, gy). */
export function nearestFree(gx: number, gy: number, maxr = 12): Tile | null {
  for (let r = 1; r <= maxr; r++) {
    let best: Tile | null = null, bd = 1e9;
    for (let y = gy - r; y <= gy + r; y++)
      for (let x = gx - r; x <= gx + r; x++) {
        if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) !== r || x < 0 || y < 0 || x >= MW || y >= MH || G.blk[y * MW + x]) continue;
        const d = Math.hypot(x - gx, y - gy);
        if (d < bd) { bd = d; best = [x, y]; }
      }
    if (best) return best;
  }
  return null;
}

/** Tile path (excluding the start). If the goal can't be reached, ends at the closest reachable tile. */
export function findPath(sx: number, sy: number, gx: number, gy: number): Tile[] {
  sx = clamp(sx, 0, MW - 1); sy = clamp(sy, 0, MH - 1); gx = clamp(gx, 0, MW - 1); gy = clamp(gy, 0, MH - 1);
  if (G.blk[gy * MW + gx]) {
    const f = nearestFree(gx, gy);
    if (!f) return [];
    [gx, gy] = f;
  }
  if (sx === gx && sy === gy) return [];
  stamp++;
  const hf: number[] = [], hi: number[] = [];
  const push = (i: number, f: number) => {
    let k = hf.length;
    hf.push(f); hi.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      hf[k] = hf[p]; hi[k] = hi[p]; k = p;
    }
    hf[k] = f; hi[k] = i;
  };
  const pop = () => {
    const top = hi[0], lf = hf.pop() as number, li = hi.pop() as number, n = hf.length;
    if (n) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        hf[k] = hf[c]; hi[k] = hi[c]; k = c;
      }
      hf[k] = lf; hi[k] = li;
    }
    return top;
  };
  const oct = (x: number, y: number, tx: number, ty: number) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  // With portals the straight-line estimate can overshoot, so also consider "walk to a gate,
  // step through, then the best estimate from its exit" (settled over chains of gates).
  const gates: { x: number; y: number; rest: number }[] = [];
  for (const p of G.portals)
    for (const [[x, y], [ex, ey]] of [[p.a, p.b], [p.b, p.a]] as const) gates.push({ x, y, rest: PORTAL_COST + oct(ex, ey, gx, gy) });
  for (let k = 0; k < gates.length; k++)
    for (const g of gates) {
      const exit = G.warp[g.y * MW + g.x], ex = exit % MW, ey = (exit / MW) | 0;
      for (const h of gates) g.rest = Math.min(g.rest, PORTAL_COST + oct(ex, ey, h.x, h.y) + h.rest);
    }
  const H = (x: number, y: number) => {
    let h = oct(x, y, gx, gy);
    for (const g of gates) h = Math.min(h, oct(x, y, g.x, g.y) + g.rest);
    return h;
  };
  const si = sy * MW + sx, gi = gy * MW + gx, blk = G.blk;
  openStamp[si] = stamp; gScore[si] = 0; cameFrom[si] = -1; push(si, H(sx, sy));
  let best = si, bh = H(sx, sy);
  while (hf.length) {
    const i = pop();
    if (closedStamp[i] === stamp) continue;
    closedStamp[i] = stamp;
    if (i === gi) { best = i; break; }
    const x = i % MW, y = (i / MW) | 0, hh = H(x, y);
    if (hh < bh) { bh = hh; best = i; }
    for (const [dx, dy, c] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const ni = ny * MW + nx;
      if (blk[ni] || closedStamp[ni] === stamp) continue;
      if (dx && dy && (blk[y * MW + nx] || blk[ny * MW + x])) continue; // no corner cutting
      const ng = gScore[i] + c;
      if (openStamp[ni] !== stamp || ng < gScore[ni]) {
        openStamp[ni] = stamp; gScore[ni] = ng; cameFrom[ni] = i; push(ni, ng + H(nx, ny));
      }
    }
    const wi = G.warp[i];
    if (wi >= 0 && !blk[wi] && closedStamp[wi] !== stamp) {
      const ng = gScore[i] + PORTAL_COST;
      if (openStamp[wi] !== stamp || ng < gScore[wi]) {
        openStamp[wi] = stamp; gScore[wi] = ng; cameFrom[wi] = i; push(wi, ng + H(wi % MW, (wi / MW) | 0));
      }
    }
  }
  const path: Tile[] = [];
  for (let c = best; c !== si && c !== -1; c = cameFrom[c]) path.push([c % MW, (c / MW) | 0]);
  return path.reverse();
}

/** Can a unit (7px half-width) walk straight from one point to another? */
export function los(x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const n = Math.ceil(d / 6), px = (-dy / d) * 7, py = (dx / d) * 7;
  for (let i = 1; i <= n; i++) {
    const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
    if (blkAt(x, y) || blkAt(x + px, y + py) || blkAt(x - px, y - py)) return false;
  }
  return true;
}

const center = (t: Tile): [number, number] => [(t[0] + 0.5) * TS, (t[1] + 0.5) * TS];

/** Consecutive path tiles that aren't neighbours: a step through a portal. */
export const isJump = (a: Tile, b: Tile): boolean => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) > 1;

/** Drop waypoints that can be skipped with a straight walk. Portal entrances and exits are always kept. */
export function smoothPath(sx: number, sy: number, path: Tile[]): Tile[] {
  if (!path.length) return path;
  const out: Tile[] = [];
  let [cx, cy] = [sx, sy];
  const here: Tile = [tileOf(sx), tileOf(sy)];
  let i = 0;
  if (isJump(here, path[0])) {
    // standing on a gate: walk onto its centre, then out of the other one
    out.push(here, path[0]);
    [cx, cy] = center(path[0]);
    i = 1;
  } else if (!los(cx, cy, ...center(path[0]))) {
    out.push(here);
    [cx, cy] = center(here);
  }
  while (i < path.length) {
    let end = i; // last tile before the next portal jump
    while (end + 1 < path.length && !isJump(path[end], path[end + 1])) end++;
    let j = Math.min(end, i + 12);
    while (j > i && !los(cx, cy, ...center(path[j]))) j--;
    out.push(path[j]);
    [cx, cy] = center(path[j]);
    i = j + 1;
    if (j === end && i < path.length) {
      // through the portal: carry on from the exit gate
      out.push(path[i]);
      [cx, cy] = center(path[i]);
      i++;
    }
  }
  return out;
}

export function pathFor(u: Ent, gx: number, gy: number): Tile[] {
  return smoothPath(u.x, u.y, findPath(tileOf(u.x), tileOf(u.y), gx, gy));
}

/** A free tile touching a footprint, nearest to the unit (with jitter so crowds spread out). */
export function adjTile(t: Target, u: { x: number; y: number }, jitter = true): Tile | null {
  let best: Tile | null = null, bd = 1e9;
  for (let y = t.ty - 1; y <= t.ty + t.h; y++)
    for (let x = t.tx - 1; x <= t.tx + t.w; x++) {
      if (x >= t.tx && x < t.tx + t.w && y >= t.ty && y < t.ty + t.h) continue;
      if (x < 0 || y < 0 || x >= MW || y >= MH || G.blk[y * MW + x]) continue;
      const d = Math.hypot((x + 0.5) * TS - u.x, (y + 0.5) * TS - u.y) + (jitter ? Math.random() * 30 : 0);
      if (d < bd) { bd = d; best = [x, y]; }
    }
  return best;
}

/** Path toward a target, or null if nothing next to it is walkable. Sets the unit's goal. */
export function pathTo(u: Ent, t: Target): Tile[] | null {
  const g: Tile | null = t.w ? adjTile(t, u) : [tileOf(t.x), tileOf(t.y)];
  if (!g) return null;
  u.goal = g;
  return pathFor(u, g[0], g[1]);
}

/** Distance from a point to a target's edge (footprint edge, or a unit's 10px body). */
export function edgeDist(a: { x: number; y: number }, t: Target): number {
  if (t.w) {
    const l = t.tx * TS, r = l + t.w * TS, tp = t.ty * TS, b = tp + t.h * TS;
    return Math.hypot(a.x - clamp(a.x, l, r), a.y - clamp(a.y, tp, b));
  }
  return Math.hypot(a.x - t.x, a.y - t.y) - 10;
}
