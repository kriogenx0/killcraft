// Expanding: a second Town Hall or a Mining Camp goes up by far ore, and gatherers drop their loads
// at whichever drop-off is nearest, so the far field doesn't mean a walk all the way home.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G } from './state.ts';
import { GRASS, MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { orderHarvest } from './order.ts';
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

  it('can put a Town Hall or Mining Camp anywhere away from the enemy, but other structures only by the base', () => {
    emptyMap();
    expect(available(0, 'structure')).toEqual(expect.arrayContaining(['yard', 'camp']));
    expect(canPlaceType('camp', 30, 20, 0)).toBe(true);
    expect(canPlaceType('yard', 30, 20, 0)).toBe(true);
    expect(canPlaceType('power', 30, 20, 0)).toBe(false);
    // not up against the enemy's base
    expect(canPlaceType('camp', 50, 52, 0)).toBe(false);
  });

  it('Workers mining a far field unload at the Mining Camp beside it, not back at the Town Hall', () => {
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
