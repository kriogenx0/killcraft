import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { MW, STEP, TREE, TS } from './const.ts';
import { ais, assignHaulers } from './ai.ts';
import { rebuildBlk } from './map.ts';
import { orderHarvest } from './order.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, kill } from './entity.ts';
import { advanceSite, placeBuilding } from './building.ts';
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
  it('dig ore from the very start and bank it at the Town Hall, before there is a Refinery', () => {
    // regression: the two starting Workers dug a load and then stood still, since only a Refinery took ore
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    expect(G.ents.some((e) => e.team === 0 && e.type === 'refinery')).toBe(false);
    const ws = G.ents.filter((e) => e.team === 0 && e.type === 'worker');
    expect(ws).toHaveLength(2);
    let ore = -1, bd = Infinity;
    for (let i = 0; i < G.ore.length; i++) {
      const d = Math.hypot((i % MW) - yard.tx, Math.floor(i / MW) - yard.ty);
      if (G.ore[i] > 0 && d < bd) { bd = d; ore = i; }
    }
    const start = G.credits[0];
    applyCommand(0, { c: 'harvest', ids: ws.map((w) => w.id), tx: ore % MW, ty: Math.floor(ore / MW) });
    run(60);
    expect(G.credits[0]).toBeGreaterThan(start + 600); // several loads banked
    for (const w of ws) expect(w.order?.t).toBe('harvest');
  });

  it('the computer moves Workers to whatever it is short of, and back once it has plenty', () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    const mx = yard.tx + 8, my = yard.ty;
    for (let y = my - 2; y < my + 4; y++) for (let x = mx + 3; x < mx + 6; x++) { G.terr[y * MW + x] = TREE; G.treeWood[y * MW + x] = 150; }
    const mill = addBuilding('mill', 0, mx, my, false);
    rebuildBlk();
    const ws = [...G.ents.filter((e) => e.team === 0 && e.type === 'worker')];
    while (ws.length < 6) ws.push(addUnit('worker', 0, yard.x, yard.y + 3 * TS));
    for (const w of ws) orderHarvest(w, yard.tx, yard.ty + 4);
    const choppers = () => ws.filter((w) => w.order?.t === 'harvest' && w.order.src === mill.id).length;
    // out of wood with ore to spare: extra hands on the trees
    G.credits[0] = 2000; G.wood[0] = 0;
    assignHaulers(0);
    expect(choppers()).toBe(4);
    // plenty of wood now: all of them back on the ore
    G.wood[0] = 5000;
    G.gameT += 30; // it settles on a split for a while before looking again
    assignHaulers(0);
    expect(choppers()).toBe(0);
    expect(ws.every((w) => w.order?.t === 'harvest' && !w.order.res)).toBe(true);
    // short of ore, wood fine: a single chopper keeps the wood coming
    G.credits[0] = 100; G.wood[0] = 600;
    G.gameT += 30;
    assignHaulers(0);
    expect(choppers()).toBe(1);
  });

  it('build sites: nothing goes up without one, and two build twice as fast', () => {
    addBuilding('power', 0, 12, 50, false);
    const helped = placeBuilding(0, 'barracks', 16, 50), alone = placeBuilding(0, 'barracks', 13, 46);
    if (!helped || !alone) throw new Error('no site');
    for (const w of G.ents.filter((e) => e.type === 'worker')) kill(w); // the starting pair stay out of it
    for (let i = 0; i < 2; i++) addUnit('worker', 0, (19 + i * 0.5) * TS, 51 * TS); // idle (no refinery to dig for), right by the first site
    const t = BUILDING.barracks.t;
    run(t / (2 * WORKER_BUILD) + 2);
    expect(helped.done).toBe(true);
    expect(alone.prog).toBe(0);
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

describe('Fix, then harvest', () => {
  it('sends Workers to fix everything damaged further off, then back to the ore', () => {
    addBuilding('power', 0, 12, 50, false);
    advanceSite(addBuilding('refinery', 0, 6, 46, true), 1);
    const far = addBuilding('barracks', 0, 22, 50, false), wounded = addUnit('swordsman', 0, 21 * TS, 47 * TS);
    far.hp = far.maxhp * 0.5;
    wounded.hp = 20;
    const w = G.ents.find((e) => e.type === 'worker' && e.team === 0) as Ent;
    run(3);
    expect(w.order?.t).toBe('harvest'); // too far off to notice by itself
    const cmd = parseCommand({ c: 'tend', ids: [w.id] });
    expect(cmd).toEqual({ c: 'tend', ids: [w.id] });
    if (!cmd) return;
    applyCommand(0, cmd);
    expect(w.tending).toBe(true);
    run(1);
    expect(w.order).toMatchObject({ t: 'heal', tgt: far.id }); // buildings first
    run(60);
    expect(far.hp).toBe(far.maxhp);
    expect(wounded.hp).toBeGreaterThan(20 + 15);
    for (let i = 0; i < 40 && w.order?.t !== 'harvest'; i++) run(1);
    expect(w.order?.t).toBe('harvest');
    expect(w.tending).toBe(false);
  });

  it('ends when the Worker gets another order', () => {
    const w = G.ents.find((e) => e.type === 'worker' && e.team === 0) as Ent;
    applyCommand(0, { c: 'tend', ids: [w.id] });
    applyCommand(0, { c: 'move', ids: [w.id], tx: 20, ty: 50 });
    expect(w.tending).toBe(false);
  });
});

describe('the computer', () => {
  it('takes a Worker off the ore to help a site go up', () => {
    ais[0].on = true;
    addBuilding('power', 0, 12, 50, false);
    addBuilding('refinery', 0, 6, 46, false);
    for (let i = 0; i < 4; i++) addUnit('worker', 0, (12 + i) * TS, 47 * TS);
    run(2);
    const site = G.ents.find((e) => !e.dead && e.team === 0 && e.kind === 'bld' && !e.done) ?? placeBuilding(0, 'barracks', 16, 50);
    if (!site) throw new Error('no site');
    run(2);
    expect(G.ents.some((e) => !e.dead && e.type === 'worker' && e.team === 0 && e.order?.t === 'heal' && e.order.tgt === site.id)).toBe(true);
  });
});
