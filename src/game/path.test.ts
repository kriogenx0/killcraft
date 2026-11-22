import { beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { MW } from './const.ts';
import { findPath, los, nearestFree, smoothPath } from './path.ts';

const block = (x: number, y: number) => { G.blk[y * MW + x] = 1; };

describe('pathfinding', () => {
  beforeEach(() => G.blk.fill(0));

  it('walks around a wall', () => {
    for (let y = 0; y < 10; y++) block(5, y);
    const path = findPath(2, 2, 8, 2);
    expect(path.at(-1)).toEqual([8, 2]);
    for (const [x, y] of path) expect(G.blk[y * MW + x]).toBe(0);
    expect(path.some(([, y]) => y >= 10)).toBe(true);
  });

  it('never cuts a blocked corner diagonally', () => {
    block(3, 2);
    block(2, 3);
    const path = findPath(2, 2, 3, 3);
    expect(path.length).toBeGreaterThan(0);
    const steps = [[2, 2], ...path];
    for (let i = 1; i < steps.length; i++) {
      const [ax, ay] = steps[i - 1], [bx, by] = steps[i];
      if (ax !== bx && ay !== by) {
        expect(G.blk[ay * MW + bx]).toBe(0);
        expect(G.blk[by * MW + ax]).toBe(0);
      }
    }
  });

  it('heads for the closest reachable tile when the goal is walled off', () => {
    for (let x = 20; x <= 24; x++) { block(x, 20); block(x, 24); }
    for (let y = 20; y <= 24; y++) { block(20, y); block(24, y); }
    const path = findPath(10, 22, 22, 22);
    expect(path.length).toBeGreaterThan(0);
    const [ex, ey] = path.at(-1) as [number, number];
    expect(Math.hypot(ex - 22, ey - 22)).toBeLessThan(4);
  });

  it('finds the nearest free tile', () => {
    block(5, 5);
    expect(nearestFree(5, 5)).not.toBeNull();
    const [x, y] = nearestFree(5, 5) as [number, number];
    expect(Math.max(Math.abs(x - 5), Math.abs(y - 5))).toBe(1);
  });

  it('smooths an open path to a straight line', () => {
    const path = findPath(1, 1, 12, 7);
    const smooth = smoothPath(48, 48, path);
    expect(smooth.length).toBe(1);
    expect(smooth[0]).toEqual([12, 7]);
    block(6, 4);
    expect(los(48, 48, 12.5 * 32, 7.5 * 32)).toBe(false);
  });
});
