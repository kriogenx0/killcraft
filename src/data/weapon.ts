/** 'air' is anything flying: only weapons with an `air` multiplier above zero can hit it */
export type ArmorClass = 'none' | 'light' | 'heavy' | 'building' | 'air';
export type WeaponType = 'rifle' | 'mg' | 'rocket' | 'cannon' | 'heavycannon' | 'turretcannon' | 'sword' | 'lance' | 'crossbow' | 'catapult' | 'ballista'
  | 'bomb' | 'planegun' | 'missile' | 'flak'
  | 'wraithlance' | 'hexrifle' | 'starbeam' | 'lmg' | 'dronegun' | 'pillboxmg' | 'atmissile' | 'bertha'
  | 'fireball' | 'lightning' | 'meteor' | 'minigun' | 'railgun'
  | 'centaurbow' | 'axe' | 'hurl' | 'hydrabite' | 'hellfire' | 'talons' | 'hoof' | 'griffclaw' | 'pick';
/** melee and bullets hit at once; the rest fly as projectiles */
export type ProjectileKind = 'melee' | 'bullet' | 'shell' | 'rocket' | 'bolt' | 'boulder' | 'orb';

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
  /** damage multiplier against each armor class (0 = can't hit it at all) */
  vs: Record<ArmorClass, number>;
  /** seconds a hit unit is slowed (see SLOW_FACTOR in data/aether.ts) */
  slow?: number;
  /** melee: strikes this many foes in reach at once (the Hydra's heads) */
  heads?: number;
  /** bullets: the hit leaps on to this many more foes, each within CHAIN_REACH of the last, at CHAIN_FALLOFF of the damage */
  chain?: number;
}

export const WEAPON: Record<WeaponType, WeaponDef> = {
  rifle: { dmg: 10, range: 3.5, cd: 0.9, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1, light: 0.5, heavy: 0.2, building: 0.25, air: 0.5 } },
  lmg: { dmg: 7, range: 4, cd: 0.3, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1.2, light: 0.55, heavy: 0.15, building: 0.25, air: 1 } },
  dronegun: { dmg: 7, range: 3.5, cd: 0.4, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1, light: 0.7, heavy: 0.35, building: 0.35, air: 0.9 } },
  mg: { dmg: 9, range: 4, cd: 0.45, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1.3, light: 0.6, heavy: 0.25, building: 0.3, air: 0.7 } },
  rocket: { dmg: 42, range: 5, cd: 2.2, proj: 'rocket', speed: 200, splash: 22, vs: { none: 0.3, light: 1, heavy: 1, building: 0.7, air: 1.3 } },
  cannon: { dmg: 32, range: 4.5, cd: 1.6, proj: 'shell', speed: 650, splash: 14, vs: { none: 0.45, light: 0.9, heavy: 1, building: 0.9, air: 0 } },
  heavycannon: { dmg: 46, range: 4.75, cd: 1.9, proj: 'shell', speed: 650, splash: 18, vs: { none: 0.5, light: 0.9, heavy: 1, building: 1, air: 0 } },
  turretcannon: { dmg: 30, range: 5.5, cd: 1.5, proj: 'shell', speed: 700, splash: 12, vs: { none: 0.5, light: 1, heavy: 1, building: 0.5, air: 0 } },
  pillboxmg: { dmg: 9, range: 5.5, cd: 0.3, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1.2, light: 0.7, heavy: 0.15, building: 0.2, air: 0.35 } },
  atmissile: { dmg: 80, range: 7, cd: 2.8, proj: 'rocket', speed: 240, splash: 18, vs: { none: 0.2, light: 0.9, heavy: 1.25, building: 0.5, air: 0 } },
  bertha: { dmg: 220, range: 22, minRange: 5, cd: 10, proj: 'shell', speed: 150, splash: 40, ground: true, vs: { none: 0.7, light: 0.8, heavy: 0.8, building: 1, air: 0 } },
  // medieval arms
  // a Worker's pick: a last resort, not a weapon of war
  pick: { dmg: 6, range: 0.6, cd: 1.3, proj: 'melee', speed: 0, splash: 0, vs: { none: 1, light: 0.5, heavy: 0.15, building: 0.3, air: 0 } },
  sword: { dmg: 18, range: 0.6, cd: 1.0, proj: 'melee', speed: 0, splash: 0, vs: { none: 1, light: 0.7, heavy: 0.35, building: 0.5, air: 0 } },
  lance: { dmg: 30, range: 0.8, cd: 1.3, proj: 'melee', speed: 0, splash: 0, vs: { none: 1.1, light: 1, heavy: 0.45, building: 0.4, air: 0 } },
  crossbow: { dmg: 20, range: 4.5, cd: 1.6, proj: 'bolt', speed: 520, splash: 0, vs: { none: 1, light: 1.4, heavy: 0.35, building: 0.3, air: 1.2 } },
  ballista: { dmg: 20, range: 5.5, cd: 1.5, proj: 'bolt', speed: 560, splash: 0, vs: { none: 1, light: 1, heavy: 0.35, building: 0.3, air: 0.8 } },
  catapult: { dmg: 60, range: 7.5, cd: 3.5, proj: 'boulder', speed: 230, splash: 22, vs: { none: 0.9, light: 0.8, heavy: 0.6, building: 2.2, air: 0 } },
  // air war: bombs dropped from above, aircraft guns and missiles, and flak to bring them down
  bomb: { dmg: 32, range: 0.7, cd: 3.5, proj: 'shell', speed: 260, splash: 18, vs: { none: 0.8, light: 0.8, heavy: 0.6, building: 1.2, air: 0 } },
  planegun: { dmg: 8, range: 4, cd: 0.3, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1, light: 0.6, heavy: 0.25, building: 0.3, air: 1.2 } },
  missile: { dmg: 42, range: 5.5, cd: 1.8, proj: 'rocket', speed: 240, splash: 20, vs: { none: 0.25, light: 1, heavy: 1.1, building: 0.6, air: 0.7 } },
  flak: { dmg: 34, range: 7.5, cd: 1.1, proj: 'shell', speed: 760, splash: 0, vs: { none: 0, light: 0, heavy: 0, building: 0, air: 1.5 } },
  // Aether arms (hidden units)
  wraithlance: { dmg: 30, range: 0.8, cd: 1.3, proj: 'melee', speed: 0, splash: 0, vs: { none: 1, light: 0.95, heavy: 0.85, building: 0.4, air: 0 } },
  hexrifle: { dmg: 12, range: 4, cd: 0.9, proj: 'bullet', speed: 0, splash: 0, slow: 1.5, vs: { none: 1, light: 0.5, heavy: 0.2, building: 0.25, air: 0.5 } },
  starbeam: { dmg: 50, range: 5, cd: 2.2, proj: 'bullet', speed: 0, splash: 0, vs: { none: 0.35, light: 0.8, heavy: 0.95, building: 2.2, air: 0 } },
  // spells: fireballs and meteors fly as glowing orbs; lightning strikes at once and leaps on
  fireball: { dmg: 28, range: 4.5, cd: 1.8, proj: 'orb', speed: 300, splash: 24, vs: { none: 1.1, light: 1, heavy: 0.35, building: 0.6, air: 0.7 } },
  lightning: { dmg: 34, range: 5, cd: 2.0, proj: 'bullet', speed: 0, splash: 0, chain: 2, vs: { none: 1, light: 1, heavy: 0.8, building: 0.4, air: 1.2 } },
  meteor: { dmg: 130, range: 9, minRange: 3, cd: 5, proj: 'orb', speed: 280, splash: 30, ground: true, vs: { none: 0.8, light: 0.9, heavy: 0.8, building: 1.3, air: 0 } },
  // cyborg arms
  minigun: { dmg: 8, range: 4.5, cd: 0.2, proj: 'bullet', speed: 0, splash: 0, vs: { none: 1.2, light: 0.75, heavy: 0.3, building: 0.35, air: 0.5 } },
  railgun: { dmg: 95, range: 6, cd: 3.2, proj: 'shell', speed: 900, splash: 14, vs: { none: 0.4, light: 1, heavy: 1.1, building: 1.1, air: 0 } },
  // creatures of Greek myth
  centaurbow: { dmg: 17, range: 4.5, cd: 1.1, proj: 'bolt', speed: 540, splash: 0, vs: { none: 1.1, light: 0.8, heavy: 0.3, building: 0.3, air: 1.3 } },
  axe: { dmg: 34, range: 0.8, cd: 1.5, proj: 'melee', speed: 0, splash: 0, vs: { none: 1, light: 0.9, heavy: 0.6, building: 1.3, air: 0 } },
  hurl: { dmg: 45, range: 6, cd: 3.2, proj: 'boulder', speed: 260, splash: 16, vs: { none: 0.6, light: 0.9, heavy: 1.1, building: 1.4, air: 0 } },
  hydrabite: { dmg: 13, range: 1.1, cd: 0.9, proj: 'melee', speed: 0, splash: 0, heads: 3, vs: { none: 1, light: 0.85, heavy: 0.5, building: 0.5, air: 0.5 } },
  hellfire: { dmg: 26, range: 1.8, cd: 1.4, proj: 'shell', speed: 300, splash: 22, vs: { none: 1.2, light: 0.8, heavy: 0.4, building: 0.6, air: 0 } },
  talons: { dmg: 14, range: 0.8, cd: 0.8, proj: 'melee', speed: 0, splash: 0, vs: { none: 1.1, light: 0.8, heavy: 0.3, building: 0.25, air: 0.6 } },
  hoof: { dmg: 24, range: 0.8, cd: 1.0, proj: 'melee', speed: 0, splash: 0, vs: { none: 1, light: 0.9, heavy: 0.45, building: 0.4, air: 1 } },
  griffclaw: { dmg: 32, range: 0.8, cd: 1.2, proj: 'melee', speed: 0, splash: 0, vs: { none: 0.8, light: 1, heavy: 1, building: 0.5, air: 1.2 } },
};

/** Chain lightning leaps to foes within this many px of the last one struck... */
export const CHAIN_REACH = 64;
/** ...each leap at this fraction of the damage of the one before. */
export const CHAIN_FALLOFF = 0.7;
