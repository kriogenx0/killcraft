// The Mystery Egg: a slow Aether gamble that hatches a random special unit, sometimes a Titan Chicken.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { atLimit, available, enqueue, unitSlots } from './production.ts';
import { acquire, betterTarget } from './combat.ts';
import { CHICKEN_CHANCE, MYSTERY_POOL, hatch, hatchable } from './mystery.ts';
import { UNIT } from '../data/unit.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

beforeEach(() => {
  G.reveal = true;
  G.demo = true;
  ais[0].on = ais[1].on = false;
  initWorld(1234);
  G.ents = [];
  G.projs = [];
});

afterEach(() => {
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

describe('the Mystery Egg', () => {
  it('needs Aether, trains slowly, one at a time', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 12, 46, false);
    expect(available(0, 'infantry')).not.toContain('mystery');
    G.aetherFound[0] = true;
    expect(available(0, 'infantry')).toContain('mystery');
    expect(UNIT.mystery.t).toBeGreaterThanOrEqual(60);
    G.credits[0] = 99999; G.aether[0] = 999;
    expect(enqueue(0, 'mystery', true)).toBe(true);
    expect(atLimit(0, 'mystery')).toBe(true);
    expect(enqueue(0, 'mystery', true)).toBe(false);
  });

  it('hatches into a special unit, never an egg', () => {
    addBuilding('yard', 0, 4, 40, false);
    addBuilding('yard', 1, 80, 10, false);
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 12, 46, false);
    G.aetherFound[0] = true;
    G.credits[0] = 99999; G.aether[0] = 999;
    enqueue(0, 'mystery', true);
    run(UNIT.mystery.t + 5);
    expect(G.ents.some((e) => e.type === 'mystery')).toBe(false);
    const out = G.ents.filter((e) => !e.dead && e.team === 0 && e.kind === 'unit');
    expect(out).toHaveLength(1);
    expect([...MYSTERY_POOL, 'chicken']).toContain(out[0].type);
  });

  it('sometimes hatches a Titan Chicken, which can\'t be trained on its own', () => {
    expect(hatch(0, 0, 0)).toBe('chicken');
    expect(hatch(0, 0, CHICKEN_CHANCE + 0.01)).not.toBe('chicken');
    addBuilding('barracks', 0, 12, 46, false);
    G.aetherFound[0] = true;
    expect(available(0, 'infantry')).not.toContain('chicken');
    expect(unitSlots(0)).not.toContain('chicken');
  });

  it('only hatches what the side\'s age allows, and no second Titan', () => {
    expect(hatchable(0, 0).every((t) => UNIT[t].era === 0)).toBe(true);
    expect(hatchable(0, 1)).toContain('giant');
    addUnit('giant', 0, 20 * TS, 30 * TS);
    expect(hatchable(0, 1)).not.toContain('giant');
  });

  it('the Titan Chicken draws every enemy nearby onto itself', () => {
    const y = 30 * TS, rifle = addUnit('rifleman', 1, 20 * TS, y);
    const tank = addUnit('tank', 0, 20 * TS + 60, y);
    expect(acquire(rifle, 4)).toBe(tank);
    const chick = addUnit('chicken', 0, 20 * TS + 100, y + 20);
    expect(acquire(rifle, 4)).toBe(chick);
    expect(betterTarget(rifle, tank, 4)).toBe(chick);
    // a target the player picked stays picked
    expect(betterTarget(rifle, tank, 4, true)).toBe(null);
  });
});
