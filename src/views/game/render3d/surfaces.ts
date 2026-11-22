// Procedural surface textures for the model materials: wood grain, stone, brick, thatch, concrete,
// corrugated metal and canvas. Each is a light, mostly-white detail map that the material colour
// tints, so a surface keeps its colour but gains grain up close. Built once, on first use.
import * as THREE from 'three';
import { mulberry32 } from '../../../util/math.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';

export type Surface = 'wood' | 'stone' | 'brick' | 'thatch' | 'concrete' | 'metal' | 'canvas' | 'plaster';

const N = 128;
const cache = new Map<Surface, THREE.Texture>();

/** Fill a grey-level image from a function returning 0..1 (1 = white), wrapping at the edges. */
function paint(f: (x: number, y: number, rnd: () => number) => number, seed: number): HTMLCanvasElement {
  const c = mkCanvas(N, N), g = ctx2d(c), img = g.createImageData(N, N), rnd = mulberry32(seed);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = Math.max(0, Math.min(1, f(x, y, rnd))) * 255, o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Smooth tiling value noise at a given cell count across the texture. */
function noise(cells: number, seed: number): (x: number, y: number) => number {
  const r = mulberry32(seed), v = Array.from({ length: cells * cells }, () => r());
  const at = (i: number, j: number) => v[((j % cells) + cells) % cells * cells + ((i % cells) + cells) % cells];
  return (x, y) => {
    const fx = (x / N) * cells, fy = (y / N) * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
  };
}

const MAKERS: Record<Surface, () => HTMLCanvasElement> = {
  wood: () => {
    const n = noise(4, 1), fine = noise(32, 2);
    return paint((x, y) => {
      const ring = Math.sin((y / N) * Math.PI * 2 * 9 + n(x, y) * 6) * 0.5 + 0.5;
      return 0.74 + ring * 0.14 + fine(x * 0.25, y * 4) * 0.12;
    }, 3);
  },
  stone: () => {
    const n = noise(6, 4), m = noise(16, 5);
    return paint((x, y, r) => {
      const v = 0.72 + n(x, y) * 0.18 + m(x, y) * 0.1 + (r() - 0.5) * 0.06;
      return m(x * 1.7, y * 1.7) < 0.18 ? v * 0.75 : v; // cracks and pits
    }, 6);
  },
  brick: () => {
    const n = noise(8, 7);
    return paint((x, y, r) => {
      const rows = 8, row = Math.floor((y / N) * rows), off = row % 2 ? 0.5 : 0, u = (x / N) * 4 + off, fu = u - Math.floor(u), fv = (y / N) * rows - row;
      if (fu < 0.05 || fv < 0.1) return 0.62; // mortar
      return 0.8 + (Math.sin(Math.floor(u) * 12.9 + row * 78.2) * 0.5 + 0.5) * 0.14 + n(x, y) * 0.08 + (r() - 0.5) * 0.04;
    }, 8);
  },
  thatch: () => {
    const n = noise(24, 9);
    return paint((x, y, r) => 0.68 + n(x * 0.15, y * 3) * 0.26 + (r() - 0.5) * 0.08 + (Math.floor((y / N) * 6) % 2) * 0.04, 10);
  },
  concrete: () => {
    const n = noise(5, 11), m = noise(40, 12);
    return paint((x, y, r) => {
      const seam = (y % 64 < 1 || x % 64 < 1) ? -0.12 : 0;
      return 0.8 + n(x, y) * 0.12 + m(x, y) * 0.06 + (r() - 0.5) * 0.05 + seam;
    }, 13);
  },
  metal: () => {
    const n = noise(4, 14);
    return paint((x, y) => 0.8 + Math.sin((x / N) * Math.PI * 2 * 16) * 0.08 + n(x, y) * 0.1, 15);
  },
  canvas: () => {
    const n = noise(6, 16);
    return paint((x, y, r) => 0.84 + ((x + y) % 4 < 2 ? 0.04 : 0) + n(x, y) * 0.1 + (r() - 0.5) * 0.04, 17);
  },
  plaster: () => {
    const n = noise(7, 18), m = noise(30, 19);
    return paint((x, y, r) => 0.86 + n(x, y) * 0.1 + m(x, y) * 0.04 + (r() - 0.5) * 0.03, 20);
  },
};

export function surface(kind: Surface): THREE.Texture {
  let t = cache.get(kind);
  if (!t) {
    t = new THREE.CanvasTexture(MAKERS[kind]());
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    cache.set(kind, t);
  }
  return t;
}
