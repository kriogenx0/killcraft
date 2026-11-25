// The computer must get its base going from the two starting Workers at every difficulty and every
// starting-resources setting. Regression (2026-11-25): on Low resources the Power Plant left 150 wood,
// the Refinery wants 200, and with no Lumber Mill yet the computer saved for the Refinery forever.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { STEP } from './const.ts';
import { ais, aiLogText, setAiLevel } from './ai.ts';
import { initWorld, update } from './world.ts';
import { START_RESOURCES, type Difficulty, type StartResources } from '../data/setup.ts';
import { mulberry32 } from '../util/math.ts';

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(G, { demo: false, headless: false, viewer: 0, human: [true, false] });
  initWorld(1);
  ais[0].on = false;
  ais[1].on = true;
});

/** Play a human (idle) against a computer for `seconds` and return the computer's finished buildings. */
function play(level: Difficulty, resources: StartResources, seed: number, seconds: number): string[] {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
  const errors: unknown[] = [];
  hooks.error = (e) => errors.push(e);
  G.headless = true;
  initWorld(seed, 2, { share: START_RESOURCES[resources].share, units: ['worker', 'worker'] });
  Object.assign(G, { demo: false, viewer: 0, human: [true, false], reveal: false });
  ais[0].on = false;
  ais[1].on = true;
  setAiLevel(level, 1);
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
  expect(errors).toEqual([]);
  return G.ents.filter((e) => !e.dead && e.team === 1 && e.kind === 'bld' && e.done && e.type !== 'yard').map((e) => e.type);
}

describe('computer builds its base early', () => {
  for (const resources of ['low', 'standard', 'high'] as const)
    for (const level of ['easy', 'normal'] as const)
      it(`${level} computer, ${resources} resources, two Workers: has a Refinery and a Barracks by 3:00`, () => {
        const built = play(level, resources, 11, 180);
        expect(built).toContain('power');
        expect(built).toContain('refinery');
        expect(built).toContain('barracks');
        expect(built.length).toBeGreaterThanOrEqual(4);
      }, 60_000);

  it('logs what it built and why it waited', () => {
    play('normal', 'low', 11, 90);
    const log = aiLogText((t) => `Side ${t + 1}`);
    expect(log).toContain('Side 2: placed a Power Plant');
    expect(log).toMatch(/Side 2: needs wood for a Refinery and has no Lumber Mill/);
    expect(log).toMatch(/Side 2: saving for a Refinery \(\d+\/2000 ore/);
  }, 60_000);
});
