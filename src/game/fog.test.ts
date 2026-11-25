// Fog of war settings: Reveal keeps explored ground visible, Regrow fogs it over again (troops hidden), Off shows everything.
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
  it('Reveal (the default) keeps explored ground fully visible, enemy troops too', () => {
    initWorld(11, 2);
    expect(G.fog).toBe('reveal');
    const { tile, bld: enemy } = scoutAndLeave('reveal');
    expect(G.sight[0][tile]).toBe(2);
    expect(visibleTo(enemy, 0)).toBe(true);
  });

  it('Regrow fogs explored ground over again: still mapped, but enemy troops there are hidden', () => {
    const { tile, bld: enemy } = scoutAndLeave('regrow');
    expect(G.sight[0][tile]).toBe(1);
    expect(visibleTo(enemy, 0)).toBe(false);
    const yard = G.ents.find((e) => e.team === 1 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    // an enemy building on ground explored earlier stays shown
    G.sight[0][Math.floor(yard.y / TS) * MW + Math.floor(yard.x / TS)] = 1;
    expect(visibleTo(yard, 0)).toBe(true);
  });

  it('Off shows the whole map', () => {
    const { tile, bld: enemy } = scoutAndLeave('off');
    expect(G.sight[0][tile]).toBe(2);
    expect(G.sight[0].every((v) => v === 2)).toBe(true);
    expect(visibleTo(enemy, 0)).toBe(true);
  });
});
