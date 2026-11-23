// Weapons, damage by armor class, target acquisition and projectiles.
import { G, hooks, altOf, bldDef, isAir, tileOf, unitDef, valid, type Ent, type Projectile } from './state.ts';
import { MW, TS } from './const.ts';
import { clamp, lerp } from '../util/math.ts';
import { WEAPON, type ArmorClass, type WeaponType } from '../data/weapon.ts';
import { isWall } from '../data/building.ts';
import { edgeDist } from './path.ts';
import { angleDiff, approach, turnToward } from './move.ts';
import { kill, lowPower } from './entity.ts';
import { dropSalvage } from './economy.ts';
import { payBounty } from './bounty.ts';
import { burst, explosion, impact, part } from './fx.ts';
import { orderFlee, setOrder } from './order.ts';
import { cloakedFrom, hex, unveil, wardDamage } from './aether.ts';
import { kneeling, subdue } from './creatures.ts';
import { GUARD_RADIUS as WILD_REACH } from '../data/creatures.ts';
import { armorFactor, weaponFactor } from './upgrade.ts';

const ALERT_COOLDOWN = 8;
const TURRET_TURN = 4.5;
const AIM_TOLERANCE = 0.2;
/** seconds from the start of a swing or thrust until the blow lands (and the damage with it) */
export const MELEE_LAND = 0.15;
/** how far a target may step away mid-swing and still be struck (px) */
const MELEE_SLACK = 12;
/** tracer and flash colours for weapons that don't fire plain lead */
const BEAM_COL: Partial<Record<WeaponType, string>> = { starbeam: '#c9a8ff', hexrifle: '#9dff8a' };

export const armorOf = (e: Ent): ArmorClass => (e.kind === 'unit' ? unitDef(e).armor : 'building');
export const weaponOf = (e: Ent): WeaponType | null => (e.kind === 'unit' ? unitDef(e).weapon : e.kind === 'bld' ? bldDef(e).weapon ?? null : null);

/** Can this weapon hurt this target at all? (Swords can't reach aircraft; flak only fires upward.) */
export const canHit = (wt: WeaponType | null, t: Ent): boolean => !!wt && t.kind !== 'source' && WEAPON[wt].vs[armorOf(t)] > 0;
/** Can this unit or turret attack this target? */
export const canAttack = (s: Ent, t: Ent): boolean => canHit(weaponOf(s), t);

export function dealDamage(t: Ent, dmg: number, src: Ent | null): void {
  if (t.dead || t.kind === 'source' || kneeling(t)) return;
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
  if (t.wild && subdue(t)) return; // wild creatures kneel instead of dying
  if (t.hp <= 0) { hooks.killedBy(t, src); payBounty(t, src); kill(t); dropSalvage(t); return; }
  if (t.kind !== 'unit' || !src || src.dead || src.team === t.team || (src.team < 0 && !src.wild)) return;
  // remember who started it: a unit keeps fighting its first attacker rather than flitting between them
  if (!attacker(t) || t.foe === src.id) { t.foe = src.id; t.foeT = G.gameT; }
  // idle units react: engaging ones fight back, passive ones run
  if (!t.order) {
    if (t.stance === 'passive') orderFlee(t, src);
    else if (t.stance === 'engage' && canAttack(t, src)) setOrder(t, { t: 'attack', tgt: src.id, auto: true, ox: t.x, oy: t.y });
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
    // the swing starts now; the blow and its damage land as the blade comes down (see updProjs)
    // many heads bite many foes at once
    for (const e of [t, ...(w.heads ? otherFoesInReach(s, t, wt, w.heads - 1) : [])])
      G.projs.push({ kind: 'melee', x: s.x, y: s.y, z: 0, z0: 0, tid: e.id, dmg: w.dmg, src: s.id, team: s.team, weapon: wt, sp: 0, d0: 0, tr: 0, a: 0, dead: false });
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
  const ground = w.ground ? { gx: t.x, gy: t.y } : {};
  G.projs.push({ ...ground, kind: w.proj, x: bomb ? s.x : mx, y: bomb ? s.y : air ? s.y + Math.sin(s.tface) * 10 : my + z, z, z0: z, tid: t.id, dmg: w.dmg, src: s.id, team: s.team, weapon: wt, sp: w.speed, d0: Math.hypot(t.x - s.x, t.y - s.y), tr: 0, a: 0, dead: false });
}

/** Up to `n` foes besides `t` within a melee weapon's reach of `s`. */
function otherFoesInReach(s: Ent, t: Ent, wt: WeaponType, n: number): Ent[] {
  const r = WEAPON[wt].range * TS, out: Ent[] = [];
  for (const e of G.ents) {
    if (out.length >= n) break;
    if (e === t || e.dead || e.team === s.team || (e.team < 0 && !e.wild) || kneeling(e) || !canHit(wt, e)) continue;
    if (edgeDist(s, e) <= r) out.push(e);
  }
  return out;
}

/** How long (s) a unit remembers who hit it. */
const FOE_MEMORY = 4;

/** The enemy that is attacking this unit, if it hit lately and can be fought back. */
export function attacker(u: Ent): Ent | null {
  const f = valid(u.foe);
  if (!f || G.gameT - u.foeT > FOE_MEMORY || !canAttack(u, f) || cloakedFrom(f, u.team) || kneeling(f)) return null;
  return f;
}

/**
 * A better target than the current one, or null to keep it. Whoever is attacking the unit comes
 * first; and nobody keeps hacking at something that can't fight back (a plain building, a
 * harvester) while an armed enemy is within reach.
 */
export function betterTarget(u: Ent, cur: Ent | null, radiusTiles: number): Ent | null {
  const a = attacker(u);
  if (a && a !== cur && edgeDist(u, a) <= radiusTiles * TS) return a;
  if (cur && !weaponOf(cur)) return acquire(u, radiusTiles, false, true);
  return null;
}

/**
 * Best enemy within a radius (tiles): armed units first, then other units, then buildings. Wild
 * creatures (data/creatures.ts) are fair game too, after real enemies.
 */
export function acquire(s: Ent, radiusTiles: number, unitsOnly = false, armedOnly = false, minTiles = 0): Ent | null {
  const r = radiusTiles * TS, rmin = minTiles * TS;
  // a gun that outranges its own sight only fires at what its side can see
  const spotted = s.kind === 'bld' && radiusTiles > bldDef(s).sight ? G.sight[s.team] : null;
  let best: Ent | null = null, bs = 1e9;
  for (const e of G.ents) {
    if (e.dead || e.team === s.team || (e.team < 0 && !e.wild) || kneeling(e) || e.kind === 'source' || (unitsOnly && e.kind !== 'unit') || (armedOnly && !weaponOf(e)) || cloakedFrom(e, s.team)) continue;
    const dist = edgeDist(s, e);
    if (dist > r || dist < rmin || !canAttack(s, e)) continue;
    if (e.kind === 'bld' && isWall(e.type)) continue; // walls are only broken when they're in the way (breach.ts)
    if (e.wild && dist > WILD_REACH * TS) continue; // only a creature that's close, not one minding its lair over there
    if (spotted && spotted[tileOf(e.y) * MW + tileOf(e.x)] !== 2) continue;
    const score = dist + (e.kind === 'bld' ? (bldDef(e).weapon ? 60 : 220) : e.wild ? 250 : weaponOf(e) ? 0 : 40);
    if (score < bs) { bs = score; best = e; }
  }
  return best;
}

/** Rotate the weapon toward a target; returns true once it is aimed. */
export function aim(s: Ent, t: Ent, dt: number, hasTurret: boolean): boolean {
  const want = Math.atan2(t.y - s.y, t.x - s.x);
  if (!hasTurret) {
    // on the move, shoot from the hip rather than steer off course; standing, turn the body to face
    s.tface = want;
    if (s.moving || weaponOf(s) === 'bomb') return true; // bombs just drop
    s.face = turnToward(s.face, want, unitDef(s).turn * dt);
    return angleDiff(s.face, want) < AIM_TOLERANCE;
  }
  s.tface = turnToward(s.tface, want, TURRET_TURN * dt);
  return angleDiff(s.tface, want) < AIM_TOLERANCE;
}

/** Approach and attack. Returns false if the target can't be reached or the unit is unarmed. */
export function combatStep(u: Ent, t: Ent, dt: number): boolean {
  const d = unitDef(u);
  if (!d.weapon || !canHit(d.weapon, t) || cloakedFrom(t, u.team) || kneeling(t)) return false;
  // walled off from the target: break through the wall in the way first
  const via = valid(u.breach);
  if (!via) u.breach = null;
  const at = via && via !== t ? via : t;
  // a blade reaches a building's wall from a little further off (a body pressed to a footprint's edge can't get closer)
  const w = WEAPON[d.weapon], r = approach(u, at, w.range * TS + (w.proj === 'melee' && at.w ? MELEE_SLACK / 2 : 0), dt);
  if (r === null) return false;
  if (r && aim(u, at, dt, d.turret) && u.cd <= 0) { u.cd = w.cd; fire(u, d.weapon, at); }
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
  u.scan -= dt;
  if (!t) u.shot = null;
  if (u.scan <= 0) {
    u.scan = 0.3;
    // shoot back at an attacker in range first, and prefer armed enemies over buildings
    const b = betterTarget(u, t, w.range) ?? (t ? null : acquire(u, w.range));
    if (b) { t = b; u.shot = b.id; }
  }
  if (!t) return;
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
  if (t && (edgeDist(b, t) > w.range * TS || edgeDist(b, t) < (w.minRange ?? 0) * TS || cloakedFrom(t, b.team))) t = null;
  if (!t && b.scan <= 0) {
    b.scan = 0.3;
    t = acquire(b, w.range, !w.ground, false, w.minRange);
    b.order = t ? { t: 'attack', tgt: t.id, auto: true, ox: b.x, oy: b.y } : null;
  }
  if (t && aim(b, t, dt, true) && b.cd <= 0) {
    b.cd = w.cd * (lowPower(b.team) ? 2.5 : 1);
    fire(b, wt, t);
  }
}

/** A sword or lance blow: once the swing comes down, a bright arc sweeps across the target and it takes the hit. */
function landBlow(p: Projectile, t: Ent, dt: number): void {
  p.tr += dt;
  if (p.tr < MELEE_LAND) return;
  p.dead = true;
  const s = valid(p.src), wt = p.weapon as WeaponType;
  if (!s || edgeDist(s, t) > WEAPON[wt].range * TS + MELEE_SLACK) return; // the attacker fell, or the target got clear
  part('slash', t.x, t.y, { rot: Math.atan2(t.y - s.y, t.x - s.x), max: 0.22, size: wt === 'sword' ? 1 : 1.3, z: altOf(t), col: wt === 'wraithlance' ? '#c9a8ff' : null });
  hit(wt, t, s, t.x, t.y);
}

/** How high each kind of projectile arcs (fraction of the distance, and a cap in px). */
const ARC: Record<string, [number, number]> = { shell: [0, 0], rocket: [0.12, 30], bolt: [0.08, 18], boulder: [0.4, 150], ground: [0.35, 320] };

/** A lobbed shell lands: everything near the spot takes damage, falling off toward the edge of the blast. */
function shellLands(wt: WeaponType, x: number, y: number, src: Ent | null, team: number): void {
  const w = WEAPON[wt];
  explosion(x, y, w.splash);
  burst('debris', x, y, 10, 60, 180);
  if (G.visualOnly) return; // the server decides damage
  for (const e of G.ents) {
    if (e.dead || e.kind === 'source' || e.team === team) continue;
    const d = e.w ? edgeDist({ x, y }, e) : Math.max(0, Math.hypot(e.x - x, e.y - y) - unitDef(e).radius);
    if (d > w.splash) continue;
    dealDamage(e, w.dmg * w.vs[armorOf(e)] * (1 - 0.6 * (d / w.splash)), src);
  }
}

/** Shells fly straight; rockets and bolts arc a little; boulders are lobbed high. */
export function updProjs(dt: number): void {
  for (const p of G.projs) {
    const t = valid(p.tid);
    if (p.gx != null && p.gy != null) {
      // lobbed at a spot: flies on even if the target dies or moves
      const dx = p.gx - p.x, dy = p.gy - p.y, dist = Math.hypot(dx, dy), st = p.sp * dt;
      p.a = Math.atan2(dy, dx);
      p.tr += st;
      const k = clamp(p.tr / Math.max(p.d0, 1), 0, 1), [arc, cap] = ARC.ground;
      p.z = lerp(p.z0, 4, k) + Math.sin(k * Math.PI) * Math.min(cap, p.d0 * arc);
      if (Math.random() < 0.5) part('trail', p.x, p.y - p.z, { max: 0.5, size: 2, soft: true });
      if (dist <= st + 2) { p.dead = true; shellLands(p.weapon as WeaponType, p.gx, p.gy, valid(p.src), p.team); }
      else { p.x += (dx / dist) * st; p.y += (dy / dist) * st; }
      continue;
    }
    if (!t) { p.dead = true; continue; }
    if (p.kind === 'melee') { landBlow(p, t, dt); continue; }
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
