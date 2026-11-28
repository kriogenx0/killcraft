// Escort (Alex, 2026-11-28): selected units follow a friendly unit, keep close round it, fight
// enemies that come at it, and go back to it after.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, type Ent } from './state.ts';
import { GRASS, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, kill } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { applyCommand, parseCommand } from './command.ts';
import { ESCORT_LEASH } from './unit.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) { update(STEP); each?.(); }
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

const gap = (a: Ent, b: Ent): number => Math.hypot(a.x - b.x, a.y - b.y) / TS;

describe('escort', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(3));
    G.demo = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(G, { demo: false, headless: false, viewer: 0, human: [true, false] });
    initWorld(1);
    ais[0].on = false;
    ais[1].on = true;
  });

  it('is a command naming the unit to escort', () => {
    expect(parseCommand({ c: 'escort', ids: [1, 2], target: 3 })).toEqual({ c: 'escort', ids: [1, 2], target: 3 });
    expect(parseCommand({ c: 'escort', ids: [1], target: 'x' })).toBeNull();
  });

  it('follows the unit across the map and keeps close round it', () => {
    openField();
    const ward = addUnit('worker', 0, 20.5 * TS, 30.5 * TS);
    const guards = [0, 1, 2].map((i) => addUnit('rifleman', 0, (14.5 + i) * TS, 24.5 * TS));
    applyCommand(0, { c: 'escort', ids: guards.map((g) => g.id), target: ward.id });
    for (const g of guards) expect(g.order?.t).toBe('escort');
    applyCommand(0, { c: 'move', ids: [ward.id], tx: 44, ty: 34 });
    let far = 0;
    run(20, () => { if (ward.order) return; for (const g of guards) far = Math.max(far, gap(g, ward)); });
    expect(gap(ward, { x: 44.5 * TS, y: 34.5 * TS } as Ent)).toBeLessThan(1.5);
    for (const g of guards) {
      expect(gap(g, ward)).toBeLessThan(3);
      expect(g.order?.t).toBe('escort');
    }
    // spread round it, not stacked on one spot
    expect(gap(guards[0], guards[1]) + gap(guards[1], guards[2]) + gap(guards[0], guards[2])).toBeGreaterThan(2);
  });

  it("fights an enemy that attacks the unit it's escorting, then goes back to it", () => {
    openField();
    const ward = addUnit('worker', 0, 30.5 * TS, 30.5 * TS);
    ward.react = 'hold';
    ward.stance = 'passive';
    const guard = addUnit('swordsman', 0, 28.5 * TS, 30.5 * TS), mate = addUnit('swordsman', 0, 28.5 * TS, 31.5 * TS);
    applyCommand(0, { c: 'escort', ids: [guard.id, mate.id], target: ward.id });
    run(1);
    // an enemy rifleman walks up and shoots the Worker
    const foe = addUnit('rifleman', 1, 40.5 * TS, 30.5 * TS);
    foe.stance = 'engage';
    applyCommand(1, { c: 'attack', ids: [foe.id], target: ward.id });
    run(25);
    expect(foe.dead).toBe(true);
    expect(ward.dead).toBe(false);
    expect(guard.order?.t).toBe('escort');
    expect(gap(guard, ward)).toBeLessThan(3);
  });

  it("doesn't chase far from the unit it's escorting", () => {
    openField();
    const ward = addUnit('worker', 0, 30.5 * TS, 30.5 * TS);
    ward.stance = 'passive';
    ward.react = 'hold';
    const guard = addUnit('swordsman', 0, 29.5 * TS, 30.5 * TS);
    applyCommand(0, { c: 'escort', ids: [guard.id], target: ward.id });
    // an enemy rifleman that comes close, then runs off out of reach
    const foe = addUnit('rifleman', 1, 34.5 * TS, 30.5 * TS);
    foe.react = 'hold';
    foe.stance = 'passive';
    run(1);
    applyCommand(1, { c: 'move', ids: [foe.id], tx: 60, ty: 30 });
    let farthest = 0;
    run(15, () => { farthest = Math.max(farthest, gap(guard, ward)); });
    expect(farthest).toBeLessThan(ESCORT_LEASH + 1.5);
    expect(gap(guard, ward)).toBeLessThan(3);
  });

  it("stops when the unit it's escorting is gone, and won't escort an enemy", () => {
    openField();
    const ward = addUnit('worker', 0, 30.5 * TS, 30.5 * TS);
    const guard = addUnit('rifleman', 0, 28.5 * TS, 30.5 * TS);
    const enemy = addUnit('rifleman', 1, 50.5 * TS, 50.5 * TS);
    applyCommand(0, { c: 'escort', ids: [guard.id], target: enemy.id });
    expect(guard.order).toBeNull();
    applyCommand(0, { c: 'escort', ids: [guard.id], target: ward.id });
    expect(guard.order?.t).toBe('escort');
    kill(ward);
    run(1);
    expect(guard.order?.t).not.toBe('escort');
  });
});
