// A big army trains slower (Alex's rule, ARMY_SLOW_FROM in data/economy.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { armySize, armySlow, enqueue } from './production.ts';
import { ARMY_SLOW_FROM, ARMY_SLOW_STEP } from '../data/economy.ts';
import { UNIT } from '../data/unit.ts';

beforeEach(() => {
  for (const a of ais) a.on = false;
  G.reveal = true;
  G.demo = true;
  initWorld(1234);
  G.leader = -1;
});

const fill = (n: number) => { for (let i = 0; i < n; i++) addUnit('swordsman', 0, (30 + (i % 10)) * TS, (20 + Math.floor(i / 10)) * TS); };

describe('a big army', () => {
  it('counts only fighting units', () => {
    const before = armySize(0);
    addUnit('worker', 0, 30 * TS, 30 * TS);
    addUnit('medic', 0, 31 * TS, 30 * TS);
    expect(armySize(0)).toBe(before);
    addUnit('knight', 0, 32 * TS, 30 * TS);
    expect(armySize(0)).toBe(before + 1);
  });

  it('trains no slower up to the threshold, then a little slower for each fighter more', () => {
    expect(armySlow(0, ARMY_SLOW_FROM)).toBe(1);
    expect(armySlow(0, ARMY_SLOW_FROM + 10)).toBeCloseTo(1 + 10 * ARMY_SLOW_STEP);
  });

  it('makes a Barracks take longer per soldier', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('power', 0, 10, 53, false);
    addBuilding('barracks', 0, 13, 50, false);
    const timeFor = () => {
      G.credits[0] = 10000;
      expect(enqueue(0, 'swordsman')).toBe(true);
      let t = 0;
      while (G.prod[0].infantry.length && t < 120) { update(STEP); t += STEP; G.leader = -1; }
      return t;
    };
    const small = timeFor();
    fill(ARMY_SLOW_FROM + 25 - armySize(0));
    const big = timeFor();
    expect(small).toBeCloseTo(UNIT.swordsman.t, 0);
    expect(big / small).toBeGreaterThan(1 + 20 * ARMY_SLOW_STEP);
  });
});
