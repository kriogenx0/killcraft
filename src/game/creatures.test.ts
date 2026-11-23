import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { available } from './production.ts';
import { acquire, dealDamage, fire } from './combat.ts';
import { addBeast, captorOf, wildBeasts } from './creatures.ts';
import { START_YARDS } from '../data/map.ts';
import { BEASTS, CAPTURE_TIME, LAIR_PAIRS_PER_MAP, SUBDUE_AT, SUBDUE_RECOVER } from '../data/creatures.ts';
import { UNIT, type UnitType } from '../data/unit.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

const errors: unknown[] = [];

beforeEach(() => {
  errors.length = 0;
  hooks.error = (e) => errors.push(e);
  G.reveal = true;
  G.demo = true;
  ais[0].on = false;
  ais[1].on = false;
  initWorld(1234);
  // a clean field: only the creatures we place ourselves
  for (const b of wildBeasts()) { b.dead = true; G.byId.delete(b.id); }
  G.ents = G.ents.filter((e) => !e.dead);
});

afterEach(() => {
  ais[0].on = false;
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

/** A creature in the open middle of the map, and the spot beside it. */
const MID = { x: 30.5 * TS, y: 20.5 * TS };
const beast = (type: UnitType = 'minotaur'): Ent => addBeast(type, MID.x, MID.y);

describe('creatures of myth', () => {
  it('puts a few lairs on every map, each with a different creature, none near a base', () => {
    for (const seed of [1, 2, 3, 99, 1234, 4321]) {
      initWorld(seed);
      const bs = wildBeasts();
      expect(bs).toHaveLength(LAIR_PAIRS_PER_MAP * 2);
      expect(new Set(bs.map((b) => b.type)).size).toBe(bs.length);
      for (const b of bs) {
        expect(BEASTS).toContain(b.type);
        expect(b.team).toBe(-1);
        for (const [x, y] of START_YARDS) expect(Math.hypot(b.x / TS - x - 1.5, b.y / TS - y - 1.5)).toBeGreaterThan(14);
      }
    }
  });

  it('puts a lair on the way out of each corner in a four-player free-for-all', () => {
    initWorld(77, 4);
    const bs = wildBeasts();
    expect(bs).toHaveLength(4);
    expect(G.tamed).toHaveLength(4);
    // a creature beaten down in a free-for-all is captured by the one side beside it
    const b = bs[0];
    dealDamage(b, b.maxhp, null);
    addUnit('swordsman', 3, b.x, b.y + TS).stance = 'passive';
    expect(captorOf(b)).toBe(3);
    addUnit('swordsman', 2, b.x + TS, b.y).stance = 'passive';
    expect(captorOf(b)).toBe(-1);
  });

  it('kneels at a quarter health instead of dying, and takes no more damage while down', () => {
    const b = beast();
    dealDamage(b, b.maxhp * 5, null);
    expect(b.dead).toBe(false);
    expect(b.wild?.down).toBe(true);
    expect(b.hp).toBeCloseTo(Math.ceil(b.maxhp * SUBDUE_AT), 0);
    const hp = b.hp;
    dealDamage(b, 1000, null);
    expect(b.hp).toBe(hp);
    // nobody targets a kneeling creature
    const s = addUnit('swordsman', 0, b.x - TS, b.y);
    expect(acquire(s, 6)).toBeNull();
  });

  it('is captured by the side that stands beside it, uncontested, long enough', () => {
    const b = beast();
    dealDamage(b, b.maxhp, null);
    const s = addUnit('swordsman', 0, b.x, b.y + TS);
    s.stance = 'passive';
    expect(captorOf(b)).toBe(0);
    expect(available(0, 'infantry')).not.toContain('minotaur');
    run(CAPTURE_TIME + 1.5);
    expect(errors).toEqual([]);
    expect(b.team).toBe(0);
    expect(b.wild).toBeUndefined();
    expect(b.hp).toBeGreaterThan(b.maxhp * 0.5);
    expect(G.tamed[0]).toContain('minotaur');
    expect(G.tamed[1]).not.toContain('minotaur');
    // the side can now train them, for ore and Aether
    addBuilding('power', 0, 10, 44, false);
    addBuilding('barracks', 0, 12, 44, false);
    expect(available(0, 'infantry')).toContain('minotaur');
    expect(UNIT.minotaur.aether).toBeGreaterThan(0);
  });

  it("isn't captured while both sides stand beside it", () => {
    const b = beast();
    dealDamage(b, b.maxhp, null);
    for (const team of [0, 1]) addUnit('swordsman', team, b.x + (team ? TS : -TS), b.y).stance = 'passive';
    expect(captorOf(b)).toBe(-1);
    run(CAPTURE_TIME + 2);
    expect(b.team).toBe(-1);
  });

  it('gets back up if nobody captures it', () => {
    const b = beast();
    dealDamage(b, b.maxhp, null);
    run(SUBDUE_RECOVER + 2);
    expect(b.wild?.down).toBe(false);
    expect(b.hp).toBeGreaterThan(b.maxhp * 0.5);
  });

  it('guards its lair: attacks units that come close, then goes home', () => {
    const b = beast();
    const s = addUnit('swordsman', 0, b.x + 2 * TS, b.y);
    s.stance = 'passive';
    run(2);
    expect(s.hp).toBeLessThan(s.maxhp);
    // a unit far away is left alone
    const far = addUnit('swordsman', 0, b.x + 12 * TS, b.y);
    far.stance = 'passive';
    run(6);
    expect(far.hp).toBe(far.maxhp);
    expect(Math.hypot(b.x - MID.x, b.y - MID.y)).toBeLessThan(7 * TS);
  });

  it('can be beaten down and captured by an army that walks up to it', () => {
    const b = beast('centaur');
    for (let i = 0; i < 6; i++) addUnit('knight', 0, MID.x - 7 * TS, MID.y + (i - 3) * 14).face = 0;
    for (const u of G.ents) if (u.team === 0 && u.type === 'knight') u.order = { t: 'move', gx: Math.floor(MID.x / TS), gy: Math.floor(MID.y / TS), sub: null };
    run(60);
    expect(errors).toEqual([]);
    expect(b.dead).toBe(false);
    expect(b.team).toBe(0);
  });

  it('lets a Hydra bite several foes at once', () => {
    const h = addUnit('hydra', 1, MID.x, MID.y);
    const foes = [0, 1, 2].map((i) => addUnit('swordsman', 0, MID.x + 20, MID.y + (i - 1) * 10));
    fire(h, 'hydrabite', foes[0]);
    for (let i = 0; i < 0.6 / STEP; i++) update(STEP); // the bites land as the jaws close
    expect(foes.filter((f) => f.hp < f.maxhp).length).toBe(3);
  });

  it('the computer sends a party to capture a creature', () => {
    initWorld(1234);
    const yard = G.ents.find((e) => e.team === 1 && e.type === 'yard') as Ent;
    // a strong army at home, and one wild creature a little way off
    for (let i = 0; i < 14; i++) addUnit('knight', 1, yard.x - 3 * TS + (i % 5) * 16, yard.y + 3 * TS + Math.floor(i / 5) * 16);
    const near = wildBeasts().filter((b) => !UNIT[b.type as 'centaur'].alt).sort((a, c) => Math.hypot(a.x - yard.x, a.y - yard.y) - Math.hypot(c.x - yard.x, c.y - yard.y))[0];
    for (const b of wildBeasts()) if (b !== near) { b.dead = true; G.byId.delete(b.id); }
    G.ents = G.ents.filter((e) => !e.dead);
    ais[1].on = true;
    ais[1].attackAt = 99;
    run(120);
    expect(errors).toEqual([]);
    expect(near.team).toBe(1);
    expect(G.tamed[1]).toContain(near.type);
  });
});
