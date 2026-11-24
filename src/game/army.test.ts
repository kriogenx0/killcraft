import { beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
import { addUnit } from './entity.ts';
import { armyShares } from './army.ts';

describe('army shares', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    initWorld(1234, 4);
    // start from an empty field: no starting armies or Workers
    for (const e of G.ents) if (e.kind === 'unit') e.dead = true;
  });

  it('splits by what the units cost, leaving out Workers and beaten sides', () => {
    addUnit('swordsman', 0, 100, 100); // 175
    addUnit('swordsman', 0, 120, 100); // 175
    addUnit('rifleman', 1, 300, 300); // 100 + 20 wood
    addUnit('worker', 2, 400, 400); // a Worker isn't army
    const s = armyShares();
    expect(s.map((x) => x.team)).toEqual([0, 1]);
    expect(s[0].share).toBeCloseTo(350 / 470);
    expect(s[0].share + s[1].share).toBeCloseTo(1);
  });

  it('is empty when nobody has an army', () => {
    expect(armyShares()).toEqual([]);
  });
});
