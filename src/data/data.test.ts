import { describe, expect, it } from 'vitest';
import { UNIT, UNIT_TYPES } from './unit.ts';
import { BUILDING, BLD_TYPES } from './building.ts';
import { WEAPON } from './weapon.ts';
import { ERA, HEAL_RATE, TECH, TECH_TYPES } from './era.ts';
import { ORE_SOURCES, START_YARDS } from './map.ts';
import { MW, MH } from '../game/const.ts';

describe('static data', () => {
  it('only requires buildings that exist, and never itself', () => {
    for (const t of BLD_TYPES) for (const r of BUILDING[t].requires) { expect(BUILDING[r]).toBeDefined(); expect(r).not.toBe(t); }
  });

  it('has a building that produces every unit line', () => {
    for (const u of UNIT_TYPES) expect(Object.values(BUILDING).some((b) => b.produces === UNIT[u].producer)).toBe(true);
  });

  it('gives every armed unit and turret a real weapon', () => {
    for (const u of UNIT_TYPES) if (UNIT[u].weapon) expect(WEAPON[UNIT[u].weapon as keyof typeof WEAPON]).toBeDefined();
    expect(WEAPON[BUILDING.turret.weapon as keyof typeof WEAPON]).toBeDefined();
  });

  it('makes more power than a starting base uses', () => {
    expect(BUILDING.power.power).toBeGreaterThan(-(BUILDING.refinery.power + BUILDING.barracks.power));
  });

  it('reaches every age by research, one step at a time, and unlocks something in each', () => {
    const ages = TECH_TYPES.filter((t) => TECH[t].age != null);
    expect(ages.map((t) => TECH[t].age).sort()).toEqual(ERA.map((_, i) => i).slice(1));
    for (const t of ages) expect(TECH[t].era).toBe((TECH[t].age ?? 0) - 1);
    for (const t of TECH_TYPES) for (const r of TECH[t].requires) expect(BUILDING[r]).toBeDefined();
    for (let era = 0; era < ERA.length; era++)
      expect(UNIT_TYPES.some((u) => UNIT[u].era === era) || BLD_TYPES.some((b) => BUILDING[b].era === era)).toBe(true);
  });

  it('researches healing one level at a time, slow to start and faster with each level', () => {
    const heals = TECH_TYPES.filter((t) => TECH[t].heal != null);
    expect(heals.map((t) => TECH[t].heal).sort()).toEqual(HEAL_RATE.map((_, i) => i).slice(1));
    for (const t of heals) expect(TECH[t].era).toBeLessThan(ERA.length);
    expect(1 / HEAL_RATE[0]).toBeGreaterThan(300); // unresearched: well over five minutes to heal fully
    for (let i = 1; i < HEAL_RATE.length; i++) expect(HEAL_RATE[i]).toBeGreaterThan(HEAL_RATE[i - 1]);
  });

  it('starts with a working medieval economy', () => {
    for (const b of ['power', 'refinery', 'barracks', 'factory'] as const) expect(BUILDING[b].era).toBe(0);
    expect(UNIT.harvester.era).toBe(0);
  });

  it('never asks for oil before World War, when the Oil Derrick arrives', () => {
    expect(BUILDING.derrick.era).toBe(1);
    expect(BUILDING.derrick.oil ?? 0).toBe(0);
    for (const u of UNIT_TYPES) if (UNIT[u].era < 1) expect(UNIT[u].oil ?? 0).toBe(0);
    for (const b of BLD_TYPES) if (BUILDING[b].era < 1) expect(BUILDING[b].oil ?? 0).toBe(0);
    for (const t of TECH_TYPES) if (TECH[t].era < 1) expect(TECH[t].oil ?? 0).toBe(0); // era: the age a research starts in
  });

  it('lets a side start cutting wood without needing any', () => {
    expect(BUILDING.mill.era).toBe(0);
    expect(BUILDING.mill.requires).toEqual([]);
    expect(BUILDING.mill.wood ?? 0).toBe(0);
  });

  it('places bases and ore inside the map', () => {
    for (const [x, y] of [...START_YARDS, ...ORE_SOURCES]) {
      expect(x >= 0 && x + 3 <= MW).toBe(true);
      expect(y >= 0 && y + 3 <= MH).toBe(true);
    }
  });
});
