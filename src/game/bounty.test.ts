import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks } from './state.ts';
import { TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { dealDamage } from './combat.ts';
import { bankLoot, updLeader } from './bounty.ts';
import { salvageOf } from './economy.ts';
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

  it('marks a side that pulls well ahead; destroying its things earns loot that counts once carried home', () => {
    for (let i = 0; i < 4; i++) addBuilding('factory', 1, 40 + i * 4, 30, false);
    updLeader();
    expect(G.leader).toBe(1);
    const target = addUnit('tank', 1, 20 * TS, 40 * TS), shooter = addUnit('swordsman', 0, 21 * TS, 40 * TS);
    const before = G.credits[0], loot = Math.round(UNIT.tank.cost * BOUNTY_SHARE);
    dealDamage(target, 10_000, shooter);
    expect(shooter.loot).toBe(loot);
    bankLoot();
    expect(G.credits[0]).toBe(before); // still out in the field
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    shooter.x = yard.x; shooter.y = (yard.ty + yard.h + 0.5) * TS;
    bankLoot();
    expect(G.credits[0] - before).toBe(loot);
    expect(shooter.loot).toBe(0);
  });

  it('drops a dead carrier\'s loot as ore where it falls', () => {
    const carrier = addUnit('swordsman', 0, 20 * TS, 40 * TS);
    carrier.loot = 300;
    expect(salvageOf(carrier)).toBeGreaterThanOrEqual(300);
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
