// A* on the tile grid (portals count as a one-step link between their two gates), then
// string-pulled so units walk straight lines.
import { G, blkAt, isAir, tileOf, type Ent, type Target, type Tile } from './state.ts';
import { MW, MH, TS, SHALLOW } from './const.ts';
import { SHALLOW_SPEED } from '../data/map.ts';
import { clamp } from '../util/math.ts';
import { UNIT, type UnitType } from '../data/unit.ts';

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

/** Did the last findPath get all the way to its goal (or the free tile standing in for a blocked one)? */
export let pathReached = true;

// the open list: a binary heap of (f, tile), kept between searches so none allocates
let heapF = new Float64Array(1 << 15), heapI = new Int32Array(1 << 15), heapN = 0;
function heapPush(i: number, f: number): void {
  if (heapN === heapF.length) {
    const f2 = new Float64Array(heapN * 2), i2 = new Int32Array(heapN * 2);
    f2.set(heapF); i2.set(heapI);
    heapF = f2; heapI = i2;
  }
  let k = heapN++;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (heapF[p] <= f) break;
    heapF[k] = heapF[p]; heapI[k] = heapI[p]; k = p;
  }
  heapF[k] = f; heapI[k] = i;
}
function heapPop(): number {
  const top = heapI[0], n = --heapN, lf = heapF[n], li = heapI[n];
  if (n) {
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heapF[k] = heapF[c]; heapI[k] = heapI[c]; k = c;
    }
    heapF[k] = lf; heapI[k] = li;
  }
  return top;
}

// the eight steps, in DIRS order
const STEP_X = DIRS.map((d) => d[0]), STEP_Y = DIRS.map((d) => d[1]), STEP_COST = DIRS.map((d) => d[2]);

const oct = (x: number, y: number, tx: number, ty: number): number => {
  const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
};

/** The last search that found no way to its goal: having closed every tile it could reach, it says what else can't be reached. */
let lastFail = { sx: -1, sy: -1, team: -2, stamp: -1, map: 0 };

/** A fingerprint of what decides where units can walk: blocked tiles and portal links. */
function mapPrint(): number {
  let h = 2166136261;
  for (const a of [G.blk, G.warp, G.warpTeam]) {
    const w = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 16777619);
  }
  return h;
}

/**
 * Tile path (excluding the start). If the goal can't be reached, ends at the closest reachable tile.
 * `team` may also step through its own Waygates; map portals are open to everyone.
 */
export function findPath(sx: number, sy: number, gx: number, gy: number, team = -1): Tile[] {
  sx = clamp(sx, 0, MW - 1); sy = clamp(sy, 0, MH - 1); gx = clamp(gx, 0, MW - 1); gy = clamp(gy, 0, MH - 1);
  pathReached = false;
  if (G.blk[gy * MW + gx]) {
    const f = nearestFree(gx, gy);
    if (!f) return [];
    [gx, gy] = f;
  }
  pathReached = sx === gx && sy === gy;
  if (pathReached) return [];
  stamp++;
  heapN = 0;
  // With portals the straight-line estimate can overshoot, so also consider "walk to a gate,
  // step through, then the best estimate from its exit" (settled over chains of gates).
  const gates: { x: number; y: number; rest: number }[] = [];
  for (const p of G.portals) for (const [[x, y], [ex, ey]] of [[p.a, p.b], [p.b, p.a]] as const) gates.push({ x, y, rest: PORTAL_COST + oct(ex, ey, gx, gy) });
  for (const p of G.waygates) if (p.team === team) for (const [[x, y], [ex, ey]] of [[p.a, p.b], [p.b, p.a]] as const) gates.push({ x, y, rest: PORTAL_COST + oct(ex, ey, gx, gy) });
  for (let k = 0; k < gates.length; k++)
    for (const g of gates) {
      const exit = G.warp[g.y * MW + g.x], ex = exit % MW, ey = (exit / MW) | 0;
      for (const h of gates) g.rest = Math.min(g.rest, PORTAL_COST + oct(ex, ey, h.x, h.y) + h.rest);
    }
  const H = gates.length
    ? (x: number, y: number) => {
      let h = oct(x, y, gx, gy);
      for (const g of gates) h = Math.min(h, oct(x, y, g.x, g.y) + g.rest);
      return h;
    }
    : (x: number, y: number) => oct(x, y, gx, gy);
  const si = sy * MW + sx, gi = gy * MW + gx, blk = G.blk, terr = G.terr, warp = G.warp, warpTeam = G.warpTeam;
  openStamp[si] = stamp; gScore[si] = 0; cameFrom[si] = -1; heapPush(si, H(sx, sy));
  let best = si, bh = H(sx, sy);
  while (heapN) {
    const i = heapPop();
    if (closedStamp[i] === stamp) continue;
    closedStamp[i] = stamp;
    if (i === gi) { best = i; break; }
    const x = i % MW, y = (i / MW) | 0, hh = H(x, y);
    if (hh < bh) { bh = hh; best = i; }
    for (let d = 0; d < 8; d++) {
      const dx = STEP_X[d], dy = STEP_Y[d], nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const ni = ny * MW + nx;
      if (blk[ni] || closedStamp[ni] === stamp) continue;
      if (dx && dy && (blk[y * MW + nx] || blk[ny * MW + x])) continue; // no corner cutting
      const c = STEP_COST[d], ng = gScore[i] + (terr[ni] === SHALLOW ? c / SHALLOW_SPEED : c); // wading is slow
      if (openStamp[ni] !== stamp || ng < gScore[ni]) {
        openStamp[ni] = stamp; gScore[ni] = ng; cameFrom[ni] = i; heapPush(ni, ng + H(nx, ny));
      }
    }
    const wi = warp[i];
    if (wi >= 0 && !blk[wi] && closedStamp[wi] !== stamp && (warpTeam[i] < 0 || warpTeam[i] === team)) {
      const ng = gScore[i] + PORTAL_COST;
      if (openStamp[wi] !== stamp || ng < gScore[wi]) {
        openStamp[wi] = stamp; gScore[wi] = ng; cameFrom[wi] = i; heapPush(wi, ng + H(wi % MW, (wi / MW) | 0));
      }
    }
  }
  pathReached = best === gi;
  lastFail = pathReached ? { sx: -1, sy: -1, team: -2, stamp: -1, map: 0 } : { sx, sy, team, stamp, map: mapPrint() };
  const path: Tile[] = [];
  for (let c = best; c !== si && c !== -1; c = cameFrom[c]) path.push([c % MW, (c / MW) | 0]);
  return path.reverse();
}

/**
 * Sure to fail: the last search started from this tile for this team, found no way to its goal,
 * and so closed every tile it could reach, and this goal (a free tile) wasn't one of them. Checked
 * against a fingerprint of the map, so nothing built or knocked down since makes it wrong.
 */
export function knownUnreachable(sx: number, sy: number, gx: number, gy: number, team: number): boolean {
  if (lastFail.stamp !== stamp || lastFail.sx !== sx || lastFail.sy !== sy || lastFail.team !== team) return false;
  if (gx < 0 || gy < 0 || gx >= MW || gy >= MH) return false;
  const gi = gy * MW + gx;
  return !G.blk[gi] && closedStamp[gi] !== stamp && lastFail.map === mapPrint();
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

/** How many shallow-water tiles a straight walk crosses. */
function wadeTiles(x0: number, y0: number, x1: number, y1: number): number {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
  let count = 0, last = -1;
  for (let k = 0; k <= n; k++) {
    const i = tileOf(y0 + ((y1 - y0) * k) / Math.max(1, n)) * MW + tileOf(x0 + ((x1 - x0) * k) / Math.max(1, n));
    if (i !== last && G.terr[i] === SHALLOW) count++;
    last = i;
  }
  return count;
}

/** A straight walk may replace path tiles i..j if it's clear and wades no more than they do. */
function canSkip(cx: number, cy: number, path: Tile[], i: number, j: number): boolean {
  if (!los(cx, cy, ...center(path[j]))) return false;
  const wade = wadeTiles(cx, cy, ...center(path[j]));
  if (!wade) return true;
  let along = 0;
  for (let k = i; k <= j; k++) if (G.terr[path[k][1] * MW + path[k][0]] === SHALLOW) along++;
  return wade <= along + 1;
}

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
    while (j > i && !canSkip(cx, cy, path, i, j)) j--;
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
  // aircraft fly straight there, over anything
  if (isAir(u)) return tileOf(u.x) === gx && tileOf(u.y) === gy && Math.hypot(u.x - (gx + 0.5) * TS, u.y - (gy + 0.5) * TS) < 2 ? [] : [[clamp(gx, 0, MW - 1), clamp(gy, 0, MH - 1)]];
  return smoothPath(u.x, u.y, findPath(tileOf(u.x), tileOf(u.y), gx, gy, u.team));
}

/** Free tiles touching a footprint, nearest to the unit first (with jitter so crowds spread out). */
export function adjTiles(t: Target, u: { x: number; y: number }, jitter = true): Tile[] {
  const out: [Tile, number][] = [];
  for (let y = t.ty - 1; y <= t.ty + t.h; y++)
    for (let x = t.tx - 1; x <= t.tx + t.w; x++) {
      if (x >= t.tx && x < t.tx + t.w && y >= t.ty && y < t.ty + t.h) continue;
      if (x < 0 || y < 0 || x >= MW || y >= MH || G.blk[y * MW + x]) continue;
      out.push([[x, y], Math.hypot((x + 0.5) * TS - u.x, (y + 0.5) * TS - u.y) + (jitter ? Math.random() * 30 : 0)]);
    }
  return out.sort((a, b) => a[1] - b[1]).map(([tile]) => tile);
}

/** The free tile touching a footprint nearest to the unit (with jitter so crowds spread out). */
export function adjTile(t: Target, u: { x: number; y: number }, jitter = true): Tile | null {
  return adjTiles(t, u, jitter)[0] ?? null;
}

/**
 * Path toward a target, or null if nothing next to it is walkable. Sets the unit's goal. Beside a
 * building, a nearby free tile can be walled off (a pocket between rock and the wall), so it tries
 * the next nearest until one can actually be reached.
 */
export function pathTo(u: Ent, t: Target): Tile[] | null {
  if (!t.w || isAir(u)) {
    u.goal = [tileOf(t.x), tileOf(t.y)];
    return pathFor(u, u.goal[0], u.goal[1]);
  }
  const tiles = adjTiles(t, u);
  if (!tiles.length) return null;
  const here = [tileOf(u.x), tileOf(u.y)];
  let first: Tile[] | null = null;
  for (const g of tiles.slice(0, 6)) {
    // once one search has found no way there, a tile it never reached is no better: skip the search
    if (first && knownUnreachable(here[0], here[1], g[0], g[1], u.team)) continue;
    const path = pathFor(u, g[0], g[1]), end = path[path.length - 1] ?? here;
    if (end[0] === g[0] && end[1] === g[1]) { u.goal = g; return path; }
    first ??= path;
  }
  u.goal = tiles[0];
  return first;
}

/** Distance from a point to a target's edge (footprint edge, or a unit's 10px body). */
export function edgeDist(a: { x: number; y: number }, t: Target): number {
  if (t.w) {
    const l = t.tx * TS, r = l + t.w * TS, tp = t.ty * TS, b = tp + t.h * TS;
    return Math.hypot(a.x - clamp(a.x, l, r), a.y - clamp(a.y, tp, b));
  }
  // a big unit is in reach at its edge, or nothing short could ever hit a Titan through the crowd
  const r = (t as Ent).kind === 'unit' ? UNIT[(t as Ent).type as UnitType]?.radius ?? 0 : 0;
  return Math.hypot(a.x - t.x, a.y - t.y) - Math.max(10, r);
}
