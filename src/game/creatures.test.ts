import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, kill } from './entity.ts';
import { available } from './production.ts';
import { acquire, dealDamage, fire } from './combat.ts';
import { addBeast, captorOf, satyrSong, stone, unicornCleanse, wildBeasts } from './creatures.ts';
import { START_YARDS } from '../data/map.ts';
import { BEASTS, CAPTURE_TIME, PETRIFY_IMMUNE, RESPAWN_TIME, LAIR_PAIRS_PER_MAP, SUBDUE_AT, SUBDUE_RECOVER } from '../data/creatures.ts';
import { WEAPON } from '../data/weapon.ts';
import { orderMove } from './order.ts';
import { cloakedFrom } from './aether.ts';
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
const MID = { x: 66.5 * TS, y: 26.5 * TS };
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

  it("isn't shot down by its captors once it joins their side (Move & attack troops)", () => {
    for (const type of ['centaur', 'griffin', 'minotaur'] as UnitType[]) {
      initWorld(1234);
      for (const w of wildBeasts()) { w.dead = true; G.byId.delete(w.id); }
      G.ents = G.ents.filter((e) => !e.dead);
      G.human[0] = true;
      const b = beast(type);
      // a mixed army on the human player's default stance beats it down, then keeps standing about it
      const army = ['rifleman', 'crossbowman', 'crossbowman', 'knight', 'knight', 'swordsman'].map((t, i) => addUnit(t as UnitType, 0, MID.x - 3 * TS, MID.y + (i - 3) * 14));
      for (const u of army) expect(u.stance).toBe('skirmish');
      run(40);
      expect(errors).toEqual([]);
      expect(b.team).toBe(0);
      const alive = army.filter((u) => !u.dead);
      run(20);
      expect(b.dead).toBe(false);
      expect(b.hp).toBeGreaterThan(b.maxhp * 0.5);
      for (const u of alive) expect(u.dead).toBe(false); // and it doesn't turn on them either
    }
  });

  it('comes back wild at its lair a minute after a captured one dies', () => {
    const b = beast('griffin');
    dealDamage(b, b.maxhp, null);
    const captor = addUnit('swordsman', 0, b.x, b.y + TS);
    captor.stance = 'passive';
    run(CAPTURE_TIME + 1.5);
    expect(b.team).toBe(0);
    // it wanders off with its new side and dies there; nobody is left at the lair for it to chase
    b.x += 10 * TS;
    kill(b);
    kill(captor);
    run(RESPAWN_TIME - 5);
    expect(wildBeasts()).toHaveLength(0);
    run(7);
    const back = wildBeasts();
    expect(back).toHaveLength(1);
    expect(back[0].type).toBe('griffin');
    expect(back[0].team).toBe(-1);
    expect(Math.hypot(back[0].x - MID.x, back[0].y - MID.y)).toBeLessThan(TS);
    expect(G.tamed[0]).toContain('griffin'); // the side can still train them
  });

  it("doesn't bring back creatures trained at a Barracks", () => {
    const u = addUnit('minotaur', 0, MID.x, MID.y);
    kill(u);
    run(RESPAWN_TIME + 2);
    expect(wildBeasts()).toHaveLength(0);
  });

  it('lets a Hydra bite several foes at once', () => {
    const h = addUnit('hydra', 1, MID.x, MID.y);
    const foes = [0, 1, 2].map((i) => addUnit('swordsman', 0, MID.x + 20, MID.y + (i - 1) * 10));
    fire(h, 'hydrabite', foes[0]);
    for (let i = 0; i < 0.6 / STEP; i++) update(STEP); // the bites land as the jaws close
    expect(foes.filter((f) => f.hp < f.maxhp).length).toBe(3);
  });

  it("turns a foe to stone with a Medusa's gaze: it can't move or fight, and can't be held in stone forever", () => {
    const m = addUnit('medusa', 1, MID.x, MID.y);
    const tank = addUnit('tank', 0, MID.x + 3 * TS, MID.y);
    tank.stance = 'passive'; // it just drives on
    orderMove(tank, Math.floor(MID.x / TS) + 12, Math.floor(MID.y / TS));
    fire(m, 'gaze', tank);
    const x0 = tank.x, y0 = tank.y, secs = WEAPON.gaze.petrify ?? 0;
    expect(stone(tank)).toBe(true);
    run(secs - 0.3);
    expect([tank.x, tank.y]).toEqual([x0, y0]);
    run(0.5);
    expect(stone(tank)).toBe(false);
    // straight after, another gaze doesn't take
    fire(m, 'gaze', tank);
    expect(stone(tank)).toBe(false);
    run(3);
    expect(Math.hypot(tank.x - x0, tank.y - y0)).toBeGreaterThan(TS * 0.5); // free again, it drives on
    run(PETRIFY_IMMUNE);
    fire(m, 'gaze', tank);
    expect(stone(tank)).toBe(true);
  });

  it("lets arrows and bullets glance off the Nemean Lion's hide, but not blades", () => {
    const lion = addUnit('nemean', 1, MID.x, MID.y), cat = addUnit('cerberus', 1, MID.x, MID.y + 3 * TS);
    const r = addUnit('rifleman', 0, MID.x - 3 * TS, MID.y);
    fire(r, 'rifle', lion);
    fire(r, 'rifle', cat);
    const lionLoss = lion.maxhp - lion.hp, catLoss = cat.maxhp - cat.hp;
    expect(lionLoss).toBeGreaterThan(0);
    expect(lionLoss).toBeLessThan(catLoss * 0.5);
    const s = addUnit('swordsman', 0, MID.x + 10, MID.y);
    const before = lion.hp;
    fire(s, 'sword', lion);
    for (let i = 0; i < 0.6 / STEP; i++) update(STEP);
    expect(before - lion.hp).toBeGreaterThan(WEAPON.sword.dmg * 0.5);
  });

  it("gives the Dragon scales that turn bullets, and a breath that burns tanks and buildings", () => {
    const d = addUnit('dragon', 1, MID.x, MID.y), p = addUnit('pegasus', 1, MID.x, MID.y + 3 * TS);
    const r = addUnit('rifleman', 0, MID.x - 3 * TS, MID.y);
    fire(r, 'rifle', d);
    fire(r, 'rifle', p);
    expect(d.maxhp - d.hp).toBeLessThan((p.maxhp - p.hp) * 0.7);
    const w = WEAPON[UNIT.dragon.weapon as keyof typeof WEAPON];
    expect(w.element).toBe('fire');
    expect(w.vs.building).toBeGreaterThan(w.vs.none);
    expect(w.vs.heavy).toBeGreaterThan(w.vs.none);
    expect(w.vs.air).toBeLessThan(0.5);
    expect(BEASTS).toContain('dragon');
  });

  it('lets a Phoenix rise from its ashes once', () => {
    const p = addUnit('phoenix', 0, MID.x, MID.y);
    dealDamage(p, p.maxhp * 3, null);
    expect(p.dead).toBe(false);
    expect(p.hp).toBeGreaterThan(p.maxhp * 0.4);
    dealDamage(p, p.maxhp * 3, null);
    expect(p.dead).toBe(true);
  });

  it('lets a Sphinx see cloaked units', () => {
    const jeep = addUnit('phantom', 1, MID.x, MID.y);
    expect(cloakedFrom(jeep, 0)).toBe(true);
    const sx = addUnit('sphinx', 0, MID.x - 6 * TS, MID.y);
    expect(cloakedFrom(jeep, 0)).toBe(false);
    sx.x -= 3 * TS;
    expect(cloakedFrom(jeep, 0)).toBe(true);
  });

  it("heals friendly foot soldiers and creatures around a Satyr's pipes", () => {
    addUnit('satyr', 0, MID.x, MID.y);
    const near = addUnit('minotaur', 0, MID.x + TS, MID.y), far = addUnit('minotaur', 0, MID.x + 10 * TS, MID.y);
    const foe = addUnit('minotaur', 1, MID.x, MID.y + TS);
    for (const u of [near, far, foe]) u.hp = u.maxhp / 2;
    for (let i = 0; i < 10; i++) satyrSong(1);
    expect(near.hp - near.maxhp / 2).toBeGreaterThan(near.maxhp * 0.08);
    expect(far.hp).toBe(far.maxhp / 2);
    expect(foe.hp).toBe(foe.maxhp / 2);
  });

  it('lets a Unicorn cure friends nearby of stone, ice and burns, but not foes', () => {
    addUnit('unicorn', 0, MID.x, MID.y);
    const friend = addUnit('swordsman', 0, MID.x + TS, MID.y), far = addUnit('swordsman', 0, MID.x + 10 * TS, MID.y);
    const foe = addUnit('swordsman', 1, MID.x, MID.y + TS);
    for (const u of [friend, far, foe]) { u.stoneT = G.gameT + 5; u.burnT = G.gameT + 5; u.frozenT = G.gameT + 5; }
    unicornCleanse();
    expect(stone(friend)).toBe(false);
    expect(friend.burnT).toBe(0);
    expect(friend.frozenT).toBe(0);
    expect(stone(far)).toBe(true);
    expect(stone(foe)).toBe(true);
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
