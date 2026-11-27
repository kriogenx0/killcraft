// Expanding: a second Town Hall or a Resource Drop goes up by far ore, and gatherers drop their loads
// at whichever drop-off is nearest, so the far field doesn't mean a walk all the way home.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G } from './state.ts';
import { GRASS, MW, STEP, TREE, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { orderHarvest } from './order.ts';
import { sendGather } from './autogather.ts';
import { canPlaceType } from './building.ts';
import { available } from './production.ts';
import { mulberry32 } from '../util/math.ts';

function emptyMap(): void {
  initWorld(1234);
  for (const a of ais) a.on = false;
  G.ents = [];
  G.byId.clear();
  G.terr.fill(GRASS);
  G.ore.fill(0);
  G.portals = [];
  G.waygates = [];
  G.warp.fill(-1);
  G.warpTeam.fill(-1);
  G.reveal = true;
  addBuilding('yard', 0, 4, 4, false);
  addBuilding('yard', 1, 56, 56, false);
  rebuildBlk();
}

describe('expanding', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(5));
    G.demo = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    G.demo = false;
    G.reveal = false;
    initWorld(1);
    ais[0].on = false;
    ais[1].on = true;
  });

  it('can put a Town Hall or Resource Drop anywhere away from the enemy, but other structures only by the base', () => {
    emptyMap();
    expect(available(0, 'structure')).toEqual(expect.arrayContaining(['yard', 'camp']));
    expect(canPlaceType('camp', 30, 20, 0)).toBe(true);
    expect(canPlaceType('yard', 30, 20, 0)).toBe(true);
    expect(canPlaceType('power', 30, 20, 0)).toBe(false);
    // not up against the enemy's base
    expect(canPlaceType('camp', 50, 52, 0)).toBe(false);
  });

  it('Workers mining a far field unload at the Resource Drop beside it, not back at the Town Hall', () => {
    emptyMap();
    for (let y = 30; y < 33; y++) for (let x = 34; x < 37; x++) G.ore[y * MW + x] = 400;
    const camp = addBuilding('camp', 0, 31, 30, false);
    rebuildBlk();
    const u = addUnit('worker', 0, 35 * TS, 34 * TS);
    orderHarvest(u, 35, 31);
    let dropped = 0, far = 0;
    const start = G.credits[0];
    for (let i = 0; i < 60 / STEP; i++) {
      update(STEP);
      if (u.order?.t === 'harvest' && u.order.st === 'unload') {
        dropped++;
        if (Math.hypot(u.x - camp.x, u.y - camp.y) > 3 * TS) far++;
      }
    }
    expect(G.credits[0]).toBeGreaterThan(start);
    expect(dropped).toBeGreaterThan(0);
    expect(far).toBe(0);
  });

  it('Workers chopping by a Resource Drop drop their wood there', () => {
    emptyMap();
    for (let y = 30; y < 33; y++) for (let x = 36; x < 39; x++) { G.terr[y * MW + x] = TREE; G.treeWood[y * MW + x] = 100; }
    const camp = addBuilding('camp', 0, 32, 30, false);
    rebuildBlk();
    const u = addUnit('worker', 0, 35 * TS, 34 * TS);
    expect(sendGather(u, 'wood')).toBe(true);
    let far = 0;
    const start = G.wood[0];
    for (let i = 0; i < 60 / STEP; i++) {
      update(STEP);
      if (u.order?.t === 'harvest' && u.order.st === 'unload' && Math.hypot(u.x - camp.x, u.y - camp.y) > 3 * TS) far++;
    }
    expect(G.wood[0]).toBeGreaterThan(start);
    expect(far).toBe(0);
  });

  it('a Worker heading home turns to a Resource Drop that finishes on the way', () => {
    emptyMap();
    const camp = addBuilding('camp', 0, 40, 30, false);
    camp.done = false;
    rebuildBlk();
    const u = addUnit('worker', 0, 44 * TS, 33 * TS);
    u.carry = 150; u.cargo = 'ore';
    orderHarvest(u, 44, 33);
    if (u.order?.t === 'harvest') u.order.st = 'ret';
    for (let i = 0; i < 1 / STEP; i++) update(STEP);
    camp.done = true;
    for (let i = 0; i < 8 / STEP && u.carry > 0; i++) update(STEP);
    expect(u.carry).toBe(0);
    expect(Math.hypot(u.x - camp.x, u.y - camp.y)).toBeLessThan(3 * TS);
  });

  it('Aether is banked at a Resource Drop', () => {
    emptyMap();
    const camp = addBuilding('camp', 0, 40, 30, false);
    rebuildBlk();
    const u = addUnit('worker', 0, 43 * TS, 31 * TS);
    u.ae = 40;
    const start = G.aether[0] ?? 0;
    // right by it: banked at once, with no walk back to the Town Hall
    for (let i = 0; i < 1 / STEP; i++) update(STEP);
    expect(G.aether[0]).toBeGreaterThan(start);
    expect(camp.dead).toBe(false);
  });

  it('a side that loses its first Town Hall plays on from its second', () => {
    emptyMap();
    const second = addBuilding('yard', 0, 30, 20, false);
    G.ents.find((e) => e.type === 'yard' && e.team === 0 && e !== second)!.hp = 0;
    G.ents.find((e) => e.type === 'yard' && e.team === 0 && e !== second)!.dead = true;
    for (let i = 0; i < 5 / STEP; i++) update(STEP);
    expect(second.dead).toBe(false);
    expect(G.over).toBeFalsy();
    expect(available(0, 'structure').length).toBeGreaterThan(0);
  });
});
