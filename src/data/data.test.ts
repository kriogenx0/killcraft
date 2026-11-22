import { describe, expect, it } from 'vitest';
import { UNIT, UNIT_TYPES } from './unit.ts';
import { BUILDING, BLD_TYPES } from './building.ts';
import { WEAPON } from './weapon.ts';
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

  it('places bases and ore inside the map', () => {
    for (const [x, y] of [...START_YARDS, ...ORE_SOURCES]) {
      expect(x >= 0 && x + 3 <= MW).toBe(true);
      expect(y >= 0 && y + 3 <= MH).toBe(true);
    }
  });
});
