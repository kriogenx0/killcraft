// Workers in a played-out economy never look confused: no walking in circles, no flitting between
// jobs, no standing about and no setting out with a full load (see sim/dither.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { ais } from './ai.ts';
import { watchWorkers } from '../sim/dither.ts';
import { mulberry32 } from '../util/math.ts';

afterEach(() => {
  vi.restoreAllMocks();
  ais[0].on = true;
  ais[1].on = true;
  G.demo = false;
});

describe('Workers in a game', () => {
  for (const seed of [1, 5, 14, 18])
    it(`go about their work without dithering (map ${seed})`, () => {
      vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
      const errors: unknown[] = [];
      hooks.error = (e) => errors.push(e);
      G.demo = true;
      expect(watchWorkers(seed, 300)).toEqual([]);
      expect(errors).toEqual([]);
    }, 30_000);
});
