// Damage per second, worked out from the weapon data, for the selection panel and the build buttons.
import { WEAPON, type ArmorClass, type WeaponType } from '../data/weapon.ts';
import { WEAPON_BONUS } from '../data/era.ts';
import { UNIT, type UnitType } from '../data/unit.ts';
import { upgradeOf } from './upgrade.ts';

/** Target kinds in the order they're listed, with the names players know them by. */
export const DPS_TARGETS: { armor: ArmorClass; label: string }[] = [
  { armor: 'none', label: 'Infantry' },
  { armor: 'light', label: 'Light' },
  { armor: 'heavy', label: 'Heavy' },
  { armor: 'building', label: 'Buildings' },
  { armor: 'air', label: 'Air' },
];

/**
 * Damage per second a weapon does to one target of each armor class, before the target's own
 * armor upgrades. `bonus` is the Armory weapon multiplier, `slow` stretches the reload (a turret
 * short of power fires 2.5× slower). Classes it can't hit are left out.
 */
export function dpsOf(wt: WeaponType, bonus = 1, slow = 1): { armor: ArmorClass; label: string; dps: number }[] {
  const w = WEAPON[wt];
  return DPS_TARGETS.filter((t) => w.vs[t.armor] > 0).map((t) => ({ ...t, dps: Math.max(1, w.dmg * w.vs[t.armor] * bonus) / (w.cd * slow) }));
}

/** The Armory weapon multiplier a team's units of this type would get. */
export function teamWeaponBonus(team: number, type: UnitType): number {
  return 1 + WEAPON_BONUS * upgradeOf(team, UNIT[type].cls === 'infantry' ? 'infWeapon' : 'vehWeapon');
}

const num = (x: number): string => (x < 10 ? x.toFixed(1).replace(/\.0$/, '') : String(Math.round(x)));

/** "Infantry 10 · Light 5 · Heavy 2 · Buildings 2.5 · Air 5", plus a splash note. */
export function dpsText(wt: WeaponType, bonus = 1, slow = 1): string {
  const parts = dpsOf(wt, bonus, slow).map((d) => `${d.label} ${num(d.dps)}`).join(' · ');
  return WEAPON[wt].splash > 0 ? `${parts} (plus splash)` : parts;
}
