import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { STEP } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit } from './entity.ts';
import { enqueue } from './production.ts';
import { dealDamage } from './combat.ts';
import { noteGathered, summarize } from './stats.ts';
import { UNIT } from '../data/unit.ts';

const run = (seconds: number) => { for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP); };

beforeEach(() => {
  initWorld(1);
  G.demo = true;
  ais[0].on = ais[1].on = false;
});

afterEach(() => {
  initWorld(1);
  ais[0].on = false;
  ais[1].on = true;
});

describe('end of game stats', () => {
  it('counts units trained', () => {
    G.credits[0] = 5000;
    run(0.1);
    expect(enqueue(0, 'worker')).toBe(true);
    run(UNIT.worker.t + 2);
    expect(summarize()[0].trained).toBe(1);
    expect(summarize()[0].spent.ore).toBeGreaterThanOrEqual(UNIT.worker.cost);
  });

  it('counts kills for the killer and losses for the victim', () => {
    const a = addUnit('worker', 0, 100, 100), b = addUnit('worker', 1, 110, 100);
    dealDamage(b, 99999, a);
    const [blue, red] = summarize();
    expect(blue.killed).toBe(1);
    expect(red.lost).toBe(1);
    expect(blue.lost).toBe(0);
  });

  it('counts what was gathered and when each age was reached', () => {
    noteGathered(0, 'wood', 120);
    G.era[0] = 1;
    run(1.5);
    const [blue] = summarize();
    expect(blue.gathered.wood).toBe(120);
    expect(blue.ages.length).toBe(2);
    expect(blue.ages[1]).toBeLessThanOrEqual(2);
  });

  it('shows upgrade and healing levels', () => {
    G.upg[1].infWeapon = 2;
    G.heal[1] = 1;
    const red = summarize()[1];
    expect(red.upg.infWeapon).toBe(2);
    expect(red.upg.vehArmor).toBe(0);
    expect(red.heal).toBe(1);
  });
});
