import { beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { MH, MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit } from './entity.ts';
import { orderAttack } from './order.ts';
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
