// Per-tick unit behaviour: idle scanning, moving, fighting and harvesting.
import { aiPace } from './ai.ts';
import { LEADER_SPEED } from '../data/economy.ts';
import { G, haulOf, hooks, isAir, isHarvester, isOrganic, tileOf, unitDef, valid, type Ent, type HarvestOrder, type HealOrder, type Tile } from './state.ts';
import { MH, MW, NEAR, TS } from './const.ts';
import { HARVEST_RATE, ORE_WORTH, UNLOAD_RATE } from '../data/ore.ts';
import { DIRS, adjTile, edgeDist, nearestFree, pathFor } from './path.ts';
import { approach, canStep, followPath, turnToward } from './move.ts';
import { canBreach, enemyWallAt, wallInWay } from './breach.ts';
import { acquire, attacker, betterTarget, combatStep, fireOnTheMove, nearestThreat } from './combat.ts';
import { orderFlee, orderMove, setOrder, arrive } from './order.ts';
import { shardFor } from './aether.ts';
import { AETHER_BANK_REACH } from '../data/aether.ts';
import { nearestOre, takeOre, walkDist } from './ore.ts';
import { nearestOwn } from './query.ts';
import { bankAt } from './haul.ts';
import { WOOD_BANKS, chopOut, fellingOut, updChop } from './chop.ts';
import { part } from './fx.ts';
import { IDLE_GRACE, autoGather, keepResume, rethink, takeResume } from './autogather.ts';

/** When each idle gatherer last had something to do (game seconds). */
const idleSince = new WeakMap<Ent, number>();
/** The kind of order each unit last had, to tell a Worker the player walked somewhere from one that finished a job. */
const lastOrder = new WeakMap<Ent, string>();
/** Units that had an order last tick. */
const busy = new WeakSet<Ent>();
import { HEAL_RATE, HOSPITAL_HEAL } from '../data/era.ts';
import { MEDIC_HEAL, MEDIC_RANGE, WORKER_BUILD, WORKER_HEAL, WORKER_REPAIR } from '../data/unit.ts';
import { advanceSite, mend } from './building.ts';
import { bldDef } from './state.ts';
import { hasBuilding, lowPower } from './entity.ts';
import { stone, updWild } from './creatures.ts';
import { frozen, reloadRate, tickStatus, updCaster } from './spells.ts';

const AUTO_CHASE = 9 * TS;
/** How far (tiles) a Worker told to fix things, then harvest, looks for something to mend. */
export const TEND_RADIUS = 12;
/** Idle Workers repair buildings on their own only while the bank holds more ore than this. */
const AUTO_REPAIR_FLOOR = 200;
/** How far (px) a stuck unit edges aside to get past a unit in its way. */
const SIDESTEP = 8;

/**
 * Every Worker and Harvester, kept until an entity is added or the dead are cleared out, so
 * searching an ore field doesn't walk every entity on the map for each tile it looks at.
 */
let hvList: Ent[] = [], hvOf: Ent[] | null = null, hvLen = -1;
function harvesters(): Ent[] {
  if (hvOf !== G.ents || hvLen !== G.ents.length) { hvOf = G.ents; hvLen = G.ents.length; hvList = G.ents.filter(isHarvester); }
  return hvList;
}

/**
 * Is this ore tile someone else's? Always: another harvester is scooping it, or one that claimed it
 * first (lower id) is heading there. When choosing a new tile (`choosing`), also skip any tile with
 * a harvester scooping right next to it, so they spread across the field.
 */
function oreTaken(i: number, u: Ent, choosing: boolean): boolean {
  const cx = ((i % MW) + 0.5) * TS, cy = (((i / MW) | 0) + 0.5) * TS;
  for (const h of harvesters()) {
    if (h === u || h.dead || !isHarvester(h) || h.order?.t !== 'harvest') continue;
    const o = h.order;
    if (o.ty * MW + o.tx === i && (o.st === 'gather' || (o.st === 'go' && (choosing || h.id < u.id)))) return true;
    if (choosing && o.st === 'gather' && Math.abs(h.x - cx) < TS * 1.1 && Math.abs(h.y - cy) < TS * 1.1) return true;
  }
  return false;
}

/**
 * The next ore to dig: the tile closest to any of the side's ore drop-offs (Refinery or Town Hall),
 * wherever the gatherer is now, so it always works the ore nearest the base first and trips stay
 * short. Crumbs of regrowth only once no tile worth a trip is left. Skips tiles another
 * gatherer has claimed, sharing one only if every tile is taken.
 */
function pickOre(u: Ent): [number, number] | null {
  const bad = cantReach.get(u), free = (i: number) => !!bad?.has(i) || oreTaken(i, u, true), ok = bad && ((i: number) => bad.has(i));
  const homes = G.ents.filter((e) => !e.dead && e.team === u.team && e.done && (e.type === 'refinery' || e.type === 'yard'));
  const walk = walkOf(u.team, homes);
  const x = tileOf(u.x), y = tileOf(u.y);
  // a tile worth a trip first: crumbs of regrowth only once there's nothing else
  return nearestOre(x, y, MW, ORE_WORTH, free, homes, walk) ?? nearestOre(x, y, MW, 1, free, homes, walk) ?? nearestOre(x, y, MW, 1, ok, homes, walk);
}

/** Each side's walking distances from its ore drop-offs, refreshed every couple of seconds or when its drop-offs change. */
const walkCache = new Map<number, { t: number; key: string; d: Float32Array }>();
function walkOf(team: number, homes: Ent[]): Float32Array | null {
  if (!homes.length) return null;
  const key = homes.map((h) => h.id).join(','), c = walkCache.get(team);
  if (c && c.key === key && G.gameT >= c.t && G.gameT - c.t < 2) return c.d;
  const d = walkDist(homes);
  walkCache.set(team, { t: G.gameT, key, d });
  return d;
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
  if (o.res === 'wood' && (o.st === 'go' || o.st === 'gather')) { updChop(u, o, dt); return; }
  if (o.res && (o.st === 'go' || o.st === 'gather')) { updHauler(u, o, dt); return; }
  if (o.st === 'go') {
    const i = o.ty * MW + o.tx;
    if (G.ore[i] <= 0 || oreTaken(i, u, false)) {
      const t = pickOre(u);
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
        const t = pickOre(u);
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
      const t = pickOre(u);
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
      const t = pickOre(u);
      if (t) { [o.tx, o.ty] = t; o.st = 'go'; } else o.st = u.carry > haulOf(u) * 0.3 ? 'ret' : 'go';
    }
    return;
  }
  // ore and oil go to a Refinery or the Town Hall; wood also to a Lumber Mill
  const cargo0 = u.cargo ?? 'ore';
  const ref = bankAt(u, cargo0 === 'ore' ? ['refinery', 'yard'] : cargo0 === 'wood' ? [...WOOD_BANKS] : ['refinery', 'yard']);
  if (!ref) { o.wait = 2; return; } // nowhere to unload: wait
  if (o.st === 'ret') {
    // shut in by trees on the way home: cut a way out
    if (fellingOut(u) && chopOut(u, ref, dt)) return;
    const r = approach(u, ref, NEAR, dt);
    if (!r && !u.path?.length && chopOut(u, ref, dt)) return;
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
  hooks.gain(u.team, u.x, u.y, cargo === 'wood' || cargo === 'oil' ? cargo : 'ore', a, u.id);
  if (u.carry <= 0.01) {
    u.carry = 0;
    o.st = 'go';
    // back out to the ore nearest the base, which may not be where the last load came from
    if (!o.res) { const t = pickOre(u); if (t) [o.tx, o.ty] = t; }
    // one that picked its own job looks round for anything to fix before setting out again
    if (o.auto && u.type === 'worker') {
      const job = { ...o };
      if (fixNext(u)) { keepResume(u, job); return; }
    }
    rethink(u, o);
  }
}

/** Haul oil: walk to a derrick, fill up from its store, then head home. */
function updHauler(u: Ent, o: HarvestOrder, dt: number): void {
  const type = 'derrick';
  let src = valid(o.src);
  if (!src || src.team !== u.team || src.type !== type || !src.done) {
    src = nearestOwn(u, type);
    if (!src) {
      // the mill or derrick is gone: dig ore instead of standing about
      o.res = undefined; o.src = undefined; o.st = u.carry > 0 ? 'ret' : 'go';
      [o.tx, o.ty] = [tileOf(u.x), tileOf(u.y)];
      u.path = null;
      return;
    }
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
  // full, or the store is empty: take what we have home rather than stand by a slow pump holding it
  if (u.carry >= haulOf(u) - 0.5 || (src.carry <= 0.01 && u.carry > 0)) o.st = 'ret';
  else if (src.carry <= 0.01) {
    // nothing to carry: a Worker that picked this job itself finds another; one sent here waits for more
    if (o.auto) u.order = null;
    else o.wait = 1;
  }
}

/** A walking ground unit touching u, in front of it and heading back toward it. */
function oncoming(u: Ent): Ent | null {
  const r = unitDef(u).radius;
  for (const e of G.ents) {
    if (e === u || e.dead || e.kind !== 'unit' || isAir(e) || !e.path?.length) continue;
    const dx = e.x - u.x, dy = e.y - u.y;
    if (Math.hypot(dx, dy) > r + unitDef(e).radius + 10) continue;
    if (dx * Math.cos(u.face) + dy * Math.sin(u.face) > 0 && dx * Math.cos(e.face) + dy * Math.sin(e.face) < 0) return e;
  }
  return null;
}

/** The tiles a unit is about to walk through: to its next two waypoints. */
function routeOf(e: Ent): Set<number> {
  const out = new Set<number>([tileOf(e.y) * MW + tileOf(e.x)]);
  let x = e.x, y = e.y;
  for (const [tx, ty] of (e.path ?? []).slice(0, 2)) {
    const cx = (tx + 0.5) * TS, cy = (ty + 0.5) * TS, n = Math.max(1, Math.ceil(Math.hypot(cx - x, cy - y) / 8));
    for (let k = 0; k <= n; k++) out.add(tileOf(y + ((cy - y) * k) / n) * MW + tileOf(x + ((cx - x) * k) / n));
    x = cx; y = cy;
  }
  return out;
}

/**
 * The nearest free tile, a few steps away at most, that is off another unit's way and on our side
 * of it: somewhere to let it pass.
 */
function pullOver(u: Ent, e: Ent): Tile | null {
  const avoid = routeOf(e), start = tileOf(u.y) * MW + tileOf(u.x), theirs = tileOf(e.y) * MW + tileOf(e.x), seen = new Set([start]);
  let ring = [start];
  for (let depth = 0; depth < 6 && ring.length; depth++) {
    const next: number[] = [];
    let best: Tile | null = null, bestGap = 0;
    for (const i of ring) {
      const x = i % MW, y = (i / MW) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, ni = ny * MW + nx;
        if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || seen.has(ni) || G.blk[ni] || ni === theirs) continue;
        if (dx && dy && (G.blk[y * MW + nx] || G.blk[ny * MW + x])) continue;
        seen.add(ni);
        next.push(ni);
        if (avoid.has(ni)) continue;
        const cx = (nx + 0.5) * TS, cy = (ny + 0.5) * TS, gap = Math.hypot(cx - e.x, cy - e.y) - Math.hypot(cx - u.x, cy - u.y);
        if (gap > bestGap) { bestGap = gap; best = [nx, ny]; }
      }
    }
    if (best) return best;
    ring = next;
  }
  return null;
}

/** The tile each unit last pulled over to, while it's still heading there. */
const pulledOver = new WeakMap<Ent, Tile>();

function unstick(u: Ent, dt: number): void {
  if (isAir(u)) {
    // nothing blocks aircraft, but a flight sent to one spot jostles over it (see separate):
    // hovering near the goal counts as arrived
    if (!u.path?.length) return;
    u.stkT -= dt;
    if (u.stkT > 0) return;
    u.stkT = 0.6;
    const last = u.path[u.path.length - 1];
    if (Math.hypot(u.x - u.px, u.y - u.py) < 4 && Math.hypot((last[0] + 0.5) * TS - u.x, (last[1] + 0.5) * TS - u.y) < 1.5 * TS) u.path.length = 0;
    u.px = u.x; u.py = u.y;
    return;
  }
  if (G.blk[tileOf(u.y) * MW + tileOf(u.x)]) {
    const f = nearestFree(tileOf(u.x), tileOf(u.y));
    if (f) { u.x = (f[0] + 0.5) * TS; u.y = (f[1] + 0.5) * TS; u.path = null; }
  }
  if (!u.path || !u.path.length) return;
  u.stkT -= dt;
  if (u.stkT > 0) return;
  u.stkT = 0.6;
  if (Math.hypot(u.x - u.px, u.y - u.py) < 4) {
    // jammed nose to nose with someone in a lane too narrow to pass: the later unit pulls over
    if (u.path[0] === pulledOver.get(u)) u.path.shift(); // couldn't get there either
    const e = oncoming(u), bay = e && e.id < u.id ? pullOver(u, e) : null;
    if (bay) { u.path.unshift(bay); pulledOver.set(u, bay); u.px = u.x; u.py = u.y; return; }
    // close enough to the goal in a crowd counts as arrived; otherwise look for another way
    const last = u.path[u.path.length - 1];
    if (!last || Math.hypot((last[0] + 0.5) * TS - u.x, (last[1] + 0.5) * TS - u.y) < 2.5 * TS) u.path.length = 0;
    else {
      // edge over to the right, like traffic, so both can pass
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

/** Organic units slowly regain health, and a few creatures (the Hydra) grow back wounds by themselves. */
function regen(u: Ent, dt: number): void {
  const own = unitDef(u).regen ?? 0;
  if (u.hp >= u.maxhp || u.wild?.down || (!own && !isOrganic(u))) return;
  const rate = (isOrganic(u) ? rates[u.team] ?? HEAL_RATE[0] : 0) + own;
  u.hp = Math.min(u.maxhp, u.hp + u.maxhp * rate * dt);
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

/** Something a Worker can mend: its side's site or damaged building (if the bank can pay), or a hurt unit on the ground. */
function mendable(u: Ent, t: Ent | null, slack = 0): t is Ent {
  if (!t || t === u || t.dead || t.team !== u.team) return false;
  if (t.kind === 'bld') return !t.done || (t.hp < t.maxhp - slack && G.credits[t.team] >= 1);
  return t.kind === 'unit' && !isAir(t) && !t.wild && t.hp < t.maxhp - slack;
}

/** Idle Workers patch up troops below this share of their health (leave scratches to heal). */
const UNIT_FIX_BELOW = 0.75;
/** Most Workers that go to a site on their own; one repairs a building or patches up a unit. */
const SITE_CREW = 2;
/** Seconds after last being hit that a unit still counts as in a fight. */
const UNDER_FIRE = 6;

/** How many of the side's other Workers are building, repairing or patching up `t`. */
function menders(t: Ent, u: Ent): number {
  let n = 0;
  for (const w of G.ents) if (w !== u && !w.dead && w.team === t.team && w.type === 'worker' && w.order?.t === 'heal' && w.order.tgt === t.id) n++;
  return n;
}

/** The nearest site or damaged building within a radius, else the most hurt unit there. */
function mendNear(u: Ent, r: number): Ent | null {
  let bld: Ent | null = null, bd = Infinity, unit: Ent | null = null;
  for (const e of G.ents) {
    if (!mendable(u, e, 0.5)) continue;
    if (e.kind === 'unit' && e.hp > e.maxhp * UNIT_FIX_BELOW) continue; // not for a scratch
    if (e.kind === 'unit' && (e.moving || G.gameT - e.foeT < UNDER_FIRE)) continue; // not one on the move or under fire: that's chasing a fight
    if (menders(e, u) >= (e.kind === 'bld' && !e.done ? SITE_CREW : 1)) continue; // enough hands on it already
    // left to themselves, Workers don't spend the last of the bank on repairs
    if (e.kind === 'bld' && e.done && G.credits[u.team] < AUTO_REPAIR_FLOOR) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y) - (e.w ? (e.w * TS) / 2 : 0);
    if (d > r) continue;
    if (e.kind === 'bld') { if (d < bd) { bd = d; bld = e; } }
    else if (!unit || e.hp / e.maxhp < unit.hp / unit.maxhp) unit = e;
  }
  return bld ?? unit;
}

/**
 * Send a Worker to the nearest site to build, damaged building to repair or wounded unit to patch
 * up within TEND_RADIUS, unless an enemy is about and it's on "Don't attack". Returns true if it went.
 */
export function fixNext(u: Ent): boolean {
  if (u.stance === 'passive' && nearestThreat(u, Math.min(unitDef(u).sight, 7))) return false;
  const t = mendNear(u, TEND_RADIUS * TS);
  if (!t) return false;
  // a building it'll stay on however far; a wounded unit it gives up if it strays (it may be off fighting)
  setOrder(u, { t: 'heal', tgt: t.id, ox: u.x, oy: u.y, sent: u.tending || t.kind === 'bld' });
  return true;
}

/** A Worker mending: helps a site go up, repairs a building (for ore), or patches up a unit. */
function updMend(u: Ent, o: HealOrder, dt: number): void {
  const t = valid(o.tgt);
  if (!mendable(u, t) || (!o.sent && Math.hypot(u.x - o.ox, u.y - o.oy) > AUTO_CHASE)) { setOrder(u, null); return; }
  // a wall segment hemmed in by others can only be reached from a tile off its corner, so a Worker
  // builds and repairs from a little further off than it patches up a soldier
  const r = approach(u, t, t.kind === 'bld' ? MEDIC_RANGE + TS : MEDIC_RANGE, dt);
  if (r === null) { setOrder(u, null); return; }
  if (!r) return;
  u.face = turnToward(u.face, Math.atan2(t.y - u.y, t.x - u.x), unitDef(u).turn * dt);
  if (t.kind === 'bld' && t.unpaid) return; // waits at the site until the side can pay for it
  u.atkT = 0.25; // hammers away: drawn like an attack
  if (t.kind === 'bld' && !t.done) advanceSite(t, ((lowPower(t.team) ? 0.5 : 1) * (t.team === G.leader ? LEADER_SPEED : 1) * aiPace(t.team) * WORKER_BUILD * dt) / bldDef(t).t);
  else if (t.kind === 'bld') { if (!mend(t, WORKER_REPAIR * dt)) setOrder(u, null); }
  else t.hp = Math.min(t.maxhp, t.hp + WORKER_HEAL * dt);
}

/** An enemy wall the unit was ordered right onto, once it's within sight of it. */
function sentToWall(u: Ent, gx: number, gy: number, sight: number): Ent | null {
  const w = canBreach(u) ? enemyWallAt(u.team, gx, gy) : null;
  return w && Math.hypot(w.x - u.x, w.y - u.y) <= sight * TS ? w : null;
}

export function updUnit(u: Ent, dt: number): void {
  const d = unitDef(u);
  regen(u, dt);
  u.cd = Math.max(0, u.cd - dt * reloadRate(u));
  u.flash = Math.max(0, u.flash - dt);
  u.atkT = Math.max(0, u.atkT - dt);
  u.moving = false;
  tickStatus(u, dt);
  if (u.dead) return;
  if (frozen(u)) return; // locked in ice: no moving, turning, fighting or casting
  if (stone(u)) return; // turned to stone by a Medusa: frozen until it wears off
  if (d.spells) updCaster(u, dt);
  unstick(u, dt);
  // vehicle turrets drift back to the hull's heading when idle
  if (d.turret && u.atkT <= 0 && u.order?.t !== 'attack' && !u.shot) u.tface = turnToward(u.tface, u.face, 2 * dt);
  if (u.wild) { updWild(u, dt); return; } // guards its lair (data/creatures.ts)
  const o = u.order;
  if (u.stance !== 'skirmish') u.shot = null;
  if (!o) {
    if (u.stance === 'skirmish' && d.weapon && !isHarvester(u)) { fireOnTheMove(u, dt); return; } // holds its ground and shoots what's in range
    if (busy.delete(u)) u.scan = 0; // just finished something: look for the next thing straight away
    u.scan -= dt;
    if (u.scan > 0) return;
    u.scan = 0.3 + Math.random() * 0.2;
    if (u.type === 'medic') {
      const t = woundedNear(u, d.sight * TS);
      if (t) { setOrder(u, { t: 'heal', tgt: t.id, ox: u.x, oy: u.y, sent: u.tending }); return; }
    }
    // an idle Worker fetches dropped Aether nearby, and takes what it carries home to bank
    if (u.type === 'worker' && (u.stance !== 'passive' || !nearestThreat(u, Math.min(d.sight, 7)))) {
      const s = shardFor(u);
      if (s) { orderMove(u, tileOf(s.x), tileOf(s.y)); return; }
      const home = u.ae ? bankAt(u, ['yard', 'refinery']) : null;
      if (home && edgeDist(u, home) > AETHER_BANK_REACH * TS * 0.8) { const t = adjTile(home, u, false); if (t) { orderMove(u, t[0], t[1]); return; } }
    }
    // fix, then harvest: an idle Worker first builds, repairs and patches up whatever needs it nearby
    // (a passive one only when no enemy is about), and only then goes back to gathering
    if (u.type === 'worker' && fixNext(u)) return;
    // a Worker only fights back, or an enemy that comes right up to it
    const foe = u.stance === 'passive' || !d.weapon ? null : isHarvester(u) ? attacker(u) ?? acquire(u, 2) : attacker(u) ?? acquire(u, d.sight);
    // a passive unit runs from enemies, but a gatherer sticks to its work with them about
    const threat = u.stance === 'passive' && !isHarvester(u) ? nearestThreat(u, Math.min(d.sight, 7)) : null;
    if (threat) orderFlee(u, threat);
    else if (u.stance === 'passive' && !isHarvester(u)) { /* nothing to do */ } else if (foe) {
      setOrder(u, { t: 'attack', tgt: foe.id, auto: true, ox: u.x, oy: u.y });
    } else if (isHarvester(u)) {
      // nothing left to fix: after a moment's pause, go and gather what the side needs most
      // only a Worker the player just walked somewhere pauses first (they may have plans for it)
      const since = idleSince.get(u), grace = lastOrder.get(u) === 'move' ? IDLE_GRACE : 0;
      if (since === undefined && grace > 0) idleSince.set(u, G.gameT);
      else if (G.gameT - (since ?? G.gameT) >= grace) {
        u.tending = false;
        u.scan = 1.5;
        idleSince.delete(u);
        lastOrder.delete(u);
        const job = takeResume(u);
        if (job) setOrder(u, { ...job, st: u.carry > 0 && (u.cargo ?? 'ore') !== (job.res ?? 'ore') ? 'ret' : 'go', wait: 0 }); // back to what it was doing before it stopped to fix something
        else if (u.carry > haulOf(u) * 0.5) setOrder(u, { t: 'harvest', st: 'ret', tx: tileOf(u.x), ty: tileOf(u.y), wait: 0, res: u.cargo === 'wood' || u.cargo === 'oil' ? u.cargo : undefined });
        else autoGather(u);
      }
    }
    return;
  }
  idleSince.delete(u);
  lastOrder.set(u, o.t);
  busy.add(u);
  switch (o.t) {
    case 'move': {
      if (u.stance === 'skirmish' || u.stance === 'passive' || !d.weapon) {
        // keep going; a skirmisher shoots along the way
        if (followPath(u, dt)) arrive(u);
        if (u.stance === 'skirmish') fireOnTheMove(u, dt);
        break;
      }
      // engage: stop to fight anything met on the way, then carry on
      let t = valid(o.sub);
      if (!t && o.sub) { o.sub = null; u.path = null; u.scan = 0; } // it fell: look for the next one now
      u.scan -= dt;
      if (u.scan <= 0) {
        u.scan = 0.3;
        // fight back against whoever is attacking first, and armed enemies before buildings; a wall
        // only if it was sent to one, once it's close
        const b = t ? betterTarget(u, t, d.sight) : attacker(u) ?? acquire(u, d.sight) ?? sentToWall(u, o.gx, o.gy, d.sight);
        if (b) { t = b; o.sub = b.id; u.path = null; }
      }
      if (t) {
        if (!combatStep(u, t, dt)) { o.sub = null; u.path = null; }
      } else {
        if (!u.path) { u.goal = [o.gx, o.gy]; u.path = pathFor(u, o.gx, o.gy); }
        if (followPath(u, dt)) {
          // stopped short, walled off from where it's going: break through the enemy wall in the way
          const short = Math.hypot(u.x - (o.gx + 0.5) * TS, u.y - (o.gy + 0.5) * TS) > 1.5 * TS;
          const w = short && canBreach(u) ? wallInWay(u, o.gx, o.gy) : null;
          if (w) { o.sub = w.id; u.path = null; }
          else arrive(u);
        }
      }
      break;
    }
    case 'attack': {
      let t = valid(o.tgt);
      u.scan -= dt;
      if (t && u.scan <= 0) {
        u.scan = 0.3;
        const b = betterTarget(u, t, d.sight);
        if (b) { t = b; o.tgt = b.id; u.path = null; }
      }
      const gaveUp = !t || (o.auto && Math.hypot(u.x - o.ox, u.y - o.oy) > AUTO_CHASE) || !combatStep(u, t, dt);
      if (gaveUp) { u.order = null; u.path = null; u.scan = 0; }
      break;
    }
    case 'harvest':
      if (isHarvester(u)) updHarvester(u, o, dt);
      else u.order = null;
      break;
    case 'heal':
      if (u.type === 'medic') updMedic(u, o, dt);
      else if (u.type === 'worker') updMend(u, o, dt);
      else u.order = null;
      break;
  }
}
