// Mana, auto-cast spells, and elemental effects (game/spells.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit } from './entity.ts';
import { dealDamage, fire, updProjs } from './combat.ts';
import { applyElement, burning, cast, frozen, lusting, poisoned, shielded, sludged, updCaster, wet } from './spells.ts';
import { setOrder } from './order.ts';
import { BURN_TIME, SHIELD_HP, SPELL, WET_SHOCK, WRECK_BURN_AT } from '../data/spells.ts';
import { UNIT } from '../data/unit.ts';

beforeEach(() => {
  G.reveal = true;
  G.demo = true;
  ais[0].on = ais[1].on = false;
  initWorld(1234);
  G.ents = [];
  G.projs = [];
});

afterEach(() => {
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

const y = 30 * TS;
const run = (secs: number) => { for (let i = 0; i < secs * 30; i++) update(1 / 30); };
const flyAll = () => { for (let i = 0; i < 240 && G.projs.length; i++) updProjs(1 / 60); };

describe('mana', () => {
  it('casters start half full and refill over time, up to their most', () => {
    const m = addUnit('mage', 0, 20 * TS, y);
    expect(m.mana).toBe(UNIT.mage.mana! / 2);
    updCaster(m, 1000);
    expect(m.mana).toBe(UNIT.mage.mana);
    expect(addUnit('rifleman', 0, 20 * TS, y).mana).toBeUndefined();
  });
});

describe('auto-cast spells', () => {
  it('a mage casts Bloodlust on a friend in a fight, which then reloads faster', () => {
    const mage = addUnit('mage', 0, 20 * TS, y), ally = addUnit('swordsman', 0, 21 * TS, y);
    const foe = addUnit('swordsman', 1, 30 * TS, y);
    setOrder(ally, { t: 'attack', tgt: foe.id, auto: false, ox: ally.x, oy: ally.y });
    run(1);
    expect(lusting(ally) || lusting(mage)).toBe(true);
    expect(mage.mana).toBeLessThan(UNIT.mage.mana! / 2 + 2);
  });

  it('Freeze stops a strong enemy dead: no moving, no shooting', () => {
    const arch = addUnit('archmage', 0, 20 * TS, y);
    arch.mana = UNIT.archmage.mana!;
    const tank = addUnit('heavy', 1, 24 * TS, y);
    cast(arch, 'freeze', tank);
    expect(frozen(tank)).toBe(true);
    expect(arch.mana).toBe(UNIT.archmage.mana! - SPELL.freeze.mana);
    const x0 = tank.x;
    setOrder(tank, { t: 'move', gx: 40, gy: 30 } as never);
    run(2);
    expect(Math.abs(tank.x - x0)).toBeLessThan(4); // only nudged by its neighbours
    expect(arch.hp).toBe(arch.maxhp);
  });

  it('an Archmage saves mana for Freeze and spends it on a worthy target', () => {
    const arch = addUnit('archmage', 0, 20 * TS, y);
    arch.mana = SPELL.freeze.mana + 5; // not enough to Slow as well and still Freeze
    const tank = addUnit('heavy', 1, 24 * TS, y);
    run(0.5);
    expect(frozen(tank)).toBe(true);
  });

  it('a Tide Caller douses a burning friend', () => {
    const tide = addUnit('tidecaller', 0, 20 * TS, y), ally = addUnit('rifleman', 0, 21 * TS, y);
    applyElement(ally, 'fire', null);
    expect(burning(ally)).toBe(true);
    run(1);
    expect(burning(ally)).toBe(false);
    expect(tide.mana).toBeLessThan(UNIT.tidecaller.mana! / 2);
  });

  it('Shield soaks up hits until it bursts, but burning still gets through', () => {
    const tide = addUnit('tidecaller', 0, 20 * TS, y), knight = addUnit('knight', 0, 21 * TS, y);
    tide.mana = UNIT.tidecaller.mana!;
    cast(tide, 'shield', knight);
    expect(shielded(knight)).toBe(true);
    const hp = knight.hp;
    dealDamage(knight, 40, null);
    expect(knight.hp).toBe(hp);
    dealDamage(knight, 1, null, true); // a tick of fire slips past
    expect(knight.hp).toBeLessThan(hp);
    const hp2 = knight.hp;
    dealDamage(knight, 1000, null); // more than it can hold: it bursts and the rest goes through
    expect(shielded(knight)).toBe(false);
    expect(knight.hp).toBeLessThan(hp2);
    expect(hp2 - knight.hp).toBeLessThan(1000);
  });

  it('a Tide Caller Shields a friend under fire, and not one that is safe', () => {
    const tide = addUnit('tidecaller', 0, 20 * TS, y), safe = addUnit('rifleman', 0, 21 * TS, y), hit = addUnit('rifleman', 0, 21 * TS, y + TS);
    tide.mana = UNIT.tidecaller.mana!;
    dealDamage(hit, 5, null);
    run(0.5);
    expect(shielded(hit)).toBe(true);
    expect(hit.shieldHp).toBe(SHIELD_HP);
    expect(shielded(safe)).toBe(false);
  });

  it('good spells reach a teammate, but go on our own troops first', () => {
    const was = G.ally;
    G.ally = [0, 0, 2, 3];
    try {
      const tide = addUnit('tidecaller', 0, 20 * TS, y), mate = addUnit('knight', 1, 21 * TS, y);
      tide.mana = UNIT.tidecaller.mana!;
      dealDamage(mate, 5, null);
      run(0.5);
      expect(shielded(mate)).toBe(true);
      const own = addUnit('rifleman', 0, 21 * TS, y + TS), mate2 = addUnit('knight', 1, 21 * TS, y - TS);
      tide.mana = UNIT.tidecaller.mana!; tide.spellCd = {};
      dealDamage(own, 5, null); dealDamage(mate2, 5, null);
      run(0.5);
      expect(shielded(own)).toBe(true);
    } finally { G.ally = was; }
  });
});

describe('elements', () => {
  it('fire burns over time; water puts it out and leaves the target wet', () => {
    const mage = addUnit('mage', 0, 20 * TS, y), foe = addUnit('swordsman', 1, 23 * TS, y);
    foe.stance = 'passive';
    fire(mage, 'fireball', foe);
    flyAll();
    expect(burning(foe)).toBe(true);
    const hp = foe.hp;
    run(1);
    expect(foe.hp).toBeLessThan(hp);
    applyElement(foe, 'water', null);
    expect(burning(foe)).toBe(false);
    expect(wet(foe)).toBe(true);
    // a wet target doesn't catch fire, it steams dry
    applyElement(foe, 'fire', null);
    expect(burning(foe)).toBe(false);
    expect(wet(foe)).toBe(false);
  });

  it('lightning hits wet targets harder', () => {
    const caller = addUnit('stormcaller', 0, 20 * TS, y);
    const dry = addUnit('swordsman', 1, 24 * TS, y), soaked = addUnit('swordsman', 1, 24 * TS, y + 6 * TS);
    applyElement(soaked, 'water', null);
    fire(caller, 'lightning', dry);
    fire(caller, 'lightning', soaked);
    const a = dry.maxhp - dry.hp, b = soaked.maxhp - soaked.hp;
    expect(b / a).toBeCloseTo(WET_SHOCK, 1);
  });

  it('poison eats living things but not machines, and water cures it', () => {
    const man = addUnit('rifleman', 1, 24 * TS, y), jeep = addUnit('jeep', 1, 26 * TS, y);
    applyElement(man, 'poison', null);
    applyElement(jeep, 'poison', null);
    expect(poisoned(man)).toBe(true);
    expect(poisoned(jeep)).toBe(false);
    applyElement(man, 'water', null);
    expect(poisoned(man)).toBe(false);
  });

  it('sludge slows its target and makes it burn hotter', () => {
    const a = addUnit('swordsman', 1, 24 * TS, y), b = addUnit('swordsman', 1, 24 * TS, y + 6 * TS);
    a.stance = b.stance = 'passive';
    applyElement(b, 'sludge', null);
    expect(sludged(b)).toBe(true);
    applyElement(a, 'fire', null);
    applyElement(b, 'fire', null);
    run(2);
    expect(b.maxhp - b.hp).toBeGreaterThan((a.maxhp - a.hp) * 1.8);
  });

  it('fire burns slowly, for a long while', () => {
    const a = addUnit('swordsman', 1, 24 * TS, y);
    a.stance = 'passive';
    applyElement(a, 'fire', null);
    run(BURN_TIME / 2);
    expect(burning(a)).toBe(true);
    run(BURN_TIME / 2 + 0.5);
    expect(burning(a)).toBe(false);
    expect(a.hp).toBeGreaterThan(0);
  });

  it('a burning soldier sets the troops packed around it alight, but the fire stops there', () => {
    const lit = addUnit('swordsman', 1, 24 * TS, y);
    const near = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => addUnit('swordsman', 1, 24 * TS + Math.cos(i * 0.785) * 6, y + Math.sin(i * 0.785) * 6));
    const far = addUnit('swordsman', 1, 30 * TS, y);
    for (const e of [lit, ...near, far]) e.stance = 'passive';
    applyElement(lit, 'fire', null);
    run(BURN_TIME / 2);
    expect(near.some(burning)).toBe(true);
    expect(burning(far)).toBe(false);
    run(BURN_TIME + 1);
    expect([lit, ...near].some(burning)).toBe(false); // burnt out: caught fire doesn't spread again
  });

  it('a wrecked vehicle slowly burns until it is repaired', () => {
    const tank = addUnit('jeep', 1, 24 * TS, y);
    tank.stance = 'passive';
    tank.hp = tank.maxhp * WRECK_BURN_AT * 0.9;
    run(1);
    expect(burning(tank)).toBe(true);
    const hp = tank.hp;
    run(2);
    expect(tank.hp).toBeLessThan(hp);
    tank.hp = tank.maxhp;
    run(2);
    expect(burning(tank)).toBe(false);
  });

  it('a Medic puts out the fire on whoever it tends', () => {
    const medic = addUnit('medic', 1, 23 * TS, y), man = addUnit('rifleman', 1, 24 * TS, y);
    man.stance = 'passive';
    applyElement(man, 'fire', null);
    setOrder(medic, { t: 'heal', tgt: man.id, ox: medic.x, oy: medic.y, sent: true });
    run(1);
    expect(burning(man)).toBe(false);
  });

  it('a damage tick of burning credits the unit that lit it', () => {
    const mage = addUnit('mage', 0, 20 * TS, y), foe = addUnit('rifleman', 1, 23 * TS, y);
    applyElement(foe, 'fire', mage);
    expect(foe.burnBy).toBe(mage.id);
    dealDamage(foe, 1, mage, true);
    expect(foe.order).toBeNull(); // a tick doesn't send it after anyone
  });
});
