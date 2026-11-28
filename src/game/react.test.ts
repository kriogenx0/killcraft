// When attacked: units evade, pursue or stay still as they're set to.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, reactOf, type Ent, type React } from './state.ts';
import { GRASS, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { applyCommand, parseCommand } from './command.ts';
import { kill } from './entity.ts';
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

  it('defaults: fighters pursue, Workers and Harvesters evade, Medics carry on, units on Don\'t attack evade', () => {
    openField();
    expect(reactOf(addUnit('rifleman', 0, 20 * TS, 20 * TS))).toBe('pursue');
    expect(reactOf(addUnit('rifleman', 1, 20 * TS, 22 * TS))).toBe('pursue');
    expect(reactOf(addUnit('worker', 0, 22 * TS, 20 * TS))).toBe('evade');
    expect(reactOf(addUnit('harvester', 1, 24 * TS, 20 * TS))).toBe('evade');
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

  it('sent after an enemy that falls to someone else, carries on to where it was', () => {
    openField();
    const us = [0, 1].map((i) => addUnit('rifleman', 0, 15.5 * TS, (30.5 + i) * TS));
    const foe = addUnit('harvester', 1, 40.5 * TS, 30.5 * TS);
    applyCommand(0, { c: 'attack', ids: us.map((u) => u.id), target: foe.id });
    run(2);
    kill(foe);
    run(1);
    for (const u of us) expect(u.order?.t).toBe('move'); // not stopped dead
    run(25);
    for (const u of us) expect(Math.hypot(u.x - foe.x, u.y - foe.y)).toBeLessThan(3 * TS);
  });

  it('Stay still: on its way somewhere, it never turns aside to chase an enemy it sees', () => {
    for (const stance of ['engage', 'skirmish'] as const) {
      openField();
      const u = addUnit('swordsman', 0, 20.5 * TS, 30.5 * TS), foe = addUnit('rifleman', 1, 30.5 * TS, 35.5 * TS);
      foe.react = 'hold';
      applyCommand(0, { c: 'stance', ids: [u.id], stance });
      applyCommand(0, { c: 'react', ids: [u.id], react: 'hold' });
      applyCommand(0, { c: 'move', ids: [u.id], tx: 40, ty: 30 });
      let off = 0;
      for (let k = 0; k < 60 && u.order; k++) { run(0.25); off = Math.max(off, Math.abs(u.y - 30.5 * TS) / TS); }
      expect(off).toBeLessThan(1);
      expect(u.x).toBeGreaterThan(39 * TS);
    }
  });

  it('Pursue: on its way on Stop & attack, it does go after an enemy it sees', () => {
    openField();
    const u = addUnit('swordsman', 0, 20.5 * TS, 30.5 * TS), foe = addUnit('rifleman', 1, 30.5 * TS, 35.5 * TS);
    foe.react = 'hold';
    applyCommand(0, { c: 'stance', ids: [u.id], stance: 'engage' });
    applyCommand(0, { c: 'move', ids: [u.id], tx: 40, ty: 30 });
    let off = 0;
    for (let k = 0; k < 40; k++) { run(0.25); off = Math.max(off, Math.abs(u.y - 30.5 * TS) / TS); }
    expect(off).toBeGreaterThan(3);
  });

  it('when the enemy a group was sent at dies, the ones still on their way join the ones that fought it', () => {
    openField();
    const foe = addUnit('harvester', 1, 40.5 * TS, 30.5 * TS);
    const front = [0, 1, 2].map((i) => addUnit('rifleman', 0, 37.5 * TS, (29.5 + i) * TS));
    const back = [0, 1, 2].map((i) => addUnit('rifleman', 0, 12.5 * TS, (29.5 + i) * TS));
    applyCommand(0, { c: 'attack', ids: [...front, ...back].map((u) => u.id), target: foe.id });
    run(2);
    const spots = front.map((u) => [u.x, u.y]);
    kill(foe);
    run(1);
    for (const u of back) expect(u.order?.t).toBe('move');
    run(20);
    const cx = spots.reduce((a, p) => a + p[0], 0) / 3, cy = spots.reduce((a, p) => a + p[1], 0) / 3;
    front.forEach((u, i) => expect(Math.hypot(u.x - spots[i][0], u.y - spots[i][1])).toBeLessThan(TS)); // they stay
    for (const u of back) expect(Math.hypot(u.x - cx, u.y - cy)).toBeLessThan(3 * TS); // the others come to them
  });
});
