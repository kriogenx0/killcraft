import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks } from './state.ts';
import { MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { generateMap, nearPortal } from './map.ts';
import { addUnit } from './entity.ts';
import { orderMove } from './order.ts';
import { canPlace } from './building.ts';
import { followPath } from './move.ts';
import { findPath, isJump, smoothPath } from './path.ts';
import { PORTAL_LAYOUTS, PORTAL_RADIUS } from '../data/map.ts';

const link = (a: [number, number], b: [number, number]) => {
  G.portals = [{ a, b }];
  G.warp.fill(-1);
  G.warp[a[1] * MW + a[0]] = b[1] * MW + b[0];
  G.warp[b[1] * MW + b[0]] = a[1] * MW + a[0];
};

describe('portal pathfinding', () => {
  beforeEach(() => { G.blk.fill(0); G.portals = []; G.warp.fill(-1); });
  afterEach(() => { G.portals = []; G.warp.fill(-1); });

  it('takes a portal when it is the shorter way', () => {
    link([3, 3], [60, 60]);
    const path = findPath(2, 2, 61, 61);
    expect(path.at(-1)).toEqual([61, 61]);
    expect(path.length).toBeLessThan(6);
    const steps = [[2, 2] as [number, number], ...path];
    const jumps = steps.slice(1).filter((t, i) => isJump(steps[i], t));
    expect(jumps).toEqual([[60, 60]]);
  });

  it('walks normally when the portal does not help', () => {
    link([3, 3], [60, 60]);
    const path = findPath(30, 30, 34, 30);
    expect(path).toHaveLength(4);
  });

  it('keeps both gates when smoothing a path', () => {
    link([10, 10], [50, 50]);
    const path = findPath(5, 5, 55, 55);
    const smooth = smoothPath(5.5 * TS, 5.5 * TS, path);
    const i = smooth.findIndex((t) => t[0] === 10 && t[1] === 10);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(smooth[i + 1]).toEqual([50, 50]);
    expect(smooth.at(-1)).toEqual([55, 55]);
  });

  it('steps straight through when standing on a gate', () => {
    link([10, 10], [50, 50]);
    const smooth = smoothPath(10.5 * TS, 10.5 * TS, findPath(10, 10, 52, 50));
    expect(smooth[0]).toEqual([10, 10]);
    expect(smooth[1]).toEqual([50, 50]);
  });
});

describe('portal maps', () => {
  afterEach(() => { ais[0].on = false; ais[1].on = true; G.demo = false; G.reveal = false; hooks.error = (e) => console.error(e); });

  it('gives portals to some maps but not all, the same way every time', () => {
    const counts = [0, 0, 0];
    for (let seed = 1; seed <= 40; seed++) {
      const s = generateMap(seed);
      counts[G.portals.length]++;
      const first = JSON.stringify(G.portals);
      generateMap(s);
      expect(JSON.stringify(G.portals)).toBe(first);
      for (const p of G.portals) {
        expect(PORTAL_LAYOUTS.some(([a, b]) => a[0] === p.a[0] && a[1] === p.a[1] && b[0] === p.b[0] && b[1] === p.b[1])).toBe(true);
        expect(G.terr[p.a[1] * MW + p.a[0]]).toBe(0);
        expect(G.terr[p.b[1] * MW + p.b[0]]).toBe(0);
      }
    }
    expect(counts[0]).toBeGreaterThan(5);
    expect(counts[1] + counts[2]).toBeGreaterThan(5);
  });

  it('sends a unit through a portal to the far side', () => {
    let seed = 1;
    while (generateMap(seed) && !G.portals.length) seed++;
    const errors: unknown[] = [];
    hooks.error = (e) => errors.push(e);
    G.reveal = true;
    G.demo = true;
    ais[0].on = false;
    ais[1].on = false;
    initWorld(seed);
    const { a, b } = G.portals[0];
    expect(nearPortal(a[0], a[1])).toBe(true);
    expect(canPlace(a[0], a[1], 1, 0)).toBe(false);
    // a knight next to one gate, sent next to the other
    const u = addUnit('knight', 0, (a[0] + 1.5) * TS, (a[1] + 0.5) * TS);
    orderMove(u, b[0] + 1, b[1]);
    let warped = false;
    for (let i = 0; i < 10 / STEP; i++) {
      const before = { x: u.x, y: u.y };
      update(STEP);
      if (Math.hypot(u.x - before.x, u.y - before.y) > 5 * TS) warped = true;
    }
    expect(errors).toEqual([]);
    expect(warped).toBe(true);
    expect(Math.hypot(u.x - (b[0] + 1.5) * TS, u.y - (b[1] + 0.5) * TS)).toBeLessThan(TS);
  });

  it('carries a unit across from anywhere on the swirl, not just its centre', () => {
    let seed = 1;
    while (generateMap(seed) && !G.portals.length) seed++;
    ais[0].on = false;
    ais[1].on = false;
    initWorld(seed);
    const { a, b } = G.portals[0];
    const edge = (PORTAL_RADIUS - 0.05) * TS;
    const u = addUnit('knight', 0, (a[0] + 0.5) * TS + edge * Math.SQRT1_2, (a[1] + 0.5) * TS + edge * Math.SQRT1_2);
    u.path = [[a[0], a[1]], [b[0], b[1]], [b[0] + 1, b[1]]];
    followPath(u, STEP);
    expect(Math.hypot(u.x - (b[0] + 0.5) * TS, u.y - (b[1] + 0.5) * TS)).toBeLessThan(1);
    expect(u.path).toEqual([[b[0] + 1, b[1]]]);
    // just outside the swirl it has to walk in first
    const v = addUnit('knight', 0, (a[0] + 0.5 + PORTAL_RADIUS + 0.2) * TS, (a[1] + 0.5) * TS);
    v.path = [[a[0], a[1]], [b[0], b[1]]];
    followPath(v, STEP);
    expect(Math.hypot(v.x - (a[0] + 0.5) * TS, v.y - (a[1] + 0.5) * TS)).toBeLessThan(2 * TS);
    expect(v.path?.[0]).toEqual([a[0], a[1]]);
  });
});
