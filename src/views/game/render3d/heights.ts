// The ground's shape for the renderer: a height grid (two vertices per tile) built from the map's
// tile heights, with craggy cliffs on rock tiles. Everything that stands on the ground asks here.
import { G } from '../../../game/state.ts';
import { MW, MH, TS, ROCK } from '../../../game/const.ts';
import { WATER_LEVEL } from '../../../data/map.ts';
import { clamp, hash } from '../../../util/math.ts';

/** Vertices per tile along each axis. */
export const RES = 2;
export const VW = MW * RES + 1, VH = MH * RES + 1;
/** Height at each grid vertex, tiles. */
export const heights = new Float32Array(VW * VH);
export { WATER_LEVEL };

const elevAt = (x: number, y: number): number => G.elev[clamp(y, 0, MH - 1) * MW + clamp(x, 0, MW - 1)];
const rockAt = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MW && y < MH && G.terr[y * MW + x] === ROCK;

/** Rebuild the grid for the current map. */
export function buildHeights(): void {
  for (let vy = 0; vy < VH; vy++)
    for (let vx = 0; vx < VW; vx++) {
      // smooth: bilinear between tile centres
      const fx = vx / RES - 0.5, fy = vy / RES - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      let h = (elevAt(ix, iy) * (1 - tx) + elevAt(ix + 1, iy) * tx) * (1 - ty) + (elevAt(ix, iy + 1) * (1 - tx) + elevAt(ix + 1, iy + 1) * tx) * ty;
      // cliffs: rock tiles rise into broken crags above the plateau they ring
      // the tiles this vertex touches: one at a tile's centre, two or four on its edges
      const xs = vx % RES ? [Math.floor(vx / RES)] : [vx / RES - 1, vx / RES], ys = vy % RES ? [Math.floor(vy / RES)] : [vy / RES - 1, vy / RES];
      let rocks = 0, top = -9;
      for (const x of xs) for (const y of ys) if (rockAt(x, y)) { rocks++; top = Math.max(top, elevAt(x, y)); }
      rocks /= xs.length * ys.length;
      if (rocks) {
        // cliff tops are broken crags, and the face drops sharply to the ground below
        const n = hash(vx * 0.37, vy * 0.53);
        h = rocks >= 0.5 ? top + n * 0.35 : Math.max(h, top * 0.75 + h * 0.25) + n * 0.2;
      }
      heights[vy * VW + vx] = h;
    }
}

/** Ground height (tiles) at a point in tile coordinates. */
export function heightAt(x: number, z: number): number {
  const fx = clamp(x * RES, 0, VW - 1.001), fz = clamp(z * RES, 0, VH - 1.001), ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const i = iz * VW + ix;
  return (heights[i] * (1 - tx) + heights[i + 1] * tx) * (1 - tz) + (heights[i + VW] * (1 - tx) + heights[i + VW + 1] * tx) * tz;
}

/** Ground height (tiles) under a world point (px). */
export const groundY = (x: number, y: number): number => heightAt(x / TS, y / TS);

/** Height (tiles) of whichever is higher at a point: the ground or the water's surface. */
export const surfaceY = (x: number, z: number): number => Math.max(heightAt(x, z), WATER_LEVEL);

/** Slope of the ground (rise per tile) along x and z at a point in tile coordinates. */
export function slopeAt(x: number, z: number): [number, number] {
  const e = 0.3;
  return [(heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)];
}

/** Ground height under a footprint (tiles): its average, which is where `level` flattens it to. */
export function footprintY(tx: number, ty: number, w: number, h: number): number {
  let sum = 0, n = 0;
  for (let y = ty * RES; y <= (ty + h) * RES; y++) for (let x = tx * RES; x <= (tx + w) * RES; x++) { sum += heights[clamp(y, 0, VH - 1) * VW + clamp(x, 0, VW - 1)]; n++; }
  return Math.max(sum / n, WATER_LEVEL + 0.06);
}

/**
 * Level the ground under a structure's footprint to its average height (feathering the edge), so
 * it sits flat on a hillside. Returns the range of grid rows touched, or null if nothing changed.
 */
export function level(tx: number, ty: number, w: number, h: number): [number, number] | null {
  const x0 = tx * RES, y0 = ty * RES, x1 = (tx + w) * RES, y1 = (ty + h) * RES;
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { sum += heights[y * VW + x]; n++; }
  const target = Math.max(sum / n, WATER_LEVEL + 0.06);
  let changed = false;
  for (let y = y0 - 1; y <= y1 + 1; y++)
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (x < 0 || y < 0 || x >= VW || y >= VH) continue;
      const edge = x < x0 || x > x1 || y < y0 || y > y1, i = y * VW + x, to = edge ? (heights[i] + target) / 2 : target;
      if (Math.abs(heights[i] - to) > 1e-4) { heights[i] = to; changed = true; }
    }
  return changed ? [Math.max(0, y0 - 1), Math.min(VH - 1, y1 + 1)] : null;
}
