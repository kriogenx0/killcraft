// Fog of war settings: Regrow covers ground nobody sees again, Always show keeps it explored, Off shows everything.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { MW, TS } from './const.ts';
import { initWorld } from './world.ts';
import { addUnit, kill } from './entity.ts';
import { updFog } from './fog.ts';
import { visibleTo } from '../net/snapshot.ts';
import { mulberry32 } from '../util/math.ts';
import type { FogMode } from '../data/setup.ts';

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261125));
  hooks.error = (e) => { throw e; };
});

afterEach(() => {
  vi.restoreAllMocks();
  G.reveal = false;
});

/** A scout walks out to the middle, looks around and is gone: what does team 0 still know about that ground? */
function scoutAndLeave(fog: FogMode): { tile: number; bld: ReturnType<typeof addUnit> } {
  initWorld(11, 2, { fog });
  Object.assign(G, { human: [true, false], viewer: 0, demo: false, reveal: fog === 'off' });
  const x = (MW / 2) * TS, y = (MW / 2) * TS;
  const scout = addUnit('worker', 0, x, y);
  const enemy = addUnit('worker', 1, x + TS, y);
  updFog();
  const tile = Math.floor(y / TS) * MW + Math.floor(x / TS);
  expect(G.sight[0][tile]).toBe(2);
  expect(visibleTo(enemy, 0)).toBe(true);
  kill(scout);
  updFog();
  return { tile, bld: enemy };
}

describe('fog of war', () => {
  it('Always show (the default) keeps ground explored, hiding enemy troops there', () => {
    initWorld(11, 2);
    expect(G.fog).toBe('show');
    const { tile, bld: enemy } = scoutAndLeave('show');
    expect(G.sight[0][tile]).toBe(1);
    expect(visibleTo(enemy, 0)).toBe(false);
    const yard = G.ents.find((e) => e.team === 1 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    // an enemy building on ground explored earlier stays shown
    G.sight[0][Math.floor(yard.y / TS) * MW + Math.floor(yard.x / TS)] = 1;
    expect(visibleTo(yard, 0)).toBe(true);
  });

  it('Regrow covers ground again once nobody on the side can see it, buildings too', () => {
    const { tile, bld: enemy } = scoutAndLeave('regrow');
    expect(G.sight[0][tile]).toBe(0);
    expect(visibleTo(enemy, 0)).toBe(false);
    // ground your own base sees stays visible
    const home = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!home) throw new Error('no yard');
    expect(G.sight[0][Math.floor(home.y / TS) * MW + Math.floor(home.x / TS)]).toBe(2);
  });

  it('Off shows the whole map', () => {
    const { tile, bld: enemy } = scoutAndLeave('off');
    expect(G.sight[0][tile]).toBe(2);
    expect(G.sight[0].every((v) => v === 2)).toBe(true);
    expect(visibleTo(enemy, 0)).toBe(true);
  });
});
