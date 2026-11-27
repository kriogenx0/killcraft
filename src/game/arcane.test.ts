// Spellcasters (regular Barracks troops, one per age) and the Modern-age cyborgs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { available, unitNeeds } from './production.ts';
import { fire, updProjs } from './combat.ts';
import { UNIT } from '../data/unit.ts';
import { WEAPON } from '../data/weapon.ts';

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

describe('spellcasters', () => {
  it('need no Aether, and come one per age', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 12, 46, false);
    // spellcasters train at the Barracks only while there's an Arcane Academy
    expect(available(0, 'infantry')).not.toContain('mage');
    expect(unitNeeds(0, 'mage')).toBe('magetower');
    addBuilding('magetower', 0, 16, 46, false);
    for (const t of ['mage', 'stormcaller', 'archmage', 'tidecaller', 'plaguewitch', 'sludgewarlock'] as const) expect(UNIT[t].aether ?? 0).toBe(0);
    expect(available(0, 'infantry')).toContain('mage');
    expect(available(0, 'infantry')).not.toContain('stormcaller');
    G.era[0] = 1;
    expect(available(0, 'infantry')).toContain('stormcaller');
    expect(available(0, 'infantry')).not.toContain('archmage');
    G.era[0] = 2;
    expect(available(0, 'infantry')).toEqual(expect.arrayContaining(['mage', 'stormcaller', 'archmage']));
  });

  it('chain lightning leaps from its target to two more foes, weaker each time', () => {
    const y = 30 * TS, caller = addUnit('stormcaller', 0, 20 * TS, y);
    const a = addUnit('rifleman', 1, 24 * TS, y), b = addUnit('rifleman', 1, 24 * TS + 30, y), c = addUnit('rifleman', 1, 24 * TS + 60, y);
    const far = addUnit('rifleman', 1, 24 * TS + 300, y);
    fire(caller, 'lightning', a);
    const lost = [a, b, c].map((e) => e.maxhp - e.hp);
    expect(lost[0]).toBeGreaterThan(0);
    expect(lost[1]).toBeGreaterThan(0);
    expect(lost[2]).toBeGreaterThan(0);
    expect(lost[1]).toBeLessThan(lost[0]);
    expect(far.hp).toBe(far.maxhp);
  });

  it('a fireball bursts over a crowd', () => {
    const y = 30 * TS, mage = addUnit('mage', 0, 20 * TS, y);
    const a = addUnit('rifleman', 1, 23 * TS, y), b = addUnit('rifleman', 1, 23 * TS + 8, y + 6);
    fire(mage, 'fireball', a);
    for (let i = 0; i < 120 && G.projs.length; i++) updProjs(1 / 60);
    expect(a.hp).toBeLessThan(a.maxhp);
    expect(b.hp).toBeLessThan(b.maxhp);
  });
});

describe('cyborgs', () => {
  it('are Modern-age War Factory units, bigger and tougher than a Heavy Tank', () => {
    for (const t of ['juggernaut', 'titan'] as const) {
      expect(UNIT[t].era).toBe(2);
      expect(UNIT[t].producer).toBe('vehicle');
      expect(UNIT[t].aether ?? 0).toBe(0);
      expect(UNIT[t].hp).toBeGreaterThan(UNIT.heavy.hp);
      expect(UNIT[t].radius).toBeGreaterThanOrEqual(UNIT.heavy.radius);
    }
    expect(UNIT.titan.hp).toBeGreaterThan(UNIT.juggernaut.hp);
  });

  it('only show up at the War Factory in the Modern age', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('refinery', 0, 14, 50, false);
    addBuilding('factory', 0, 14, 44, false);
    expect(available(0, 'vehicle')).not.toContain('juggernaut');
    G.era[0] = 2;
    expect(available(0, 'vehicle')).toEqual(expect.arrayContaining(['juggernaut', 'titan']));
  });

  it('the Juggernaut shreds infantry, the Titan cracks armor, and neither hits aircraft well', () => {
    expect(WEAPON.minigun.vs.none).toBeGreaterThan(WEAPON.minigun.vs.heavy * 3);
    expect(WEAPON.railgun.vs.heavy).toBeGreaterThan(WEAPON.railgun.vs.none * 2);
    expect(WEAPON.railgun.vs.air).toBe(0);
  });
});
