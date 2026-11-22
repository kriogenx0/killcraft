// Per-tick unit behaviour: idle scanning, moving, fighting and harvesting.
import { G, haulOf, hooks, isAir, isHarvester, isOrganic, tileOf, unitDef, valid, type Ent, type HarvestOrder, type HealOrder } from './state.ts';
import { MW, NEAR, TS } from './const.ts';
import { HARVEST_RATE, UNLOAD_RATE } from '../data/ore.ts';
import { nearestFree, pathFor } from './path.ts';
import { approach, canStep, followPath, turnToward } from './move.ts';
import { acquire, combatStep, fireOnTheMove, nearestThreat } from './combat.ts';
import { orderFlee, orderHarvest, setOrder } from './order.ts';
import { nearestOre, takeOre } from './ore.ts';
import { nearestOwn } from './query.ts';
import { bankAt } from './haul.ts';
import { millRate, oilLeft } from './economy.ts';
import { part } from './fx.ts';
import { HEAL_RATE, HOSPITAL_HEAL } from '../data/era.ts';
import { MEDIC_HEAL, MEDIC_RANGE } from '../data/unit.ts';
import { hasBuilding } from './entity.ts';

const AUTO_CHASE = 9 * TS;
const ORE_SEARCH = 24;
/** How far (px) a stuck unit edges aside to get past a unit in its way. */
const SIDESTEP = 8;

/**
 * Is this ore tile someone else's? Always: another harvester is scooping it, or one that claimed it
 * first (lower id) is heading there. When choosing a new tile (`choosing`), also skip any tile with
 * a harvester scooping right next to it, so they spread across the field.
 */
function oreTaken(i: number, u: Ent, choosing: boolean): boolean {
  const cx = ((i % MW) + 0.5) * TS, cy = (((i / MW) | 0) + 0.5) * TS;
  for (const h of G.ents) {
    if (h === u || h.dead || !isHarvester(h) || h.order?.t !== 'harvest') continue;
    const o = h.order;
    if (o.ty * MW + o.tx === i && (o.st === 'gather' || (o.st === 'go' && (choosing || h.id < u.id)))) return true;
    if (choosing && o.st === 'gather' && Math.abs(h.x - cx) < TS * 1.1 && Math.abs(h.y - cy) < TS * 1.1) return true;
  }
  return false;
}

/** The nearest ore no other harvester has claimed; shares a tile only if every field is taken. */
function pickOre(u: Ent, tx: number, ty: number, r: number): [number, number] | null {
  const bad = cantReach.get(u);
  return nearestOre(tx, ty, r, 1, (i) => !!bad?.has(i) || oreTaken(i, u, true)) ?? nearestOre(tx, ty, r, 1, bad && ((i) => bad.has(i)));
}

/** Ore tiles each harvester found it couldn't walk up to, so it doesn't keep trying them. Forgotten once it scoops. */
const cantReach = new WeakMap<Ent, Set<number>>();
function giveUpOn(u: Ent, i: number): void {
  let bad = cantReach.get(u);
  if (!bad || bad.size > 64) cantReach.set(u, (bad = new Set()));
  bad.add(i);
}

/** A harvester's scoop reaches the next tile over. */
const SCOOP_REACH = TS * 1.05;

function updHarvester(u: Ent, o: HarvestOrder, dt: number): void {
  if (o.wait > 0) { o.wait -= dt; return; }
  // carrying something else: take it home first
  if ((o.st === 'go' || o.st === 'gather') && u.carry > 0 && (u.cargo ?? 'ore') !== (o.res ?? 'ore')) { o.st = 'ret'; u.path = null; }
  if (o.res && (o.st === 'go' || o.st === 'gather')) { updHauler(u, o, dt); return; }
  if (o.st === 'go') {
    const i = o.ty * MW + o.tx;
    if (G.ore[i] <= 0 || oreTaken(i, u, false)) {
      const t = pickOre(u, o.tx, o.ty, ORE_SEARCH) ?? pickOre(u, tileOf(u.x), tileOf(u.y), MW);
      if (!t) { o.st = u.carry > 0 ? 'ret' : 'go'; o.wait = 2; return; }
      [o.tx, o.ty] = t;
      u.path = null;
    }
    // close enough to scoop: harvesters don't need to sit on the tile
    const d = Math.hypot(u.x - (o.tx + 0.5) * TS, u.y - (o.ty + 0.5) * TS);
    if (d < SCOOP_REACH) { o.st = 'gather'; u.path = null; return; }
    if (!u.path) {
      u.goal = [o.tx, o.ty];
      u.path = pathFor(u, o.tx, o.ty);
      // a path that stops short of the tile (walled in by trees or rock): pick other ore
      const end = u.path[u.path.length - 1] ?? [tileOf(u.x), tileOf(u.y)];
      if (Math.max(Math.abs(end[0] - o.tx), Math.abs(end[1] - o.ty)) > 1) {
        giveUpOn(u, o.ty * MW + o.tx);
        u.path = null;
        o.wait = 0.3;
        const t = pickOre(u, tileOf(u.x), tileOf(u.y), ORE_SEARCH);
        if (t) [o.tx, o.ty] = t;
        return;
      }
    }
    if (followPath(u, dt)) {
      u.path = null;
      // the path ends beside the tile (even across a corner it can't cut): scoop from there
      if (d < TS * 1.5) { o.st = 'gather'; return; }
      // couldn't get there: try another tile nearby, not the same one again
      giveUpOn(u, o.ty * MW + o.tx);
      o.wait = 0.5;
      const t = pickOre(u, tileOf(u.x), tileOf(u.y), 3);
      if (t) [o.tx, o.ty] = t;
    }
    return;
  }
  if (o.st === 'gather') {
    cantReach.delete(u);
    u.carry += takeOre(o.tx, o.ty, Math.min((unitDef(u).scoop ?? HARVEST_RATE) * dt, haulOf(u) - u.carry));
    u.cargo = 'ore';
    u.atkT = 0.2;
    u.face = turnToward(u.face, u.face + 1, 0.4 * dt); // slow sweep while scooping
    if (Math.random() < dt * 6) part('ore', u.x + Math.cos(u.face) * 14, u.y + Math.sin(u.face) * 14, { vz: 40, vx: (Math.random() - 0.5) * 30, max: 0.5, size: 2, col: '#f0c040' });
    if (u.carry >= haulOf(u) - 0.5) { o.st = 'ret'; return; }
    if (G.ore[o.ty * MW + o.tx] <= 0) {
      const t = pickOre(u, o.tx, o.ty, 4);
      if (t) { [o.tx, o.ty] = t; o.st = 'go'; } else o.st = u.carry > haulOf(u) * 0.3 ? 'ret' : 'go';
    }
    return;
  }
  // ore goes to a Refinery; wood and oil to a Refinery or the Construction Yard
  const ref = bankAt(u, (u.cargo ?? 'ore') === 'ore' ? ['refinery'] : ['refinery', 'yard']);
  if (!ref) { o.wait = 2; return; } // nowhere to unload: wait
  if (o.st === 'ret') {
    const r = approach(u, ref, NEAR, dt);
    if (r === null) { o.wait = 1; return; }
    if (r) o.st = 'unload';
    return;
  }
  // unloading
  const a = Math.min(UNLOAD_RATE * dt, u.carry), cargo = u.cargo ?? 'ore';
  u.carry -= a;
  if (cargo === 'wood') G.wood[u.team] += a;
  else if (cargo === 'oil') G.oil[u.team] += a;
  else { G.credits[u.team] += a; hooks.income(u.team, a); }
  if (u.carry <= 0.01) { u.carry = 0; o.st = 'go'; }
}

/** Haul wood or oil: walk to a mill or derrick, fill up from its store, then head home. */
function updHauler(u: Ent, o: HarvestOrder, dt: number): void {
  const type = o.res === 'wood' ? 'mill' : 'derrick';
  let src = valid(o.src);
  if (!src || src.team !== u.team || src.type !== type || !src.done) {
    src = nearestOwn(u, type);
    if (!src) { o.st = u.carry > 0 ? 'ret' : 'go'; o.wait = 2; return; }
    o.src = src.id;
    [o.tx, o.ty] = [src.tx, src.ty];
    u.path = null;
  }
  if (o.st === 'go') {
    const r = approach(u, src, NEAR, dt);
    if (r === null) { o.wait = 1; return; }
    if (r) o.st = 'gather';
    return;
  }
  const take = Math.min((unitDef(u).scoop ?? HARVEST_RATE) * dt, haulOf(u) - u.carry, src.carry);
  if (take > 0) {
    src.carry -= take;
    u.carry += take;
    u.cargo = o.res;
    u.atkT = 0.2;
  }
  // full, or the store is empty: take what we have home; with nothing, wait for more
  const refills = src.type === 'mill' ? millRate(src) > 0 : oilLeft(src) > 0;
  if (u.carry >= haulOf(u) - 0.5 || (src.carry <= 0.01 && u.carry > 0 && (u.carry >= Math.min(haulOf(u), 60) || !refills))) o.st = 'ret';
  else if (src.carry <= 0.01) o.wait = 1;
}

function unstick(u: Ent, dt: number): void {
  if (isAir(u)) return; // nothing blocks aircraft
  if (G.blk[tileOf(u.y) * MW + tileOf(u.x)]) {
    const f = nearestFree(tileOf(u.x), tileOf(u.y));
    if (f) { u.x = (f[0] + 0.5) * TS; u.y = (f[1] + 0.5) * TS; u.path = null; }
  }
  if (!u.path || !u.path.length) return;
  u.stkT -= dt;
  if (u.stkT > 0) return;
  u.stkT = 0.6;
  if (Math.hypot(u.x - u.px, u.y - u.py) < 4) {
    // close enough to the goal in a crowd counts as arrived; otherwise look for another way
    const last = u.path[u.path.length - 1], rem = Math.hypot((last[0] + 0.5) * TS - u.x, (last[1] + 0.5) * TS - u.y);
    if (rem < 2.5 * TS) u.path.length = 0;
    else {
      // jammed nose to nose with someone: edge over to the right, like traffic, so both can pass
      const sx = u.x - Math.sin(u.face) * SIDESTEP, sy = u.y + Math.cos(u.face) * SIDESTEP;
      if (canStep(u.x, u.y, sx, sy)) { u.x = sx; u.y = sy; }
      if (u.goal) u.path = pathFor(u, u.goal[0], u.goal[1]);
    }
  }
  u.px = u.x; u.py = u.y;
}

/** Fraction of max health a team's organic units regain each second: research and a Hospital speed it up. */
export function healRate(team: number): number {
  return (HEAL_RATE[G.heal[team] ?? 0] ?? HEAL_RATE[0]) * (hasBuilding(team, 'hospital') ? HOSPITAL_HEAL : 1);
}

/** healRate for each team, worked out once per step rather than once per unit. */
const rates = [HEAL_RATE[0], HEAL_RATE[0]];
export function refreshHealRates(): void {
  for (let team = 0; team < G.teams; team++) rates[team] = healRate(team);
}

/** Organic units slowly regain health. */
function regen(u: Ent, dt: number): void {
  if (u.hp >= u.maxhp || !isOrganic(u)) return;
  u.hp = Math.min(u.maxhp, u.hp + u.maxhp * (rates[u.team] ?? HEAL_RATE[0]) * dt);
}

/** The most hurt organic ally (not the medic itself) within a radius, if any. */
function woundedNear(u: Ent, r: number): Ent | null {
  let best: Ent | null = null;
  for (const e of G.ents) {
    if (e === u || e.dead || e.team !== u.team || !isOrganic(e) || e.hp >= e.maxhp - 0.5) continue;
    if (Math.hypot(e.x - u.x, e.y - u.y) > r) continue;
    if (!best || e.hp / e.maxhp < best.hp / best.maxhp) best = e;
  }
  return best;
}

function updMedic(u: Ent, o: HealOrder, dt: number): void {
  const t = valid(o.tgt);
  if (!t || t.team !== u.team || t.hp >= t.maxhp || Math.hypot(u.x - o.ox, u.y - o.oy) > AUTO_CHASE) { setOrder(u, null); return; }
  const r = approach(u, t, MEDIC_RANGE, dt);
  if (r === null) { setOrder(u, null); return; }
  if (!r) return;
  u.face = turnToward(u.face, Math.atan2(t.y - u.y, t.x - u.x), unitDef(u).turn * dt);
  u.atkT = 0.25; // kneels and works: drawn like an attack
  t.hp = Math.min(t.maxhp, t.hp + MEDIC_HEAL * dt);
}

export function updUnit(u: Ent, dt: number): void {
  const d = unitDef(u);
  regen(u, dt);
  u.cd = Math.max(0, u.cd - dt);
  u.flash = Math.max(0, u.flash - dt);
  u.atkT = Math.max(0, u.atkT - dt);
  u.moving = false;
  unstick(u, dt);
  // vehicle turrets drift back to the hull's heading when idle
  if (d.turret && u.atkT <= 0 && u.order?.t !== 'attack' && !u.shot) u.tface = turnToward(u.tface, u.face, 2 * dt);
  const o = u.order;
  if (u.stance !== 'skirmish') u.shot = null;
  if (!o) {
    if (u.stance === 'skirmish' && d.weapon) { fireOnTheMove(u, dt); return; } // holds its ground and shoots what's in range
    u.scan -= dt;
    if (u.scan > 0) return;
    u.scan = 0.3 + Math.random() * 0.2;
    if (u.type === 'medic') {
      const t = woundedNear(u, d.sight * TS);
      if (t) { setOrder(u, { t: 'heal', tgt: t.id, ox: u.x, oy: u.y }); return; }
    }
    if (u.stance === 'passive') {
      const threat = nearestThreat(u, Math.min(d.sight, 7));
      if (threat) orderFlee(u, threat);
    } else if (d.weapon) {
      const t = acquire(u, d.sight);
      if (t) setOrder(u, { t: 'attack', tgt: t.id, auto: true, ox: u.x, oy: u.y });
    } else if (isHarvester(u) && nearestOwn(u, 'refinery')) {
      u.scan = 1.5;
      if (u.carry > haulOf(u) * 0.5) setOrder(u, { t: 'harvest', st: 'ret', tx: tileOf(u.x), ty: tileOf(u.y), wait: 0 });
      else orderHarvest(u, tileOf(u.x), tileOf(u.y));
    }
    return;
  }
  switch (o.t) {
    case 'move': {
      if (u.stance === 'skirmish' || u.stance === 'passive' || !d.weapon) {
        // keep going; a skirmisher shoots along the way
        if (followPath(u, dt)) { u.order = null; u.path = null; }
        if (u.stance === 'skirmish') fireOnTheMove(u, dt);
        break;
      }
      // engage: stop to fight anything met on the way, then carry on
      let t = valid(o.sub);
      if (!t && o.sub) { o.sub = null; u.path = null; }
      if (!t) {
        u.scan -= dt;
        if (u.scan <= 0) {
          u.scan = 0.3;
          t = acquire(u, d.sight);
          if (t) { o.sub = t.id; u.path = null; }
        }
      }
      if (t) {
        if (!combatStep(u, t, dt)) { o.sub = null; u.path = null; }
      } else {
        if (!u.path) { u.goal = [o.gx, o.gy]; u.path = pathFor(u, o.gx, o.gy); }
        if (followPath(u, dt)) { u.order = null; u.path = null; }
      }
      break;
    }
    case 'attack': {
      const t = valid(o.tgt);
      const gaveUp = !t || (o.auto && Math.hypot(u.x - o.ox, u.y - o.oy) > AUTO_CHASE) || !combatStep(u, t, dt);
      if (gaveUp) { u.order = null; u.path = null; }
      break;
    }
    case 'harvest':
      if (isHarvester(u)) updHarvester(u, o, dt);
      else u.order = null;
      break;
    case 'heal':
      if (u.type === 'medic') updMedic(u, o, dt);
      else u.order = null;
      break;
  }
}
