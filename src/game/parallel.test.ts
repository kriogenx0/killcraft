// Every Barracks trains its own order at the same time, so two train twice as fast (Alex, 2026-11-25).
import { beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { STEP } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding } from './entity.ts';
import { enqueue } from './production.ts';
import { UNIT } from '../data/unit.ts';

beforeEach(() => {
  for (const a of ais) a.on = false;
  G.reveal = true;
  G.demo = true;
  initWorld(1234);
  G.leader = -1;
  addBuilding('power', 0, 10, 50, false);
  addBuilding('power', 0, 10, 53, false);
  G.credits[0] = 10000;
  G.wood[0] = 10000;
});

/** Seconds to train n Swordsmen with the side's Barracks. */
const trainAll = (n: number): number => {
  for (let i = 0; i < n; i++) expect(enqueue(0, 'swordsman')).toBe(true);
  let t = 0;
  while (G.prod[0].infantry.length && t < 300) { update(STEP); t += STEP; G.leader = -1; }
  return t;
};
const swordsmen = () => G.ents.filter((e) => !e.dead && e.team === 0 && e.type === 'swordsman');

describe('several Barracks', () => {
  it('one Barracks trains its queue one at a time', () => {
    addBuilding('barracks', 0, 13, 50, false);
    expect(trainAll(4)).toBeCloseTo(4 * UNIT.swordsman.t, 0);
  });

  it('two Barracks train the same queue twice as fast, each sending out its own', () => {
    const a = addBuilding('barracks', 0, 13, 50, false), b = addBuilding('barracks', 0, 13, 40, false);
    const before = swordsmen().length;
    expect(trainAll(4)).toBeCloseTo(2 * UNIT.swordsman.t, 0);
    const made = swordsmen().slice(before);
    expect(made).toHaveLength(4);
    // two came out by each Barracks
    const near = (e: { y: number }, bld: { y: number }) => Math.abs(e.y - bld.y) < Math.abs(e.y - (bld === a ? b : a).y);
    expect(made.filter((u) => near(u, a))).toHaveLength(2);
    expect(made.filter((u) => near(u, b))).toHaveLength(2);
  });

  it("an order whose Barracks falls moves on to the other one, keeping its progress", () => {
    const a = addBuilding('barracks', 0, 13, 50, false);
    addBuilding('barracks', 0, 13, 40, false);
    enqueue(0, 'swordsman');
    enqueue(0, 'swordsman');
    for (let t = 0; t < UNIT.swordsman.t / 2; t += STEP) update(STEP);
    const [first, second] = G.prod[0].infantry;
    const lost = first.at === a.id ? first : second;
    const kept = lost.prog;
    a.dead = true;
    update(STEP);
    expect(G.prod[0].infantry).toHaveLength(2);
    expect(lost.prog).toBeGreaterThanOrEqual(kept);
    expect(G.prod[0].infantry.filter((x) => x.at != null)).toHaveLength(1); // one free Barracks left
  });

});
