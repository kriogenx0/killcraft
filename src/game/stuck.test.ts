// Units with an order must keep acting on it: these are the ways they used to get stuck standing still.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G } from './state.ts';
import { GRASS, MW, ROCK, STEP, TREE, TS } from './const.ts';
import { ais, sealsIn } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { orderAttack, orderHarvest, orderHaul, orderMove } from './order.ts';
import { canStep } from './move.ts';
import { findStuck } from '../sim/stuck.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

/** An empty grass map: no units, ore, trees or portals, and only a power plant in a corner for each side. */
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
  // a plant in a far corner for each side, so the match doesn't end
  addBuilding('power', 0, 1, 61, false);
  addBuilding('power', 1, 61, 1, false);
  rebuildBlk();
}

const rock = (x: number, y: number) => { G.terr[y * MW + x] = ROCK; };

describe('units never stand around with an order', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(7));
    G.demo = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // leave the engine as the two-player tests expect it
    Object.assign(G, { demo: false, headless: false, viewer: 0, human: [true, false] });
    initWorld(1);
    ais[0].on = false;
    ais[1].on = true;
  });

  it('a swordsman reaches a building whose only free sides are its corners', () => {
    emptyMap();
    // rock all around a 2x2 plant except the four diagonal corner tiles
    for (let y = 29; y <= 32; y++) for (let x = 29; x <= 32; x++) if ((x === 29 || x === 32) !== (y === 29 || y === 32)) rock(x, y);
    const plant = addBuilding('power', 1, 30, 30, false);
    rebuildBlk();
    const u = addUnit('swordsman', 0, 26.5 * TS, 26.5 * TS);
    orderAttack(u, plant);
    run(12);
    expect(plant.hp).toBeLessThan(plant.maxhp);
    expect(u.order?.t).toBe('attack');
  });

  it('a worker scoops ore it can only reach across a corner it may not cut', () => {
    emptyMap();
    rock(41, 40); rock(40, 41); rock(39, 40); rock(40, 39);
    G.ore[40 * MW + 40] = 500;
    rebuildBlk();
    const w = addUnit('worker', 0, 36.5 * TS, 36.5 * TS);
    orderHarvest(w, 40, 40);
    run(15);
    expect(w.carry).toBeGreaterThan(0);
  });

  it('a worker unloads from a corner of the refinery', () => {
    emptyMap();
    const ref = addBuilding('refinery', 0, 20, 20, false);
    for (let y = 19; y <= 23; y++) for (let x = 19; x <= 23; x++) if ((x === 19 || x === 23) !== (y === 19 || y === 23)) rock(x, y);
    rebuildBlk();
    // the free Workers that come with it are not part of this
    for (const e of G.ents) if (e.type === 'worker') e.dead = true;
    run(STEP);
    const w = addUnit('worker', 0, 26.5 * TS, 26.5 * TS);
    w.carry = 50;
    G.credits[0] = 0;
    orderHarvest(w, 40, 40);
    if (w.order?.t === 'harvest') w.order.st = 'ret';
    run(15);
    expect(ref.dead).toBe(false);
    expect(G.credits[0]).toBeGreaterThan(40);
  });

  it('walks round to a reachable side of a building when the nearest side is a walled-off pocket', () => {
    emptyMap();
    const ref = addBuilding('refinery', 0, 24, 20, false);
    for (const e of G.ents) if (e.type === 'worker') e.dead = true;
    // tiles (23,20)-(23,21) beside the refinery, sealed off by rock from the worker's side
    for (let y = 19; y <= 23; y++) rock(22, y);
    rock(23, 19); rock(23, 22);
    rebuildBlk();
    run(STEP);
    const w = addUnit('worker', 0, 20.5 * TS, 21.5 * TS);
    w.carry = 50;
    G.credits[0] = 0;
    orderHarvest(w, 40, 40);
    if (w.order?.t === 'harvest') w.order.st = 'ret';
    run(20);
    expect(ref.dead).toBe(false);
    expect(G.credits[0]).toBeGreaterThan(40);
  });

  it('never squeezes diagonally between two blocks that touch at a corner', () => {
    emptyMap();
    rock(20, 20); rock(21, 21);
    rebuildBlk();
    expect(canStep(20.9 * TS, 21.1 * TS, 21.1 * TS, 20.9 * TS)).toBe(false);
    expect(canStep(20.9 * TS, 21.1 * TS, 20.9 * TS, 21.3 * TS)).toBe(true);
  });

  it('two units meeting head-on in a one-tile lane let each other by', () => {
    emptyMap();
    // a lane four tiles long, with open ground at both ends
    for (let x = 20; x <= 23; x++) { rock(x, 19); rock(x, 21); }
    rebuildBlk();
    const a = addUnit('harvester', 0, 17.5 * TS, 20.5 * TS), b = addUnit('harvester', 0, 26.5 * TS, 20.5 * TS);
    orderMove(a, 27, 20);
    orderMove(b, 16, 20);
    run(30);
    expect(a.order).toBeNull();
    expect(b.order).toBeNull();
    expect(a.x).toBeGreaterThan(24 * TS);
    expect(b.x).toBeLessThan(20 * TS);
  });

  it('a hauler whose derrick is gone digs ore instead of waiting', () => {
    emptyMap();
    addBuilding('refinery', 0, 10, 10, false);
    for (const e of G.ents) if (e.type === 'worker') e.dead = true;
    const well = addBuilding('derrick', 0, 30, 30, false);
    G.ore[20 * MW + 20] = 500;
    run(STEP);
    const w = addUnit('worker', 0, 25.5 * TS, 25.5 * TS);
    orderHaul(w, well);
    well.dead = true;
    run(20);
    expect(w.order?.t === 'harvest' && w.order.res).toBeFalsy();
    expect(w.carry + G.credits[0]).toBeGreaterThan(0);
    expect(G.ore[20 * MW + 20]).toBeLessThan(500);
  });

  it('a Worker shut in by trees on its way home cuts its way out and drops off its wood', () => {
    emptyMap();
    // a ring of trees around one open tile, with the Worker inside it holding a load
    for (let y = 19; y <= 21; y++) for (let x = 19; x <= 21; x++) if (x !== 20 || y !== 20) { G.terr[y * MW + x] = TREE; G.treeWood[y * MW + x] = 150; }
    const mill = addBuilding('mill', 0, 26, 19, false);
    rebuildBlk();
    const w = addUnit('worker', 0, 20.5 * TS, 20.5 * TS);
    w.carry = 50; w.cargo = 'wood';
    w.order = { t: 'harvest', st: 'ret', tx: 20, ty: 20, wait: 0, res: 'wood', src: mill.id };
    G.wood[0] = 0;
    run(30);
    expect(G.wood[0]).toBeGreaterThanOrEqual(49);
    // one tree felled, the rest still standing
    let trees = 0;
    for (let y = 19; y <= 21; y++) for (let x = 19; x <= 21; x++) if (G.terr[y * MW + x] === TREE) trees++;
    expect(trees).toBe(7);
  });

  it('the computer won\'t put a structure across the only way out of a pocket its own Workers are in', () => {
    emptyMap();
    const yard = addBuilding('yard', 0, 10, 10, false);
    // a rock pocket east of the yard, open only at (20, 12)
    for (let y = 9; y <= 15; y++) for (let x = 20; x <= 26; x++) if (x === 20 || x === 26 || y === 9 || y === 15) rock(x, y);
    G.terr[12 * MW + 20] = GRASS;
    rebuildBlk();
    addUnit('worker', 0, 23.5 * TS, 12.5 * TS);
    expect(sealsIn(0, yard, [12 * MW + 20])).toBe(true);
    expect(sealsIn(0, yard, [5 * MW + 5, 5 * MW + 6])).toBe(false);
  });

  it('in a four-player computer match, nobody sits still, walks in circles or stutters with an order', () => {
    // before the fixes this match had a dozen units stuck (swords at building corners, workers at
    // unreachable ore, crowds at waypoints, units wedged against wall corners) and 90 that kept
    // dropping a fight and taking it up again because the computer re-gave their move order
    const stuck = findStuck(1, 900);
    expect(stuck).toEqual([]);
  }, 60_000);
});
