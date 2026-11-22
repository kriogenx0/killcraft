// Weapons, damage by armor class, target acquisition and projectiles.
import { G, hooks, bldDef, unitDef, valid, type Ent } from './state.ts';
import { TS } from './const.ts';
import { clamp, lerp } from '../util/math.ts';
import { WEAPON, type ArmorClass, type WeaponType } from '../data/weapon.ts';
import { edgeDist } from './path.ts';
import { angleDiff, approach, turnToward } from './move.ts';
import { kill, lowPower } from './entity.ts';
import { burst, explosion, impact, part } from './fx.ts';
import { setOrder } from './order.ts';
import { cloakedFrom, hex, unveil, wardDamage } from './aether.ts';

const ALERT_COOLDOWN = 8;
const TURRET_TURN = 4.5;
const AIM_TOLERANCE = 0.2;

export const armorOf = (e: Ent): ArmorClass => (e.kind === 'unit' ? unitDef(e).armor : 'building');
export const weaponOf = (e: Ent): WeaponType | null => (e.kind === 'unit' ? unitDef(e).weapon : e.kind === 'bld' ? bldDef(e).weapon ?? null : null);

export function dealDamage(t: Ent, dmg: number, src: Ent | null): void {
  if (t.dead || t.kind === 'source') return;
  t.hp -= Math.max(1, wardDamage(t, dmg));
  t.flash = 0.1;
  if (t.kind === 'unit' && unitDef(t).cls === 'infantry') burst('blood', t.x, t.y - 6, 3, 30, 90);
  else burst('spark', t.x + (Math.random() - 0.5) * (t.w || 0.6) * TS * 0.6, t.y - 6, 3, 50, 140);
  if (t.team >= 0) {
    if (t.team === G.viewer) G.lastAlert = { x: t.x, y: t.y };
    if (!G.demo && G.gameT - G.alertT[t.team] > ALERT_COOLDOWN) {
      G.alertT[t.team] = G.gameT;
      hooks.notify(t.team, t.kind === 'bld' ? 'Our base is under attack!' : 'Unit under attack!');
      hooks.alert(t.team, t.x, t.y);
    }
  }
  if (t.hp <= 0) { kill(t); return; }
  // idle armed units fight back
  if (t.kind === 'unit' && !t.order && unitDef(t).weapon && src && !src.dead && src.team !== t.team && src.kind === 'unit')
    setOrder(t, { t: 'attack', tgt: src.id, auto: true, ox: t.x, oy: t.y });
}

function hit(wt: WeaponType, t: Ent, src: Ent | null, x: number, y: number): void {
  const w = WEAPON[wt], blast = w.proj === 'boulder' ? impact : explosion;
  if (w.proj === 'melee' && armorOf(t) !== 'none') burst('spark', (x + (src?.x ?? x)) / 2, (y + (src?.y ?? y)) / 2 - 8, 4, 60, 160); // steel on steel
  if (G.visualOnly) { if (w.splash) blast(x, y, w.splash); return; } // the server decides damage
  dealDamage(t, w.dmg * w.vs[armorOf(t)], src);
  if (w.slow) hex(t, w.slow);
  if (!w.splash) return;
  blast(x, y, w.splash);
  for (const e of G.ents) {
    if (e === t || e.dead || e.kind !== 'unit' || (src && e.team === src.team)) continue;
    if (Math.hypot(e.x - x, e.y - y) < w.splash + unitDef(e).radius) dealDamage(e, w.dmg * 0.5 * w.vs[armorOf(e)], src);
  }
}

/** Fire a weapon from a unit or turret at a target. */
export function fire(s: Ent, wt: WeaponType, t: Ent): void {
  // buildings shoot from their top (a tall tower from its battlements), units from the hip
  const z = s.kind === 'bld' ? Math.max(16, bldDef(s).top) : 8;
  const w = WEAPON[wt], mx = s.x + Math.cos(s.tface) * (s.kind === 'bld' ? 16 : 12), my = s.y - (s.kind === 'bld' ? z - 2 : 6) + Math.sin(s.tface) * 10;
  s.atkT = 0.25;
  unveil(s);
  hooks.fired(s, wt, t);
  if (w.proj === 'melee') { hit(wt, t, s, t.x, t.y); return; }
  // gunpowder flashes; bows and catapults don't
  if (w.proj === 'bullet' || w.proj === 'shell' || w.proj === 'rocket') part('flash', mx, my, { max: 0.08, size: w.proj === 'bullet' ? 7 : 14 });
  if (w.proj === 'bullet') {
    part('tracer', mx, my, { ex: t.x + (Math.random() - 0.5) * 8, ey: t.y - 6 + (Math.random() - 0.5) * 8, max: 0.07 });
    hit(wt, t, s, t.x, t.y);
    return;
  }
  G.projs.push({ kind: w.proj, x: mx, y: my + z, z, z0: z, tid: t.id, dmg: w.dmg, src: s.id, team: s.team, weapon: wt, sp: w.speed, d0: Math.hypot(t.x - s.x, t.y - s.y), tr: 0, a: 0, dead: false });
}

/** Best enemy within a radius (tiles): armed units first, then other units, then buildings. */
export function acquire(s: Ent, radiusTiles: number, unitsOnly = false): Ent | null {
  const r = radiusTiles * TS;
  let best: Ent | null = null, bs = 1e9;
  for (const e of G.ents) {
    if (e.dead || e.team === s.team || e.team < 0 || e.kind === 'source' || (unitsOnly && e.kind !== 'unit') || cloakedFrom(e, s.team)) continue;
    const dist = edgeDist(s, e);
    if (dist > r) continue;
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
  if (!d.weapon || cloakedFrom(t, u.team)) return false;
  const w = WEAPON[d.weapon], r = approach(u, t, w.range * TS, dt);
  if (r === null) return false;
  if (r && aim(u, t, dt, d.turret) && u.cd <= 0) { u.cd = w.cd; fire(u, d.weapon, t); }
  return true;
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
    p.z = lerp(p.z0, 4, k) + Math.sin(k * Math.PI) * Math.min(cap, p.d0 * arc);
    if (p.kind === 'rocket' && Math.random() < 0.8) part('trail', p.x, p.y - p.z, { max: 0.6, size: 2.5, soft: true });
    if (dist <= st + 6) {
      p.dead = true;
      hit(p.weapon as WeaponType, t, valid(p.src), t.x, t.y);
    } else { p.x += (dx / dist) * st; p.y += (dy / dist) * st; }
  }
  G.projs = G.projs.filter((p) => !p.dead);
}
