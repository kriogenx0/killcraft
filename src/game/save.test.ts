import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { STEP } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { captureWorld, restoreWorld, SAVE_VERSION } from './save.ts';
import { mulberry32 } from '../util/math.ts';

const errors: unknown[] = [];
const run = (seconds: number) => { for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP); };

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261124));
  errors.length = 0;
  hooks.error = (e) => errors.push(e);
  G.demo = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  initWorld(1);
});

describe('saving a game', () => {
  it('comes back exactly as it was after a structured clone, and plays on', () => {
    initWorld(4242);
    ais.forEach((a) => { a.on = true; });
    run(120);
    const saved = structuredClone(captureWorld());
    const before = { t: G.gameT, n: G.ents.length, next: G.nextId, credits: [...G.credits], ore: G.ore.slice(), ids: G.ents.map((e) => `${e.id}:${e.type}:${e.team}:${Math.round(e.x)},${Math.round(e.y)}:${Math.ceil(e.hp)}`) };

    // a different map in between, as a fresh page would have
    initWorld(7);
    ais.forEach((a) => { a.on = false; });
    expect(restoreWorld(saved)).toBe(true);

    expect(G.gameT).toBe(before.t);
    expect(G.nextId).toBe(before.next);
    expect(G.credits).toEqual(before.credits);
    expect(G.ore).toEqual(before.ore);
    expect(G.ents.map((e) => `${e.id}:${e.type}:${e.team}:${Math.round(e.x)},${Math.round(e.y)}:${Math.ceil(e.hp)}`)).toEqual(before.ids);
    // the id lookup points at the very same entity objects as the list
    for (const e of G.ents) expect(G.byId.get(e.id)).toBe(e);
    expect(G.vis).toBe(G.sight[G.viewer]);
    expect(ais.every((a, t) => a.on === (t < G.teams))).toBe(true);

    run(90);
    expect(errors).toEqual([]);
    expect(G.gameT).toBeGreaterThan(before.t + 60);
    expect(G.nextId).toBeGreaterThan(before.next);
  }, 20_000); // 210 s of a computer match

  it('ignores a save from another version', () => {
    initWorld(4242);
    const saved = { ...structuredClone(captureWorld()), v: SAVE_VERSION + 1 };
    expect(restoreWorld(saved)).toBe(false);
  });
});
