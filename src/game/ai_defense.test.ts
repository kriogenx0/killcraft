// A computer defends its own base: it pulls its army home from a big raid, keeps a guard at home when a
// wave goes out, falls back from a beaten attack, and puts up a defense in a hurry after a raid.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { TS } from './const.ts';
import { aiThink, ais, setAiLevel } from './ai.ts';
import { initWorld } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { orderMove } from './order.ts';
import { sitesOf } from './production.ts';
import { mulberry32 } from '../util/math.ts';
import type { Difficulty } from '../data/setup.ts';

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261126));
  hooks.error = (e) => { throw e; };
  G.demo = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const a of ais) a.on = false;
});

function setup(level: Difficulty = 'normal') {
  initWorld(7, 2);
  for (const a of ais) a.on = false;
  setAiLevel(level, 0);
  ais[0].on = true;
  G.gameT = 900;
  const home = G.ents.find((e) => e.team === 0 && e.type === 'yard');
  const foe = G.ents.find((e) => e.team === 1 && e.type === 'yard');
  if (!home || !foe) throw new Error('no yards');
  return { home, foe };
}

const near = (u: Ent, x: number, y: number, r: number) => u.order?.t === 'move' && Math.hypot(u.order.gx * TS - x, u.order.gy * TS - y) < r * TS;

/** A wave of side 0's riflemen out by the enemy's base, marching on it. */
function waveOut(foe: Ent, n = 8): Ent[] {
  const wave = Array.from({ length: n }, (_, i) => addUnit('rifleman', 0, foe.x - 14 * TS + (i % 4) * 12, foe.y + Math.floor(i / 4) * 12));
  for (const u of wave) orderMove(u, foe.tx, foe.ty);
  ais[0].attacking = true;
  return wave;
}

describe('computer base defense', () => {
  it('pulls its army home when a big raid hits the base', () => {
    const { home, foe } = setup();
    const wave = waveOut(foe);
    for (let i = 0; i < 6; i++) addUnit('rifleman', 1, home.x + 4 * TS + i * 10, home.y + 3 * TS);
    aiThink(0);
    for (const u of wave) expect(near(u, home.x, home.y, 10)).toBe(true);
    expect(ais[0].attacking).toBe(false);
  });

  it('answers a raid on a building away from the Town Hall', () => {
    const { home, foe } = setup();
    const wave = waveOut(foe);
    // a refinery out by the ore, well beyond the watch around the Town Hall, under fire
    const ref = addBuilding('refinery', 0, home.tx + 14, home.ty + 6, false);
    const raiders = Array.from({ length: 5 }, (_, i) => addUnit('rifleman', 1, ref.x + 3 * TS + i * 10, ref.y));
    ref.foe = raiders[0].id;
    ref.foeT = G.gameT;
    aiThink(0);
    for (const u of wave) expect(near(u, ref.x, ref.y, 10)).toBe(true);
  });

  it('leaves the wave out when the home guard can handle a lone scout', () => {
    const { home, foe } = setup();
    const wave = waveOut(foe);
    for (let i = 0; i < 6; i++) addUnit('rifleman', 0, home.x + 3 * TS + i * 10, home.y - 3 * TS);
    addUnit('jeep', 1, home.x + 5 * TS, home.y + 3 * TS);
    aiThink(0);
    for (const u of wave) expect(near(u, foe.x, foe.y, 6)).toBe(true);
  });

  it('keeps a guard at home when a wave goes out', () => {
    const { home } = setup();
    ais[0].attacking = false;
    ais[0].attackAt = 5;
    const army = Array.from({ length: 10 }, (_, i) => addUnit('rifleman', 0, home.x + 4 * TS + (i % 5) * 12, home.y + 4 * TS + Math.floor(i / 5) * 12));
    aiThink(0);
    expect(ais[0].attacking).toBe(true);
    const stay = army.filter((u) => !u.order || Math.hypot(u.order.t === 'move' ? u.order.gx * TS - home.x : 0, u.order.t === 'move' ? u.order.gy * TS - home.y : 0) < 12 * TS);
    expect(stay.length).toBe(2);
  });

  it('falls back from a beaten attack and regroups', () => {
    const { home, foe } = setup();
    const wave = waveOut(foe, 4);
    for (let i = 0; i < 16; i++) addUnit('rifleman', 1, foe.x - 12 * TS + (i % 4) * 12, foe.y - 2 * TS + Math.floor(i / 4) * 12);
    aiThink(0);
    expect(ais[0].attacking).toBe(false);
    for (const u of wave) expect(near(u, home.x, home.y, 10)).toBe(true);
    expect(ais[0].regroupT ?? 0).toBeGreaterThan(G.gameT);
  });

  it('puts up a defense in a hurry after a raid, without a deep bank', () => {
    const { home } = setup();
    G.credits[0] = 900;
    G.wood[0] = 400;
    addBuilding('barracks', 0, home.tx + 5, home.ty - 4, false);
    addBuilding('power', 0, home.tx - 5, home.ty - 4, false);
    addBuilding('power', 0, home.tx - 5, home.ty + 4, false);
    for (let i = 0; i < 3; i++) addUnit('swordsman', 1, home.x + 4 * TS + i * 10, home.y + 3 * TS);
    aiThink(0); // sees the raid
    aiThink(0); // and answers it
    expect(sitesOf(0).some((e) => ['tower', 'turret', 'pillbox', 'atturret'].includes(e.type))).toBe(true);
  });

  it('Easy stays careless: no recall from afar', () => {
    const { home, foe } = setup('easy');
    const wave = waveOut(foe);
    for (let i = 0; i < 6; i++) addUnit('rifleman', 1, home.x + 4 * TS + i * 10, home.y + 3 * TS);
    aiThink(0);
    for (const u of wave) expect(near(u, home.x, home.y, 10)).toBe(false);
  });
});
