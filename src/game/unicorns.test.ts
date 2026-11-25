import { describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { initWorld } from './world.ts';
import { pasture } from './cows.ts';
import { currentUnicorns, unicornAt } from './unicorns.ts';

describe('unicorns', () => {
  it('wander open meadows, the same on every screen, and are never units anyone can catch', () => {
    for (const seed of [1, 42, 777, 12345]) {
      initWorld(seed);
      const list = currentUnicorns();
      expect(list.length).toBeGreaterThanOrEqual(1);
      for (const u of list) for (const t of [0, 37, 300, 1800]) { const p = unicornAt(u, t); expect(pasture(p.x, p.y)).toBe(true); }
      const first = list.map((u) => unicornAt(u, 90));
      initWorld(seed);
      expect(currentUnicorns().map((u) => unicornAt(u, 90))).toEqual(first);
      expect(G.ents.some((e) => (e.type as string) === 'unicorn')).toBe(false);
    }
  });
});
