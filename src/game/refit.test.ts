import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G } from './state.ts';
import { STEP } from './const.ts';
import { ais, aiThink } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, power } from './entity.ts';
import { applyCommand, parseCommand } from './command.ts';
import { behind, bldHp, canRefit, refitBonus, refitPrice, refitTime } from './refit.ts';
import { encodeEnt } from '../net/snapshot.ts';
import { BUILDING, UPGRADE_BONUS, UPGRADE_HP } from '../data/building.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

const yardOf = (team: number) => {
  const y = G.ents.find((e) => e.team === team && e.type === 'yard');
  if (!y) throw new Error('no yard');
  return y;
};

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261123));
  G.demo = true;
  ais[0].on = false;
  ais[1].on = false;
  initWorld(1234);
});

afterEach(() => {
  vi.restoreAllMocks();
  ais[0].on = false;
  ais[1].on = true;
  G.demo = false;
});

describe('building upgrades', () => {
  it('keeps the look of the age a building was built in', () => {
    const yard = yardOf(0);
    expect(yard.lvl).toBe(0);
    G.era[0] = 1;
    expect(yard.lvl).toBe(0); // reaching an age restyles nothing
    expect(behind(yard)).toBe(true);
    const p = addBuilding('power', 0, yard.tx + 5, yard.ty, false);
    expect(p.lvl).toBe(1); // built in the new age, in its style
    expect(p.maxhp).toBe(bldHp('power', 1));
    expect(behind(p)).toBe(false);
  });

  it('upgrades one building for a price and some time, with a little more health and output', () => {
    const yard = yardOf(0);
    const p = addBuilding('power', 0, yard.tx + 5, yard.ty, false);
    expect(canRefit(p)).toBe(false); // nothing to upgrade to yet
    G.era[0] = 1;
    G.credits[0] = 5000; G.wood[0] = 1000;
    const made = power(0).made, price = refitPrice(p);
    expect(price.ore).toBe(Math.round((BUILDING.power.cost * 0.5) / 10) * 10);
    const cmd = parseCommand({ c: 'upgrade', id: p.id });
    expect(cmd).toEqual({ c: 'upgrade', id: p.id });
    if (cmd) applyCommand(0, cmd);
    expect(p.upT).toBe(0);
    expect(G.credits[0]).toBe(5000 - price.ore);
    run(refitTime(p) / 2);
    expect(p.lvl).toBe(0);
    run(refitTime(p) / 2 + 1);
    expect(p.upT).toBeUndefined();
    expect(p.lvl).toBe(1);
    expect(UPGRADE_HP).toBe(0.4);
    expect(p.maxhp).toBe(Math.round(BUILDING.power.hp * (1 + UPGRADE_HP)));
    expect(p.hp).toBe(p.maxhp);
    expect(refitBonus(p)).toBeCloseTo(1 + UPGRADE_BONUS);
    expect(power(0).made).toBeGreaterThan(made);
    expect(canRefit(p)).toBe(false); // caught up with its side
  });

  it('refunds a cancelled upgrade in full and needs the full price to start', () => {
    const yard = yardOf(0);
    G.era[0] = 2;
    G.credits[0] = 10; G.wood[0] = 0;
    applyCommand(0, { c: 'upgrade', id: yard.id });
    expect(yard.upT).toBeUndefined();
    G.credits[0] = 5000; G.wood[0] = 1000;
    applyCommand(0, { c: 'upgrade', id: yard.id });
    expect(yard.upT).toBe(0);
    run(2);
    applyCommand(0, { c: 'upgrade', id: yard.id });
    expect(yard.upT).toBeUndefined();
    expect(G.credits[0]).toBe(5000);
    expect(G.wood[0]).toBe(1000);
    expect(yard.lvl).toBe(0);
  });

  it("can't upgrade someone else's building", () => {
    G.era[1] = 1;
    G.credits[0] = 5000;
    const theirs = yardOf(1);
    applyCommand(0, { c: 'upgrade', id: theirs.id });
    expect(theirs.upT).toBeUndefined();
  });

  it('sends the age and upgrade progress to the client', () => {
    const yard = yardOf(0);
    G.era[0] = 1;
    G.credits[0] = 5000; G.wood[0] = 1000;
    applyCommand(0, { c: 'upgrade', id: yard.id });
    run(1);
    const row = encodeEnt(yard, true);
    expect(row[13]).toBe(0);
    expect(row[14]).toBeGreaterThan(0);
    expect(encodeEnt(yard, false)[14]).toBe(-1); // the enemy doesn't see the progress
  });

  it("the computer upgrades a cheaper building while it can't yet afford the Town Hall", () => {
    const yard = yardOf(1);
    const p = addBuilding('power', 1, yard.tx - 4, yard.ty, false);
    G.era[1] = 1;
    G.credits[1] = refitPrice(p).ore + 400; G.wood[1] = 500;
    expect(G.credits[1]).toBeLessThan(refitPrice(yard).ore);
    aiThink(1);
    expect(p.upT).toBe(0);
    expect(yard.upT).toBeUndefined();
  });

  it('the computer upgrades the buildings it had once it reaches a new age', () => {
    ais[0].on = true; ais[1].on = true;
    initWorld(99);
    let t = 0;
    while (t < 900 && !G.over && G.era.every((e) => !e)) { run(1); t++; }
    expect(G.era.some((e) => e > 0)).toBe(true);
    // a side can reach an age just as it's beaten and broke: give the other time to get there too
    // (new buildings go up in the side's age already: only a building that gained a level counts)
    const seen = new Map<number, number>();
    const upgraded = () => G.ents.some((e) => {
      if (e.dead || e.kind !== 'bld') return false;
      if (!seen.has(e.id)) seen.set(e.id, e.lvl ?? 0);
      return (e.lvl ?? 0) > (seen.get(e.id) ?? 0);
    });
    for (let i = 0; i < 120 && !G.over && !upgraded(); i++) run(5);
    expect(upgraded()).toBe(true);
  }, 20_000); // a long computer game on the bigger maps

  it('the computer upgrades its buildings once it has ore to spare', () => {
    G.era[1] = 1;
    G.credits[1] = 6000; G.wood[1] = 2000;
    aiThink(1);
    const upgrading = G.ents.filter((e) => e.team === 1 && e.upT != null);
    expect(upgrading.map((e) => e.type)).toEqual(['yard']);
  });
});
