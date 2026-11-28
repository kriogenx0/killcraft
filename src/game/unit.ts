// Per-tick unit behaviour: idle scanning, moving, fighting and harvesting.
import { updCarrier, updHornet } from './carrier.ts';
import { aiPace, leaderHandicap } from './ai.ts';
import { LEADER_SPEED } from '../data/economy.ts';
import { WEAPON } from '../data/weapon.ts';
import { isWall } from '../data/building.ts';
import { G, allied, altOf, haulOf, hooks, loadOf, oreLoadOf, isAir, isHarvester, isOrganic, tileOf, unitDef, valid, type Ent, type AttackOrder, type HarvestOrder, type HealOrder, type MoveOrder, type Tile } from './state.ts';
import { noteGathered } from './stats.ts';
import { MH, MW, NEAR, TS } from './const.ts';
import { HARVEST_RATE, ORE_WORTH, UNLOAD_RATE } from '../data/ore.ts';
import { DIRS, adjTile, edgeDist, los, nearestFree, pathFor, pathTo } from './path.ts';
import { approach, canStep, cruise, followPath, holdingFormation, narrow, turnToward } from './move.ts';
import { canBreach, enemyWallAt, wallInWay } from './breach.ts';
import { acquire, attacker, betterTarget, canAttack, cantReachFoe, combatStep, fireOnTheMove, isFoe, lookRange, nearestThreat } from './combat.ts';
import { groupMove, orderFlee, orderMove, setOrder, arrive } from './order.ts';
import { shardFor, wantsHome } from './aether.ts';
import { AETHER_BANK_REACH, AETHER_CARRY, AETHER_DRY, AETHER_REACH, AETHER_RETURN_RETRY, SHARD_PULL } from '../data/aether.ts';
import { nearestOre, takeOre, walkDist } from './ore.ts';
import { found } from './fog.ts';
import { nearestOwn } from './query.ts';
import { AETHER_BANKS, ORE_BANKS, banksOf, dropAt } from './haul.ts';
import { WOOD_BANKS, chopOut, fellingOut, updChop } from './chop.ts';
import { part } from './fx.ts';
import { IDLE_GRACE, aetherJobOf, forgetAether, fetching, autoGather, keepResume, peekResume, rethink, stayOnDerrick, takeResume } from './autogather.ts';
import { EVADE_GIVE_UP, doneFleeing, evade, evades, fledFor, hasFled, safeToWork, threatNear, watchOut } from './evade.ts';

/** When each idle gatherer last had something to do (game seconds). */
const idleSince = new WeakMap<Ent, number>();
/** The kind of order each unit last had, to tell a Worker the player walked somewhere from one that finished a job. */
const lastOrder = new WeakMap<Ent, string>();
/** Units that had an order last tick. */
const busy = new WeakSet<Ent>();
import { HEAL_RATE, HOSPITAL_HEAL } from '../data/era.ts';
import { MACHINE_REPAIR, MEDIC_HEAL, MEDIC_RANGE, MEDIC_REACH, WORKER_BUILD, WORKER_HEAL, WORKER_REPAIR } from '../data/unit.ts';
import { advanceSite, mend } from './building.ts';
import { bldDef, isJet, reactOf } from './state.ts';
import { hasBuilding, lowPower } from './entity.ts';
import { callSwarm, stone, updBee, updWild } from './creatures.ts';
import { updDemon } from './hell.ts';
import { burning, frozen, reloadRate, tickStatus, updCaster } from './spells.ts';

const AUTO_CHASE = 9 * TS;
/**
 * The enemy a group was sent after is gone. Everyone who was sent at it is sorted out at once: those
 * who got there and fought stay where they are; the rest, still on their way or held up, come and join
 * them (Alex, 2026-11-28), or if nobody got there, carry on to where it was, fighting by stance on the way.
 */
function regroup(u: Ent, o: AttackOrder): void {
  if (o.lx == null || o.ly == null) return;
  const lx = o.lx, ly = o.ly;
  const mates = [u, ...G.ents.filter((e) => e !== u && !e.dead && e.team === u.team && e.order?.t === 'attack' && !e.order.auto && e.order.tgt === o.tgt)];
  const fought = (e: Ent) => Math.hypot(e.x - lx, e.y - ly) <= weaponReach(e) + CARRY_ON * TS;
  const there = mates.filter(fought), rest = mates.filter((e) => !fought(e));
  for (const e of there) if (e !== u) setOrder(e, null);
  if (!rest.length) return;
  for (const e of rest) setOrder(e, null);
  const [cx, cy] = there.length ? [there.reduce((a, e) => a + e.x, 0) / there.length, there.reduce((a, e) => a + e.y, 0) / there.length] : [lx, ly];
  const gx = tileOf(cx), gy = tileOf(cy), spot = G.blk[gy * MW + gx] ? nearestFree(gx, gy, 3) : [gx, gy] as Tile;
  if (spot) groupMove(rest, spot[0], spot[1]);
}

/** How far (px) a unit can hit from where it stands. */
const weaponReach = (u: Ent): number => { const w = unitDef(u).weapon; return w ? WEAPON[w].range * TS : 0; };

/** A unit whose target fell this far (tiles) or more from where it was carries on to that spot. */
const CARRY_ON = 2;
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
/** How far (tiles) a destroyed thing's salvage lies from where it fell (economy.ts dropSalvage spreads it). */
const WRECK_SPREAD = 4;
/** How far (tiles) from a taken tile a gatherer looks for other ore before choosing afresh. */
const AROUND_TAKEN = 5;

function pickOre(u: Ent, underway = false, around: Tile | null = null): [number, number] | null {
  // only ore the side has found: none still hidden in the fog of war
  const bad = cantReach.get(u), danger = scrapInDanger(u), hidden = (i: number) => !found(u.team, i);
  const free = (i: number) => !!bad?.has(i) || hidden(i) || oreTaken(i, u, true) || danger(i), ok = (i: number) => !!bad?.has(i) || hidden(i);
  // sent to pick over a wreck: what's left of it first, until it's all carried off
  const o = u.order;
  if (o?.t === 'harvest' && o.wreck) {
    const w = nearestOre(o.wreck[0], o.wreck[1], WRECK_SPREAD, 1, (i) => !G.scrap[i] || free(i));
    if (w) return w;
    o.wreck = undefined;
  }
  // the tile it was walking out to got taken: other ore by that one, rather than turn back toward base
  // for a patch that has just grown back
  if (around) { const by = nearestOre(around[0], around[1], AROUND_TAKEN, ORE_WORTH, free); if (by) return by; }
  // part-way through a load, or the tile it was walking to got taken: ore right here rather than
  // trek back toward base and out again
  if (underway || (u.carry > 0 && (u.cargo ?? 'ore') === 'ore')) {
    const here = nearestOre(tileOf(u.x), tileOf(u.y), TOP_UP, ORE_WORTH, free);
    if (here) return here;
    if (u.carry > oreLoadOf(u) * 0.5) return null; // most of a load: bank it, then set out afresh
  }
  const homes = banksOf(u.team, ORE_BANKS);
  const walk = walkOf(u.team, homes);
  const x = tileOf(u.x), y = tileOf(u.y);
  // a tile worth a trip first: crumbs of regrowth only once there's nothing else
  const best = nearestOre(x, y, MW, ORE_WORTH, free, homes, walk) ?? nearestOre(x, y, MW, 1, free, homes, walk) ?? nearestOre(x, y, MW, 1, ok, homes, walk);
  return best;
}

/** Salvage this close (tiles) to an armed enemy (or enemy tower) is left until the fighting's over. */
const SCRAP_DANGER = 7;

/**
 * The salvage tiles (ore left by destroyed units and structures) that are too near an armed enemy
 * to dig now. Otherwise salvage is ore like any other: the nearest to base gets dug first.
 */
function scrapInDanger(u: Ent): (i: number) => boolean {
  let foes: Ent[] | null = null;
  return (i) => {
    if (!G.scrap[i]) return false;
    foes ??= G.ents.filter((e) => !e.dead && e.team >= 0 && !allied(e.team, u.team) && (e.kind === 'unit' ? !!unitDef(e).weapon && e.type !== 'worker' : e.kind === 'bld' && !!bldDef(e)?.weapon));
    const x = (i % MW + 0.5) * TS, y = (((i / MW) | 0) + 0.5) * TS;
    return foes.some((e) => Math.hypot(e.x - x, e.y - y) < SCRAP_DANGER * TS);
  };
}

/** How far (tiles) a gatherer with part of a load looks for more before heading off elsewhere. */
const TOP_UP = 5;

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
  // a full load goes home, however the Worker came to be setting out with it
  if (o.st === 'go' && !o.res && u.carry >= oreLoadOf(u) - 0.5) { o.st = 'ret'; u.path = null; }
  if (o.st === 'go') {
    const i = o.ty * MW + o.tx;
    if (G.ore[i] <= 0 || oreTaken(i, u, false)) {
      // someone else got to the tile first, near the end of the walk: ore right here instead
      const t = pickOre(u, G.ore[i] > 0 && Math.hypot(u.x - (o.tx + 0.5) * TS, u.y - (o.ty + 0.5) * TS) < TOP_UP * TS, G.ore[i] > 0 ? [o.tx, o.ty] : null);
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
        else if (u.carry > 0) o.st = 'ret'; // nothing else to top up from: bank what it has rather than try the same tile for ever
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
      else if (u.carry > 0) o.st = 'ret';
    }
    return;
  }
  if (o.st === 'gather') {
    cantReach.delete(u);
    u.carry += takeOre(o.tx, o.ty, Math.min((unitDef(u).oreScoop ?? unitDef(u).scoop ?? HARVEST_RATE) * dt, oreLoadOf(u) - u.carry));
    u.cargo = 'ore';
    u.atkT = 0.2;
    u.face = turnToward(u.face, u.face + 1, 0.4 * dt); // slow sweep while scooping
    if (Math.random() < dt * 6) part('ore', u.x + Math.cos(u.face) * 14, u.y + Math.sin(u.face) * 14, { vz: 40, vx: (Math.random() - 0.5) * 30, max: 0.5, size: 2, col: '#f0c040' });
    if (u.carry >= oreLoadOf(u) - 0.5) { o.st = 'ret'; return; }
    if (G.ore[o.ty * MW + o.tx] <= 0) {
      const t = pickOre(u);
      if (t) { [o.tx, o.ty] = t; o.st = 'go'; } else o.st = u.carry > oreLoadOf(u) * 0.3 ? 'ret' : 'go';
    }
    return;
  }
  // ore and oil go to the nearest Refinery, Resource Drop or Town Hall by walking; wood there or to a
  // Lumber Mill. Picked afresh as it goes, so one finished (or lost) on the way home counts at once
  const cargo0 = u.cargo ?? 'ore';
  const ref = dropAt(u, cargo0 === 'wood' ? WOOD_BANKS : ORE_BANKS);
  if (!ref) { o.wait = 2; return; } // nowhere to unload: wait
  // heading for a different drop-off than last time: drop the old path (approach keeps a path to a
  // building until it runs out, which walked Workers on to the old one first)
  if (headingTo.get(u) !== ref.id) { headingTo.set(u, ref.id); if (o.st === 'ret') u.path = null; }
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
  noteGathered(u.team, cargo === 'wood' || cargo === 'oil' ? cargo : 'ore', a);
  if (u.carry <= 0.01) {
    u.carry = 0;
    o.st = 'go';
    // back out to the ore nearest the base, which may not be where the last load came from
    if (!o.res) { const t = pickOre(u); if (t) [o.tx, o.ty] = t; }
    // one that picked its own job looks round for anything to fix before setting out again,
    // and for Aether dropped by the fallen to fetch home
    if (o.auto && u.type === 'worker') {
      const job = { ...o };
      if (fixNext(u)) { keepResume(u, job); return; }
      const s = shardFor(u, SHARD_PULL);
      if (s) { keepResume(u, job); fetching.add(u); orderMove(u, tileOf(s.x), tileOf(s.y)); return; }
    }
    rethink(u, o);
  }
}

/** When each gatherer at work next looks round for danger. */
const lookT = new WeakMap<Ent, number>();

/** The drop-off each gatherer last headed for. */
const headingTo = new WeakMap<Ent, number>();

/** Haul oil: walk to a derrick, fill up from its store, then head home. */
/** The side's Oil Derrick (other than `not`) with the most oil waiting in its tank, if any has half a load. */
function fullerDerrick(u: Ent, not: Ent): Ent | null {
  let best: Ent | null = null;
  for (const d of G.ents) if (d !== not && !d.dead && d.team === u.team && d.type === 'derrick' && d.done && d.carry >= haulOf(u) / 2 && (!best || d.carry > best.carry)) best = d;
  return best;
}

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
    // an empty tank: move to another derrick with a load waiting, or (on Auto) gather something
    // else until this one fills up again, rather than stand about
    const other = fullerDerrick(u, src);
    // set to Oil (or it built this derrick): it stays on oil, waiting for the pump
    // (one waits at each pump; any more go and do something else)
    if (!o.auto && !other && !G.ents.some((w) => w !== u && !w.dead && w.id < u.id && w.order?.t === 'harvest' && w.order.src === src.id && w.order.st === 'gather')) return;
    if (other) { o.src = other.id; [o.tx, o.ty] = [other.tx, other.ty]; o.st = 'go'; u.path = null; }
    else u.order = null;
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

/**
 * Is the ground between a jammed unit and the end of its walk packed with its own side's troops
 * standing there (others sent to the same spot that got there first)? Then it has got as close
 * as it can, and stopping at the edge of the crowd is arriving: pushing on only shoves them about.
 */
function packedAround(u: Ent, goal: Tile): boolean {
  const gx = (goal[0] + 0.5) * TS, gy = (goal[1] + 0.5) * TS, d = Math.hypot(gx - u.x, gy - u.y);
  if (u.order?.t !== 'move' || d > 14 * TS || narrow(u.x, u.y)) return false;
  let area = 0;
  for (const e of G.ents) {
    if (e === u || e.dead || e.kind !== 'unit' || e.team !== u.team || e.moving || isAir(e)) continue;
    if (Math.hypot(e.x - gx, e.y - gy) > d) continue;
    const w = unitDef(e).radius * 2 + 4;
    area += w * w;
  }
  // a crowd standing that close packed covers at least half the ground short of us
  return area >= 0.5 * Math.PI * (d - TS) * (d - TS);
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
  // waiting in formation for the front to move off isn't being stuck
  if (holdingFormation(u)) { u.stkT = 0.6; u.px = u.x; u.py = u.y; return; }
  u.stkT -= dt;
  if (u.stkT > 0) return;
  u.stkT = 0.6;
  if (Math.hypot(u.x - u.px, u.y - u.py) < 4) {
    // jammed nose to nose with someone in a lane too narrow to pass: the later unit pulls over
    if (u.path[0] === pulledOver.get(u)) u.path.shift(); // couldn't get there either
    const e = oncoming(u), bay = e && e.id < u.id ? pullOver(u, e) : null;
    if (bay) { u.path.unshift(bay); pulledOver.set(u, bay); u.px = u.x; u.py = u.y; return; }
    // jostling for a waypoint on the way (a corner, a gap) with others: close by is near enough
    const wp = u.path[0];
    const nx = u.path[1];
    if (nx && G.warp[wp[1] * MW + wp[0]] < 0 && Math.hypot((wp[0] + 0.5) * TS - u.x, (wp[1] + 0.5) * TS - u.y) < 0.75 * TS
      && los(u.x, u.y, (nx[0] + 0.5) * TS, (nx[1] + 0.5) * TS, 2)) { u.path.shift(); u.px = u.x; u.py = u.y; return; }
    // close enough to the goal in a crowd counts as arrived; otherwise look for another way
    const last = u.path[u.path.length - 1];
    if (!last || Math.hypot((last[0] + 0.5) * TS - u.x, (last[1] + 0.5) * TS - u.y) < 2.5 * TS || packedAround(u, last)) u.path.length = 0;
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

/**
 * Whether Medic `u` can heal `e`: its own side's or a teammate's foot soldiers and creatures, anything
 * that flies, and vehicles once the Medic's side knows Field Mechanics.
 */
const medicCanHeal = (u: Ent, e: Ent): boolean => allied(e.team, u.team) && e.kind === 'unit'
  && (isOrganic(e) || isAir(e) || (unitDef(e).cls === 'vehicle' && !!G.mech[u.team]));

/**
 * The patient a Medic should see to within a radius (not the medic itself): the most hurt of its own
 * side's wounded, and only when none of its own need it, the most hurt teammate's.
 */
function woundedNear(u: Ent, r: number, ownOnly = false): Ent | null {
  let own: Ent | null = null, ally: Ent | null = null;
  for (const e of G.ents) {
    if (e === u || e.dead || e.hp >= e.maxhp - 0.5 || !medicCanHeal(u, e)) continue;
    const mine = e.team === u.team;
    if (!mine && (ownOnly || own)) continue;
    if (Math.hypot(e.x - u.x, e.y - u.y) > r) continue;
    const best = mine ? own : ally;
    if (!best || e.hp / e.maxhp < best.hp / best.maxhp) { if (mine) own = e; else ally = e; }
  }
  return own ?? ally;
}

// a patient at full health still gets its flames beaten out before the Medic moves on
function updMedic(u: Ent, o: HealOrder, dt: number): void {
  const t = valid(o.tgt);
  if (!t || !medicCanHeal(u, t) || (t.hp >= t.maxhp && !burning(t)) || Math.hypot(u.x - o.ox, u.y - o.oy) > AUTO_CHASE) { setOrder(u, null); return; }
  // tending a teammate's unit on its own initiative: drop it for one of our own who gets hurt nearby
  if (t.team !== u.team && !o.sent && (u.scan -= dt) <= 0) {
    u.scan = 0.4;
    const mine = woundedNear(u, unitDef(u).sight * TS, true);
    if (mine) { setOrder(u, { t: 'heal', tgt: mine.id, ox: o.ox, oy: o.oy, sent: false }); return; }
  }
  if (tend(u, t, dt) === null) setOrder(u, null);
}

/** Walk until `t` is within a Medic's reach, then heal it. Returns null if it can't be reached, false while walking. */
function tend(u: Ent, t: Ent, dt: number): boolean | null {
  // heals from a distance: stops as soon as the patient is within reach, rather than walking up to it
  const r = approach(u, t, MEDIC_REACH, dt);
  if (!r) return r;
  u.face = turnToward(u.face, Math.atan2(t.y - u.y, t.x - u.x), unitDef(u).turn * dt);
  u.atkT = 0.25; // tends from afar: drawn like an attack
  t.hp = Math.min(t.maxhp, t.hp + MEDIC_HEAL * mendRate(t) * dt);
  t.burnT = 0; // and beats out the flames
  // a soft green ray to the patient now and then, so you can see who is being healed
  // (an amber welding ray when it's repairing a machine)
  if (Math.random() < dt / 0.4) part('tracer', u.x, u.y - 8, { ex: t.x, ey: t.y - 6, ez: altOf(t), max: 0.3, col: unitDef(t).cls === 'vehicle' ? '#ffc861' : '#7dff9a', size: 2 });
  return true;
}

/** Patients Medics on the march are seeing to, and when each next looks round for one. */
const marchPatient = new WeakMap<Ent, { id: number | null; scan: number }>();

/**
 * A Medic walking somewhere (with the army, in formation or not) heals the wounded it passes
 * within reach without stopping, at its usual rate, and beats out their flames.
 */
function healOnTheMove(u: Ent, dt: number): void {
  let m = marchPatient.get(u);
  if (!m) { m = { id: null, scan: 0 }; marchPatient.set(u, m); }
  let t = m.id != null ? valid(m.id) : null;
  if (t && (!medicCanHeal(u, t) || (t.hp >= t.maxhp - 0.5 && !burning(t)) || Math.hypot(t.x - u.x, t.y - u.y) > MEDIC_REACH)) t = null;
  if ((m.scan -= dt) <= 0) {
    m.scan = 0.25;
    // one of our own who's hurt comes before the teammate it's patching up
    if (!t || t.team !== u.team) t = woundedNear(u, MEDIC_REACH, !!t) ?? t;
  }
  m.id = t ? t.id : null;
  if (!t) return;
  t.hp = Math.min(t.maxhp, t.hp + MEDIC_HEAL * mendRate(t) * dt);
  t.burnT = 0;
  if (Math.random() < dt / 0.4) part('tracer', u.x, u.y - 8, { ex: t.x, ey: t.y - 6, ez: altOf(t), max: 0.3, col: unitDef(t).cls === 'vehicle' ? '#ffc861' : '#7dff9a', size: 2 });
}

/**
 * A Medic on patrol: heals the wounded it comes across (anyone within sight), then walks on along
 * its beat. Returns true while it's busy with a patient.
 */
function medicOnPatrol(u: Ent, o: MoveOrder, dt: number): boolean {
  // back to the beat
  const resume = () => { o.sub = null; u.goal = [o.gx, o.gy]; u.path = pathFor(u, o.gx, o.gy); };
  let t = valid(o.sub);
  if (o.sub && (!t || !medicCanHeal(u, t) || t.hp >= t.maxhp - 0.5)) { t = null; resume(); }
  // patching up a teammate's unit: one of our own who's hurt nearby comes first
  if (t && t.team !== u.team && (u.scan -= dt) <= 0) {
    u.scan = 0.4;
    const mine = woundedNear(u, unitDef(u).sight * TS, true);
    if (mine) { t = mine; o.sub = mine.id; u.path = null; }
  }
  if (!t) {
    u.scan -= dt;
    if (u.scan > 0) return false;
    u.scan = 0.4;
    t = woundedNear(u, unitDef(u).sight * TS);
    if (!t) return false;
    o.sub = t.id;
    u.path = null;
  }
  if (tend(u, t, dt) === null) { resume(); return false; }
  return true;
}

/**
 * Something a Worker can mend: its side's site or damaged building (if the bank can pay), or a hurt
 * unit on the ground. Sent there (`ally`), it also works on a teammate's: lending a hand to rebuild.
 */
function mendable(u: Ent, t: Ent | null, slack = 0, ally = false): t is Ent {
  if (!t || t === u || t.dead || (ally ? !allied(t.team, u.team) : t.team !== u.team)) return false;
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
  for (const w of G.ents) if (w !== u && !w.dead && allied(w.team, t.team) && w.type === 'worker' && w.order?.t === 'heal' && w.order.tgt === t.id) n++;
  return n;
}

/** The nearest site or damaged building within a radius, else the most hurt unit there. */
function mendNear(u: Ent, r: number): Ent | null {
  let bld: Ent | null = null, bd = Infinity, unit: Ent | null = null;
  for (const e of G.ents) {
    if (!mendable(u, e, 0.5) || e.unpaid) continue; // a site still waiting for funds: keep gathering
    if (e.kind === 'unit' && e.hp > e.maxhp * UNIT_FIX_BELOW) continue; // not for a scratch
    if (e.kind === 'unit' && (e.moving || G.gameT - e.foeT < UNDER_FIRE)) continue; // not one on the move or under fire: that's chasing a fight
    const crew = menders(e, u);
    if (crew >= (e.kind === 'bld' && !e.done ? SITE_CREW : 1)) continue; // enough hands on it already
    // left to themselves, Workers don't spend the last of the bank on repairs
    if (e.kind === 'bld' && e.done && G.credits[u.team] < AUTO_REPAIR_FLOOR) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y) - (e.w ? (e.w * TS) / 2 : 0);
    if (d > r) continue;
    // a site the crew on it will have up before this one could get there
    if (e.kind === 'bld' && !e.done && crew && d / (unitDef(u).spd * TS) > ((1 - e.prog) * bldDef(e).t) / (WORKER_BUILD * crew)) continue;
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
  if (u.stance !== 'tend' || nearestThreat(u, Math.min(unitDef(u).sight, 7))) return false;
  const t = mendNear(u, TEND_RADIUS * TS);
  if (!t) return false;
  // a building it'll stay on however far; a wounded unit it gives up if it strays (it may be off fighting)
  setOrder(u, { t: 'heal', tgt: t.id, ox: u.x, oy: u.y, sent: t.kind === 'bld' });
  return true;
}

/** A Worker mending: helps a site go up, repairs a building (for ore), or patches up a unit. */
function updMend(u: Ent, o: HealOrder, dt: number): void {
  const t = valid(o.tgt);
  if (!mendable(u, t, 0, o.sent) || (!o.sent && Math.hypot(u.x - o.ox, u.y - o.oy) > AUTO_CHASE)) { setOrder(u, null); return; }
  // a Worker that went off by itself to patch up a soldier lets it go once it walks off: back to work
  if (!o.sent && u.type === 'worker' && t.kind === 'unit' && t.moving && Math.hypot(t.x - u.x, t.y - u.y) > MEDIC_RANGE + TS) { setOrder(u, null); return; }
  // a wall segment hemmed in by others can only be reached from a tile off its corner, so a Worker
  // builds and repairs from a little further off than it patches up a soldier
  const r = approach(u, t, t.kind === 'bld' ? MEDIC_RANGE + TS : MEDIC_RANGE, dt);
  if (r === null) { setOrder(u, null); return; }
  if (!r) return;
  u.face = turnToward(u.face, Math.atan2(t.y - u.y, t.x - u.x), unitDef(u).turn * dt);
  if (t.kind === 'bld' && t.unpaid) return; // waits at the site until the side can pay for it
  u.atkT = 0.25; // hammers away: drawn like an attack
  if (t.kind === 'bld' && !t.done) {
    advanceSite(t, ((lowPower(t.team) ? 0.5 : 1) * (leaderHandicap(t.team) ? LEADER_SPEED : 1) * aiPace(t.team) * WORKER_BUILD * dt) / bldDef(t).t);
    if (t.done) stayOnDerrick(u, t);
  }
  else if (t.kind === 'bld') { if (!mend(t, WORKER_REPAIR * dt)) setOrder(u, null); }
  else t.hp = Math.min(t.maxhp, t.hp + WORKER_HEAL * mendRate(t) * dt);
}

/** Machines (vehicles and cyborgs) are repaired more slowly than troops are healed. */
function mendRate(t: Ent): number {
  return t.kind === 'unit' && unitDef(t).cls === 'vehicle' ? MACHINE_REPAIR : 1;
}

/** An enemy wall the unit was ordered right onto, once it's within sight of it. */
function sentToWall(u: Ent, gx: number, gy: number, sight: number): Ent | null {
  const w = canBreach(u) ? enemyWallAt(u.team, gx, gy) : null;
  return w && Math.hypot(w.x - u.x, w.y - u.y) <= sight * TS ? w : null;
}

export function updUnit(u: Ent, dt: number): void {
  act(u, dt);
  // a jet can't hover: whenever it isn't flying anywhere it circles
  if (!u.moving && !u.dead && unitDef(u).jet && !frozen(u) && !stone(u)) cruise(u, dt);
}

/** The path and goal of a unit carrying Aether home (kept apart, so orders given meanwhile can't steer it), and when one that couldn't get there may try again. */
const homeWay = new WeakMap<Ent, { path: Tile[] | null; goal: Tile | null; home?: number }>();
const homeRetry = new WeakMap<Ent, number>();

/** Is this unit walking Aether home under Return Aether? A Worker sent to draw Aether fills up at its deposit first. */
function carryingHome(u: Ent): boolean {
  if (!wantsHome(u) || (homeRetry.get(u) ?? -1) > G.gameT) return false;
  return !(u.type === 'worker' && aetherJobOf(u) && (u.ae ?? 0) < AETHER_CARRY - 0.5);
}

/**
 * Return Aether: a unit carrying Aether walks it straight home to bank, ignoring orders (the last
 * one waits, and it carries on with it once the Aether is banked). An armed unit shoots what it
 * passes but doesn't stop. Returns true while it's doing that.
 */
function aetherHome(u: Ent, dt: number): boolean {
  const home = carryingHome(u) ? dropAt(u, AETHER_BANKS) : null;
  if (!home) {
    if (u.aeRun) {
      // banked (or switched off): back to its orders, with a fresh path
      u.aeRun = false;
      homeWay.delete(u);
      u.shot = null;
      u.scan = 0;
      const o = u.order;
      if (o?.t === 'move' && !o.sub) { u.goal = [o.gx, o.gy]; u.path = pathFor(u, o.gx, o.gy); } else { u.path = null; u.goal = null; }
    }
    return false;
  }
  const near = edgeDist(u, home) <= AETHER_BANK_REACH * TS * 0.8;
  let way = homeWay.get(u);
  if (!u.aeRun || !way || way.home !== home.id) {
    u.aeRun = true;
    u.goal = null;
    const path = near ? [] : pathTo(u, home) ?? [];
    way = { path, goal: u.goal, home: home.id };
    homeWay.set(u, way);
  }
  u.path = way.path;
  u.goal = way.goal;
  if (u.path?.length) followPath(u, dt);
  way.path = u.path;
  if (!u.path?.length && edgeDist(u, home) > AETHER_BANK_REACH * TS * 0.8) {
    // no way home from here: take orders again for a while
    homeRetry.set(u, G.gameT + AETHER_RETURN_RETRY);
    return aetherHome(u, dt);
  }
  const d = unitDef(u);
  if (d.weapon && !isHarvester(u) && !d.deploy) fireOnTheMove(u, dt);
  return true;
}

function act(u: Ent, dt: number): void {
  const d = unitDef(u);
  regen(u, dt);
  u.cd = Math.max(0, u.cd - dt * reloadRate(u));
  u.flash = Math.max(0, u.flash - dt);
  u.atkT = Math.max(0, u.atkT - dt);
  // a gun that must dig in counts the time it has stood still (moving is still last tick's here)
  if (d.deploy) u.setT = u.moving ? 0 : (u.setT ?? 0) + dt;
  u.moving = false;
  tickStatus(u, dt);
  if (u.dead) return;
  if (frozen(u)) return; // locked in ice: no moving, turning, fighting or casting
  if (stone(u)) return; // turned to stone by a Medusa: frozen until it wears off
  if (d.spells) updCaster(u, dt);
  unstick(u, dt);
  // vehicle turrets drift back to the hull's heading when idle
  if (d.turret && u.atkT <= 0 && u.order?.t !== 'attack' && !u.shot) u.tface = turnToward(u.tface, u.face, 2 * dt);
  if (u.bee) { updBee(u, dt); return; } // one of a Bee Queen's swarm: it stings what she fights
  if (d.swarm) callSwarm(u); // a Bee Queen in a fight calls up her Bees
  if (u.wing != null) { updHornet(u, dt); return; } // flown off a Sky Battleship: it fights what the Carrier fights
  if (d.hangar) updCarrier(u, dt); // a Sky Battleship launches, recalls and rebuilds its Hornets
  if (u.wild) { updWild(u, dt); return; } // guards its lair (data/creatures.ts)
  if (u.demon) { updDemon(u, dt); return; } // lurks by the Gate of Hell, or raids the leader (data/hell.ts)
  if (aetherHome(u, dt)) return; // Return Aether: banking comes before orders
  const o = u.order;
  // told to stay still when attacked, an idle fighter stands its ground and shoots only what's in range
  // (a jet can't stand anywhere: it always flies its attack runs, so it never holds like this)
  const jet = isJet(u), still = !o && !jet && reactOf(u) === 'hold' && !!d.weapon && !isHarvester(u) && (u.stance === 'skirmish' || u.stance === 'engage');
  if (u.stance !== 'skirmish' && !still) u.shot = null;
  if (!o) {
    if (still) { fireOnTheMove(u, dt); return; }
    // a skirmisher shoots what's in range from where it stands; with nothing in range it goes after
    // enemies it can see and fights back like any other, so idle troops aren't picked off from afar
    // (not a jet: circling, it seldom faces what it's locked on to, and has to make attack runs)
    if (u.stance === 'skirmish' && d.weapon && !isHarvester(u) && !jet) { fireOnTheMove(u, dt); if (u.shot) return; }
    if (busy.delete(u)) u.scan = 0; // just finished something: look for the next thing straight away
    u.scan -= dt;
    if (u.scan > 0) return;
    u.scan = 0.3 + Math.random() * 0.2;
    // a Worker or Harvester on Evade runs from an enemy closing in, and after running waits where it's
    // safe until the enemy is gone from it and from the job it left (game/evade.ts)
    if (evades(u)) {
      const t = attacker(u) ?? threatNear(u);
      if (t) { evade(u, t); return; }
      if (hasFled(u)) {
        // its old job still has the enemy at it after a good wait: let it go and find other work
        // (a job the player gave it, it keeps waiting for; the computer's Workers move on)
        const job = peekResume(u);
        if (fledFor(u) > EVADE_GIVE_UP && (job?.auto || !G.human[u.team]) && !safeToWork(u, job) && safeToWork(u, null)) takeResume(u);
        else if (!safeToWork(u, peekResume(u))) { u.scan = 0.5; return; }
        doneFleeing(u);
      }
    }
    if (u.type === 'medic') {
      const t = woundedNear(u, d.sight * TS);
      if (t) { setOrder(u, { t: 'heal', tgt: t.id, ox: u.x, oy: u.y, sent: false }); return; }
    }
    // a Worker sent to draw Aether stands at its deposit until it carries a full load, banks it, and goes back;
    // Aether dropped by the fallen nearby is quicker to take than drawing, so it fetches that first
    let ae = u.type === 'worker' ? aetherJobOf(u) : null;
    // a dry deposit, or one another of the side's Workers is already drawing from (a deposit gives
    // to one at a time): gather something else instead of queueing there
    if (ae) { const dep = ae; if (dep.hp < AETHER_DRY || G.ents.some((w) => w !== u && !w.dead && w.team === u.team && aetherJobOf(w) === dep && Math.hypot(w.x - dep.x, w.y - dep.y) < Math.hypot(u.x - dep.x, u.y - dep.y))) { forgetAether(u); ae = null; } }
    if (ae && (u.ae ?? 0) < AETHER_CARRY - 0.5) {
      const s = shardFor(u, SHARD_PULL);
      if (s) { fetching.add(u); orderMove(u, tileOf(s.x), tileOf(s.y)); return; }
      if (Math.hypot(u.x - ae.x, u.y - ae.y) > AETHER_REACH * TS * 0.8) { const t = adjTile(ae, u, false); if (t) { orderMove(u, t[0], t[1]); return; } }
      else return; // drawing
    }
    // an idle Worker fetches dropped Aether nearby, and takes what it carries home to bank
    if (u.type === 'worker' && (u.stance !== 'passive' || !nearestThreat(u, Math.min(d.sight, 7)))) {
      const s = shardFor(u, SHARD_PULL); // dropped Aether comes before anything else
      if (s) { orderMove(u, tileOf(s.x), tileOf(s.y)); return; }
      const home = u.ae ? dropAt(u, AETHER_BANKS) : null;
      if (home && edgeDist(u, home) > AETHER_BANK_REACH * TS * 0.8) { const t = adjTile(home, u, false); if (t) { orderMove(u, t[0], t[1]); return; } }
    }
    // fix, then harvest: an idle Worker first builds, repairs and patches up whatever needs it nearby
    // (a passive one only when no enemy is about), and only then goes back to gathering
    if (u.type === 'worker' && fixNext(u)) return;
    // a Worker only fights back, or an enemy that comes right up to it
    const foe = u.stance === 'passive' || u.stance === 'tend' || !d.weapon ? null : isHarvester(u) ? attacker(u) ?? acquire(u, 2) : attacker(u) ?? acquire(u, lookRange(u));
    // an evader that was just hit keeps away from whoever hit it rather than taking it on
    const hitter = reactOf(u) === 'evade' ? attacker(u) : null;
    if (hitter && !isHarvester(u)) { orderFlee(u, hitter); return; }
    // a passive unit set to evade runs from enemies, but a gatherer sticks to its work with them about
    const threat = u.stance === 'passive' && reactOf(u) === 'evade' && !isHarvester(u) ? nearestThreat(u, Math.min(d.sight, 7)) : null;
    if (threat) orderFlee(u, threat);
    else if (u.stance === 'passive' && !isHarvester(u)) { /* nothing to do */ } else if (foe) {
      setOrder(u, { t: 'attack', tgt: foe.id, auto: true, ox: u.x, oy: u.y });
    } else if (isHarvester(u)) {
      // nothing left to fix: after a moment's pause, go and gather what the side needs most
      // only a Worker the player just walked somewhere pauses first (they may have plans for it)
      const since = idleSince.get(u), grace = lastOrder.get(u) === 'move' && !fetching.has(u) ? IDLE_GRACE : 0;
      fetching.delete(u);
      if (since === undefined && grace > 0) idleSince.set(u, G.gameT);
      else if (G.gameT - (since ?? G.gameT) >= grace) {
        u.scan = 1.5;
        idleSince.delete(u);
        lastOrder.delete(u);
        const job = takeResume(u);
        // back to what it was doing before it stopped to fix something, banking any load first
        if (job) setOrder(u, { ...job, st: u.carry > 0 && ((u.cargo ?? 'ore') !== (job.res ?? 'ore') || u.carry > loadOf(u) * 0.5) ? 'ret' : 'go', wait: 0 });
        else if (u.carry > loadOf(u) * 0.5) setOrder(u, { t: 'harvest', st: 'ret', tx: tileOf(u.x), ty: tileOf(u.y), wait: 0, res: u.cargo === 'wood' || u.cargo === 'oil' ? u.cargo : undefined });
        else autoGather(u);
      }
    }
    return;
  }
  idleSince.delete(u);
  // a gatherer at work looks up now and then: an enemy closing in sends it running (game/evade.ts)
  if (isHarvester(u) && G.gameT >= (lookT.get(u) ?? 0)) { lookT.set(u, G.gameT + 0.3); if (watchOut(u)) return; }
  lastOrder.set(u, o.t);
  busy.add(u);
  switch (o.t) {
    case 'move': {
      if (u.stance === 'skirmish' && d.weapon && !o.flee) {
        // keep going and shoot along the way; only an enemy wall it must get through stops it
        const wall = valid(o.sub);
        if (wall) { if (!combatStep(u, wall, dt)) { o.sub = null; u.path = null; } break; }
        if (o.sub) { o.sub = null; u.path = null; }
        if (!u.path) { u.goal = [o.gx, o.gy]; u.path = pathFor(u, o.gx, o.gy); }
        if (followPath(u, dt)) {
          const short = Math.hypot(u.x - (o.gx + 0.5) * TS, u.y - (o.gy + 0.5) * TS) > 1.5 * TS;
          const w = sentToWall(u, o.gx, o.gy, d.sight) ?? (short && canBreach(u) ? wallInWay(u, o.gx, o.gy) : null);
          if (w) { o.sub = w.id; u.path = null; } else arrive(u);
        }
        fireOnTheMove(u, dt);
        break;
      }
      if (u.stance === 'passive' || u.stance === 'tend' || !d.weapon || o.flee) {
        if (u.type === 'medic' && o.pat && medicOnPatrol(u, o, dt)) break;
        // keep going (a Medic heals whoever it passes on the way)
        if (followPath(u, dt)) arrive(u);
        if (u.type === 'medic' && u.order === o) healOnTheMove(u, dt);
        break;
      }
      // engage: stop to fight anything met on the way, then carry on. Set to Stay still when attacked,
      // it only stops for what it can hit from where it is, and never steps off its way to chase
      const hold = reactOf(u) === 'hold', reach = (e: Ent | null) => !hold || !e || isWall(e.type) || edgeDist(u, e) <= weaponReach(u);
      let t = valid(o.sub);
      if (t && !reach(t)) { t = null; o.sub = null; u.path = null; }
      if (!t && o.sub) { o.sub = null; u.path = null; u.scan = 0; } // it fell: look for the next one now
      u.scan -= dt;
      if (u.scan <= 0) {
        u.scan = 0.3;
        // fight back against whoever is attacking first, and armed enemies before buildings; a wall
        // only if it was sent to one, once it's close
        const look = hold ? weaponReach(u) / TS : lookRange(u), atk = attacker(u);
        const b = t ? betterTarget(u, t, look) : (reach(atk) ? atk : null) ?? acquire(u, look) ?? sentToWall(u, o.gx, o.gy, d.sight);
        if (b && reach(b)) { t = b; o.sub = b.id; u.path = null; }
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
      // a target the player picked is kept unless something hits back (then it's taken up again after);
      // one the unit found itself gives way to a better one
      if (t && u.scan <= 0) {
        u.scan = 0.3;
        const b = betterTarget(u, t, lookRange(u), !o.auto);
        if (b) { if (!o.auto && o.pick === undefined) o.pick = t.id; t = b; o.tgt = b.id; u.path = null; }
      }
      if (t && !o.auto && o.pick === undefined) { o.lx = t.x; o.ly = t.y; }
      const strayed = o.auto && Math.hypot(u.x - o.ox, u.y - o.oy) > AUTO_CHASE;
      const gaveUp = !t || strayed || !combatStep(u, t, dt);
      if (gaveUp) {
        // chased it too far: let it go for good, rather than taking it up again from here and chasing on
        if (strayed && t && u.foe === t.id) u.foe = null;
        // couldn't get at it at all: leave it be for a while rather than taking it straight up again
        else if (t && !strayed && !t.dead && isFoe(u, t)) cantReachFoe(u, t);
        // dealt with whatever got in the way: back to the target the player picked
        const back = o.pick !== undefined ? valid(o.pick) : null;
        if (back && back !== t && isFoe(u, back) && canAttack(u, back)) { o.tgt = back.id; o.pick = undefined; u.path = null; u.scan = 0; break; }
        u.order = null; u.path = null; u.scan = 0;
        // the enemy you sent it after is gone (killed, or out of sight): don't stop dead in the field
        if (!t && !o.auto) regroup(u, o);
      }
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
