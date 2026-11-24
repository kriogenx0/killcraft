// Gatherers move on when their ore runs out: to the nearest other patch, spread out rather than
// crowding one tile, and never standing about.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, type Ent } from './state.ts';
import { GRASS, MW, ROCK, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addSource, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { orderHarvest } from './order.ts';
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
  // a plant in a far corner for each side, so the match doesn't end
  addBuilding('power', 0, 1, 61, false);
  addBuilding('power', 1, 61, 1, false);
  rebuildBlk();
}

/** A square patch of ore with its top-left tile at (x, y). */
function patch(x: number, y: number, size: number, ore: number): number[] {
  const tiles: number[] = [];
  for (let ty = y; ty < y + size; ty++) for (let tx = x; tx < x + size; tx++) { G.ore[ty * MW + tx] = ore; tiles.push(ty * MW + tx); }
  return tiles;
}
const oreIn = (tiles: number[]) => tiles.reduce((s, i) => s + G.ore[i], 0);

describe('when a patch of ore runs out', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(11));
    G.demo = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    G.demo = false;
    initWorld(1);
    ais[0].on = false;
    ais[1].on = true;
  });

  for (const type of ['worker', 'harvester'] as const) {
    it(`every ${type} moves on to other patches, spread out, and keeps bringing ore in`, () => {
      emptyMap();
      if (type === 'harvester') G.era[0] = 2;
      addBuilding('refinery', 0, 20, 20, false);
      for (const e of G.ents) if (e.kind === 'unit') e.dead = true; // the free gatherers aren't part of this
      const near = patch(27, 20, 2, 200), east = patch(40, 18, 3, 3000), south = patch(19, 34, 3, 3000);
      // a crystal rock by the small patch keeps speckling the mined-out ground with crumbs of ore,
      // as it does all game long
      addSource(29, 23);
      rebuildBlk();
      for (let y = 18; y <= 28; y++) for (let x = 24; x <= 34; x++) if (!G.ore[y * MW + x] && !G.blk[y * MW + x] && (x + y) % 2) G.ore[y * MW + x] = 16;
      update(STEP);
      const crew: Ent[] = [];
      for (let i = 0; i < 4; i++) {
        const u = addUnit(type, 0, (24.5 + i) * TS, 24.5 * TS);
        orderHarvest(u, 27, 20);
        crew.push(u);
      }
      let t = 0;
      while (oreIn(near) > 60 * near.length && t < 120) { for (let i = 0; i < 60; i++) update(STEP); t++; }
      expect(oreIn(near)).toBeLessThanOrEqual(60 * near.length);
      const before = oreIn(east) + oreIn(south);
      const dug = new Map<number, number>();
      for (let s = 0; s < 60; s++) {
        let last = crew.map((u) => u.carry);
        for (let i = 0; i < 60; i++) {
          update(STEP);
          crew.forEach((u, k) => { if (u.carry > last[k]) dug.set(u.id, (dug.get(u.id) ?? 0) + u.carry - last[k]); });
          last = crew.map((u) => u.carry);
        }
      }
      // all of them found more ore and kept at it, none left picking at crumbs (they all take the
      // patch nearest the Refinery, so whoever got the far side of it brings in a little less)
      const most = Math.max(...crew.map((u) => dug.get(u.id) ?? 0));
      for (const u of crew) {
        expect(u.order?.t).toBe('harvest');

        expect(dug.get(u.id) ?? 0).toBeGreaterThan(most * 0.65);
      }
      // mostly from the rich patches
      expect(before - oreIn(east) - oreIn(south)).toBeGreaterThan(crew.length * 500);
      // and they spread out: no two scoop the same tile
      const scooping = crew.filter((u) => u.order?.t === 'harvest' && u.order.st === 'gather').map((u) => u.order?.t === 'harvest' ? u.order.ty * MW + u.order.tx : -1);
      expect(new Set(scooping).size).toBe(scooping.length);
    }, 30_000);
  }
});

describe('Workers go for the ore closest to base', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(12));
    G.demo = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    G.demo = false;
    initWorld(1);
    ais[0].on = false;
    ais[1].on = true;
  });

  const run = (s: number) => { for (let i = 0; i < s / STEP; i++) update(STEP); };
  const scooped = (u: Ent): number => (u.order?.t === 'harvest' ? u.order.ty * MW + u.order.tx : -1);

  it('rather than the ore where they stand, and from whichever drop-off is nearest', () => {
    emptyMap();
    addBuilding('refinery', 0, 20, 20, false);
    for (const e of G.ents) if (e.kind === 'unit') e.dead = true;
    const far = patch(40, 40, 3, 400), near = patch(25, 20, 3, 400);
    // standing right on the far patch, sent to dig at a tile with nothing on it
    const w = addUnit('worker', 0, 41.5 * TS, 41.5 * TS);
    orderHarvest(w, 41, 37);
    run(1);
    expect(near).toContain(scooped(w));
    run(40);
    expect(oreIn(near)).toBeLessThan(400 * near.length);
    expect(oreIn(far)).toBe(400 * far.length);
    // a second drop-off right by the far patch: now that one is the ore closest to base
    addBuilding('refinery', 0, 43, 40, false);
    rebuildBlk();
    run(20);
    expect(far).toContain(scooped(w));
  });

  it('measured by the walk there, not straight across a cliff', () => {
    emptyMap();
    addBuilding('refinery', 0, 20, 20, false);
    for (const e of G.ents) if (e.kind === 'unit') e.dead = true;
    // a rock wall just north of the Refinery, with ore right behind it: a long walk round
    for (let tx = 8; tx < 40; tx++) G.terr[17 * MW + tx] = ROCK;
    rebuildBlk();
    const behind = patch(21, 14, 2, 400), open = patch(29, 25, 2, 400);
    const w = addUnit('worker', 0, 23.5 * TS, 24 * TS);
    orderHarvest(w, 23, 24);
    run(1);
    expect(open).toContain(scooped(w));
    expect(behind).not.toContain(scooped(w));
  });
});
