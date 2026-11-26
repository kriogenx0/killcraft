// Mana, spells and elements. Spellcasters (UnitDef.magic) carry mana that refills on its own and
// cast their spells by themselves when a fight calls for it (game/spells.ts). Some weapons carry an
// element (WeaponDef.element) that leaves a lasting effect on whatever it hits, and the elements
// play off each other: water puts out fire and poison and washes off sludge, but leaves its target
// wet, and lightning hits wet things far harder.

export type Element = 'fire' | 'electric' | 'poison' | 'sludge' | 'water';
export type SpellType = 'bloodlust' | 'slow' | 'freeze' | 'douse' | 'shield';

export interface SpellDef {
  name: string;
  /** mana it takes */
  mana: number;
  /** tiles from the caster */
  range: number;
  /** seconds before the same caster casts it again */
  cd: number;
  /** seconds the effect lasts (0: at once) */
  dur: number;
  /** cast on its own side or on the enemy */
  on: 'ally' | 'enemy';
  /** flash colour where it lands */
  col: string;
  desc: string;
}

export const SPELL: Record<SpellType, SpellDef> = {
  bloodlust: { name: 'Bloodlust', mana: 30, range: 5, cd: 4, dur: 12, on: 'ally', col: '#ff4030', desc: 'a friendly unit in a fight attacks 40% faster and moves 25% faster' },
  slow: { name: 'Slow', mana: 35, range: 6, cd: 5, dur: 8, on: 'enemy', col: '#b890ff', desc: 'an enemy moves at half speed and attacks 25% slower' },
  freeze: { name: 'Freeze', mana: 90, range: 6, cd: 15, dur: 5, on: 'enemy', col: '#a8f0ff', desc: 'locks a strong enemy in ice: it can\'t move or fight' },
  shield: { name: 'Shield', mana: 40, range: 6, cd: 5, dur: 12, on: 'ally', col: '#ffd860', desc: 'wraps a friend under fire in a golden bubble that soaks up the next 90 damage (not burning or poison)' },
  douse: { name: 'Douse', mana: 10, range: 5, cd: 1.5, dur: 0, on: 'ally', col: '#60b8ff', desc: 'puts out a burning or poisoned friend' },
};

/** Mana a caster regains each second. */
export const MANA_REGEN = 1.5;
/** A new caster starts with this share of its mana. */
export const MANA_START = 0.5;

/** Bloodlust: attacks come this much faster, and the unit moves this much faster. */
export const LUST_ATTACK = 1.4;
export const LUST_SPEED = 1.25;
/** Slow (the spell): reloads take this much longer, on top of moving at half speed. */
export const SLOW_ATTACK = 0.75;
/** A unit worth freezing: one that costs at least this much ore, or has this much health. */
export const FREEZE_WORTH = 400;
export const FREEZE_HP = 300;

/** Shield: how much damage the bubble soaks up before it bursts. */
export const SHIELD_HP = 90;

/** Burning: damage per second, and how long it lasts. Sludge-coated targets burn twice as hot and half again as long. */
export const BURN_DPS = 4;
export const BURN_TIME = 4;
/** Poison: damage per second and duration. It only harms living things (not vehicles, machines or cyborgs) and goes through armor. */
export const POISON_DPS = 8;
export const POISON_TIME = 6;
/** Sludge: how long a coat lasts, and the speed it leaves its target. */
export const SLUDGE_TIME = 6;
export const SLUDGE_SPEED = 0.65;
/** Sludge is oily: fire on a sludged target does this much more damage, and burns hotter (above). */
export const SLUDGE_FIRE = 1.25;
/** Sludge gums up weapons too: reloads take this much longer. */
export const SLUDGE_RELOAD = 0.75;
/** Water hits anything that fights with fire this much harder (Battle Mages, Cerberus, the Phoenix...). */
export const WATER_VS_FIRE = 1.8;
/** Water: how long a target stays wet, and how much harder lightning hits it. */
export const WET_TIME = 8;
export const WET_SHOCK = 1.6;
/** Damage over time is dealt in ticks this many seconds apart. */
export const DOT_TICK = 0.5;

export const ELEMENT_NAME: Record<Element, string> = { fire: 'Fire', electric: 'Lightning', poison: 'Poison', sludge: 'Sludge', water: 'Water' };
/** What each element does, for the unit card. */
export const ELEMENT_DESC: Record<Element, string> = {
  fire: 'sets its target burning',
  electric: `hits wet targets ${Math.round((WET_SHOCK - 1) * 100)}% harder`,
  poison: 'poisons living things, straight through armor',
  sludge: 'coats its target in sludge: it moves and reloads slower, and burns hotter',
  water: `hits fire-wielders ${Math.round((WATER_VS_FIRE - 1) * 100)}% harder; puts out fire and poison and washes off sludge, but leaves its target wet (lightning hits it harder)`,
};
