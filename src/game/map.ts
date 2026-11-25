// Seeded terrain generation: lakes and woods from smoothed noise, ore fields around crystal rocks,
// and clearings for the bases.
import { G, type Tile } from './state.ts';
import { MW, MH, GRASS, WATER, TREE, SHALLOW, ROCK, walkable } from './const.ts';
import { mulberry32 } from '../util/math.ts';
import {
  layoutFor, PORTAL_CHANCE, PORTAL_DOUBLE_CHANCE, PORTAL_CLEAR, WATER_LEVEL, HILL_HEIGHT, PLATEAU_HEIGHT, RIVER_CHANCE, COAST_CHANCE,
} from '../data/map.ts';
import { OIL_TILE_MAX, OIL_WELL_RADIUS, TREE_WOOD } from '../data/economy.ts';
import { ORE_FIELD_RADIUS, ORE_TILE_MAX } from '../data/ore.ts';

/** Map size against the 64-tile map the terrain was tuned on: noise cells and rivers scale with it, so lakes and woods stay the same size. */
const K = MW / 64;

function valueGrid(rnd: () => number, cells: number): (x: number, y: number) => number {
  const sz = Math.round(cells * K), a: number[] = [];
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

/** 0..1, eased: 0 at or below a, 1 at or above b. */
const smooth = (a: number, b: number, v: number): number => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Distance (tiles, 8-way chamfer) from every tile to the nearest tile where `src` is true. */
function distanceTo(src: (i: number) => boolean): Float32Array {
  const d = new Float32Array(MW * MH).fill(1e6);
  for (let i = 0; i < MW * MH; i++) if (src(i)) d[i] = 0;
  const pass = (dirs: [number, number, number][], y0: number, y1: number, step: number, x0: number, x1: number) => {
    for (let y = y0; y !== y1; y += step)
      for (let x = x0; x !== x1; x += step) {
        const i = y * MW + x;
        for (const [dx, dy, c] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < MW && ny < MH && d[ny * MW + nx] + c < d[i]) d[i] = d[ny * MW + nx] + c;
        }
      }
  };
  pass([[-1, 0, 1], [0, -1, 1], [-1, -1, 1.41], [1, -1, 1.41]], 0, MH, 1, 0, MW);
  pass([[1, 0, 1], [0, 1, 1], [1, 1, 1.41], [-1, 1, 1.41]], MH - 1, -1, -1, MW - 1, -1);
  return d;
}

/** Distance from a point to a polyline, in tiles. */
function distToLine(x: number, y: number, pts: [number, number][]): { d: number; t: number } {
  let best = 1e9, bt = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1], vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)), d = Math.hypot(x - ax - vx * t, y - ay - vy * t);
    if (d < best) { best = d; bt = (k + t) / (pts.length - 1); }
  }
  return { d: best, t: bt };
}

/**
 * A meandering river between two map edges, crossing the line between the bases, as a polyline
 * plus where along it the fords are (shares of its length).
 */
function riverCourse(rnd: () => number): { pts: [number, number][]; fords: number[]; width: number } {
  // run from the top-left side to the bottom-right side, so it lies between the two bases
  const along = rnd() < 0.5;
  const a: [number, number] = along ? [-2, (8 + rnd() * 20) * K] : [(8 + rnd() * 20) * K, -2];
  const b: [number, number] = along ? [MW + 2, MH - (8 + rnd() * 20) * K] : [MW - (8 + rnd() * 20) * K, MH + 2];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), px = -(b[1] - a[1]) / len, py = (b[0] - a[0]) / len;
  const amp = (3 + rnd() * 4) * K, f1 = 1.5 + rnd() * 1.5, f2 = 3 + rnd() * 3, ph1 = rnd() * 6.3, ph2 = rnd() * 6.3;
  const pts: [number, number][] = [];
  const n = Math.round(48 * K);
  for (let k = 0; k <= n; k++) {
    const t = k / n, off = Math.sin(t * Math.PI * 2 * f1 + ph1) * amp + Math.sin(t * Math.PI * 2 * f2 + ph2) * amp * 0.35;
    pts.push([a[0] + (b[0] - a[0]) * t + px * off, a[1] + (b[1] - a[1]) * t + py * off]);
  }
  const fords = [0.18 + rnd() * 0.12, 0.42 + rnd() * 0.16, 0.7 + rnd() * 0.12];
  return { pts, fords, width: 1.1 + rnd() * 0.5 };
}

/** Fill the terrain for one seed. Returns false if any base can't reach the others. */
function genMap(seed: number): boolean {
  const { terr, ore, oilField, treeWood, elev } = G;
  const { yards, ore: sources, oil, forests } = layoutFor(G.teams);
  const rnd = mulberry32(seed);
  const w1 = valueGrid(rnd, 5), w2 = valueGrid(rnd, 11), t1 = valueGrid(rnd, 7), t2 = valueGrid(rnd, 15);
  const h1 = valueGrid(rnd, 3), h2 = valueGrid(rnd, 7), h3 = valueGrid(rnd, 13), pl = valueGrid(rnd, 4), rp = valueGrid(rnd, 9);
  const river = rnd() < RIVER_CHANCE ? riverCourse(rnd) : null;
  const coast = rnd() < COAST_CHANCE && G.teams <= 2 ? (rnd() < 0.5 ? [0, 0] : [MW, MH]) : null, coastR = (13 + rnd() * 6) * K;
  terr.fill(GRASS);
  ore.fill(0);
  G.scrap.fill(0);
  oilField.fill(0);
  // how wet each tile is: >= 1 deep water, >= 0.5 shallow
  const wet = new Float32Array(MW * MH);
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x, u = x / MW, v = y / MH;
      const wn = (w1(u, v) + w2(u, v) * 0.5) / 1.5;
      let w = smooth(0.645, 0.72, wn) * 1.2;
      if (river) {
        const { d, t } = distToLine(x + 0.5, y + 0.5, river.pts), ford = river.fords.some((f) => Math.abs(t - f) < 0.03 / K); // fords stay the same width in tiles
        const r = river.width * (0.85 + w2(u, v) * 0.4);
        w = Math.max(w, d < r && !ford ? 1.2 : d < r + 1.3 ? 0.7 : 0);
      }
      if (coast) {
        const d = Math.hypot(x - coast[0], y - coast[1]) + (t2(u, v) - 0.5) * 8 * K;
        w = Math.max(w, d < coastR ? 1.2 : d < coastR + 2 ? 0.7 : 0);
      }
      wet[i] = w;
      terr[i] = w >= 1 ? WATER : w >= 0.5 ? SHALLOW : GRASS;
    }
  // rolling hills everywhere, and plateaus ringed by cliffs (with ramps up) away from the water
  const dWater = distanceTo((i) => terr[i] !== GRASS);
  const plateau = new Uint8Array(MW * MH);
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x, u = x / MW, v = y / MH;
      const hills = (h1(u, v) + h2(u, v) * 0.5 + h3(u, v) * 0.2) / 1.7;
      elev[i] = (hills - 0.35) * HILL_HEIGHT;
      if (pl(u, v) > 0.64 && dWater[i] > 3) plateau[i] = 1;
    }
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      if (!plateau[i]) continue;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < MW && ny < MH && !plateau[ny * MW + nx]) edge = true;
      }
      // the rim is a cliff, unless it's a ramp halfway up
      const ramp = edge && rp(x / MW, y / MH) >= 0.6;
      elev[i] += ramp ? PLATEAU_HEIGHT * 0.5 : PLATEAU_HEIGHT;
      if (edge && !ramp) terr[i] = ROCK;
    }
  // cliff tops stand level with the plateau they ring, so the drop is all on the outside
  const raw = elev.slice();
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      if (terr[y * MW + x] !== ROCK) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < MW && ny < MH && plateau[ny * MW + nx]) elev[y * MW + x] = Math.max(elev[y * MW + x], raw[ny * MW + nx]);
        }
    }
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x, u = x / MW, v = y / MH, tn = (t1(u, v) + t2(u, v) * 0.6) / 1.6;
      if (terr[i] === GRASS && tn > 0.62 && rnd() < 0.8) terr[i] = TREE;
    }
  for (const [cx, cy, r] of forests) eachInDisk(cx, cy, r, (i) => { if (terr[i] === GRASS && rnd() < 0.85) terr[i] = TREE; });
  const flats: [number, number, number][] = [];
  const clear = (cx: number, cy: number, r: number) => { flats.push([cx, cy, r]); eachInDisk(cx, cy, r, (i) => { terr[i] = GRASS; }); };
  for (const [x, y] of yards) clear(x + 1, y + 1, 9);
  for (const [x, y] of sources) {
    clear(x, y, ORE_FIELD_RADIUS + 1);
    eachInDisk(x, y, ORE_FIELD_RADIUS, (i, tx, ty) => {
      const d = Math.hypot(tx - x, ty - y);
      // dense and rich near the rock, thinning toward the edge
      if ((tx !== x || ty !== y) && rnd() < 0.97 - d * 0.06) ore[i] = Math.round(ORE_TILE_MAX * (0.55 + 0.45 * rnd()) * (1 - d / (ORE_FIELD_RADIUS + 3)));
    });
  }
  for (const [x, y] of oil) {
    clear(x, y, OIL_WELL_RADIUS + 2);
    eachInDisk(x, y, OIL_WELL_RADIUS + 0.5, (i, tx, ty) => {
      ore[i] = 0;
      oilField[i] = Math.round(OIL_TILE_MAX * (1 - Math.hypot(tx - x, ty - y) / (OIL_WELL_RADIUS + 1.5)));
    });
  }
  shapeHeights(flats);
  for (let i = 0; i < MW * MH; i++) treeWood[i] = terr[i] === TREE ? TREE_WOOD : 0;
  return yards.every((y) => connected(yards[0], y));
}

/**
 * Finish the height map: level the clearings (so bases and fields sit flat), sink lake and river
 * beds below the water, and let the land slope down to meet the shore.
 */
function shapeHeights(flats: [number, number, number][]): void {
  const { terr, elev } = G;
  for (const [cx, cy, r] of flats) {
    const c = elev[Math.min(MH - 1, Math.max(0, Math.round(cy))) * MW + Math.min(MW - 1, Math.max(0, Math.round(cx)))];
    eachInDisk(cx, cy, r + 4, (i, x, y) => { elev[i] += (c - elev[i]) * (1 - smooth(r - 1, r + 4, Math.hypot(x - cx, y - cy))); });
  }
  const dShore = distanceTo((i) => terr[i] === WATER || terr[i] === SHALLOW);
  const dDeep = distanceTo((i) => terr[i] !== WATER);
  for (let i = 0; i < MW * MH; i++) {
    if (terr[i] === WATER) elev[i] = WATER_LEVEL - 0.35 - Math.min(0.6, dDeep[i] * 0.2);
    else if (terr[i] === SHALLOW) elev[i] = WATER_LEVEL - 0.18;
    else {
      // beaches: the land eases down toward the water's edge
      const k = smooth(0.5, 6, dShore[i]);
      elev[i] = (WATER_LEVEL + 0.08) * (1 - k) + Math.max(elev[i], WATER_LEVEL + 0.08) * k;
    }
  }
}
/** Tiles reachable on foot from a tile. */
function reachable(from: Tile): Uint8Array {
  const seen = new Uint8Array(MW * MH), start = from[1] * MW + from[0], q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop() as number, x = i % MW, y = (i / MW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const ni = ny * MW + nx;
      if (seen[ni] || !walkable(G.terr[ni])) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

const yardTile = (t: Tile): Tile => [t[0] + 1, t[1] + 1];

function connected(a: Tile, b: Tile): boolean {
  return reachable(yardTile(a))[(b[1] + 1) * MW + b[0] + 1] === 1;
}

/** Some seeds get one or two portal pairs. Uses its own random stream so terrain stays the same per seed. */
function placePortals(seed: number): void {
  G.portals = [];
  G.warp.fill(-1);
  const rnd = mulberry32((seed * 7919 + 104729) >>> 0), { yards, portals } = layoutFor(G.teams);
  if (rnd() >= PORTAL_CHANCE || !portals.length) return;
  const order = portals.map((p) => ({ p, k: rnd() })).sort((a, b) => a.k - b.k).map((o) => o.p);
  const want = rnd() < PORTAL_DOUBLE_CHANCE ? 2 : 1;
  for (const [a, b] of order) {
    if (G.portals.length >= want) break;
    // clear a little plaza round each gate, then make sure both sides can walk to it
    const layers = [G.terr, G.ore, G.oilField, G.treeWood, G.elev], saved = layers.map((l) => l.slice());
    for (const [x, y] of [a, b]) eachInDisk(x, y, PORTAL_CLEAR, (i) => { G.terr[i] = GRASS; G.ore[i] = 0; G.oilField[i] = 0; G.treeWood[i] = 0; G.elev[i] = Math.max(G.elev[i], WATER_LEVEL + 0.08); });
    const home = reachable(yardTile(yards[0]));
    if (!home[a[1] * MW + a[0]] || !home[b[1] * MW + b[0]]) { layers.forEach((l, k) => l.set(saved[k] as never)); continue; }
    G.portals.push({ a: [a[0], a[1]], b: [b[0], b[1]] });
    G.warp[a[1] * MW + a[0]] = b[1] * MW + b[0];
    G.warp[b[1] * MW + b[0]] = a[1] * MW + a[0];
  }
}

/** Is a tile within `r` tiles (square) of a gate? A map portal's stone ring is wider, so it keeps one more tile clear. */
export function nearPortal(tx: number, ty: number, r = 1): boolean {
  const near = (gates: { a: Tile; b: Tile }[], d: number) => gates.some((p) => [p.a, p.b].some(([x, y]) => Math.abs(x - tx) <= d && Math.abs(y - ty) <= d));
  return near(G.portals, r + 1) || near(G.waygates, r);
}

/** Is this tile one of the map's portal gates (not a player's Waygate)? */
export const isMapPortal = (tx: number, ty: number): boolean => G.portals.some((p) => [p.a, p.b].some(([x, y]) => x === tx && y === ty));

/** Generate a playable map, trying following seeds until the bases connect. Returns the seed used. */
export function generateMap(seed: number): number {
  let s = seed;
  for (let tries = 0; tries < 80 && !genMap(s); tries++) s++;
  placePortals(s);
  G.seed = s;
  return s;
}

export function rebuildBlk(): void {
  for (let i = 0; i < MW * MH; i++) G.blk[i] = walkable(G.terr[i]) ? 0 : 1;
  for (const e of G.ents) if (!e.dead && e.w) setBlk(e, true);
}

export function setBlk(e: { tx: number; ty: number; w: number; h: number }, on: boolean): void {
  for (let y = e.ty; y < e.ty + e.h; y++)
    for (let x = e.tx; x < e.tx + e.w; x++) G.blk[y * MW + x] = on || !walkable(G.terr[y * MW + x]) ? 1 : 0;
}
