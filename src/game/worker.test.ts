import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { placeBuilding } from './building.ts';
import { applyCommand, parseCommand } from './command.ts';
import { BUILDING } from '../data/building.ts';
import { MEDIC_HEAL, WORKER_BUILD, WORKER_HEAL } from '../data/unit.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

const errors: unknown[] = [];

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261123));
  errors.length = 0;
  hooks.error = (e) => errors.push(e);
  G.reveal = true;
  G.demo = true;
  ais[0].on = false;
  ais[1].on = false;
  initWorld(1234);
});

afterEach(() => {
  vi.restoreAllMocks();
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
  expect(errors).toEqual([]);
});

describe('Workers', () => {
  it('help a building site nearby go up faster', () => {
    addBuilding('power', 0, 12, 50, false);
    const helped = placeBuilding(0, 'barracks', 16, 50), alone = placeBuilding(0, 'barracks', 13, 46);
    if (!helped || !alone) throw new Error('no site');
    addUnit('worker', 0, 19 * TS, 51 * TS); // idle (no refinery to dig for), right by the first site
    const t = BUILDING.barracks.t;
    run(t / (1 + WORKER_BUILD) + 2);
    expect(helped.done).toBe(true);
    expect(alone.done).toBe(false);
  });

  it('repair a damaged building, paying ore for it', () => {
    const b = addBuilding('power', 0, 16, 50, false);
    b.hp = b.maxhp * 0.5;
    const w = addUnit('worker', 0, 19 * TS, 51 * TS), ore = G.credits[0];
    run(4);
    expect(w.order?.t).toBe('heal');
    run(30);
    expect(b.hp).toBe(b.maxhp);
    expect(b.repairing).toBeFalsy(); // the Workers did it, not the Repair button
    expect(G.credits[0]).toBeLessThan(ore);
  });

  it('patch up wounded troops, slower than a Medic', () => {
    const s = addUnit('swordsman', 0, 20 * TS, 50 * TS), w = addUnit('worker', 0, 22 * TS, 50 * TS);
    s.hp = 20;
    run(8);
    expect(w.order?.t).toBe('heal');
    const before = s.hp;
    run(5);
    const gained = s.hp - before;
    expect(gained).toBeGreaterThan(WORKER_HEAL * 5 * 0.8);
    expect(gained).toBeLessThan(MEDIC_HEAL * 5);
  });

  it('fight back weakly with a pick', () => {
    const w = addUnit('worker', 0, 20 * TS, 50 * TS), foe = addUnit('swordsman', 1, 21 * TS, 50 * TS);
    run(3);
    expect(w.dead).toBe(false);
    expect(w.order?.t).toBe('attack');
    expect(foe.hp).toBeLessThan(foe.maxhp);
    expect(foe.hp).toBeGreaterThan(foe.maxhp * 0.6);
  });

  it("stay off fights and mending on the passive stance when an enemy is about", () => {
    const s = addUnit('swordsman', 0, 20 * TS, 50 * TS), w = addUnit('worker', 0, 22 * TS, 50 * TS);
    s.hp = 20;
    w.stance = 'passive';
    const foe = addUnit('crossbowman', 1, 25 * TS, 50 * TS);
    foe.stance = 'passive';
    run(1);
    expect(w.order?.t).toBe('move'); // running away
  });

  it('go and mend what a player right-clicks, however far', () => {
    const b = addBuilding('power', 0, 16, 40, false);
    b.hp = b.maxhp * 0.5;
    const w = addUnit('worker', 0, 30 * TS, 56 * TS);
    const cmd = parseCommand({ c: 'fix', ids: [w.id], target: b.id });
    expect(cmd).toEqual({ c: 'fix', ids: [w.id], target: b.id });
    if (!cmd) return;
    applyCommand(0, cmd);
    expect(w.order).toMatchObject({ t: 'heal', tgt: b.id, sent: true });
    run(40);
    expect(b.hp).toBe(b.maxhp);
    // another side can't order them
    applyCommand(1, { c: 'fix', ids: [w.id], target: b.id });
    expect(w.order?.t).not.toBe('heal');
  });
});

describe('the computer', () => {
  it('takes a Worker off the ore to help a site go up', () => {
    ais[0].on = true;
    addBuilding('power', 0, 12, 50, false);
    addBuilding('refinery', 0, 6, 46, false);
    for (let i = 0; i < 3; i++) addUnit('worker', 0, (12 + i) * TS, 47 * TS);
    run(2);
    const site = G.ents.find((e) => !e.dead && e.team === 0 && e.kind === 'bld' && !e.done) ?? placeBuilding(0, 'barracks', 16, 50);
    if (!site) throw new Error('no site');
    run(2);
    expect(G.ents.some((e) => !e.dead && e.type === 'worker' && e.team === 0 && e.order?.t === 'heal' && e.order.tgt === site.id)).toBe(true);
  });
});
