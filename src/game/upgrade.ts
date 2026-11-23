// Armory upgrades: better weapons and armor for troops on foot, and for vehicles and aircraft.
import { G, type Ent } from './state.ts';
import { refitBonus } from './refit.ts';
import { ARMOR_BONUS, WEAPON_BONUS, type UpgradeTrack } from '../data/era.ts';
import { UNIT, type UnitType } from '../data/unit.ts';

export const noUpgrades = (): Record<UpgradeTrack, number> => ({ infWeapon: 0, infArmor: 0, vehWeapon: 0, vehArmor: 0 });

/** A team's level on one upgrade track. */
export const upgradeOf = (team: number, track: UpgradeTrack): number => G.upg[team]?.[track] ?? 0;

/** Which pair of tracks a unit uses: troops on foot, or machines. Buildings get no upgrades. */
const side = (e: Ent): 'inf' | 'veh' | null => (e.kind !== 'unit' ? null : UNIT[e.type as UnitType]?.cls === 'infantry' ? 'inf' : 'veh');

/** Damage multiplier for what this unit deals. */
export function weaponFactor(e: Ent | null): number {
  const s = e && side(e);
  // a building's guns hit a little harder with each age it's upgraded through (refit.ts)
  return s ? 1 + WEAPON_BONUS * upgradeOf(e.team, `${s}Weapon`) : refitBonus(e);
}

/** Damage multiplier for what this unit takes. */
export function armorFactor(e: Ent): number {
  const s = side(e);
  return s ? Math.max(0.1, 1 - ARMOR_BONUS * upgradeOf(e.team, `${s}Armor`)) : 1;
}
