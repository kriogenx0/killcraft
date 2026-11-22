// Weapons, damage by armor class, target acquisition and projectiles.
import { G, hooks, altOf, bldDef, isAir, unitDef, valid, type Ent } from './state.ts';
import { TS } from './const.ts';
import { clamp, lerp } from '../util/math.ts';
import { WEAPON, type ArmorClass, type WeaponType } from '../data/weapon.ts';
import { edgeDist } from './path.ts';
import { angleDiff, approach, turnToward } from './move.ts';
import { kill, lowPower } from './entity.ts';
import { dropSalvage } from './economy.ts';
import { burst, explosion, impact, part } from './fx.ts';
import { orderFlee, setOrder } from './order.ts';
import { cloakedFrom, hex, unveil, wardDamage } from './aether.ts';
import { armorFactor, weaponFactor } from './upgrade.ts';

const ALERT_COOLDOWN = 8;
const TURRET_TURN = 4.5;
const AIM_TOLERANCE = 0.2;
/** tracer and flash colours for weapons that don't fire plain lead */
const BEAM_COL: Partial<Record<WeaponType, string>> = { starbeam: '#c9a8ff', hexrifle: '#9dff8a' };

export const armorOf = (e: Ent): ArmorClass => (e.kind === 'unit' ? unitDef(e).armor : 'building');
export const weaponOf = (e: Ent): WeaponType | null => (e.kind === 'unit' ? unitDef(e).weapon : e.kind === 'bld' ? bldDef(e).weapon ?? null : null);

/** Can this weapon hurt this target at all? (Swords can't reach aircraft; flak only fires upward.) */
export const canHit = (wt: WeaponType | null, t: Ent): boolean => !!wt && t.kind !== 'source' && WEAPON[wt].vs[armorOf(t)] > 0;
/** Can this unit or turret attack this target? */
export const canAttack = (s: Ent, t: Ent): boolean => canHit(weaponOf(s), t);

export function dealDamage(t: Ent, dmg: number, src: Ent | null): void {
  if (t.dead || t.kind === 'source') return;
  t.hp -= Math.max(1, wardDamage(t, dmg * weaponFactor(src) * armorFactor(t)));
  t.flash = 0.1;
  if (t.kind === 'unit' && unitDef(t).cls === 'infantry') burst('blood', t.x, t.y - 6, 3, 30, 90);
  else if (isAir(t)) burst('spark', t.x, t.y, 3, 50, 140, null, altOf(t));
  else burst('spark', t.x + (Math.random() - 0.5) * (t.w || 0.6) * TS * 0.6, t.y - 6, 3, 50, 140);
  if (t.team >= 0) {
    if (t.team === G.viewer) G.lastAlert = { x: t.x, y: t.y };
    if (!G.demo && G.gameT - G.alertT[t.team] > ALERT_COOLDOWN) {
      G.alertT[t.team] = G.gameT;
      hooks.notify(t.team, t.kind === 'bld' ? 'Our base is under attack!' : 'Unit under attack!');
      hooks.alert(t.team, t.x, t.y);
    }
  }
  if (t.hp <= 0) { hooks.killedBy(t, src); kill(t); dropSalvage(t); return; }
  // idle units react: engaging ones fight back, passive ones run
  if (t.kind === 'unit' && !t.order && src && !src.dead && src.team !== t.team) {
    if (t.stance === 'passive') orderFlee(t, src);
    else if (t.stance === 'engage' && src.kind === 'unit' && canAttack(t, src)) setOrder(t, { t: 'attack', tgt: src.id, auto: true, ox: t.x, oy: t.y });
  }
}

function hit(wt: WeaponType, t: Ent, src: Ent | null, x: number, y: number): void {
  const w = WEAPON[wt], blast = w.proj === 'boulder' ? impact : explosion;
  if (w.proj === 'melee' && armorOf(t) !== 'none') burst('spark', (x + (src?.x ?? x)) / 2, (y + (src?.y ?? y)) / 2 - 8, 4, 60, 160); // steel on steel
  // a bullet striking: a small flash where it lands, so every hit reads at a glance
  if (w.proj === 'bullet') part('flash', x + (Math.random() - 0.5) * 6, y - 6, { max: 0.09, size: wt === 'starbeam' ? 16 : 6, z: altOf(t), col: BEAM_COL[wt] ?? '#fff2c0' });
  if (G.visualOnly) { if (w.splash) blast(x, y, w.splash); return; } // the server decides damage
  dealDamage(t, w.dmg * w.vs[armorOf(t)], src);
  if (w.slow) hex(t, w.slow);
  if (!w.splash) return;
  blast(x, y, w.splash);
  for (const e of G.ents) {
    if (e === t || e.dead || e.kind !== 'unit' || (src && e.team === src.team) || !canHit(wt, e)) continue;
    if (Math.hypot(e.x - x, e.y - y) < w.splash + unitDef(e).radius) dealDamage(e, w.dmg * 0.5 * w.vs[armorOf(e)], src);
  }
}

/** Fire a weapon from a unit or turret at a target. */
export function fire(s: Ent, wt: WeaponType, t: Ent): void {
  // buildings shoot from their top (a tall tower from its battlements), units from the hip
  // aircraft shoot from where they fly
  const air = isAir(s), z = s.kind === 'bld' ? Math.max(16, bldDef(s).top) : air ? altOf(s) : 8;
  const w = WEAPON[wt], mx = s.x + Math.cos(s.tface) * (s.kind === 'bld' ? 16 : 12), my = s.y - (s.kind === 'bld' ? z - 2 : air ? 0 : 6) + Math.sin(s.tface) * 10;
  s.atkT = 0.25;
  unveil(s);
  hooks.fired(s, wt, t);
  if (w.proj === 'melee') {
    // a bright arc sweeps across the target with each blow
    part('slash', t.x, t.y, { rot: Math.atan2(t.y - s.y, t.x - s.x), max: 0.22, size: wt === 'sword' ? 1 : 1.3, z: altOf(t), col: wt === 'wraithlance' ? '#c9a8ff' : null });
    hit(wt, t, s, t.x, t.y);
    return;
  }
  // gunpowder flashes; bows and catapults don't
  const bomb = wt === 'bomb';
  if (!bomb && (w.proj === 'bullet' || w.proj === 'shell' || w.proj === 'rocket')) {
    part('flash', mx, my, { max: 0.1, size: w.proj === 'bullet' ? 12 : 24, z: air ? z : 0, col: BEAM_COL[wt] ?? null });
    if (w.proj !== 'bullet') part('smoke', mx, my, { max: 0.9, size: 4, soft: true, vz: 12, z: air ? z : 0 });
  }
  if (w.proj === 'bullet') {
    part('tracer', mx, my, { ex: t.x + (Math.random() - 0.5) * 8, ey: t.y - 6 + (Math.random() - 0.5) * 8, ez: altOf(t), max: wt === 'starbeam' ? 0.25 : 0.13, z: air ? z : 0, col: BEAM_COL[wt] ?? null, size: wt === 'starbeam' ? 3 : 1 });
    hit(wt, t, s, t.x, t.y);
    return;
  }
  G.projs.push({ kind: w.proj, x: bomb ? s.x : mx, y: bomb ? s.y : air ? s.y + Math.sin(s.tface) * 10 : my + z, z, z0: z, tid: t.id, dmg: w.dmg, src: s.id, team: s.team, weapon: wt, sp: w.speed, d0: Math.hypot(t.x - s.x, t.y - s.y), tr: 0, a: 0, dead: false });
}

/** Best enemy within a radius (tiles): armed units first, then other units, then buildings. */
export function acquire(s: Ent, radiusTiles: number, unitsOnly = false): Ent | null {
  const r = radiusTiles * TS;
  let best: Ent | null = null, bs = 1e9;
  for (const e of G.ents) {
    if (e.dead || e.team === s.team || e.team < 0 || e.kind === 'source' || (unitsOnly && e.kind !== 'unit') || cloakedFrom(e, s.team)) continue;
    const dist = edgeDist(s, e);
    if (dist > r || !canAttack(s, e)) continue;
    const score = dist + (e.kind === 'bld' ? (bldDef(e).weapon ? 60 : 220) : weaponOf(e) ? 0 : 40);
    if (score < bs) { bs = score; best = e; }
  }
  return best;
}

/** Rotate the weapon toward a target; returns true once it is aimed. */
export function aim(s: Ent, t: Ent, dt: number, hasTurret: boolean): boolean {
  const want = Math.atan2(t.y - s.y, t.x - s.x);
  if (!hasTurret) { s.face = s.tface = want; return true; }
  s.tface = turnToward(s.tface, want, TURRET_TURN * dt);
  return angleDiff(s.tface, want) < AIM_TOLERANCE;
}

/** Approach and attack. Returns false if the target can't be reached or the unit is unarmed. */
export function combatStep(u: Ent, t: Ent, dt: number): boolean {
  const d = unitDef(u);
  if (!d.weapon || !canHit(d.weapon, t) || cloakedFrom(t, u.team)) return false;
  const w = WEAPON[d.weapon], r = approach(u, t, w.range * TS, dt);
  if (r === null) return false;
  if (r && aim(u, t, dt, d.turret) && u.cd <= 0) { u.cd = w.cd; fire(u, d.weapon, t); }
  return true;
}

/**
 * Shoot whatever is in range without stopping or turning aside: for skirmishing units, whether
 * they are moving or standing still. Turrets track freely; others turn to fire.
 */
export function fireOnTheMove(u: Ent, dt: number): void {
  const d = unitDef(u);
  if (!d.weapon) return;
  const w = WEAPON[d.weapon];
  let t = valid(u.shot);
  if (t && (edgeDist(u, t) > w.range * TS || cloakedFrom(t, u.team))) t = null;
  if (!t) {
    u.shot = null;
    u.scan -= dt;
    if (u.scan > 0) return;
    u.scan = 0.3;
    t = acquire(u, w.range);
    if (!t) return;
    u.shot = t.id;
  }
  if (aim(u, t, dt, d.turret) && u.cd <= 0) { u.cd = w.cd; fire(u, d.weapon, t); }
}

/** The nearest armed enemy unit within a radius (tiles), for passive units to run from. */
export function nearestThreat(u: Ent, radiusTiles: number): Ent | null {
  let best: Ent | null = null, bd = radiusTiles * TS;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || e.team === u.team || e.team < 0 || !unitDef(e).weapon) continue;
    const dist = Math.hypot(e.x - u.x, e.y - u.y);
    if (dist < bd) { bd = dist; best = e; }
  }
  return best;
}

/** Building weapons (turrets). */
export function updTurret(b: Ent, dt: number): void {
  const wt = bldDef(b).weapon;
  if (!wt || !b.done) return;
  const w = WEAPON[wt];
  b.cd -= dt;
  b.scan -= dt;
  let t = valid(b.order?.t === 'attack' ? b.order.tgt : null);
  if (t && (edgeDist(b, t) > w.range * TS || cloakedFrom(t, b.team))) t = null;
  if (!t && b.scan <= 0) {
    b.scan = 0.3;
    t = acquire(b, w.range, true);
    b.order = t ? { t: 'attack', tgt: t.id, auto: true, ox: b.x, oy: b.y } : null;
  }
  if (t && aim(b, t, dt, true) && b.cd <= 0) {
    b.cd = w.cd * (lowPower(b.team) ? 2.5 : 1);
    fire(b, wt, t);
  }
}

/** How high each kind of projectile arcs (fraction of the distance, and a cap in px). */
const ARC: Record<string, [number, number]> = { shell: [0, 0], rocket: [0.12, 30], bolt: [0.08, 18], boulder: [0.4, 150] };

/** Shells fly straight; rockets and bolts arc a little; boulders are lobbed high. */
export function updProjs(dt: number): void {
  for (const p of G.projs) {
    const t = valid(p.tid);
    if (!t) { p.dead = true; continue; }
    const dx = t.x - p.x, dy = t.y - 6 - p.y, dist = Math.hypot(dx, dy), st = p.sp * dt;
    p.a = Math.atan2(dy, dx);
    p.tr += st;
    const k = clamp(p.tr / Math.max(p.d0, 1), 0, 1);
    const [arc, cap] = ARC[p.kind] ?? [0, 0];
    p.z = lerp(p.z0, 4 + altOf(t), k) + Math.sin(k * Math.PI) * Math.min(cap, p.d0 * arc);
    if (p.kind === 'rocket' && Math.random() < 0.8) part('trail', p.x, p.y - p.z, { max: 0.6, size: 2.5, soft: true });
    if (dist <= st + 6) {
      p.dead = true;
      hit(p.weapon as WeaponType, t, valid(p.src), t.x, t.y);
    } else { p.x += (dx / dist) * st; p.y += (dy / dist) * st; }
  }
  G.projs = G.projs.filter((p) => !p.dead);
}
