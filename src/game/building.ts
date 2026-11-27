// Building behaviour (rising, repair, turrets, effects) and placement rules.
import { G, say, tileOf, bldDef, isAir, type Ent, type Point, type Tile } from './state.ts';
import { noteBuilt } from './stats.ts';
import { MW, MH, TS, GRASS } from './const.ts';
import { oilNear } from './economy.ts';
import { DERRICK_REACH } from '../data/economy.ts';
import { BUILDING, BUILD_RADIUS, EXPAND_GAP, REPAIR_RATE, REPAIR_SHARE, SCRAP_SHARE, WALL_LINE_MAX, WALL_RADIUS, isExpansion, isWall, type BldType } from '../data/building.ts';
import { ERA } from '../data/era.ts';
import { UNIT } from '../data/unit.ts';
import { addBuilding, addUnit, kill, lowPower } from './entity.ts';
import { updRefit } from './refit.ts';
import { burst } from './fx.ts';
import { nearestFree } from './path.ts';
import { nearPortal } from './map.ts';
import { updTurret } from './combat.ts';
import { orderHarvest } from './order.ts';
import { joinRally } from './rally.ts';

/** A new site starts with this share of its hit points and gains the rest as it goes up. */
export const SITE_HP = 0.1;

/** Free tile next to a building, nearest to `toward` (default: below the building, where doors are). */
export function exitTile(b: Ent, toward?: Point): Tile {
  // without a rally point, units leave on the side facing the middle of the map, so no corner's
  // troops start out walking toward the map edge
  const rx = toward ? toward.x : (MW * TS) / 2, ry = toward ? toward.y : (MH * TS) / 2;
  let best: Tile | null = null, bd = 1e9;
  for (let y = b.ty - 1; y <= b.ty + b.h; y++)
    for (let x = b.tx - 1; x <= b.tx + b.w; x++) {
      if (x >= b.tx && x < b.tx + b.w && y >= b.ty && y < b.ty + b.h) continue;
      if (x < 0 || y < 0 || x >= MW || y >= MH || G.blk[y * MW + x]) continue;
      const d = Math.hypot((x + 0.5) * TS - rx, (y + 0.5) * TS - ry);
      if (d < bd) { bd = d; best = [x, y]; }
    }
  return best ?? nearestFree(b.tx + 1, b.ty + 1, 14) ?? [b.tx, b.ty + b.h];
}

function completed(b: Ent): void {
  burst('dust', b.x, b.y + (b.h * TS) / 2, 14, 40, 100);
  if (!G.visualOnly) say(b.team, `${bldDef(b).name} complete`);
  if (!G.visualOnly) joinRally(b);
  noteBuilt(b);
  const to = bldDef(b).opens;
  if (to != null && !G.visualOnly && (G.era[b.team] ?? 0) < to) say(b.team, `${ERA[to].name} age can be researched at the Town Hall`);
  if (b.type !== 'refinery') return;
  // every refinery comes with two Workers, or a Harvester in the Modern age
  const modern = (G.era[b.team] ?? 0) >= UNIT.harvester.era;
  for (let i = 0; i < (modern ? 1 : 2); i++) {
    const [x, y] = exitTile(b), u = addUnit(modern ? 'harvester' : 'worker', b.team, (x + 0.5 + i * 0.4) * TS, (y + 0.5) * TS);
    orderHarvest(u, x, y);
  }
}

function effects(b: Ent, dt: number): void {
  if (G.vis[tileOf(b.y) * MW + tileOf(b.x)] !== 2) return;
  // damaged buildings smoke and burn: drawn by the view (render3d/burn3d.ts)
  // power plant steam is drawn by the view, from the tops of its towers (render3d/burn3d.ts)
  if (b.repairing && Math.random() < dt * 4) burst('spark', b.x + (Math.random() - 0.5) * b.w * TS * 0.6, b.y - 10, 3, 40, 100);
}

function repair(b: Ent, dt: number): void {
  if (!b.repairing) return;
  if (b.hp >= b.maxhp) { b.repairing = false; return; }
  mend(b, REPAIR_RATE * dt);
}

/** Restore up to `hp` hit points to a finished building, paying ore for it. False if the bank can't. */
export function mend(b: Ent, hp: number): boolean {
  const amt = Math.min(hp, b.maxhp - b.hp), cost = (amt * bldDef(b).cost * REPAIR_SHARE) / b.maxhp;
  if (G.credits[b.team] < cost) return false;
  G.credits[b.team] -= cost;
  b.hp += amt;
  return true;
}

/**
 * Move a site along by a share of its whole build, gaining hit points as it goes up. Only Workers
 * build (unit.ts); any number of sites can rise at once.
 */
export function advanceSite(b: Ent, share: number): void {
  if (b.done || b.dead || b.unpaid) return;
  const step = Math.min(share, 1 - b.prog);
  b.prog += step;
  b.hp = Math.min(b.maxhp, b.hp + b.maxhp * (1 - SITE_HP) * step);
  if (b.prog >= 1 - 1e-9) { b.prog = 1; b.done = true; completed(b); }
}

export function updBld(b: Ent, dt: number): void {
  b.flash = Math.max(0, b.flash - dt);
  b.atkT = Math.max(0, b.atkT - dt);
  if (!b.done) return; // waits for Workers to build it
  effects(b, dt);
  repair(b, dt);
  if (b.upT != null) updRefit(b, dt, lowPower(b.team));
  updTurret(b, dt);
}

/**
 * Can a structure go on this tile? People can only build on ground they've explored. Units standing
 * there don't count (Alex): they step aside when the site goes down (clearSite).
 */
export function tileFree(x: number, y: number, team: number): boolean {
  if (x < 0 || y < 0 || x >= MW || y >= MH) return false;
  const i = y * MW + x;
  return !G.blk[i] && G.terr[i] === GRASS && !(G.human[team] && !G.reveal && G.sight[team][i] === 0);
}

/** Move any ground unit standing on a new site's footprint to the nearest open tile beside it. */
function clearSite(b: Ent): void {
  for (const u of G.ents) {
    if (u.dead || u.kind !== 'unit' || isAir(u)) continue;
    const x = tileOf(u.x), y = tileOf(u.y);
    if (x < b.tx || y < b.ty || x >= b.tx + b.w || y >= b.ty + b.h) continue;
    const to = nearestFree(x, y);
    if (!to) continue;
    // keep where it stood within its tile, so a crowd doesn't land on one spot
    u.x = to[0] * TS + (u.x - x * TS);
    u.y = to[1] * TS + (u.y - y * TS);
  }
}

/**
 * Structures must be placed within BUILD_RADIUS tiles of one of the team's buildings; walls within
 * WALL_RADIUS. Walls never count as base themselves, so they can't be chained across the map.
 */
export function nearBase(tx: number, ty: number, s: number, team: number, wall = false): boolean {
  const R = wall ? WALL_RADIUS : BUILD_RADIUS;
  return G.ents.some((e) => !e.dead && e.team === team && e.kind === 'bld' && !isWall(e.type) &&
    tx < e.tx + e.w + R && tx + s > e.tx - R && ty < e.ty + e.h + R && ty + s > e.ty - R);
}

/**
 * The tiles of a wall dragged from one tile to another: a straight run along the nearer of the
 * eight directions (so diagonals work too), at most WALL_LINE_MAX segments.
 */
export function wallLine(x0: number, y0: number, x1: number, y1: number): Tile[] {
  const dx = x1 - x0, dy = y1 - y0, ax = Math.abs(dx), ay = Math.abs(dy);
  // snap to a straight or 45-degree line
  const sx = ax >= ay * 0.5 ? Math.sign(dx) : 0, sy = ay >= ax * 0.5 ? Math.sign(dy) : 0;
  const n = Math.min(WALL_LINE_MAX - 1, sx && sy ? Math.max(ax, ay) : sx ? ax : ay);
  const out: Tile[] = [];
  for (let i = 0; i <= n; i++) out.push([x0 + sx * i, y0 + sy * i]);
  return out;
}

/** Oil Derricks go on an oil well, wherever it is: the well, not the base, decides where. */
export const onWell = (type: BldType): boolean => type === 'derrick';

/**
 * Where a structure may go: 'base' near the side's buildings, 'well' on an oil well, 'far' (a Town
 * Hall or Resource Drop, see EXPANSION) anywhere explored that isn't up against an enemy base.
 */
export type Reach = 'base' | 'well' | 'far';
export const reachOf = (type: BldType): Reach => (onWell(type) ? 'well' : isExpansion(type) ? 'far' : 'base');

/** No enemy structure within R (default EXPAND_GAP) tiles of this footprint. */
export function clearOfFoes(tx: number, ty: number, s: number, team: number, R = EXPAND_GAP): boolean {
  return !G.ents.some((e) => !e.dead && e.kind === 'bld' && e.team >= 0 && e.team !== team && !isWall(e.type) &&
    tx < e.tx + e.w + R && tx + s > e.tx - R && ty < e.ty + e.h + R && ty + s > e.ty - R);
}

/**
 * Is a site here close enough to build? Most structures must be near the base (nearBase). An Oil
 * Derrick instead must reach oil, and may stand on any well, however far from home; a new Town Hall
 * or Resource Drop may go anywhere away from the enemy (the explored-ground check is tileFree's).
 */
export function inReach(tx: number, ty: number, s: number, team: number, wall = false, reach: Reach | boolean = 'base'): boolean {
  const r = reach === true ? 'well' : reach === false ? 'base' : reach;
  if (r === 'well') return oilNear(tx, ty, s) > 0;
  if (r === 'far') return nearBase(tx, ty, s, team) || clearOfFoes(tx, ty, s, team);
  return nearBase(tx, ty, s, team, wall);
}

/**
 * The ground where a structure of this type may go, for drawing while it's being placed. Fills
 * `out` (MW * MH) with 0 (out of reach or unexplored), 1 (in reach, but the tile itself can't be
 * built on) or 2 (in reach and open). A site is allowed when its footprint touches the zone
 * (nearBase / inReach) and every tile under it is open.
 */
export function buildZone(type: BldType, team: number, out: Uint8Array): Uint8Array {
  out.fill(0);
  const seen = (i: number) => !G.human[team] || G.reveal || G.sight[team][i] !== 0;
  const stamp = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y < Math.min(MH, y1); y++) for (let x = Math.max(0, x0); x < Math.min(MW, x1); x++) out[y * MW + x] = 1;
  };
  if (onWell(type)) {
    // any tile that reaches a well (DERRICK_REACH) counts, as oilNear sees it
    for (let i = 0; i < MW * MH; i++) if (G.oilField[i] > 0) { const x = i % MW, y = (i / MW) | 0; stamp(x - DERRICK_REACH, y - DERRICK_REACH, x + 1 + DERRICK_REACH, y + 1 + DERRICK_REACH); }
  } else {
    if (isExpansion(type)) {
      // a new Town Hall or Resource Drop: anywhere but up against an enemy base
      stamp(0, 0, MW, MH);
      for (const e of G.ents) {
        if (e.dead || e.kind !== 'bld' || e.team < 0 || e.team === team || isWall(e.type)) continue;
        for (let y = Math.max(0, e.ty - EXPAND_GAP); y < Math.min(MH, e.ty + e.h + EXPAND_GAP); y++)
          for (let x = Math.max(0, e.tx - EXPAND_GAP); x < Math.min(MW, e.tx + e.w + EXPAND_GAP); x++) out[y * MW + x] = 0;
      }
    }
    const R = isWall(type) ? WALL_RADIUS : BUILD_RADIUS;
    for (const e of G.ents) if (!e.dead && e.team === team && e.kind === 'bld' && !isWall(e.type)) stamp(e.tx - R, e.ty - R, e.tx + e.w + R, e.ty + e.h + R);
  }
  for (let i = 0; i < MW * MH; i++) {
    if (!out[i]) continue;
    if (!seen(i)) { out[i] = 0; continue; }
    if (!G.blk[i] && G.terr[i] === GRASS && !nearPortal(i % MW, (i / MW) | 0)) out[i] = 2;
  }
  return out;
}

/** Can this type of structure go here? */
export const canPlaceType = (type: BldType, tx: number, ty: number, team: number, margin = false): boolean =>
  canPlace(tx, ty, BUILDING[type].size, team, margin, isWall(type), reachOf(type));

/** With margin, keeps a one-tile lane free around other buildings (used by the computer player). */
export function canPlace(tx: number, ty: number, s: number, team: number, margin = false, wall = false, reach: Reach | boolean = 'base'): boolean {
  if (tx < 0 || ty < 0 || tx + s > MW || ty + s > MH || !inReach(tx, ty, s, team, wall, reach)) return false;
  for (let y = ty; y < ty + s; y++) for (let x = tx; x < tx + s; x++) if (!tileFree(x, y, team) || nearPortal(x, y)) return false;
  if (margin)
    for (let y = ty - 1; y <= ty + s; y++)
      for (let x = tx - 1; x <= tx + s; x++) {
        if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
        const i = y * MW + x;
        if (G.blk[i] && G.terr[i] === GRASS) return false;
      }
  return true;
}

/** Lay out a construction site (the caller has checked and paid for it). */
export function placeBuilding(team: number, type: BldType, tx: number, ty: number, quiet = false): Ent | null {
  if (!canPlaceType(type, tx, ty, team)) { if (!quiet) say(team, onWell(type) ? 'Build it on an oil well' : isExpansion(type) ? 'Too close to the enemy' : 'Cannot place there'); return null; }
  for (let y = ty; y < ty + BUILDING[type].size; y++) for (let x = tx; x < tx + BUILDING[type].size; x++) G.ore[y * MW + x] = 0;
  const b = addBuilding(type, team, tx, ty, true);
  b.hp = b.maxhp * SITE_HP;
  clearSite(b);
  return b;
}

/** Call off a site that isn't finished: its whole price comes back (nothing, if it was still waiting to be paid for). */
export function cancelSite(b: Ent): void {
  if (b.dead || b.kind !== 'bld' || b.done) return;
  const d = bldDef(b);
  if (b.unpaid) { burst('dust', b.x, b.y, 12, 30, 90); kill(b); return; }
  G.credits[b.team] += d.cost;
  G.wood[b.team] += d.wood ?? 0;
  G.oil[b.team] += d.oil ?? 0;
  if (d.aether) G.aether[b.team] = (G.aether[b.team] ?? 0) + d.aether;
  burst('dust', b.x, b.y, 12, 30, 90);
  kill(b);
}

/**
 * Tear a building down and get part of its price back, straight into the bank: SCRAP_SHARE of
 * each resource it cost, times its remaining health. A derrick's tank of oil comes back too.
 */
export function scrap(b: Ent): void {
  if (b.dead || b.kind !== 'bld' || (b.type === 'yard' && !extraHall(b))) return;
  if (!b.done) { cancelSite(b); return; }
  const back = scrapRefund(b);
  G.credits[b.team] += back.ore;
  G.wood[b.team] += back.wood;
  G.oil[b.team] += back.oil;
  if (back.aether) G.aether[b.team] = (G.aether[b.team] ?? 0) + back.aether;
  burst('dust', b.x, b.y, 20, 40, 120);
  kill(b);
}

/** What scrapping this building pays back right now. */
export function scrapRefund(b: Ent): { ore: number; wood: number; oil: number; aether: number } {
  const d = bldDef(b), k = SCRAP_SHARE * Math.max(0, b.hp / b.maxhp);
  return {
    ore: Math.round(d.cost * k),
    wood: Math.round((d.wood ?? 0) * k),
    oil: Math.round((d.oil ?? 0) * k + (b.type === 'derrick' ? b.carry : 0)),
    aether: Math.round((d.aether ?? 0) * k),
  };
}

/** A Town Hall the side could lose and keep another: only extra ones can be scrapped. */
export const extraHall = (b: Ent): boolean =>
  G.ents.some((e) => e !== b && !e.dead && e.team === b.team && e.type === 'yard' && e.done);

export function toggleRepair(b: Ent): void {
  if (b.kind === 'bld' && b.done && b.hp < b.maxhp) b.repairing = !b.repairing;
}
