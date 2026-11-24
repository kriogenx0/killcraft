import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G } from './state.ts';
import { STEP } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding } from './entity.ts';
import { applyCommand } from './command.ts';
import { priceOf } from './production.ts';
import { mulberry32 } from '../util/math.ts';

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(1));
  ais[0].on = false;
  ais[1].on = false;
  initWorld(1234);
  // no Workers hauling ore in, so the bank only moves when an order is charged or refunded
  G.ents = G.ents.filter((e) => e.team !== 0 || e.kind !== 'unit');
  addBuilding('barracks', 0, 13, 50, false);
  G.credits[0] = 10000;
  G.wood[0] = 10000;
});

afterEach(() => {
  vi.restoreAllMocks();
  ais[1].on = true;
});

const ore = priceOf('swordsman').ore;
const queue = () => G.prod[0].infantry;

describe("a player's queued orders", () => {
  it('are charged only when they start training, one at a time', () => {
    for (let i = 0; i < 3; i++) applyCommand(0, { c: 'build', type: 'swordsman' });
    expect(queue().map((x) => x.paid)).toEqual([true, false, false]);
    expect(G.credits[0]).toBe(10000 - ore);
    // the first one finishes: only then is the second charged
    for (let t = 0; queue().length === 3 && t < 120; t += STEP) update(STEP);
    expect(G.credits[0]).toBe(10000 - ore);
    update(STEP);
    expect(queue().map((x) => x.paid)).toEqual([true, false]);
    expect(G.credits[0]).toBe(10000 - 2 * ore);
  });

  it('refund only what was charged when cancelled', () => {
    for (let i = 0; i < 3; i++) applyCommand(0, { c: 'build', type: 'swordsman' });
    applyCommand(0, { c: 'cancel', type: 'swordsman' }); // the newest: never charged, nothing back
    expect(G.credits[0]).toBe(10000 - ore);
    applyCommand(0, { c: 'cancel', type: 'swordsman' });
    applyCommand(0, { c: 'cancel', type: 'swordsman' }); // the one training: charged, refunded in full
    expect(queue()).toHaveLength(0);
    expect(G.credits[0]).toBe(10000);
  });
});
