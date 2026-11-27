// Campaign missions can hold every side in an age (Alex, 2026-11-27: the first missions are played
// without upgrading to the Industrial age). With G.maxEra 0 nobody is offered the Engine Works or the
// Industrial Age research, and the computer doesn't save up for them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { STEP } from './const.ts';
import { ais, setAiLevel } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding } from './entity.ts';
import { available } from './production.ts';
import { MISSIONS, unlocked } from '../data/campaign.ts';
import { layoutFor } from '../data/map.ts';
import { mulberry32 } from '../util/math.ts';

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(G, { demo: false, headless: false, viewer: 0, human: [true, false] });
  initWorld(1);
  ais[0].on = false;
  ais[1].on = true;
});

describe('campaign age limit', () => {
  it('offers no Engine Works and no Industrial Age research in a Medieval-only game', () => {
    initWorld(1101, 2, { maxEra: 0, share: 2 });
    const [x, y] = layoutFor(2).yards[0];
    addBuilding('derrick', 0, x + 6, y + 6, false);
    expect(available(0, 'structure')).not.toContain('works');
    // even with an Engine Works standing (placed by hand), the Town Hall can't research the age
    addBuilding('works', 0, x + 6, y - 5, false);
    expect(available(0, 'tech')).not.toContain('age1');
  });

  it('offers both without a limit', () => {
    initWorld(1101, 2, { share: 2 });
    const [x, y] = layoutFor(2).yards[0];
    addBuilding('derrick', 0, x + 6, y + 6, false);
    expect(available(0, 'structure')).toContain('works');
    addBuilding('works', 0, x + 6, y - 5, false);
    expect(available(0, 'tech')).toContain('age1');
  });

  it('an Easy computer stays Medieval and keeps building', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(7));
    const errors: unknown[] = [];
    hooks.error = (e) => errors.push(e);
    G.headless = true;
    initWorld(1101, 2, { maxEra: 0, share: 2 });
    Object.assign(G, { demo: false, viewer: 0, human: [true, false], reveal: false });
    ais[0].on = false;
    ais[1].on = true;
    setAiLevel('easy', 1);
    for (let i = 0; i < 600 / STEP && !G.over; i++) update(STEP);
    expect(errors).toEqual([]);
    expect(G.era[1]).toBe(0);
    expect(G.ents.some((e) => !e.dead && e.team === 1 && e.type === 'works')).toBe(false);
    expect(G.ents.some((e) => !e.dead && e.team === 1 && e.type === 'barracks' && e.done)).toBe(true);
  }, 30_000);
});

describe('campaign progress', () => {
  it('opens a mission once every mission before it is won', () => {
    expect(unlocked(0, new Set())).toBe(true);
    expect(unlocked(1, new Set())).toBe(false);
    expect(unlocked(2, new Set([MISSIONS[0].id, MISSIONS[1].id]))).toBe(true);
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length);
  });
});
