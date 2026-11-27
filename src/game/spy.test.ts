// The Spy (Alex, 2026-11-27): a Modern-age stealth unit for watching other sides. It never attacks.
import { beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, reactOf } from './state.ts';
import { MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, stranded, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { available } from './production.ts';
import { cloakedFrom } from './aether.ts';
import { acquire, dealDamage } from './combat.ts';
import { updFog } from './fog.ts';
import { UNIT, UNIT_SIGHT_BOOST } from '../data/unit.ts';
import { CLOAK_DETECT } from '../data/aether.ts';

const run = (seconds: number) => { for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP); };

beforeEach(() => {
  hooks.error = (e) => { throw e; };
  G.reveal = true;
  G.demo = true;
  ais[0].on = false;
  ais[1].on = false;
  initWorld(1234);
});

describe('Spy', () => {
  it('is a Modern Barracks unit that costs oil and has no weapon', () => {
    expect(UNIT.spy.era).toBe(2);
    expect(UNIT.spy.weapon).toBeNull();
    expect(UNIT.spy.oil).toBeGreaterThan(0);
    expect(UNIT.spy.aether).toBeUndefined();
    addBuilding('barracks', 0, 20, 40, false);
    expect(available(0, 'infantry')).not.toContain('spy');
    G.era[0] = 2;
    expect(available(0, 'infantry')).toContain('spy');
  });

  it('stays hidden from enemies until they all but bump into it, closer than a Phantom Jeep', () => {
    const spy = addUnit('spy', 0, 30 * TS, 20 * TS);
    const guard = addUnit('rifleman', 1, 30 * TS + (CLOAK_DETECT - 0.5) * TS, 20 * TS); // would spot a jeep
    expect(cloakedFrom(spy, 1)).toBe(true);
    expect(acquire(guard, 6)).not.toBe(spy);
    guard.x = 30 * TS + 0.6 * TS;
    expect(cloakedFrom(spy, 1)).toBe(false);
  });

  it('is seen by Ward Stones and by an enemy Spy', () => {
    const spy = addUnit('spy', 0, 30 * TS, 20 * TS);
    const theirs = addUnit('spy', 1, 30 * TS + 3 * TS, 20 * TS);
    expect(cloakedFrom(spy, 1)).toBe(false);
    expect(cloakedFrom(theirs, 0)).toBe(false);
    theirs.dead = true;
    expect(cloakedFrom(spy, 1)).toBe(true);
    addBuilding('wardstone', 1, 30, 25, false);
    expect(cloakedFrom(spy, 1)).toBe(false);
  });

  it('sees far through the fog', () => {
    G.reveal = false;
    G.fog = 'regrow';
    const spy = addUnit('spy', 0, 30 * TS, 30 * TS);
    G.sight[0].fill(0);
    updFog();
    const far = Math.floor(UNIT.spy.sight * UNIT_SIGHT_BOOST) - 1;
    expect(G.sight[0][30 * MW + 30 + far]).toBe(2);
    expect(UNIT.spy.sight).toBeGreaterThan(UNIT.jeep.sight);
    expect(spy.dead).toBe(false);
  });

  it('never attacks, and runs when shot', () => {
    const spy = addUnit('spy', 0, 30 * TS, 20 * TS);
    const foe = addUnit('swordsman', 1, 30 * TS + 0.5 * TS, 20 * TS);
    expect(reactOf(spy)).toBe('evade');
    dealDamage(spy, 5, foe);
    expect(spy.order?.t).toBe('move');
    run(2);
    expect(foe.hp).toBe(foe.maxhp);
  });

  it("doesn't keep a beaten side in the game on its own", () => {
    for (const e of G.ents) if (e.team === 1) e.dead = true;
    addUnit('spy', 1, 30 * TS, 20 * TS);
    expect(stranded(1)).toBe(true);
  });
});
