import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { STEP } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, stranded, update } from './world.ts';
import { addBuilding, kill } from './entity.ts';
import { enqueue } from './production.ts';
import { UNIT } from '../data/unit.ts';

const run = (seconds: number) => { for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP); };
const own = (team: number, kind: 'unit' | 'bld') => G.ents.filter((e) => !e.dead && e.team === team && e.kind === kind);
const yard = (team: number) => own(team, 'bld').find((e) => e.type === 'yard')!;

beforeEach(() => {
  initWorld(1);
  G.demo = true;
  ais[0].on = ais[1].on = false;
  // red loses every unit it has
  for (const u of own(1, 'unit')) kill(u);
});

afterEach(() => {
  initWorld(1);
  ais[0].on = false;
  ais[1].on = true;
});

describe('a side that can never recover', () => {
  it('keeps playing with a Town Hall and the ore for a Worker', () => {
    G.credits[1] = UNIT.worker.cost;
    expect(stranded(1)).toBe(false);
    run(5);
    expect(G.over).toBe(false);
    expect(yard(1)).toBeTruthy();
  });

  it('is out when it has no units and can\'t pay for a Worker: its buildings blow up', () => {
    addBuilding('refinery', 1, yard(1).tx - 5, yard(1).ty, false);
    G.credits[1] = UNIT.worker.cost - 1;
    expect(stranded(1)).toBe(true);
    run(8);
    expect(own(1, 'bld')).toHaveLength(0);
    expect(G.over).toBe(true);
    expect(G.winner).toBe(0);
  });

  it('is out with ore but nothing left that trains Workers', () => {
    const refinery = addBuilding('refinery', 1, yard(1).tx - 5, yard(1).ty, false);
    kill(yard(1));
    G.credits[1] = 10_000;
    expect(stranded(1)).toBe(true);
    run(8);
    expect(refinery.dead).toBe(true);
    expect(G.winner).toBe(0);
  });

  it('can still get a Worker from a Barracks after losing the Town Hall', () => {
    addBuilding('barracks', 1, yard(1).tx - 5, yard(1).ty, false);
    kill(yard(1));
    G.credits[1] = UNIT.worker.cost;
    expect(stranded(1)).toBe(false);
  });

  it('counts a Worker it has paid for and is training as a unit', () => {
    G.credits[1] = UNIT.worker.cost;
    expect(enqueue(1, 'worker')).toBe(true);
    expect(G.credits[1]).toBe(0);
    expect(stranded(1)).toBe(false);
    run(3);
    expect(G.over).toBe(false);
  });
});
