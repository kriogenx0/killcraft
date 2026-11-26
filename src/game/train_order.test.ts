// The train menu: every unit that costs Aether sits together at the end of its building's list.
import { expect, it } from 'vitest';
import { G } from './state.ts';
import { initWorld } from './world.ts';
import { priceOf, unitSlots } from './production.ts';
import { UNIT, UNIT_TYPES } from '../data/unit.ts';

it('puts Aether units together, last in each building\'s list', () => {
  initWorld(1234);
  G.aetherFound[0] = true;
  G.tamed[0] = UNIT_TYPES.filter((t) => UNIT[t].beast);
  for (const era of [0, 1, 2]) {
    G.era[0] = era;
    const slots = unitSlots(0);
    expect(slots.some((t) => priceOf(t).aether > 0)).toBe(true);
    for (const line of ['infantry', 'vehicle', 'air'] as const) {
      const list = slots.filter((t) => UNIT[t].producer === line), first = list.findIndex((t) => priceOf(t).aether > 0);
      if (first >= 0) expect(list.slice(first).every((t) => priceOf(t).aether > 0)).toBe(true);
    }
    expect(unitSlots(0)).toEqual(slots); // stable
  }
});
