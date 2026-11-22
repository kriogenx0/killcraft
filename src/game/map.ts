// Seeded terrain generation: lakes and woods from smoothed noise, ore fields around crystal rocks,
// and clearings for the bases.
import { G, type Tile } from './state.ts';
import { MW, MH, GRASS, WATER, TREE } from './const.ts';
import { mulberry32 } from '../util/math.ts';
import { START_YARDS, ORE_SOURCES, FORESTS } from '../data/map.ts';
import { ORE_FIELD_RADIUS, ORE_TILE_MAX } from '../data/ore.ts';

function valueGrid(rnd: () => number, sz: number): (x: number, y: number) => number {
  const a: number[] = [];
  for (let i = 0; i < (sz + 1) * (sz + 1); i++) a.push(rnd());
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x * sz, fy = y * sz, ix = Math.floor(fx), iy = Math.floor(fy), sx = s(fx - ix), sy = s(fy - iy);
    const v = (i: number, j: number) => a[(iy + j) * (sz + 1) + ix + i];
    return (v(0, 0) * (1 - sx) + v(1, 0) * sx) * (1 - sy) + (v(0, 1) * (1 - sx) + v(1, 1) * sx) * sy;
  };
}

export function eachInDisk(cx: number, cy: number, r: number, fn: (i: number, x: number, y: number) => void): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++)
      if (x >= 0 && y >= 0 && x < MW && y < MH && Math.hypot(x - cx, y - cy) <= r) fn(y * MW + x, x, y);
}

/** Fill the terrain for one seed. Returns false if the two bases can't reach each other. */
function genMap(seed: number): boolean {
  const { terr, ore } = G;
  const rnd = mulberry32(seed);
  const w1 = valueGrid(rnd, 5), w2 = valueGrid(rnd, 11), t1 = valueGrid(rnd, 7), t2 = valueGrid(rnd, 15);
  terr.fill(GRASS);
  ore.fill(0);
  const clear = (cx: number, cy: number, r: number) => eachInDisk(cx, cy, r, (i) => { terr[i] = GRASS; });

  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x, u = x / MW, v = y / MH;
      const wn = (w1(u, v) + w2(u, v) * 0.5) / 1.5, tn = (t1(u, v) + t2(u, v) * 0.6) / 1.6;
      if (wn > 0.67) terr[i] = WATER;
      else if (tn > 0.62 && rnd() < 0.8) terr[i] = TREE;
    }
  for (const [cx, cy, r] of FORESTS) eachInDisk(cx, cy, r, (i) => { if (terr[i] === GRASS && rnd() < 0.85) terr[i] = TREE; });
  for (const [x, y] of START_YARDS) clear(x + 1, y + 1, 9);
  for (const [x, y] of ORE_SOURCES) {
    clear(x, y, ORE_FIELD_RADIUS + 1);
    eachInDisk(x, y, ORE_FIELD_RADIUS, (i, tx, ty) => {
      const d = Math.hypot(tx - x, ty - y);
      // dense and rich near the rock, thinning toward the edge
      if ((tx !== x || ty !== y) && rnd() < 0.97 - d * 0.06) ore[i] = Math.round(ORE_TILE_MAX * (0.55 + 0.45 * rnd()) * (1 - d / (ORE_FIELD_RADIUS + 3)));
    });
  }
  return connected(START_YARDS[0], START_YARDS[1]);
}

function connected(a: Tile, b: Tile): boolean {
  const seen = new Uint8Array(MW * MH), start = (a[1] + 1) * MW + a[0] + 1, q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop() as number, x = i % MW, y = (i / MW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const ni = ny * MW + nx;
      if (seen[ni] || G.terr[ni] !== GRASS) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen[(b[1] + 1) * MW + b[0] + 1] === 1;
}

/** Generate a playable map, trying following seeds until the bases connect. Returns the seed used. */
export function generateMap(seed: number): number {
  let s = seed;
  for (let tries = 0; tries < 80 && !genMap(s); tries++) s++;
  G.seed = s;
  return s;
}

export function rebuildBlk(): void {
  for (let i = 0; i < MW * MH; i++) G.blk[i] = G.terr[i] !== GRASS ? 1 : 0;
  for (const e of G.ents) if (!e.dead && e.w) setBlk(e, true);
}

export function setBlk(e: { tx: number; ty: number; w: number; h: number }, on: boolean): void {
  for (let y = e.ty; y < e.ty + e.h; y++)
    for (let x = e.tx; x < e.tx + e.w; x++) G.blk[y * MW + x] = on || G.terr[y * MW + x] !== GRASS ? 1 : 0;
}
