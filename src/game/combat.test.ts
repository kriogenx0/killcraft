import { beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { MH, MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit } from './entity.ts';
import { fire, MELEE_LAND, updProjs } from './combat.ts';
import { applyCommand } from './command.ts';
import { groupMove, orderAttack, setStance } from './order.ts';
import type { UnitType } from '../data/unit.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP; i++) update(STEP);
}

/** A row of open ground long enough for a duel. */
function openGround(len: number): [number, number] {
  for (let ty = 2; ty < MH - 2; ty++)
    for (let tx = 2; tx < MW - len - 2; tx++) {
      let ok = true;
      for (let y = ty - 1; y <= ty + 1 && ok; y++) for (let x = tx - 1; x <= tx + len + 1 && ok; x++) ok = !G.blk[y * MW + x];
      if (ok) return [(tx + 0.5) * TS, (ty + 0.5) * TS];
    }
  throw new Error('no open ground');
}

/** Two units face off on open ground; returns them after `seconds`. */
function duel(a: UnitType, b: UnitType, seconds = 30, gap = 4): [Ent, Ent] {
  const [x, y] = openGround(gap + 1);
  const u = addUnit(a, 0, x, y), v = addUnit(b, 1, x + gap * TS, y);
  orderAttack(u, v);
  orderAttack(v, u);
  run(seconds);
  return [u, v];
}

describe('medieval arms', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    G.reveal = true;
    hooks.error = (e) => { throw e; };
    initWorld(1234);
    // clear the starting armies so they don't join in
    for (const e of G.ents) if (e.kind === 'unit') e.dead = true;
    G.ents = G.ents.filter((e) => !e.dead);
  });

  it('a sword blow lands as the swing comes down, not when it starts', () => {
    const [x, y] = openGround(2);
    const u = addUnit('swordsman', 0, x, y), foe = addUnit('rifleman', 1, x + 10, y);
    fire(u, 'sword', foe);
    expect(foe.hp).toBe(foe.maxhp);
    updProjs(MELEE_LAND * 0.5);
    expect(foe.hp).toBe(foe.maxhp);
    updProjs(MELEE_LAND * 0.6);
    expect(foe.hp).toBeLessThan(foe.maxhp);
  });

  it('a swordsman closes in and cuts down a rifleman', () => {
    const [sword, rifle] = duel('swordsman', 'rifleman');
    expect(rifle.dead).toBe(true);
    expect(sword.dead).toBe(false);
  });

  it('armor holds: a battle tank beats a swordsman', () => {
    const [sword, tank] = duel('swordsman', 'tank', 40);
    expect(sword.dead).toBe(true);
    expect(tank.dead).toBe(false);
  });

  it('a knight runs down a crossbowman, but crossbows pierce its armor', () => {
    const [knight, xbow] = duel('knight', 'crossbowman', 30, 5);
    expect(xbow.dead).toBe(true);
    expect(knight.hp).toBeLessThan(knight.maxhp);
  });

  it('a catapult lobs boulders from beyond a tank’s reach', () => {
    const yard = G.ents.find((e) => e.team === 1 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    const cat = addUnit('catapult', 0, yard.x - 9 * TS, yard.y + 4 * TS);
    orderAttack(cat, yard);
    const before = yard.hp;
    run(25);
    expect(yard.hp).toBeLessThan(before - 100);
    expect(Math.hypot(cat.x - yard.x, cat.y - yard.y)).toBeGreaterThan(5 * TS);
  });
});

describe('stances', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    G.reveal = true;
    hooks.error = (e) => { throw e; };
    initWorld(1234);
    for (const e of G.ents) if (e.kind === 'unit') e.dead = true;
    G.ents = G.ents.filter((e) => !e.dead);
  });

  /** A unit walks the length of a strip of open ground, past an enemy harvester beside its path. */
  function walkPast(type: UnitType, stance: 'engage' | 'skirmish' | 'passive', seconds: number): { u: Ent; prey: Ent; gx: number } {
    const [x, y] = openGround(16);
    const u = addUnit(type, 0, x, y), prey = addUnit('harvester', 1, x + 6 * TS, y + TS);
    setStance(u, stance);
    const gx = Math.floor(x / TS) + 15;
    groupMove([u], gx, Math.floor(y / TS));
    run(seconds);
    return { u, prey, gx };
  }

  it('fights back against an attacker before a building or harvester that can’t', () => {
    const [x, y] = openGround(10);
    const u = addUnit('tank', 0, x + 4 * TS, y), prey = addUnit('harvester', 1, x + 7 * TS, y);
    orderAttack(u, prey);
    run(2);
    expect(prey.hp).toBeLessThan(prey.maxhp);
    const foe = addUnit('rifleman', 1, x + TS, y);
    run(12);
    expect(foe.dead).toBe(true);
    expect(prey.dead).toBe(false);
  });

  it('patrol walks back and forth, fighting what it meets on the way', () => {
    const [x, y] = openGround(10);
    const u = addUnit('tank', 0, x, y), tx = Math.floor(x / TS) + 8, ty = Math.floor(y / TS);
    applyCommand(0, { c: 'patrol', ids: [u.id], tx, ty });
    let far = 0;
    for (let i = 0; i < 12 / STEP; i++) { update(STEP); far = Math.max(far, u.x - x); }
    expect(far).toBeGreaterThan(7 * TS); // got to the far end
    expect(u.order?.t).toBe('move'); // and is still patrolling
    run(8);
    expect(Math.abs(u.x - x)).toBeLessThan(3 * TS); // back near the start by now, or on the way
    const prey = addUnit('harvester', 1, x + 4 * TS, y + TS);
    run(10);
    expect(prey.hp).toBeLessThan(prey.maxhp);
  });

  it('stop and attack (the default): a moving unit stops to fight what it meets', () => {
    const { u, prey, gx } = walkPast('tank', 'engage', 8);
    expect(prey.hp).toBeLessThan(prey.maxhp);
    expect(u.x).toBeLessThan((gx - 2) * TS); // still busy with the harvester
  });

  it('attack while moving: shoots on the way without stopping', () => {
    const { u, prey, gx } = walkPast('jeep', 'skirmish', 8);
    expect(prey.hp).toBeLessThan(prey.maxhp);
    expect(Math.abs(u.x - (gx + 0.5) * TS)).toBeLessThan(TS);
  });

  it('do not attack: holds fire and runs from armed enemies', () => {
    const [x, y] = openGround(8);
    const u = addUnit('rifleman', 0, x + 4 * TS, y), foe = addUnit('tank', 1, x, y);
    setStance(u, 'passive');
    setStance(foe, 'passive');
    run(6);
    expect(foe.hp).toBe(foe.maxhp);
    expect(Math.hypot(u.x - foe.x, u.y - foe.y)).toBeGreaterThan(6 * TS);
  });
});
