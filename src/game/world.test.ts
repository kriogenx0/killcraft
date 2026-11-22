import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks } from './state.ts';
import { MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, power } from './entity.ts';
import { orderHarvest } from './order.ts';
import { available, enqueue, placeReady, readyStructure } from './production.ts';
import { canPlace } from './building.ts';
import { START_CREDITS } from '../data/map.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

const errors: unknown[] = [];

beforeEach(() => {
  errors.length = 0;
  hooks.error = (e) => errors.push(e);
  G.reveal = true;
  G.demo = true;
});

afterEach(() => {
  ais[0].on = false;
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

describe('production', () => {
  beforeEach(() => {
    ais[0].on = false;
    ais[1].on = false;
    initWorld(1234);
  });

  it('starts each side with a construction yard, starting units and credits', () => {
    for (const team of [0, 1]) {
      expect(G.ents.filter((e) => e.team === team && e.type === 'yard')).toHaveLength(1);
      expect(G.ents.some((e) => e.team === team && e.kind === 'unit')).toBe(true);
      expect(G.credits[team]).toBe(START_CREDITS);
    }
  });

  it('spends credits gradually and places a finished structure', () => {
    expect(available(0, 'structure')).toEqual(['power']);
    expect(enqueue(0, 'power')).toBe(true);
    run(4);
    expect(G.credits[0]).toBeLessThan(START_CREDITS);
    expect(G.credits[0]).toBeGreaterThan(START_CREDITS - 300);
    run(6);
    expect(readyStructure(0)).toBe('power');
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    // first free spot next to the yard (units standing there block placement)
    const spots = [[3, -2], [-2, 0], [0, -2], [0, 3], [3, 3], [-2, 3]].map(([dx, dy]) => [yard.tx + dx, yard.ty + dy]);
    const spot = spots.find(([x, y]) => canPlace(x, y, 2, 0));
    expect(spot).toBeDefined();
    const b = placeReady(0, spot?.[0] ?? 0, spot?.[1] ?? 0);
    expect(b?.type).toBe('power');
    run(2);
    expect(power(0).made).toBeGreaterThan(0);
    expect(available(0, 'structure')).toContain('refinery');
  });

  it('stalls without credits instead of going into debt', () => {
    G.credits[0] = 50;
    enqueue(0, 'power');
    run(20);
    expect(G.credits[0]).toBeGreaterThanOrEqual(0);
    expect(readyStructure(0)).toBeNull();
  });

  it('turns ore into credits with the free harvester', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('refinery', 0, 6, 46, true);
    G.credits[0] = 0;
    run(90);
    expect(G.ents.some((e) => e.team === 0 && e.type === 'harvester')).toBe(true);
    expect(G.credits[0]).toBeGreaterThan(1000);
  });
});

describe('harvesters sharing a field', () => {
  function incomeWith(harvesters: number, seconds: number): { credits: number; clashes: number } {
    for (const a of ais) a.on = false;
    initWorld(1234);
    addBuilding('power', 0, 10, 50, false);
    addBuilding('refinery', 0, 6, 46, true); // brings one harvester
    run(2);
    for (let i = 1; i < harvesters; i++) orderHarvest(addUnit('harvester', 0, (8 + i) * TS, 49.5 * TS), 14, 54);
    G.credits[0] = 0;
    let clashes = 0;
    for (let t = 0; t < seconds; t += 0.5) {
      run(0.5);
      const tiles = G.ents
        .filter((e) => e.type === 'harvester' && e.order?.t === 'harvest' && e.order.st === 'gather')
        .map((e) => (e.order?.t === 'harvest' ? `${e.order.tx},${e.order.ty}` : ''));
      clashes += tiles.length - new Set(tiles).size;
    }
    return { credits: G.credits[0], clashes };
  }

  it('never scoop the same tile, so more harvesters bring in more', () => {
    const one = incomeWith(1, 120), three = incomeWith(3, 120);
    expect(three.clashes).toBe(0);
    expect(three.credits).toBeGreaterThan(one.credits * 2);
  });
});

describe('a computer-vs-computer match', () => {
  it('builds bases, harvests and fights without errors', () => {
    ais[0].on = true;
    ais[1].on = true;
    initWorld(99);
    run(300);
    expect(errors).toEqual([]);
    for (const team of [0, 1]) {
      if (G.over && G.winner !== team) continue;
      const types = G.ents.filter((e) => e.team === team).map((e) => e.type);
      expect(types).toContain('refinery');
      expect(types).toContain('harvester');
    }
    // nothing may stand inside a wall or building
    for (const u of G.ents.filter((e) => e.kind === 'unit')) expect(G.blk[Math.floor(u.y / TS) * MW + Math.floor(u.x / TS)]).toBe(0);
  });
});
