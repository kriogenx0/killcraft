// Ore fields: crystal rocks slowly regrow ore around them, harvesters scoop it up.
import { G, hooks, type Tile } from './state.ts';
import { MW, MH, GRASS } from './const.ts';
import { ORE_REGROW, ORE_REGROW_RADIUS, ORE_REGROW_TILES, ORE_TILE_MAX } from '../data/ore.ts';

/** Add ore near every crystal rock. Called once per second. */
export function regrowOre(): void {
  let changed = false;
  for (const s of G.ents) {
    if (s.dead || s.type !== 'source') continue;
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
  return a;
}

/** Nearest tile with ore, searching outward up to `r` tiles. Skips tiles under buildings and any `skip` rejects. */
/**
 * The ore tile within r tiles of (tx, ty) with at least `min` ore, nearest to (tx, ty), or, given a
 * `home` footprint (a drop-off), nearest to that so trips stay short.
 */
export function nearestOre(tx: number, ty: number, r: number, min = 1, skip?: (i: number) => boolean, home?: { tx: number; ty: number; w: number; h: number } | null): Tile | null {
  let best: Tile | null = null, bd = 1e9;
  for (let y = Math.max(0, ty - r); y <= Math.min(MH - 1, ty + r); y++)
    for (let x = Math.max(0, tx - r); x <= Math.min(MW - 1, tx + r); x++) {
      const i = y * MW + x;
      if (G.ore[i] < min || G.blk[i] || skip?.(i)) continue;
      const d = (home ? Math.hypot(Math.max(home.tx - x, 0, x - (home.tx + home.w - 1)), Math.max(home.ty - y, 0, y - (home.ty + home.h - 1))) : Math.hypot(x - tx, y - ty))
        - G.ore[i] / 1000; // prefer richer tiles at equal distance
      if (d < bd) { bd = d; best = [x, y]; }
    }
  return best;
}

export function totalOre(): number {
  let s = 0;
  for (let i = 0; i < MW * MH; i++) s += G.ore[i];
  return s;
}
