// Big crowds on the move don't jam: units pass waypoints when level with them, stop at the edge of
// a crowd already standing at their spot, and idle friends in a lane walk on out of the way.
import { afterEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
import { runAll } from '../sim/jam.ts';

describe('crowds', () => {
  afterEach(() => {
    Object.assign(G, { demo: false, headless: false, viewer: 0, human: [true, false] });
    initWorld(1);
    ais[0].on = false;
    ais[1].on = true;
  });

  it('fifty units sent one by one to a rally spot stop round it instead of pushing into the middle', () => {
    // before: 9.3 s lost per unit and 7 six-second stalls
    const [r] = runAll(3, 'rally');
    expect(r.late).toBeLessThan(5);
    expect(r.slow).toBeLessThan(3);
  });

  it('an army squeezes through a two-tile gap without stalling', () => {
    // before: 20 six-second stalls with seed 3 and 13 with seed 13
    for (const seed of [3, 13]) {
      const [r] = runAll(seed, 'choke');
      expect(r.done).toBe(r.units);
      expect(r.slow).toBeLessThan(12);
    }
  });

  it('troops threading the lanes of a real base to a rally spot keep moving', () => {
    // seed 17 had 38 six-second stalls: units stopping in a lane exit and blocking it
    const [r] = runAll(17, 'base');
    expect(r.done).toBe(r.units);
    expect(r.slow).toBeLessThan(20);
  }, 60_000);
});
