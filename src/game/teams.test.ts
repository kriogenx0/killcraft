// Team games (2v2): allies share sight, never fight each other and win together; closed seats stay empty.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, allied, hooks, hostile } from './state.ts';
import { MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit, kill } from './entity.ts';
import { acquire } from './combat.ts';
import { updFog } from './fog.ts';
import { mulberry32 } from '../util/math.ts';

const TWO_V_TWO = [0, 1, 0, 1];

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261124));
  hooks.error = (e) => { throw e; };
  G.reveal = false;
  G.demo = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const a of ais) a.on = false;
  G.reveal = false;
});

describe('team games', () => {
  it('pairs the corners on each side into two teams', () => {
    initWorld(7, 4, { ally: TWO_V_TWO });
    expect(allied(0, 2)).toBe(true);
    expect(allied(1, 3)).toBe(true);
    expect(hostile(0, 1)).toBe(true);
    expect(hostile(2, 3)).toBe(true);
    expect(hostile(0, -1)).toBe(false);
    initWorld(7, 4);
    expect(hostile(0, 2)).toBe(true);
  });

  it("doesn't shoot at allies, only at enemies", () => {
    initWorld(7, 4, { ally: TWO_V_TWO });
    G.ents = G.ents.filter((e) => e.kind === 'source');
    G.byId.clear();
    const x = 32 * TS, y = 32 * TS;
    const me = addUnit('rifleman', 0, x, y);
    addUnit('rifleman', 2, x + 20, y);
    expect(acquire(me, 5)).toBeNull();
    const foe = addUnit('rifleman', 1, x - 30, y);
    expect(acquire(me, 5)).toBe(foe);
  });

  it("shares an ally's sight with a person on its side", () => {
    initWorld(7, 4, { ally: TWO_V_TWO });
    Object.assign(G, { human: [true, false, false, false], viewer: 0 });
    const ally = G.ents.find((e) => e.team === 2 && e.type === 'yard');
    const enemy = G.ents.find((e) => e.team === 1 && e.type === 'yard');
    if (!ally || !enemy) throw new Error('no yards');
    updFog();
    const at = (e: typeof ally) => G.sight[0][Math.floor(e.y / TS) * MW + Math.floor(e.x / TS)];
    expect(at(ally)).toBe(2);
    expect(at(enemy)).toBe(0);
  });

  it('ends when one side is left: allies win together, even one who was knocked out', () => {
    initWorld(7, 4, { ally: TWO_V_TWO });
    G.human = [false, false, false, false];
    // team 2 (on 0's side) and team 1 fall: the match goes on
    for (const e of G.ents) if (e.team === 2 || e.team === 1) kill(e);
    run(5);
    expect(G.over).toBe(false);
    for (const e of G.ents) if (e.team === 3) kill(e);
    run(5);
    expect(G.over).toBe(true);
    expect(G.winner).toBe(0);
    expect(allied(G.winner, 2)).toBe(true);
    expect(G.outLog.map((o) => o.team).sort()).toEqual([1, 2, 3]);
  });

  it('leaves a closed seat empty and never counts it as knocked out', () => {
    initWorld(7, 4, { ally: TWO_V_TWO, absent: [false, false, false, true] });
    G.human = [false, false, false, false];
    expect(G.ents.some((e) => e.team === 3)).toBe(false);
    run(5);
    expect(G.over).toBe(false);
    expect(G.outLog).toEqual([]);
    for (const e of G.ents) if (e.team === 1) kill(e);
    run(5);
    expect(G.over).toBe(true);
    expect(allied(G.winner, 0)).toBe(true);
    expect(G.outLog.map((o) => o.team)).toEqual([1]);
  });

  it('plays a 2v2 between computers without errors, and allies never hurt each other', () => {
    initWorld(11, 4, { ally: TWO_V_TWO });
    G.human = [false, false, false, false];
    for (const [t, a] of ais.entries()) a.on = t < 4;
    const hurt: string[] = [];
    let fights = 0;
    hooks.killedBy = (e, by) => {
      if (by && e.team >= 0 && by.team !== e.team && allied(by.team, e.team)) hurt.push(`${by.type} killed ally ${e.type}`);
      if (by && hostile(by.team, e.team)) fights++;
    };
    run(1200);
    hooks.killedBy = () => {};
    expect(hurt).toEqual([]);
    expect(fights).toBeGreaterThan(0);
  }, 120_000);
});
