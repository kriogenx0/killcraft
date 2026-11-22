import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks } from './state.ts';
import { TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { dealDamage } from './combat.ts';
import { updLeader } from './bounty.ts';
import { BOUNTY_SHARE } from '../data/economy.ts';
import { UNIT } from '../data/unit.ts';

describe('bounty on the leader', () => {
  beforeEach(() => {
    hooks.notify = () => {};
    G.demo = true;
    initWorld(7);
    for (const a of ais) a.on = false;
  });
  afterEach(() => {
    G.demo = false;
    ais[1].on = true;
  });

  it('marks nobody while the sides are even', () => {
    updLeader();
    expect(G.leader).toBe(-1);
  });

  it('marks a side that pulls well ahead, and pays whoever destroys its things', () => {
    for (let i = 0; i < 4; i++) addBuilding('factory', 1, 40 + i * 4, 30, false);
    updLeader();
    expect(G.leader).toBe(1);
    const target = addUnit('tank', 1, 20 * TS, 40 * TS), shooter = addUnit('swordsman', 0, 21 * TS, 40 * TS);
    const before = G.credits[0];
    dealDamage(target, 10_000, shooter);
    expect(G.credits[0] - before).toBe(Math.round(UNIT.tank.cost * BOUNTY_SHARE));
  });

  it("pays nothing for the trailing side's losses", () => {
    for (let i = 0; i < 4; i++) addBuilding('factory', 1, 40 + i * 4, 30, false);
    updLeader();
    const target = addUnit('tank', 0, 20 * TS, 40 * TS), shooter = addUnit('swordsman', 1, 21 * TS, 40 * TS);
    const before = G.credits[1];
    dealDamage(target, 10_000, shooter);
    expect(G.credits[1]).toBe(before);
  });
});
