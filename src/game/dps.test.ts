import { describe, expect, it } from 'vitest';
import { dpsOf, dpsText } from './dps.ts';
import { WEAPON } from '../data/weapon.ts';

describe('dps', () => {
  it('divides damage by reload time for each armor class', () => {
    const rifle = dpsOf('rifle');
    expect(rifle.find((d) => d.armor === 'none')?.dps).toBeCloseTo(WEAPON.rifle.dmg / WEAPON.rifle.cd);
    expect(rifle.find((d) => d.armor === 'heavy')?.dps).toBeCloseTo((WEAPON.rifle.dmg * WEAPON.rifle.vs.heavy) / WEAPON.rifle.cd);
  });

  it('leaves out what a weapon cannot hit', () => {
    expect(dpsOf('flak').map((d) => d.armor)).toEqual(['air']);
    expect(dpsOf('sword').some((d) => d.armor === 'air')).toBe(false);
  });

  it('scales with Armory upgrades and low power', () => {
    const base = dpsOf('cannon')[0].dps;
    expect(dpsOf('cannon', 1.2)[0].dps).toBeCloseTo(base * 1.2);
    expect(dpsOf('cannon', 1, 2.5)[0].dps).toBeCloseTo(base / 2.5);
  });

  it('notes splash weapons', () => {
    expect(dpsText('cannon')).toContain('splash');
    expect(dpsText('rifle')).not.toContain('splash');
  });
});
