// The Sky Carrier: a huge flying hangar that launches its own wing of Hornets at foes near it, calls
// them back aboard when the fight is over, and very slowly rebuilds the ones it loses.
import { G, hooks, unitDef, valid, type Ent } from './state.ts';
import { TS } from './const.ts';
import { CARRIER_LAUNCH_EVERY, CARRIER_REACH, CARRIER_REBUILD } from '../data/unit.ts';
import { addUnit, kill } from './entity.ts';
import { acquire, combatStep, isFoe } from './combat.ts';
import { setOrder } from './order.ts';
import { steer, stepOf } from './move.ts';
import { burst } from './fx.ts';

/** A Carrier's Hornets in the air. */
export const wingOf = (c: Ent): Ent[] => G.ents.filter((e) => !e.dead && e.wing === c.id);

/** Hornets aboard a Carrier, ready to take off. */
export const aboard = (c: Ent): number => c.hangar ?? unitDef(c).hangar ?? 0;

/** Hornets the Carrier has lost and not yet rebuilt. */
export const missing = (c: Ent): number => Math.max(0, (unitDef(c).hangar ?? 0) - aboard(c) - wingOf(c).length);

const within = (c: Ent, t: Ent | null): Ent | null => (t && isFoe(c, t) && Math.hypot(t.x - c.x, t.y - c.y) <= CARRIER_REACH * TS ? t : null);

/** What a Carrier's wing should go after: what it's told to attack or shooting at, or the nearest foe within reach. */
function carrierFoe(c: Ent): Ent | null {
  return within(c, valid(c.order?.t === 'attack' ? c.order.tgt : null)) ?? within(c, valid(c.shot)) ?? within(c, valid(c.foe)) ?? within(c, valid(c.spot));
}

/**
 * A Carrier's turn: look about for foes, launch a Hornet at a time while there are any, and rebuild
 * lost ones aboard. Call every tick for each living Carrier.
 */
export function updCarrier(c: Ent, dt: number): void {
  const cap = unitDef(c).hangar ?? 0;
  if (!cap) return;
  // rebuild a lost Hornet, one at a time and slowly
  if (missing(c) > 0) {
    c.rebuildT = (c.rebuildT ?? 0) + dt;
    if (c.rebuildT >= CARRIER_REBUILD) { c.rebuildT = 0; c.hangar = aboard(c) + 1; }
  } else c.rebuildT = 0;
  if (G.gameT < (c.launchT ?? 0)) return;
  c.launchT = G.gameT + CARRIER_LAUNCH_EVERY;
  // a lookout well past its own guns' reach (`spot` remembers what it saw between looks)
  if (!within(c, valid(c.spot))) c.spot = acquire(c, CARRIER_REACH, false, false, 0)?.id ?? null;
  if (aboard(c) <= 0 || !carrierFoe(c)) return;
  const a = c.face + Math.PI + (Math.random() - 0.5) * 0.6;
  const h = addUnit('hornet', c.team, c.x + Math.cos(a) * 10, c.y + Math.sin(a) * 10);
  h.wing = c.id;
  h.face = h.tface = a;
  h.stance = 'engage';
  c.hangar = aboard(c) - 1;
  burst('spark', h.x, h.y, 4, 20, 60, null, 60);
}

/** A Hornet lands back aboard its Carrier: gone from the field, one more in the hangar. */
function land(h: Ent, c: Ent): void {
  h.dead = true;
  hooks.killed(h);
  c.hangar = Math.min(unitDef(c).hangar ?? 0, aboard(c) + 1);
}

/**
 * A Hornet's turn: fight what its Carrier fights (or the nearest foe within reach of it), and with
 * nothing left to fight fly home and land aboard. With its Carrier gone, it goes down with it.
 */
export function updHornet(h: Ent, dt: number): void {
  const c = valid(h.wing);
  if (!c || c.team !== h.team) { kill(h); return; }
  let t = carrierFoe(c) ?? within(c, valid(h.order?.t === 'attack' ? h.order.tgt : null));
  if (!t) {
    h.scan -= dt;
    if (h.scan <= 0) { h.scan = 0.4; t = within(c, acquire(h, 4, false)); }
  }
  if (t) {
    if (h.order?.t !== 'attack' || h.order.tgt !== t.id) setOrder(h, { t: 'attack', tgt: t.id, auto: true, ox: c.x, oy: c.y });
    if (combatStep(h, t, dt)) return;
  }
  if (h.order) setOrder(h, null);
  // nothing to fight: home to the Carrier's tail and land
  if (Math.hypot(c.x - h.x, c.y - h.y) < unitDef(c).radius + unitDef(h).radius + 8) { land(h, c); return; }
  steer(h, c.x, c.y, stepOf(h, dt), dt, true);
}
