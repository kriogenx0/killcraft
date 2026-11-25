// Moving in formation: a group walks at its slowest unit's pace and keeps its shape.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, tileOf, type Ent } from './state.ts';
import { GRASS, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { groupMove } from './order.ts';
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
    // each unit's spot keeps where it stood in the group
    for (const u of us) expect(u.order?.t === 'move' && u.order.pace).toBe(Math.min(UNIT.rifleman.spd, UNIT.jeep.spd));
    const spot = (u: Ent) => (u.order?.t === 'move' ? [u.order.gx, u.order.gy] : [0, 0]);
    for (let i = 0; i < 4; i++) {
      const [rx, ry] = spot(us[i * 2]), [jx, jy] = spot(us[i * 2 + 1]);
      expect(jx - rx).toBe(2);
      expect(jy - ry).toBe(0);
    }
    run(8);
    // halfway there, the jeeps haven't run ahead of the riflemen
    const lead = Math.max(...us.map((u) => u.x)), tail = Math.min(...us.map((u) => u.x));
    expect(lead - tail).toBeLessThan(3.5 * TS);
    run(30);
    for (const u of us) expect(u.order).toBeNull();
    for (let i = 0; i < 4; i++) expect(tileOf(us[i * 2 + 1].x) - tileOf(us[i * 2].x)).toBe(2);
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

  it('without it, the fast units go on ahead', () => {
    openField();
    const us = squad();
    groupMove(us, 45, 31);
    run(8);
    const jeeps = us.filter((u) => u.type === 'jeep'), rifles = us.filter((u) => u.type === 'rifleman');
    expect(Math.min(...jeeps.map((u) => u.x)) - Math.max(...rifles.map((u) => u.x))).toBeGreaterThan(3 * TS);
  });
});
