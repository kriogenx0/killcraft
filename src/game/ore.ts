// Ore fields: crystal rocks slowly regrow ore around them, harvesters scoop it up.
import { G, hooks, type Tile } from './state.ts';
import { MW, MH, GRASS } from './const.ts';
import { ORE_REGROW, ORE_REGROW_RADIUS, ORE_REGROW_TILES, ORE_TILE_MAX } from '../data/ore.ts';
import { GATE_SIZE, GATE_TILE } from '../data/hell.ts';

/** The Gate of Hell stands where the middle field's crystal rock was (data/hell.ts), and the ore grows back round it the same. */
const GATE_ROCK = { tx: GATE_TILE[0] + (GATE_SIZE >> 1), ty: GATE_TILE[1] + (GATE_SIZE >> 1) };

/** Add ore near every crystal rock. Called once per second. */
export function regrowOre(): void {
  let changed = false;
  for (const s of G.hell?.gate ? [...G.ents, GATE_ROCK] : G.ents) {
    if (('dead' in s && s.dead) || ('type' in s && s.type !== 'source')) continue;
    for (let k = 0; k < ORE_REGROW_TILES; k++) {
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * ORE_REGROW_RADIUS;
      const x = Math.round(s.tx + Math.cos(a) * r), y = Math.round(s.ty + Math.sin(a) * r);
      if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
      const i = y * MW + x;
      if (G.terr[i] !== GRASS || G.blk[i]) continue;
      G.ore[i] = Math.min(ORE_TILE_MAX, G.ore[i] + ORE_REGROW);
      changed = true;
    }
  }
  if (changed) hooks.oreChanged();
}

/** Remove up to `amount` ore from a tile; returns how much was taken. */
export function takeOre(tx: number, ty: number, amount: number): number {
  const i = ty * MW + tx, a = Math.min(amount, G.ore[i]);
  G.ore[i] -= a;
  if (G.ore[i] <= 0) G.scrap[i] = 0;
  return a;
}

/** A footprint to measure from (a drop-off). */
export interface Home { tx: number; ty: number; w: number; h: number }

/** Tiles from (x, y) to the nearest tile of a footprint (0 on it). */
const tilesTo = (x: number, y: number, f: Home): number =>
  Math.hypot(Math.max(f.tx - x, 0, x - (f.tx + f.w - 1)), Math.max(f.ty - y, 0, y - (f.ty + f.h - 1)));

/**
 * Walking distance (tiles, going round cliffs, water and buildings) from the tiles beside any of
 * `homes` to every tile; Infinity where there's no way.
 */
export function walkDist(homes: readonly Home[]): Float32Array {
  // counted in half tiles: 2 a straight step, 3 a diagonal one, so a bucket per cost does the sorting
  const d = new Float32Array(MW * MH).fill(Infinity), buckets: number[][] = [];
  const push = (i: number, c: number) => { if (c < d[i]) { d[i] = c; (buckets[c] ??= []).push(i); } };
  for (const h of homes)
    for (let y = h.ty - 1; y <= h.ty + h.h; y++)
      for (let x = h.tx - 1; x <= h.tx + h.w; x++)
        if (x >= 0 && y >= 0 && x < MW && y < MH && !G.blk[y * MW + x]) push(y * MW + x, 0);
  for (let c = 0; c < buckets.length; c++) {
    const b = buckets[c];
    if (!b) continue;
    for (const i of b) {
      if (d[i] !== c) continue;
      const x = i % MW, y = (i / MW) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= MW || ny >= MH || G.blk[ny * MW + nx]) continue;
          const diag = dx && dy;
          if (diag && (G.blk[y * MW + nx] || G.blk[ny * MW + x])) continue; // no squeezing between corners
          push(ny * MW + nx, c + (diag ? 3 : 2));
        }
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 2;
  return d;
}

/**
 * The ore tile within r tiles of (tx, ty) with at least `min` ore that is nearest to any of `homes`
 * (the side's drop-offs, so trips stay short), or nearest to (tx, ty) with none. Given `walk`
 * (walkDist from those homes) it goes by walking distance and leaves out ore there's no way to.
 * Tiles under buildings and any `skip` rejects are left out.
 */
export function nearestOre(tx: number, ty: number, r: number, min = 1, skip?: (i: number) => boolean, homes?: readonly Home[] | null, walk?: Float32Array | null): Tile | null {
  let best: Tile | null = null, bd = 1e9;
  for (let y = Math.max(0, ty - r); y <= Math.min(MH - 1, ty + r); y++)
    for (let x = Math.max(0, tx - r); x <= Math.min(MW - 1, tx + r); x++) {
      const i = y * MW + x;
      if (G.ore[i] < min || G.blk[i]) continue;
      let d = Math.hypot(x - tx, y - ty);
      if (walk) { d = walk[i]; if (d === Infinity) continue; }
      else if (homes?.length) { d = Infinity; for (const h of homes) d = Math.min(d, tilesTo(x, y, h)); }
      d -= G.ore[i] / 1e6; // the richer tile on a tie
      if (d >= bd || skip?.(i)) continue;
      bd = d; best = [x, y];
    }
  return best;
}

export function totalOre(): number {
  let s = 0;
  for (let i = 0; i < MW * MH; i++) s += G.ore[i];
  return s;
}
