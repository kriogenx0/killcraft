// When attacked: units evade, pursue or stay still as they're set to.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, reactOf, type Ent, type React } from './state.ts';
import { GRASS, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { applyCommand, parseCommand } from './command.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

function openField(): void {
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
  addBuilding('power', 0, 1, 61, false);
  addBuilding('power', 1, 61, 1, false);
  addUnit('harvester', 0, 4 * TS, 62 * TS);
  addUnit('harvester', 1, 62 * TS, 4 * TS);
  rebuildBlk();
}

/** A swordsman set to `react`, shot at from 3 tiles by a rifleman that holds its ground; returns how far it ends up from the rifleman, in tiles. */
function shotAt(react: React | null, seconds = 3): { gap: number; moved: number; s: Ent } {
  openField();
  const s = addUnit('swordsman', 0, 30.5 * TS, 30.5 * TS), r = addUnit('rifleman', 1, 33.5 * TS, 30.5 * TS);
  s.stance = 'engage';
  r.react = 'hold';
  if (react) applyCommand(0, { c: 'react', ids: [s.id], react });
  run(seconds);
  return { gap: Math.hypot(s.x - r.x, s.y - r.y) / TS, moved: Math.hypot(s.x - 30.5 * TS, s.y - 30.5 * TS) / TS, s };
}

describe('when attacked', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(5));
    G.demo = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(G, { demo: false, headless: false, viewer: 0, human: [true, false] });
    initWorld(1);
    ais[0].on = false;
    ais[1].on = true;
  });

  it('is a command with three choices', () => {
    expect(parseCommand({ c: 'react', ids: [1], react: 'evade' })).toEqual({ c: 'react', ids: [1], react: 'evade' });
    expect(parseCommand({ c: 'react', ids: [1], react: 'flee' })).toBeNull();
  });

  it('defaults: fighters pursue, Workers, Harvesters and Medics carry on, units on Don\'t attack evade', () => {
    openField();
    expect(reactOf(addUnit('rifleman', 0, 20 * TS, 20 * TS))).toBe('pursue');
    expect(reactOf(addUnit('rifleman', 1, 20 * TS, 22 * TS))).toBe('pursue');
    expect(reactOf(addUnit('worker', 0, 22 * TS, 20 * TS))).toBe('hold');
    expect(reactOf(addUnit('harvester', 1, 24 * TS, 20 * TS))).toBe('hold');
    expect(reactOf(addUnit('medic', 0, 26 * TS, 20 * TS))).toBe('hold');
    const p = addUnit('swordsman', 0, 28 * TS, 20 * TS);
    p.stance = 'passive';
    expect(reactOf(p)).toBe('evade');
  });

  it('Pursue: goes after the attacker', () => {
    const { gap } = shotAt('pursue');
    expect(gap).toBeLessThan(1.5);
  });

  it('Stay still: stands where it is', () => {
    const { moved } = shotAt('hold');
    expect(moved).toBeLessThan(0.3);
  });

  it('Evade: runs away from the attacker', () => {
    const { gap } = shotAt('evade');
    expect(gap).toBeGreaterThan(5);
  });

  it('Stay still: a shooter fires back at what is in range without moving', () => {
    openField();
    const a = addUnit('rifleman', 0, 30.5 * TS, 30.5 * TS), b = addUnit('rifleman', 1, 33.5 * TS, 30.5 * TS);
    a.react = 'hold'; b.react = 'hold';
    run(4);
    expect(Math.hypot(a.x - 30.5 * TS, a.y - 30.5 * TS)).toBeLessThan(0.3 * TS);
    expect(b.hp).toBeLessThan(b.maxhp);
  });
});
