// Mana and spells, and the lasting effects of elemental weapons. Tuning lives in data/spells.ts.
//
// Spellcasters regain mana on their own and cast by themselves: Bloodlust on a friend in a fight,
// Shield on a friend taking hits,
// Slow and Freeze on an enemy, Douse on a friend that's burning or poisoned. Elements stick to what
// they hit: fire burns, poison eats at living things, sludge slows and makes fire worse, water puts
// out fire and poison and washes off sludge but leaves its target wet, and lightning punishes wet.
import { G, allied, demonAfter, fair, altOf, isAir, isVehicle, unitDef, valid, type Ent } from './state.ts';
import { TS } from './const.ts';
import { burst, part } from './fx.ts';
import { cloakedFrom, hex } from './aether.ts';
import { kneeling } from './creatures.ts';
import { dealDamage } from './combat.ts';
import { UNIT } from '../data/unit.ts';
import { WEAPON } from '../data/weapon.ts';
import {
  BURN_DPS, BURN_REACH, BURN_REST, BURN_SPREAD, BURN_TIME, DOT_TICK, WRECK_BURN_AT, FREEZE_HP, FREEZE_WORTH, LUST_ATTACK, LUST_SPEED, MANA_REGEN, MANA_START, POISON_DPS, POISON_TIME,
  SHIELD_HP, SLOW_ATTACK, SLUDGE_FIRE, SLUDGE_RELOAD, WATER_VS_FIRE, SLUDGE_SPEED, SLUDGE_TIME, SPELL, WET_SHOCK, WET_TIME, type Element, type SpellType,
} from '../data/spells.ts';

const on = (t: number | undefined): boolean => (t ?? 0) > G.gameT;

export const burning = (e: Ent): boolean => on(e.burnT);
export const poisoned = (e: Ent): boolean => on(e.poisonT);
export const wet = (e: Ent): boolean => on(e.wetT);
export const sludged = (e: Ent): boolean => on(e.sludgeT);
export const frozen = (e: Ent): boolean => on(e.frozenT);
export const lusting = (e: Ent): boolean => on(e.lustT);
export const cursed = (e: Ent): boolean => on(e.curseT);
export const shielded = (e: Ent): boolean => on(e.shieldT) && (e.shieldHp ?? 0) > 0;

/**
 * A Shield soaks up a hit before it reaches the unit: returns the damage left over. The bubble bursts
 * when it has taken all it can. Burning and poison (dot) slip past it.
 */
export function soakShield(t: Ent, dmg: number): number {
  if (!shielded(t)) return dmg;
  const soak = Math.min(t.shieldHp ?? 0, dmg);
  t.shieldHp = (t.shieldHp ?? 0) - soak;
  const z = altOf(t);
  if (t.shieldHp <= 0) {
    t.shieldT = 0;
    burst('spark', t.x, t.y - 8, 14, 60, 160, SPELL.shield.col, z); // it bursts
  } else part('flash', t.x + (Math.random() - 0.5) * 8, t.y - 8, { max: 0.15, size: 12, z: z + 6, col: SPELL.shield.col });
  return dmg - soak;
}

/** Poison only harms living things: soldiers, riders and creatures, not vehicles, machines or cyborgs. */
export const living = (e: Ent): boolean => e.kind === 'unit' && (unitDef(e).cls === 'infantry' || !!unitDef(e).beast);

/** Most mana a unit can hold (0 for anything that isn't a caster). */
export const maxMana = (e: Ent): number => (e.kind === 'unit' ? UNIT[e.type as keyof typeof UNIT]?.mana ?? 0 : 0);

/** A new caster starts part full. */
export function initMana(e: Ent): void {
  const m = maxMana(e);
  if (m) e.mana = m * MANA_START;
}

/** Speed multiplier from spells and sludge (frozen units don't move at all). */
export function spellSpeed(u: Ent): number {
  if (frozen(u)) return 0;
  return (lusting(u) ? LUST_SPEED : 1) * (sludged(u) ? SLUDGE_SPEED : 1);
}

/** How fast a unit's weapon reloads: Bloodlust speeds it up, the Slow spell slows it down. */
export const reloadRate = (u: Ent): number => (lusting(u) ? LUST_ATTACK : 1) * (cursed(u) ? SLOW_ATTACK : 1) * (sludged(u) ? SLUDGE_RELOAD : 1);

/** Extra damage an element does to a target in its current state: lightning on wet, fire on sludge. */
export function elementMult(el: Element | undefined, t: Ent): number {
  if (el === 'electric' && wet(t)) return WET_SHOCK;
  if (el === 'fire' && sludged(t)) return SLUDGE_FIRE;
  if (el === 'water' && t.kind === 'unit') { const w = unitDef(t).weapon; if (w && WEAPON[w].element === 'fire') return WATER_VS_FIRE; }
  return 1;
}

/** Leave an element's mark on a unit it struck. Buildings take the damage but keep no effect. */
export function applyElement(t: Ent, el: Element | undefined, src: Ent | null): void {
  if (!el || t.dead || t.kind !== 'unit' || G.visualOnly) return;
  const now = G.gameT;
  switch (el) {
    case 'fire':
      // fire steams off a wet target rather than catching
      if (wet(t)) { t.wetT = 0; steam(t); return; }
      if (!ignitable(t)) return; // already alight (a burn isn't stoked longer) or freshly scorched
      ignite(t, BURN_TIME * (sludged(t) ? 1.5 : 1), src?.id);
      break;
    case 'poison':
      if (!living(t)) return;
      t.poisonT = Math.max(t.poisonT ?? 0, now + POISON_TIME);
      t.poisonBy = src?.id;
      break;
    case 'sludge':
      t.sludgeT = Math.max(t.sludgeT ?? 0, now + SLUDGE_TIME);
      if (burning(t)) t.burnT = Math.max(t.burnT ?? 0, (t.burnAt ?? now) + BURN_TIME * 1.5); // the coat catches: this burn runs half again as long
      break;
    case 'water':
      if (burning(t)) steam(t);
      t.burnT = t.poisonT = t.sludgeT = 0;
      t.wetT = now + WET_TIME;
      break;
    case 'electric':
      break; // its bite is in elementMult
  }
}

/** Can fire take hold of this unit now? Not while it's burning, nor for BURN_REST after a burn dies. */
const ignitable = (t: Ent): boolean => !burning(t) && !(t.burnT && G.gameT < t.burnT + BURN_REST);

/** Set a unit alight for `secs`, counted against whoever lit it. */
function ignite(t: Ent, secs: number, by: number | undefined): void {
  t.burnAt = G.gameT;
  t.burnT = G.gameT + secs;
  t.burnBy = by;
}

/** A ground vehicle so badly hurt it's on fire. */
export const wrecked = (e: Ent): boolean => isVehicle(e) && !e.dead && e.hp < e.maxhp * WRECK_BURN_AT;

/**
 * Who a fire or poison counts against: whoever started it, unless that's a friend (fire spreads
 * through packed troops friend or foe). Then nobody: no friendly kill, no bounty.
 */
const byFoe = (u: Ent, id: number | undefined): Ent | null => {
  const by = valid(id ?? null);
  return by && by.team !== u.team && allied(by.team, u.team) ? null : by;
};

/** Can flames jump to this unit? Soldiers and creatures on foot, not already burning, wet or frozen. */
const catches = (e: Ent): boolean => living(e) && !isAir(e) && !e.dead && ignitable(e) && !wet(e) && !frozen(e) && !e.wild?.down;

/**
 * A soldier or creature freshly alight can set someone it's packed against burning too (friend or
 * foe). Caught fire burns half as long and is past its spreading half from the start, so it stops there.
 */
function spread(u: Ent): void {
  if (!living(u) || isAir(u) || (u.burnT ?? 0) - G.gameT <= BURN_TIME / 2) return;
  const reach = BURN_REACH * TS + unitDef(u).radius;
  for (const e of G.ents) {
    if (e === u || e.kind !== 'unit' || !catches(e)) continue;
    if (Math.hypot(e.x - u.x, e.y - u.y) > reach + unitDef(e).radius * 0.5) continue;
    if (Math.random() >= BURN_SPREAD) continue;
    ignite(e, BURN_TIME / 2, u.burnBy);
  }
}

function steam(t: Ent): void {
  burst('smoke', t.x, t.y - 4, 4, 20, 50, null, altOf(t));
}

/**
 * Burning and poison eat away at a unit, a tick at a time; spells and coats wear off on their own.
 * Call every step for every unit.
 */
export function tickStatus(u: Ent, dt: number): void {
  // a wrecked machine catches fire and slowly burns down, until it's repaired or it's soaked
  if (wrecked(u) && !wet(u) && !frozen(u)) {
    if (!burning(u)) u.burnAt = G.gameT;
    u.burnT = Math.max(u.burnT ?? 0, G.gameT + DOT_TICK * 2);
  }
  const b = burning(u), p = poisoned(u);
  if (!b && !p) { u.dotT = 0; return; }
  u.dotT = (u.dotT ?? 0) + dt;
  if (u.dotT < DOT_TICK) return;
  u.dotT -= DOT_TICK;
  if (G.visualOnly) return;
  if (b) {
    spread(u);
    dealDamage(u, BURN_DPS * DOT_TICK * (sludged(u) ? 2 : 1), byFoe(u, u.burnBy), true);
  }
  if (p && !u.dead) dealDamage(u, POISON_DPS * DOT_TICK, byFoe(u, u.poisonBy), true);
}

// ---- casting ----

/** How often (s) a caster looks around for something to cast on. */
const CAST_SCAN = 0.4;

const ready = (u: Ent, s: SpellType): boolean => (u.spellCd?.[s] ?? 0) <= G.gameT && (u.mana ?? 0) >= SPELL[s].mana;

/** Is this unit in a fight right now? (Shooting, swinging, or chasing something down.) */
const fighting = (e: Ent): boolean => e.atkT > 0 || e.order?.t === 'attack' || !!e.shot || !!(e.order?.t === 'move' && e.order.sub);

/** Was this unit hit in the last few seconds? */
const underFire = (e: Ent): boolean => (e.hitT ?? -99) > G.gameT - 3;

/** Good spells go on our own troops first, then on a teammate's. */
const OWN_FIRST = 100000;

const priceOf = (e: Ent): number => unitDef(e).cost + (unitDef(e).oil ?? 0) * 2 + (unitDef(e).aether ?? 0) * 5;

/** The best target for a spell within its range, or null. */
function spellTarget(u: Ent, s: SpellType): Ent | null {
  const d = SPELL[s], r = d.range * TS;
  let best: Ent | null = null, bs = -1;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || Math.hypot(e.x - u.x, e.y - u.y) > r) continue;
    if (d.on === 'ally') {
      if (!allied(e.team, u.team) || e.wild || e.team < 0) continue;
      let score: number;
      if (s === 'douse') {
        if (!burning(e) && !poisoned(e)) continue;
        score = 1 - e.hp / e.maxhp;
      } else if (s === 'shield') {
        // a friend taking hits, not already in a bubble: the dearest and the most hurt first
        if (shielded(e) || frozen(e) || !underFire(e)) continue;
        score = priceOf(e) + (1 - e.hp / e.maxhp) * 600;
      } else {
        // Bloodlust: an armed friend that's fighting and not already raging
        if (lusting(e) || frozen(e) || !unitDef(e).weapon || !fighting(e)) continue;
        score = priceOf(e);
      }
      if (e.team === u.team) score += OWN_FIRST;
      if (score > bs) { bs = score; best = e; }
    } else {
      if (allied(e.team, u.team) || !fair(e) || kneeling(e) || cloakedFrom(e, u.team) || frozen(e)) continue;
      if (!unitDef(e).weapon && !e.wild && !e.demon) continue; // don't waste spells on workers and harvesters
      if (e.demon && !demonAfter(e, u.team) && e.foe !== u.id && u.foe !== e.id) continue; // let demons that aren't after us be
      if (s === 'freeze' && priceOf(e) < FREEZE_WORTH && e.maxhp < FREEZE_HP) continue;
      if (s === 'slow' && on(e.slowT)) continue;
      const score = priceOf(e) + e.maxhp;
      if (score > bs) { bs = score; best = e; }
    }
  }
  return best;
}

/** Cast a spell on a target: pay the mana, show it, and put the effect on. */
export function cast(u: Ent, s: SpellType, t: Ent): void {
  const d = SPELL[s];
  u.mana = Math.max(0, (u.mana ?? 0) - d.mana);
  (u.spellCd ??= {})[s] = G.gameT + d.cd;
  u.atkT = Math.max(u.atkT, 0.25); // the staff goes up
  if (u !== t && !u.moving) u.face = u.tface = Math.atan2(t.y - u.y, t.x - u.x);
  const z0 = isAir(u) ? altOf(u) : 14, z1 = altOf(t);
  part('tracer', u.x, u.y - 8, { ex: t.x, ey: t.y - 6, ez: z1, max: 0.3, z: z0, col: d.col, size: 2 });
  part('flash', t.x, t.y - 6, { max: 0.35, size: 20, z: z1, col: d.col });
  burst('spark', t.x, t.y - 6, 8, 40, 110, d.col, z1);
  const now = G.gameT;
  switch (s) {
    case 'bloodlust': t.lustT = now + d.dur; break;
    case 'slow': hex(t, d.dur); t.curseT = now + d.dur; break;
    case 'freeze':
      t.frozenT = now + d.dur;
      t.burnT = 0; // ice puts the fire out
      t.moving = false;
      t.path = null;
      break;
    case 'shield': t.shieldT = now + d.dur; t.shieldHp = SHIELD_HP; break;
    case 'douse': t.burnT = t.poisonT = 0; t.wetT = now + WET_TIME / 2; break;
  }
}

/**
 * A caster regains mana, and now and then looks for something worth a spell. One that knows Freeze
 * keeps enough mana for it, spending only what's above that on its other spells.
 */
export function updCaster(u: Ent, dt: number): void {
  const d = unitDef(u), spells = d.spells;
  if (!spells?.length || !d.mana) return;
  u.mana = Math.min(d.mana, (u.mana ?? 0) + MANA_REGEN * dt);
  if (G.visualOnly) return;
  // a cheap clock: look every CAST_SCAN seconds, staggered by id
  if (Math.floor((G.gameT + u.id * 0.13) / CAST_SCAN) === Math.floor((G.gameT - dt + u.id * 0.13) / CAST_SCAN)) return;
  const reserve = spells.includes('freeze') ? SPELL.freeze.mana : 0;
  for (const s of spells) {
    if (!ready(u, s)) continue;
    if (s !== 'freeze' && s !== 'douse' && (u.mana ?? 0) - SPELL[s].mana < reserve) continue;
    if (SPELL[s].on === 'enemy' && u.stance === 'passive') continue;
    const t = spellTarget(u, s);
    if (t) { cast(u, s, t); return; }
  }
}
