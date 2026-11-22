import { beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { GRASS, MW, MH, ROCK, SHALLOW, TS, WATER } from './const.ts';
import { findPath, pathFor } from './path.ts';
import { generateMap, rebuildBlk } from './map.ts';
import { initWorld } from './world.ts';
import { addUnit } from './entity.ts';
import { followPath, terrainSpeed } from './move.ts';
import { SHALLOW_SPEED, START_YARDS } from '../data/map.ts';

describe('terrain', () => {
  beforeEach(() => { initWorld(1); G.ents = []; G.byId.clear(); G.portals = []; G.warp.fill(-1); G.terr.fill(GRASS); rebuildBlk(); });

  it('lets ground units wade through shallow water, slowly', () => {
    for (let y = 0; y < MH; y++) G.terr[y * MW + 20] = SHALLOW;
    rebuildBlk();
    const u = addUnit('swordsman', 0, 18.5 * TS, 10.5 * TS);
    expect(terrainSpeed(u)).toBe(1);
    u.x = 20.5 * TS;
    expect(terrainSpeed(u)).toBe(SHALLOW_SPEED);
    u.path = pathFor(u, 23, 10);
    const x0 = u.x;
    followPath(u, 0.1);
    const wading = u.x - x0;
    u.x = 22.5 * TS; u.path = pathFor(u, 26, 10);
    const x1 = u.x;
    followPath(u, 0.1);
    expect(wading).toBeCloseTo((u.x - x1) * SHALLOW_SPEED, 3);
  });

  it('aircraft fly over shallows at full speed', () => {
    G.terr[10 * MW + 10] = SHALLOW;
    const a = addUnit('biplane', 0, 10.5 * TS, 10.5 * TS);
    expect(terrainSpeed(a)).toBe(1);
  });

  it('paths go round a small pool of shallows, but wade across a long stretch', () => {
    for (let y = 6; y <= 8; y++) for (let x = 19; x <= 21; x++) G.terr[y * MW + x] = SHALLOW;
    const around = findPath(20, 3, 20, 11);
    expect(around.at(-1)).toEqual([20, 11]);
    expect(around.some(([x, y]) => G.terr[y * MW + x] === SHALLOW)).toBe(false);
    for (let x = 0; x < MW; x++) G.terr[7 * MW + x] = SHALLOW;
    const through = findPath(20, 3, 20, 11);
    expect(through.filter(([x, y]) => G.terr[y * MW + x] === SHALLOW).length).toBeGreaterThan(0);
    expect(through.at(-1)).toEqual([20, 11]);
  });

  it('deep water and rock block ground units', () => {
    G.terr[3 * MW + 3] = WATER;
    G.terr[3 * MW + 4] = ROCK;
    G.terr[3 * MW + 5] = SHALLOW;
    rebuildBlk();
    expect([G.blk[3 * MW + 3], G.blk[3 * MW + 4], G.blk[3 * MW + 5]]).toEqual([1, 1, 0]);
  });

  it('generates maps with hills, both bases on dry, level ground and connected', () => {
    for (const seed of [3, 77, 1234, 99999]) {
      generateMap(seed);
      let lo = 9, hi = -9;
      for (const e of G.elev) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
      expect(hi - lo).toBeGreaterThan(1);
      for (const [x, y] of START_YARDS) {
        expect(G.terr[(y + 1) * MW + x + 1]).toBe(GRASS);
        expect(Math.abs(G.elev[(y + 1) * MW + x + 1] - G.elev[(y + 3) * MW + x + 3])).toBeLessThan(0.15);
      }
    }
  });
});
