// Walking units steer around each other instead of walking into each other and being shoved apart.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, type Ent } from './state.ts';
import { GRASS, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { groupMove, orderMove } from './order.ts';
import { shoved } from './move.ts';
import { crowding } from '../sim/crowd.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

/** Open grass with nothing on it but a power plant in a far corner for each side. */
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
  // and a parked unit, so neither side counts as unable to recover (world.ts stranded)
  addUnit('harvester', 0, 4 * TS, 62 * TS);
  addUnit('harvester', 1, 62 * TS, 4 * TS);
  rebuildBlk();
}

describe('units steer around each other', () => {
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

  it('two squads walking through each other pass without shoving', () => {
    openField();
    const west: Ent[] = [], east: Ent[] = [];
    for (let i = 0; i < 6; i++) {
      west.push(addUnit(i % 2 ? 'rifleman' : 'tank', 0, (18 + (i % 2)) * TS, (28 + i) * TS));
      east.push(addUnit(i % 2 ? 'swordsman' : 'jeep', 0, (44 - (i % 2)) * TS, (28.5 + i) * TS));
    }
    groupMove(west, 46, 30);
    groupMove(east, 16, 30);
    shoved.px = 0;
    run(25);
    for (const u of [...west, ...east]) expect(u.order).toBeNull();
    expect(west.every((u) => u.x > 40 * TS)).toBe(true);
    expect(east.every((u) => u.x < 22 * TS)).toBe(true);
    expect(shoved.px).toBeLessThan(400); // about 700 before steering
  });

  it('an idle friend in the way steps aside', () => {
    openField();
    const by = addUnit('rifleman', 0, 30.5 * TS, 30.5 * TS), walker = addUnit('tank', 0, 24.5 * TS, 30.5 * TS);
    orderMove(walker, 37, 30);
    shoved.px = 0;
    run(6);
    expect(walker.order).toBeNull();
    expect(Math.abs(by.y - 30.5 * TS)).toBeGreaterThan(6); // it moved off the line
    expect(shoved.px).toBeLessThan(20);
  });

  it('in a four-player computer match, walking units are seldom shoved', () => {
    // before steering, walking units were shoved about 4 px for every second they walked. Since the
    // computer builds Resource Drops by far ore, Workers walk less and spend more of it among others
    // at the field, and matches fight more, which lifts this to about 2-2.8 (it was 1.8-2.3). The slower Normal computer keeps more units bunched at
    // home, about 3.1
    expect(crowding(1, 600).shove).toBeLessThan(3.6);
  }, 60_000);
});
