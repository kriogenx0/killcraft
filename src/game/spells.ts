// Mana and spells, and the lasting effects of elemental weapons. Tuning lives in data/spells.ts.
//
// Spellcasters regain mana on their own and cast by themselves: Bloodlust on a friend in a fight,
// Slow and Freeze on an enemy, Douse on a friend that's burning or poisoned. Elements stick to what
// they hit: fire burns, poison eats at living things, sludge slows and makes fire worse, water puts
// out fire and poison and washes off sludge but leaves its target wet, and lightning punishes wet.
import { G, allied, fair, altOf, isAir, unitDef, valid, type Ent } from './state.ts';
import { TS } from './const.ts';
import { burst, part } from './fx.ts';
import { cloakedFrom, hex } from './aether.ts';
import { kneeling } from './creatures.ts';
import { dealDamage } from './combat.ts';
import { UNIT } from '../data/unit.ts';
import { WEAPON } from '../data/weapon.ts';
import {
  BURN_DPS, BURN_TIME, DOT_TICK, FREEZE_HP, FREEZE_WORTH, LUST_ATTACK, LUST_SPEED, MANA_REGEN, MANA_START, POISON_DPS, POISON_TIME,
  SLOW_ATTACK, SLUDGE_FIRE, SLUDGE_RELOAD, WATER_VS_FIRE, SLUDGE_SPEED, SLUDGE_TIME, SPELL, WET_SHOCK, WET_TIME, type Element, type SpellType,
} from '../data/spells.ts';

const on = (t: number | undefined): boolean => (t ?? 0) > G.gameT;

export const burning = (e: Ent): boolean => on(e.burnT);
export const poisoned = (e: Ent): boolean => on(e.poisonT);
export const wet = (e: Ent): boolean => on(e.wetT);
export const sludged = (e: Ent): boolean => on(e.sludgeT);
export const frozen = (e: Ent): boolean => on(e.frozenT);
export const lusting = (e: Ent): boolean => on(e.lustT);
export const cursed = (e: Ent): boolean => on(e.curseT);

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
      t.burnT = Math.max(t.burnT ?? 0, now + BURN_TIME * (sludged(t) ? 1.5 : 1));
      t.burnBy = src?.id;
      break;
    case 'poison':
      if (!living(t)) return;
      t.poisonT = Math.max(t.poisonT ?? 0, now + POISON_TIME);
      t.poisonBy = src?.id;
      break;
    case 'sludge':
      t.sludgeT = Math.max(t.sludgeT ?? 0, now + SLUDGE_TIME);
      if (burning(t)) t.burnT = Math.max(t.burnT ?? 0, now + BURN_TIME * 1.5); // the coat catches
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

function steam(t: Ent): void {
  burst('smoke', t.x, t.y - 4, 4, 20, 50, null, altOf(t));
}

/**
 * Burning and poison eat away at a unit, a tick at a time; spells and coats wear off on their own.
 * Call every step for every unit.
 */
export function tickStatus(u: Ent, dt: number): void {
  const b = burning(u), p = poisoned(u);
  if (!b && !p) { u.dotT = 0; return; }
  u.dotT = (u.dotT ?? 0) + dt;
  if (u.dotT < DOT_TICK) return;
  u.dotT -= DOT_TICK;
  if (G.visualOnly) return;
  if (b) dealDamage(u, BURN_DPS * DOT_TICK * (sludged(u) ? 2 : 1), valid(u.burnBy ?? null), true);
  if (p && !u.dead) dealDamage(u, POISON_DPS * DOT_TICK, valid(u.poisonBy ?? null), true);
}

// ---- casting ----

/** How often (s) a caster looks around for something to cast on. */
const CAST_SCAN = 0.4;

const ready = (u: Ent, s: SpellType): boolean => (u.spellCd?.[s] ?? 0) <= G.gameT && (u.mana ?? 0) >= SPELL[s].mana;

/** Is this unit in a fight right now? (Shooting, swinging, or chasing something down.) */
const fighting = (e: Ent): boolean => e.atkT > 0 || e.order?.t === 'attack' || !!e.shot || !!(e.order?.t === 'move' && e.order.sub);

const priceOf = (e: Ent): number => unitDef(e).cost + (unitDef(e).oil ?? 0) * 2 + (unitDef(e).aether ?? 0) * 5;

/** The best target for a spell within its range, or null. */
function spellTarget(u: Ent, s: SpellType): Ent | null {
  const d = SPELL[s], r = d.range * TS;
  let best: Ent | null = null, bs = -1;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || Math.hypot(e.x - u.x, e.y - u.y) > r) continue;
    if (d.on === 'ally') {
      if (e.team !== u.team || e.wild) continue;
      let score: number;
      if (s === 'douse') {
        if (!burning(e) && !poisoned(e)) continue;
        score = 1 - e.hp / e.maxhp;
      } else {
        // Bloodlust: an armed friend that's fighting and not already raging
        if (lusting(e) || frozen(e) || !unitDef(e).weapon || !fighting(e)) continue;
        score = priceOf(e);
      }
      if (score > bs) { bs = score; best = e; }
    } else {
      if (allied(e.team, u.team) || !fair(e) || kneeling(e) || cloakedFrom(e, u.team) || frozen(e)) continue;
      if (!unitDef(e).weapon && !e.wild && !e.demon) continue;
      if (e.demon && e.demon.raid < 0 && e.foe !== u.id && u.foe !== e.id) continue; // let demons lurking by the gate be // don't waste spells on workers and harvesters
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
