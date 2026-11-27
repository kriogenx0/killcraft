import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks } from './state.ts';
import { GRASS, MH, MW, STEP, TREE, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit } from './entity.ts';
import { wildBeasts } from './creatures.ts';
import { applyWildfireSnap, initWildfire, lightTree, sparkTrees, treeBurning, updWildfire, wildfireSnap } from './wildfire.ts';
import { stoneLands } from './weather.ts';
import { TREE_WOOD } from '../data/economy.ts';
import { TREE_BURN, TREE_FIRE_CAP } from '../data/wildfire.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

/** Trees round a tile (of the 8 beside it). */
const treesAround = (i: number): number => {
  const x = i % MW, y = (i / MW) | 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && G.terr[(y + dy) * MW + x + dx] === TREE) n++;
  return n;
};

/** A tree deep in a wood (all 8 neighbours trees), as a tile index. */
function deepTree(): number {
  for (let y = 4; y < MH - 4; y++) for (let x = 4; x < MW - 4; x++) { const i = y * MW + x; if (G.terr[i] === TREE && treesAround(i) === 8) return i; }
  throw new Error('no wood on this map');
}

const centre = (i: number) => ({ x: ((i % MW) + 0.5) * TS, y: (((i / MW) | 0) + 0.5) * TS });

beforeEach(() => {
  hooks.error = (e) => { throw e; };
  G.demo = true;
  ais[0].on = false;
  ais[1].on = false;
  initWorld(4321);
  for (const b of wildBeasts()) { b.dead = true; G.byId.delete(b.id); }
  G.ents = G.ents.filter((e) => !e.dead);
  G.hell.spawnT = Infinity;
  G.weather.stormT = Infinity;
  G.weather.rainT = Infinity;
});

afterEach(() => {
  ais[1].on = true;
  G.demo = false;
});

describe('forest fires', () => {
  it('a fire landing by the woods can set a tree alight; in the open it does nothing', () => {
    const i = deepTree(), { x, y } = centre(i);
    expect(sparkTrees(x + TS, y, 10, 1)).toBe(true);
    expect(G.wildfire.burning.length).toBe(1);
    initWildfire();
    // far out on open water/grass with no tree near: nothing to catch
    let open = -1;
    for (let k = 0; k < MW * MH && open < 0; k++) {
      const kx = k % MW, ky = (k / MW) | 0;
      if (kx < 6 || ky < 6 || kx > MW - 7 || ky > MH - 7) continue;
      let any = false;
      for (let dy = -4; dy <= 4 && !any; dy++) for (let dx = -4; dx <= 4 && !any; dx++) any = G.terr[(ky + dy) * MW + kx + dx] === TREE;
      if (!any) open = k;
    }
    const o = centre(open);
    expect(sparkTrees(o.x, o.y, 30, 1)).toBe(false);
    expect(G.wildfire.burning.length).toBe(0);
  });

  it('only now and then: a fire attack by the woods rarely catches', () => {
    const i = deepTree(), { x, y } = centre(i);
    let caught = 0;
    for (let k = 0; k < 400; k++) { if (sparkTrees(x + TS, y, 10, 0.05)) caught++; initWildfire(k); }
    expect(caught).toBeGreaterThan(5);
    expect(caught).toBeLessThan(45);
  });

  it('a burning tree burns down to a stump, then grows back slowly', () => {
    const i = deepTree();
    expect(lightTree(i)).toBe(true);
    run(TREE_BURN / 2);
    expect(treeBurning(i)).toBe(true);
    expect(G.treeWood[i]).toBeLessThan(TREE_WOOD * 0.7);
    run(TREE_BURN / 2 + 1);
    expect(treeBurning(i)).toBe(false);
    expect(G.treeWood[i]).toBeLessThan(5);
    expect(G.terr[i]).toBe(TREE); // a stump, still standing in the way
    run(60);
    expect(G.treeWood[i]).toBeGreaterThan(0);
    expect(G.treeWood[i]).toBeLessThan(TREE_WOOD * 0.1);
  });

  it("a fire creeps a little way but doesn't take the whole wood", () => {
    const N = 40, before = Array.from(G.treeWood), sizes: number[] = [];
    for (let s = 0; s < N; s++) {
      initWildfire(1000 + s);
      lightTree(deepTree());
      for (let t = 0; t < 300 && G.wildfire.burning.length; t += 0.1) updWildfire(0.1);
      expect(G.wildfire.burning.length).toBe(0); // gone out by itself
      let burnt = 0;
      for (let k = 0; k < MW * MH; k++) { if (G.terr[k] === TREE && before[k] >= 30 && G.treeWood[k] < 5) burnt++; G.treeWood[k] = before[k]; }
      sizes.push(burnt);
    }
    sizes.sort((a, b) => a - b);
    if (process.env.FIRE_LOG) process.stderr.write(`fire sizes: ${sizes.join(' ')}\n`);
    expect(sizes.reduce((a, b) => a + b, 0) / N).toBeLessThan(12); // a handful of trees on average
    expect(sizes[N - 1]).toBeLessThan(80); // and even the worst stays in its corner of the wood
  });

  it('never more than the cap burn at once', () => {
    let lit = 0;
    for (let k = 0; k < MW * MH; k++) if (G.terr[k] === TREE && lightTree(k)) lit++;
    expect(lit).toBe(TREE_FIRE_CAP);
  });

  it('heavy rain puts the woods out', () => {
    const i = deepTree();
    lightTree(i);
    G.weather.rain = 1;
    G.weather.raining = true;
    run(1);
    expect(treeBurning(i)).toBe(false);
    expect(G.treeWood[i]).toBeGreaterThan(TREE_WOOD * 0.8); // saved, mostly
  });

  it('a meteor stone landing in the woods can start a fire', () => {
    const i = deepTree(), { x, y } = centre(i);
    let lit = false;
    for (let k = 0; k < 60 && !lit; k++) { stoneLands(x, y); lit = G.wildfire.burning.length > 0; }
    expect(lit).toBe(true);
  });

  it('a soldier standing against a burning tree catches fire', () => {
    // a tree at the edge of a wood, with open ground to its left
    let i = -1;
    for (let k = MW * 4; k < MW * (MH - 4) && i < 0; k++) if (G.terr[k] === TREE && G.terr[k - 1] === GRASS && !G.blk[k - 1] && G.treeWood[k] >= 30) i = k;
    const { x, y } = centre(i);
    const u = addUnit('rifleman', 0, x - TS * 0.9, y);
    lightTree(i);
    let caught = false;
    for (let k = 0; k < 10 * 30 && !caught; k++) { update(STEP); caught = (u.burnT ?? 0) > G.gameT; }
    expect(caught).toBe(true);
  });

  it('a client sees the fires the server sends, and a tree gone from the list has burnt down', () => {
    const i = deepTree();
    lightTree(i);
    const snap = wildfireSnap();
    initWildfire();
    G.visualOnly = true;
    try {
      applyWildfireSnap(snap);
      expect(treeBurning(i)).toBe(true);
      applyWildfireSnap(undefined);
      expect(treeBurning(i)).toBe(false);
      expect(G.treeWood[i]).toBe(0);
    } finally { G.visualOnly = false; }
  });
});
