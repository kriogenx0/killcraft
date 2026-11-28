// Moving in formation: a group walks at its slowest unit's pace and keeps its shape.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, tileOf, type Ent } from './state.ts';
import { GRASS, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { formRank, groupMove } from './order.ts';
import { parseCommand } from './command.ts';
import { mulberry32 } from '../util/math.ts';
import { UNIT } from '../data/unit.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

function openField(): void {
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
  addBuilding('power', 0, 1, 61, false);
  addBuilding('power', 1, 61, 1, false);
  addUnit('harvester', 0, 4 * TS, 62 * TS);
  addUnit('harvester', 1, 62 * TS, 4 * TS);
  rebuildBlk();
}

/** A column of riflemen with fast jeeps beside them. */
function squad(): Ent[] {
  const us: Ent[] = [];
  for (let i = 0; i < 4; i++) {
    us.push(addUnit('rifleman', 0, 15.5 * TS, (28.5 + i * 2) * TS));
    us.push(addUnit('jeep', 0, 17.5 * TS, (28.5 + i * 2) * TS));
  }
  return us;
}

describe('formation', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(5));
    G.demo = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(G, { demo: false, headless: false, viewer: 0, human: [true, false] });
    initWorld(1);
    ais[0].on = false;
    ais[1].on = true;
  });

  it('is an option on move and patrol orders', () => {
    expect(parseCommand({ c: 'move', ids: [1, 2], tx: 5, ty: 6, form: true })).toEqual({ c: 'move', ids: [1, 2], tx: 5, ty: 6, form: true });
    expect(parseCommand({ c: 'patrol', ids: [1, 2], tx: 5, ty: 6, form: 'yes' })).toEqual({ c: 'patrol', ids: [1, 2], tx: 5, ty: 6 });
  });

  it('keeps the group together and in shape', () => {
    openField();
    const us = squad();
    groupMove(us, 45, 31, false, true);
    for (const u of us) expect(u.order?.t === 'move' && u.order.pace).toBe(Math.min(UNIT.rifleman.spd, UNIT.jeep.spd));
    run(8);
    // halfway there, the jeeps haven't run ahead of the riflemen
    const lead = Math.max(...us.map((u) => u.x)), tail = Math.min(...us.map((u) => u.x));
    expect(lead - tail).toBeLessThan(4.5 * TS); // two rows, a tile apart and a tile clear for the jeeps
    run(30);
    for (const u of us) expect(u.order).toBeNull();
    // drawn up in a tidy block around the goal
    for (const u of us) expect(Math.hypot(tileOf(u.x) - 45, tileOf(u.y) - 31)).toBeLessThan(3);
  });

  it('puts tanks and melee in front, ranged behind, siege at the back, whichever way the group is heading', () => {
    openField();
    const col = (type: Parameters<typeof addUnit>[0], x: number) => [0, 1, 2].map((i) => addUnit(type, 0, x * TS, (28.5 + i * 2) * TS));
    // tanks in the middle of the block, footmen on the west side, riflemen on the east
    const swords = col('swordsman', 12.5), tanks = col('tank', 15.5), rifles = col('rifleman', 18.5);
    expect([tanks[0], col('heavy', 30.5)[0], col('guardian', 33.5)[0], col('stormcaller', 36.5)[0], col('jeep', 39.5)[0], col('catapult', 42.5)[0], col('artillery', 45.5)[0]].map(formRank)).toEqual([0, 0, 0, 1, 1, 2, 2]);
    const all = [...swords, ...tanks, ...rifles];
    G.ents.filter((e) => e.kind === 'unit' && !all.includes(e) && e.type !== 'harvester').forEach((e) => { e.dead = true; });
    const gx = (u: Ent) => (u.order?.t === 'move' ? u.order.gx : NaN);
    groupMove(all, 45, 31, false, true); // east: tanks and footmen lead, riflemen behind
    expect(Math.min(...tanks.map(gx), ...swords.map(gx))).toBeGreaterThan(Math.max(...rifles.map(gx)));
    groupMove(all, 2, 31, false, true); // west: the same, facing the other way
    expect(Math.max(...tanks.map(gx), ...swords.map(gx))).toBeLessThan(Math.min(...rifles.map(gx)));
  });

  it('puts the front line in front, then ranged troops, and medics at the back', () => {
    openField();
    // a jumbled block heading east: medics and rocket troops up front, swordsmen at the back
    const col = (type: Parameters<typeof addUnit>[0], x: number) => [0, 1, 2].map((i) => addUnit(type, 0, x * TS, (28.5 + i * 2) * TS));
    const swords = col('swordsman', 12.5), rifles = col('rifleman', 15.5), rockets = col('rocket', 18.5), medics = col('medic', 21.5);
    expect([swords[0], rifles[0], rockets[0], medics[0]].map(formRank)).toEqual([0, 1, 1, 3]);
    const all = [...medics, ...rockets, ...rifles, ...swords];
    const gx = (u: Ent) => (u.order?.t === 'move' ? u.order.gx : NaN);
    const front = (us: Ent[]) => Math.max(...us.map(gx)), back = (us: Ent[]) => Math.min(...us.map(gx));
    groupMove(all, 45, 31, false, true);
    expect(back(swords)).toBeGreaterThan(front(rifles));
    expect(back([...rifles, ...rockets])).toBeGreaterThan(front(medics));
    // heading west they're already in order: the medics stay at the back (east side)
    for (const [i, u] of all.entries()) { u.x = (21.5 - Math.floor(i / 3) * 3) * TS; }
    groupMove(all, 2, 31, false, true);
    expect(back(medics)).toBeGreaterThan(front([...rifles, ...rockets]));
    expect(back([...rifles, ...rockets])).toBeGreaterThan(front(swords));
  });

  it('a unit left behind speeds up to join the pack, then keeps its pace', () => {
    openField();
    const rifles = [0, 1, 2, 3].map((i) => addUnit('rifleman', 0, 16.5 * TS, (28.5 + i) * TS));
    const jeep = addUnit('jeep', 0, 5.5 * TS, 30 * TS);
    groupMove([...rifles, jeep], 45, 30, false, true);
    const gap = () => rifles.reduce((s, u) => s + u.x, 0) / rifles.length - jeep.x;
    expect(gap()).toBeGreaterThan(10 * TS);
    run(6);
    expect(gap()).toBeLessThan(5 * TS); // caught up, to its place a couple of tiles behind (at the riflemen's pace it would still be 11 tiles back)
    run(6);
    expect(gap()).toBeGreaterThan(0); // and then stays with them rather than running ahead
  });

  it('marches in line: nobody runs ahead of or trails its place while on the way', () => {
    openField();
    const mix = ['rifleman', 'swordsman', 'tank', 'crossbowman', 'knight', 'heavy', 'gunner', 'medic'] as const;
    const us = mix.map((t, i) => addUnit(t, 0, (12 + (i % 3) + 0.5) * TS, (29 + Math.floor(i / 3) + 0.5) * TS));
    groupMove(us, 52, 31, false, true);
    const left = (u: Ent) => (u.order?.t === 'move' ? Math.hypot((u.order.gx + 0.5) * TS - u.x, (u.order.gy + 0.5) * TS - u.y) / TS : 0);
    run(6);
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      run(1);
      const l = us.map(left);
      sum += Math.max(...l) - Math.min(...l);
    }
    expect(sum / 12).toBeLessThan(2.5); // about 4.3 tiles before formation was made stricter
  });

  it('units whose spots are at the back wait for the front to move off, then fall in behind', () => {
    openField();
    // Medics stand at the front of the way the group is going, swordsmen behind them
    const medics = [0, 1, 2].map((i) => addUnit('medic', 0, 20.5 * TS, (29.5 + i) * TS));
    const swords = [0, 1, 2].map((i) => addUnit('swordsman', 0, 18.5 * TS, (29.5 + i) * TS));
    const x0 = medics.map((u) => u.x);
    groupMove([...medics, ...swords], 45, 30, false, true);
    run(1);
    medics.forEach((u, i) => expect(Math.abs(u.x - x0[i])).toBeLessThan(0.5 * TS)); // still waiting
    run(7);
    // under way, the swordsmen lead and the Medics follow
    expect(Math.min(...swords.map((u) => u.x))).toBeGreaterThan(Math.max(...medics.map((u) => u.x)));
    run(20);
    expect([...medics, ...swords].every((u) => !u.order)).toBe(true);
  });

  it('a unit waiting for the front never waits more than a few seconds', () => {
    openField();
    const medics = [0, 1, 2].map((i) => addUnit('medic', 0, 20.5 * TS, (29.5 + i) * TS));
    const swords = [0, 1, 2].map((i) => addUnit('swordsman', 0, 18.5 * TS, (29.5 + i) * TS));
    groupMove([...medics, ...swords], 45, 30, false, true);
    // the front line is held where it stands (as if hemmed in): it never gets past the Medics
    const hold = swords.map((u) => [u.x, u.y]);
    const x0 = medics.map((u) => u.x);
    for (let i = 0; i < 6 / STEP; i++) { update(STEP); swords.forEach((u, k) => { u.x = hold[k][0]; u.y = hold[k][1]; }); }
    medics.forEach((u, i) => expect(u.x - x0[i]).toBeGreaterThan(2 * TS)); // set off anyway
  });

  it('without it, the fast units go on ahead', () => {
    openField();
    const us = squad();
    groupMove(us, 45, 31);
    run(8);
    const jeeps = us.filter((u) => u.type === 'jeep'), rifles = us.filter((u) => u.type === 'rifleman');
    expect(Math.min(...jeeps.map((u) => u.x)) - Math.max(...rifles.map((u) => u.x))).toBeGreaterThan(3 * TS);
  });
});
