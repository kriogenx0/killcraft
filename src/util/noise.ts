// Value noise used to texture the terrain.

const table = new Float32Array(256 * 256);

export function seedNoise(rnd: () => number): void {
  for (let i = 0; i < table.length; i++) table[i] = rnd();
}

export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const x0 = ix & 255, x1 = (ix + 1) & 255, y0 = (iy & 255) << 8, y1 = ((iy + 1) & 255) << 8;
  const a = table[y0 | x0], b = table[y0 | x1], c = table[y1 | x0], d = table[y1 | x1];
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Three octaves of value noise. */
export function fbm(x: number, y: number): number {
  return vnoise(x, y) * 0.5 + vnoise(x * 2.03 + 17, y * 2.03 + 9) * 0.3 + vnoise(x * 4.1 + 5, y * 4.1 + 31) * 0.2;
}
