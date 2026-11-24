import { describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { MW } from './const.ts';
import { initWorld } from './world.ts';
import { COW_COLORS, cows, pasture, updateCows } from './cows.ts';

const snapshot = () => cows.list.map((c) => [c.x.toFixed(3), c.y.toFixed(3), c.color]);

describe('cows', () => {
  it('places herds on open grass, each with a purple cow', () => {
    for (const seed of [1, 42, 777, 12345]) {
      initWorld(seed);
      updateCows(0);
      expect(cows.herds.length).toBeGreaterThanOrEqual(2);
      for (let h = 0; h < cows.herds.length; h++) {
        const herd = cows.list.filter((c) => c.herd === h);
        expect(herd.length).toBeGreaterThanOrEqual(4);
        expect(herd.some((c) => c.color === COW_COLORS[0])).toBe(true);
      }
      for (const c of cows.list) expect(pasture(c.x, c.y)).toBe(true);
    }
  });

  it('wander the same way on every screen, and stay on grass', () => {
    initWorld(99);
    updateCows(0);
    const start = snapshot();
    updateCows(120);
    const a = snapshot();
    expect(a).not.toEqual(start);
    initWorld(99);
    for (let t = 0; t <= 120; t += 0.37) updateCows(t);
    updateCows(120);
    expect(snapshot()).toEqual(a);
    for (const c of cows.list) expect(G.terr[Math.floor(c.y) * MW + Math.floor(c.x)]).toBe(0);
  });
});
