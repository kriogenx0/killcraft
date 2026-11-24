// Herds of cows: harmless scenery that grazes in the meadows between the bases. Every cow wears a
// random colour (each herd has at least one purple one). They take no part in the game, so the
// server never sends them: every screen works out the same herds from the map's seed and walks them
// in fixed steps of game time, which keeps them in step across an online match for free.
import { G } from './state.ts';
import { GRASS, MH, MW } from './const.ts';
import { mulberry32 } from '../util/math.ts';
import { layoutFor } from '../data/map.ts';
import { lairsFor } from './creatures.ts';
import { nearPortal } from './map.ts';

/** Coat colours a cow can have. Purple first: every herd gets one. */
export const COW_COLORS = ['#8a4ad0', '#f2efe8', '#2a2624', '#7a4a2a', '#e86aa8', '#4aa8e8', '#f0c830', '#5ac86a', '#f08a30', '#d84040', '#40c8c0'];
/** How many herds a map gets (fewer if it has too little open meadow). */
export const HERDS = 8;
export const HERD_SIZE: [number, number] = [4, 7];
/** How far (tiles) a cow strays from its herd. */
export const HERD_RADIUS = 2.6;
/** Walking speed in tiles per second. */
export const COW_SPEED = 0.32;
/** The cows think in steps of this much game time. */
export const COW_TICK = 0.2;
/** Herds stay this far (tiles) from every Town Hall and lair. */
const CLEAR_OF_BASES = 13;
const CLEAR_OF_LAIRS = 6;

export interface Cow {
  /** position in tiles, now and one step ago (the renderer blends them) */
  x: number; y: number; px: number; py: number;
  face: number;
  color: string;
  /** 0.85 to 1.15 */
  size: number;
  herd: number;
  walking: boolean;
  /** where it's walking to */
  tx: number; ty: number;
  /** game time it stops grazing and wanders off */
  until: number;
  rnd: () => number;
  seed: number;
  /** how it stood when the map was made: [x, y, face, until] */
  start: [number, number, number, number];
}

/** A herd: where it grazes now, its home meadow, and when it next drifts. */
export interface Herd { x: number; y: number; hx: number; hy: number; move: number; move0: number; seed: number; rnd: () => number }

export const cows: { list: Cow[]; herds: Herd[]; t: number; seed: number; teams: number } = { list: [], herds: [], t: 0, seed: -1, teams: 0 };

/** Open grass a cow can stand on (no ore, oil or buildings). */
export function pasture(x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 1 || ty < 1 || tx >= MW - 1 || ty >= MH - 1) return false;
  const i = ty * MW + tx;
  return G.terr[i] === GRASS && !G.blk[i] && !G.ore[i] && !G.oilField[i];
}

/** Fully open meadow around a spot, for a herd's home. */
function meadow(x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r && !pasture(x + dx + 0.5, y + dy + 0.5)) return false;
  return !nearPortal(x, y, 3);
}

/** Send every cow back to where it started (a rewound clock). */
function restartCows(): void {
  for (const h of cows.herds) Object.assign(h, { x: h.hx, y: h.hy, move: h.move0, rnd: mulberry32(h.seed) });
  for (const c of cows.list) { const [x, y, face, until] = c.start; Object.assign(c, { x, y, px: x, py: y, face, walking: false, until, rnd: mulberry32(c.seed) }); }
  cows.t = 0;
}

/** Place the herds for the current map. Same seed and map, same herds, on every screen. */
export function initCows(): void {
  const rnd = mulberry32(G.seed ^ 0xc0c0a), layout = layoutFor(G.teams);
  const avoid: [number, number, number][] = [
    ...layout.yards.map(([x, y]): [number, number, number] => [x + 1, y + 1, CLEAR_OF_BASES]),
    ...lairsFor(G.seed).map(([[x, y]]): [number, number, number] => [x, y, CLEAR_OF_LAIRS]),
  ];
  const spots: [number, number][] = [];
  for (let y = 4; y < MH - 4; y++)
    for (let x = 4; x < MW - 4; x++)
      if (avoid.every(([ax, ay, r]) => Math.hypot(x - ax, y - ay) >= r) && meadow(x, y, 3)) spots.push([x, y]);
  Object.assign(cows, { list: [], herds: [], t: 0, seed: G.seed, teams: G.teams });
  for (let tries = 0; tries < 60 && cows.herds.length < HERDS && spots.length; tries++) {
    const [x, y] = spots[Math.floor(rnd() * spots.length)];
    if (cows.herds.some((h) => Math.hypot(h.x - x - 0.5, h.y - y - 0.5) < 12)) continue;
    const move = 40 + rnd() * 60, hs = (G.seed * 31 + cows.herds.length * 7919) | 0;
    const herd: Herd = { x: x + 0.5, y: y + 0.5, hx: x + 0.5, hy: y + 0.5, move, move0: move, seed: hs, rnd: mulberry32(hs) };
    const n = HERD_SIZE[0] + Math.floor(rnd() * (HERD_SIZE[1] - HERD_SIZE[0] + 1)), purple = Math.floor(rnd() * n);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, d = rnd() * HERD_RADIUS * 0.8, cx = herd.x + Math.cos(a) * d, cy = herd.y + Math.sin(a) * d;
      const ok = pasture(cx, cy);
      const sx = ok ? cx : herd.x, sy = ok ? cy : herd.y, face = rnd() * Math.PI * 2, color = k === purple ? COW_COLORS[0] : COW_COLORS[Math.floor(rnd() * COW_COLORS.length)];
      const size = 0.85 + rnd() * 0.3, until = rnd() * 8, cs = (G.seed * 131 + cows.list.length * 104729) | 0;
      cows.list.push({ x: sx, y: sy, px: sx, py: sy, face, color, size, herd: cows.herds.length, walking: false, tx: 0, ty: 0, until, seed: cs, rnd: mulberry32(cs), start: [sx, sy, face, until] });
    }
    cows.herds.push(herd);
  }
}

function step(c: Cow, t: number): void {
  c.px = c.x; c.py = c.y;
  const h = cows.herds[c.herd];
  if (!c.walking) {
    if (t < c.until) return;
    // wander to another patch of grass near the herd
    const a = c.rnd() * Math.PI * 2, d = c.rnd() * HERD_RADIUS, tx = h.x + Math.cos(a) * d, ty = h.y + Math.sin(a) * d;
    if (!pasture(tx, ty)) { c.until = t + 1 + c.rnd() * 2; return; }
    Object.assign(c, { walking: true, tx, ty });
    return;
  }
  const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy), s = COW_SPEED * COW_TICK * c.size;
  c.face = Math.atan2(dy, dx);
  if (d <= s) { c.x = c.tx; c.y = c.ty; c.walking = false; c.until = t + 4 + c.rnd() * 10; return; }
  const nx = c.x + (dx / d) * s, ny = c.y + (dy / d) * s;
  // something got built in the way (or it's the shore): stop and graze here instead
  if (!pasture(nx, ny)) { c.walking = false; c.until = t + 2 + c.rnd() * 4; return; }
  c.x = nx; c.y = ny;
}

/** A herd slowly drifts around its home meadow, so the cows don't wear one spot bare. */
function drift(h: Herd, t: number): void {
  if (t < h.move) return;
  h.move = t + 50 + h.rnd() * 70;
  const a = h.rnd() * Math.PI * 2, d = h.rnd() * 4, x = h.hx + Math.cos(a) * d, y = h.hy + Math.sin(a) * d;
  if (pasture(x, y)) { h.x = x; h.y = y; }
}

/** Walk the herds up to game time `t` (a rewind starts them over; initWorld places them on a fresh map). Returns the blend between the last two steps. */
export function updateCows(t: number): number {
  if (cows.seed !== G.seed || cows.teams !== G.teams) initCows();
  if (t < cows.t - 1) restartCows();
  // a resumed game replays the herds from the start: an hour is under a million tiny steps
  while (cows.t + COW_TICK <= t) {
    cows.t += COW_TICK;
    for (const h of cows.herds) drift(h, cows.t);
    for (const c of cows.list) step(c, cows.t);
  }
  return Math.min(1, Math.max(0, (t - cows.t) / COW_TICK));
}
