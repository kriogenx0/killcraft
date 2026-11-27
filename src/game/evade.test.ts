// Workers and Harvesters run from enemies to safety and go back to work once it's clear (Alex, 2026-11-27).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, reactOf, type Ent } from './state.ts';
import { GRASS, MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { orderHarvest, orderMove } from './order.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

function field(): Ent {
  initWorld(1234);
  for (const a of ais) a.on = false;
  G.ents = [];
  G.byId.clear();
  G.terr.fill(GRASS);
  G.ore.fill(0);
  for (const s of G.sight) s.fill(1);
  G.portals = [];
  G.waygates = [];
  G.warp.fill(-1);
  G.warpTeam.fill(-1);
  addBuilding('power', 0, 1, 61, false);
  addBuilding('power', 1, 61, 1, false);
  addBuilding('yard', 1, 58, 4, false);
  const hall = addBuilding('yard', 0, 10, 30, false);
  for (let ty = 30; ty < 33; ty++) for (let tx = 24; tx < 27; tx++) G.ore[ty * MW + tx] = 3000;
  rebuildBlk();
  return hall;
}

const tiles = (a: Ent, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / TS;

describe('gatherers evade attacks', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(7));
    G.demo = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    G.demo = false;
    initWorld(1);
    ais[0].on = false;
    ais[1].on = true;
  });

  it('Workers and Harvesters evade by default, for people and the computer', () => {
    field();
    expect(reactOf(addUnit('worker', 0, 20 * TS, 20 * TS))).toBe('evade');
    expect(reactOf(addUnit('harvester', 1, 22 * TS, 20 * TS))).toBe('evade');
    expect(reactOf(addUnit('medic', 0, 24 * TS, 20 * TS))).toBe('hold');
  });

  for (const type of ['worker', 'harvester'] as const) {
    it(`a ${type} runs to the Town Hall from an enemy closing in, then goes back to work`, () => {
      const hall = field();
      G.era[0] = 2;
      const w = addUnit(type, 0, 25.5 * TS, 31.5 * TS);
      orderHarvest(w, 25, 31);
      run(3);
      expect(w.order?.t).toBe('harvest');
      // an enemy swordsman walks up to the ore
      const foe = addUnit('swordsman', 1, 40.5 * TS, 31.5 * TS);
      foe.stance = 'passive';
      orderMove(foe, 27, 31);
      run(12);
      expect(tiles(w, foe)).toBeGreaterThan(6);
      expect(tiles(w, hall)).toBeLessThan(6);
      // it waits there while the enemy stands by the ore
      run(5);
      expect(tiles(w, hall)).toBeLessThan(6);
      // the enemy leaves: back to work
      foe.dead = true;
      run(8);
      expect(w.order?.t).toBe('harvest');
      expect(tiles(w, hall)).toBeGreaterThan(5);
    });
  }

  it('a Worker walked somewhere by the player keeps going', () => {
    field();
    const w = addUnit('worker', 0, 25.5 * TS, 31.5 * TS);
    const foe = addUnit('swordsman', 1, 34.5 * TS, 31.5 * TS);
    foe.stance = 'passive';
    orderMove(w, 33, 31);
    run(2.5);
    expect(w.order?.t === 'move' && !w.order.flee).toBe(true);
    expect(tiles(w, foe)).toBeLessThan(7);
  });

  it('a Worker set to Stay still keeps digging', () => {
    field();
    const w = addUnit('worker', 0, 25.5 * TS, 31.5 * TS);
    w.react = 'hold';
    orderHarvest(w, 25, 31);
    const foe = addUnit('swordsman', 1, 30.5 * TS, 31.5 * TS);
    foe.stance = 'passive';
    run(4);
    expect(w.order?.t).toBe('harvest');
  });
});
