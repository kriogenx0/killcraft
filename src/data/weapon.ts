export type ArmorClass = 'none' | 'light' | 'heavy' | 'building';
export type WeaponType = 'rifle' | 'mg' | 'rocket' | 'cannon' | 'heavycannon' | 'turretcannon' | 'sword' | 'lance' | 'crossbow' | 'catapult' | 'ballista'
  | 'pillboxmg' | 'atmissile' | 'bertha';
/** melee and bullets hit at once; the rest fly as projectiles */
export type ProjectileKind = 'melee' | 'bullet' | 'shell' | 'rocket' | 'bolt' | 'boulder';

export interface WeaponDef {
  dmg: number;
  /** tiles */
  range: number;
  /** seconds between shots */
  cd: number;
  proj: ProjectileKind;
  /** px per second (melee and bullets hit instantly) */
  speed: number;
  /** splash radius in px (0 = single target) */
  splash: number;
  /** can't fire at anything closer than this (tiles) */
  minRange?: number;
  /**
   * Lobbed at the spot the target stood when fired, not homing: whatever is there when it lands takes
   * the hit (buildings and units alike), so moving targets can dodge.
   */
  ground?: boolean;
  /** damage multiplier against each armor class */
  vs: Record<ArmorClass, number>;
}

export const WEAPON: Record<WeaponType, WeaponDef> = {
  rifle: { dmg: 9, range: 3.5, cd: 0.9, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1, light: 0.5, heavy: 0.2, building: 0.25 } },
  mg: { dmg: 8, range: 4, cd: 0.45, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1.1, light: 0.6, heavy: 0.25, building: 0.3 } },
  rocket: { dmg: 42, range: 5, cd: 2.2, proj: 'rocket', speed: 320, splash: 10, vs: { none: 0.3, light: 1, heavy: 1, building: 0.7 } },
  cannon: { dmg: 32, range: 4.5, cd: 1.6, proj: 'shell', speed: 650, splash: 14, vs: { none: 0.45, light: 0.9, heavy: 1, building: 0.9 } },
  heavycannon: { dmg: 46, range: 4.75, cd: 1.9, proj: 'shell', speed: 650, splash: 18, vs: { none: 0.5, light: 0.9, heavy: 1, building: 1 } },
  turretcannon: { dmg: 40, range: 6, cd: 1.5, proj: 'shell', speed: 700, splash: 12, vs: { none: 0.5, light: 1, heavy: 1, building: 0.5 } },
  pillboxmg: { dmg: 10, range: 5.5, cd: 0.3, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1.2, light: 0.7, heavy: 0.15, building: 0.2 } },
  atmissile: { dmg: 80, range: 7, cd: 2.8, proj: 'rocket', speed: 360, splash: 8, vs: { none: 0.2, light: 0.9, heavy: 1.25, building: 0.5 } },
  bertha: { dmg: 220, range: 22, minRange: 5, cd: 10, proj: 'shell', speed: 150, splash: 40, ground: true, vs: { none: 0.7, light: 0.8, heavy: 0.8, building: 1 } },
  // medieval arms
  sword: { dmg: 18, range: 0.6, cd: 1.0, proj: 'melee', speed: 0, splash: 0, vs: { none: 1, light: 0.7, heavy: 0.35, building: 0.5 } },
  lance: { dmg: 30, range: 0.8, cd: 1.3, proj: 'melee', speed: 0, splash: 0, vs: { none: 1.1, light: 0.8, heavy: 0.45, building: 0.4 } },
  crossbow: { dmg: 16, range: 4.5, cd: 1.6, proj: 'bolt', speed: 520, splash: 0, vs: { none: 1, light: 0.9, heavy: 0.35, building: 0.3 } },
  ballista: { dmg: 24, range: 5.5, cd: 1.5, proj: 'bolt', speed: 560, splash: 0, vs: { none: 1, light: 1, heavy: 0.35, building: 0.3 } },
  catapult: { dmg: 60, range: 7.5, cd: 4, proj: 'boulder', speed: 230, splash: 22, vs: { none: 0.9, light: 0.8, heavy: 0.6, building: 1.4 } },
};
