import { afterEach, describe, expect, it } from 'vitest';
import { G } from '../game/state.ts';
import { ais } from '../game/ai.ts';
import { initWorld } from '../game/world.ts';
import { FFA_YARDS } from '../data/map.ts';
import { playMatch } from './match.ts';
import { report } from './report.ts';

afterEach(() => {
  // leave the engine as the two-player tests expect it
  Object.assign(G, { demo: false, headless: false, viewer: 0, human: [true, false] });
  initWorld(1);
  ais[0].on = false;
  ais[1].on = true;
});

describe('four-player free-for-all', () => {
  it('puts a base in each corner, reachable from the others', () => {
    initWorld(5, 4);
    expect(G.teams).toBe(4);
    for (let t = 0; t < 4; t++) {
      const yard = G.ents.find((e) => e.team === t && e.type === 'yard');
      expect(yard && [yard.tx, yard.ty]).toEqual(FFA_YARDS[t]);
      expect(G.credits[t]).toBeGreaterThan(0);
    }
  });

  it('plays computer players against each other, seeded so a match replays the same', () => {
    const a = playMatch({ seed: 3, maxSeconds: 420 }), b = playMatch({ seed: 3, maxSeconds: 420 });
    expect(a.errors).toBe(0);
    expect(a.stats).toHaveLength(4);
    expect(b).toEqual(a);
    for (const s of a.stats) {
      expect(s.income).toBeGreaterThan(0);
      expect(s.built.refinery).toBeGreaterThan(0);
    }
    expect(a.firstBlood).not.toBeNull();
    expect(report([a])).toContain('Win rate by starting corner');
  }, 120_000); // two full four-player matches
});
