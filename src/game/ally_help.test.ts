// Team games: a computer whose own base is quiet sends its army to a teammate's base under attack.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { STEP, TS } from './const.ts';
import { aiThink, ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { applyCommand } from './command.ts';
import { addBuilding, addUnit } from './entity.ts';
import { mulberry32 } from '../util/math.ts';

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261125));
  hooks.error = (e) => { throw e; };
  G.demo = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const a of ais) a.on = false;
});

function setup() {
  initWorld(7, 4, { ally: [0, 1, 0, 1] });
  for (const a of ais) a.on = false;
  ais[0].on = true;
  const home = G.ents.find((e) => e.team === 0 && e.type === 'yard');
  const friend = G.ents.find((e) => e.team === 2 && e.type === 'yard');
  if (!home || !friend) throw new Error('no yards');
  const army = Array.from({ length: 4 }, (_, i) => addUnit('rifleman', 0, home.x + 4 * TS + i * 12, home.y + 4 * TS));
  return { home, friend, army };
}

describe('allies help each other', () => {
  it("marches to a teammate's base when enemies raid it", () => {
    const { friend, army } = setup();
    addUnit('rifleman', 1, friend.x + 3 * TS, friend.y);
    aiThink(0);
    for (const u of army) {
      expect(u.order?.t).toBe('move');
      if (u.order?.t !== 'move') continue;
      expect(Math.hypot(u.order.gx * TS - friend.x, u.order.gy * TS - friend.y)).toBeLessThan(8 * TS);
    }
  });

  it('defends its own base first', () => {
    const { home, friend, army } = setup();
    addUnit('rifleman', 1, friend.x + 3 * TS, friend.y);
    addUnit('rifleman', 3, home.x + 3 * TS, home.y);
    aiThink(0);
    for (const u of army) if (u.order?.t === 'move') expect(Math.hypot(u.order.gx * TS - home.x, u.order.gy * TS - home.y)).toBeLessThan(8 * TS);
  });

  it('stays home when the teammate is safe', () => {
    const { friend, army } = setup();
    aiThink(0);
    for (const u of army) if (u.order?.t === 'move') expect(Math.hypot(u.order.gx * TS - friend.x, u.order.gy * TS - friend.y)).toBeGreaterThan(20 * TS);
  });
});

describe('allies lend Workers to rebuild', () => {
  function rebuilding() {
    initWorld(7, 4, { ally: [0, 1, 0, 1] });
    for (const a of ais) a.on = false;
    const friend = G.ents.find((e) => e.team === 2 && e.type === 'yard');
    if (!friend) throw new Error('no yard');
    // side 2 is starting over: no Workers of its own, one site waiting for hands
    for (const e of G.ents) if (e.team === 2 && e.type === 'worker') e.dead = true;
    const site = addBuilding('barracks', 2, friend.tx + 6, friend.ty, true);
    return { site };
  }

  it("lets a player's Workers help build a teammate's site", () => {
    const { site } = rebuilding();
    const w = addUnit('worker', 0, site.x + 2 * TS, site.y + 2 * TS);
    applyCommand(0, { c: 'fix', ids: [w.id], target: site.id });
    expect(w.order?.t).toBe('heal');
    const before = site.prog;
    for (let i = 0; i < 20 / STEP; i++) update(STEP);
    expect(site.prog).toBeGreaterThan(before);
  });

  it("doesn't let Workers build an enemy's site", () => {
    const { site } = rebuilding();
    const w = addUnit('worker', 1, site.x + 2 * TS, site.y + 2 * TS);
    applyCommand(1, { c: 'fix', ids: [w.id], target: site.id });
    expect(w.order?.t).not.toBe('heal');
  });

  it('a computer sends Workers to a short-handed teammate', () => {
    const { site } = rebuilding();
    const home = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!home) throw new Error('no yard');
    for (let i = 0; i < 4; i++) addUnit('worker', 0, home.x + 3 * TS + i * 12, home.y + 3 * TS);
    ais[0].on = true;
    aiThink(0);
    const helpers = G.ents.filter((e) => !e.dead && e.team === 0 && e.type === 'worker' && e.order?.t === 'heal' && e.order.tgt === site.id);
    expect(helpers.length).toBeGreaterThan(0);
    expect(helpers.length).toBeLessThanOrEqual(2);
  });
});
