import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G } from './state.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
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
  it('are paid for in full the moment they are queued', () => {
    for (let i = 0; i < 3; i++) applyCommand(0, { c: 'build', type: 'swordsman' });
    expect(queue().map((x) => x.paid)).toEqual([true, true, true]);
    expect(G.credits[0]).toBe(10000 - 3 * ore);
  });

  it("are turned down when the side can't pay", () => {
    G.credits[0] = ore * 2 - 1;
    for (let i = 0; i < 3; i++) applyCommand(0, { c: 'build', type: 'swordsman' });
    expect(queue()).toHaveLength(1);
    expect(G.credits[0]).toBe(ore - 1);
  });

  it('refund in full when cancelled', () => {
    for (let i = 0; i < 3; i++) applyCommand(0, { c: 'build', type: 'swordsman' });
    for (let i = 0; i < 3; i++) applyCommand(0, { c: 'cancel', type: 'swordsman' });
    expect(queue()).toHaveLength(0);
    expect(G.credits[0]).toBe(10000);
  });
});
