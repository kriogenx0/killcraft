import { describe, expect, it } from 'vitest';
import { clamp, hash, lerp, mulberry32 } from './math.ts';

describe('math', () => {
  it('clamps to a range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('interpolates', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it('gives the same random sequence for the same seed', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(c()).not.toBe(seqA[0]);
    for (const v of seqA) expect(v >= 0 && v < 1).toBe(true);
  });

  it('hashes grid positions into [0, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const h = hash(i, i * 3);
      expect(h >= 0 && h < 1).toBe(true);
    }
    expect(hash(4, 7)).toBe(hash(4, 7));
  });
});
