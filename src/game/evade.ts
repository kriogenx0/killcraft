// Gatherers keeping out of harm's way (Alex, 2026-11-27): a Worker or Harvester set to Evade (their
// default) that is hit, or sees an armed enemy close in, drops its work and runs for safety (the
// nearest Town Hall, Resource Drop, defense tower or friendly troops away from the threat), waits
// there till the enemy is gone, then takes its job up again. Orders the player gave come first: a unit
// walked somewhere, or sent to build or fix something, keeps at it. The computer's Workers run too.
import { G, allied, bldDef, isHarvester, reactOf, unitDef, valid, type Ent, type HarvestOrder, type Tile } from './state.ts';
import { MH, MW, TS } from './const.ts';
import { canAttack, isFoe } from './combat.ts';
import { cloakedFrom } from './aether.ts';
import { adjTile, nearestFree } from './path.ts';
import { orderMove, setOrder } from './order.ts';
import { fetching, keepResume, peekResume } from './autogather.ts';

/** An armed enemy this close (tiles) sends a gatherer running. */
export const EVADE_NEAR = 5;
/** A wild creature or a demon by its lair or gate only counts this close (tiles); they stay put. */
const LURK_NEAR = 3;
/** Back to work only once no threat is within this (tiles) of the gatherer or its job. */
export const EVADE_CLEAR = 8;
/** A safe place must be at least this far (tiles) from the threat. */
const SAFE_GAP = 7;
/** Buildings a gatherer runs to: drop-offs and the side's guns. */
const HAVENS = new Set(['yard', 'refinery', 'camp']);

/** Gatherers this rule covers: Workers and Harvesters on Evade (their default). */
export const evades = (u: Ent): boolean => u.kind === 'unit' && isHarvester(u) && reactOf(u) === 'evade' && !u.wild && !u.demon;

/** Is this enemy a danger to the unit: armed, able to hurt it, seen, and fair game? */
function danger(u: Ent, e: Ent): boolean {
  return e.kind === 'unit' && !e.dead && !!unitDef(e).weapon && isFoe(u, e) && canAttack(e, u) && !cloakedFrom(e, u.team) && !isHarvester(e);
}

/** Going after this unit: it has picked it as its target. */
const huntedBy = (u: Ent, e: Ent): boolean => (e.order?.t === 'attack' && e.order.tgt === u.id) || e.shot === u.id;

/**
 * The nearest enemy closing in on the gatherer at (x, y) (default: where it stands), within `tiles`.
 * Looking at a spot it's not at yet, a wild creature or demon keeping to its lair or gate doesn't count.
 */
export function threatNear(u: Ent, tiles = EVADE_NEAR, x = u.x, y = u.y): Ent | null {
  const there = x !== u.x || y !== u.y;
  let best: Ent | null = null, bd = Infinity;
  for (const e of G.ents) {
    if (e.kind !== 'unit' || e.dead || allied(u.team, e.team) || (there && (e.wild || e.demon) && !huntedBy(u, e))) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    // an enemy that's after this very unit counts from further off
    const reach = (e.wild || e.demon) && !huntedBy(u, e) ? Math.min(tiles, LURK_NEAR) : huntedBy(u, e) ? tiles + 3 : tiles;
    if (d >= reach * TS || d >= bd || !danger(u, e)) continue;
    bd = d;
    best = e;
  }
  return best;
}

/**
 * The nearest safe place to run to from `threat`: a drop-off, a finished defense tower or a few
 * friendly fighters, well clear of the threat and not past it. Null if there's none.
 */
export function havenFrom(u: Ent, threat: { x: number; y: number }): Tile | null {
  const ud = Math.hypot(u.x - threat.x, u.y - threat.y);
  let best: Tile | null = null, bd = Infinity;
  const consider = (x: number, y: number, tile: () => Tile | null) => {
    const td = Math.hypot(x - threat.x, y - threat.y), d = Math.hypot(x - u.x, y - u.y);
    // clear of the threat, further from it than the gatherer is now, and not a run straight past it
    if (td < SAFE_GAP * TS || td < ud + TS || d >= bd) return;
    const ax = x - u.x, ay = y - u.y, bx = threat.x - u.x, by = threat.y - u.y;
    if (d > 2 * TS && (ax * bx + ay * by) / (d * (ud || 1)) > 0.5) return;
    const t = tile();
    if (!t) return;
    bd = d;
    best = t;
  };
  for (const e of G.ents) {
    if (e.dead || !allied(e.team, u.team) || e === u) continue;
    if (e.kind === 'bld') {
      // a drop-off, or a finished gun tower that guards whoever stands by it
      if (!e.done || !(HAVENS.has(e.type) || bldDef(e).weapon)) continue;
      consider(e.x, e.y, () => adjTile(e, u, false));
    } else if (e.kind === 'unit' && unitDef(e).weapon && !isHarvester(e) && !e.wild && !e.demon) {
      // friendly fighters: worth running to only where a few stand together
      let n = 0;
      for (const f of G.ents) if (f.kind === 'unit' && !f.dead && allied(f.team, u.team) && unitDef(f).weapon && !isHarvester(f) && Math.hypot(f.x - e.x, f.y - e.y) < 3 * TS) n++;
      if (n >= 3) consider(e.x, e.y, () => { const tx = Math.floor(e.x / TS), ty = Math.floor(e.y / TS); return G.blk[ty * MW + tx] ? nearestFree(tx, ty, 3) : [tx, ty]; });
    }
  }
  return best;
}

/** The job each gatherer dropped to run, and what it ran from, to take up again once it's safe. */
const fled = new WeakMap<Ent, { id: number; t: number }>();
export const hasFled = (u: Ent): boolean => fled.has(u);
export const doneFleeing = (u: Ent): void => { fled.delete(u); };
/** Whatever it ran from, if that's still about. */
export const fledFrom = (u: Ent): Ent | null => valid(fled.get(u)?.id ?? null);
/** How long (s) since it last had to run. */
export const fledFor = (u: Ent): number => G.gameT - (fled.get(u)?.t ?? G.gameT);
/** Waiting longer than this (s) for its old job to clear, a gatherer finds other work instead. */
export const EVADE_GIVE_UP = 20;

/** Can the gatherer drop what it's doing to run? Its own work yes; an order the player gave, no. */
export function mayRun(u: Ent): boolean {
  const o = u.order;
  if (!o) return true;
  if (o.t === 'harvest') return true;
  if (o.t === 'attack') return o.auto;
  if (o.t === 'heal') return !o.sent || !G.human[u.team]; // a computer's builders run too
  if (o.t === 'move') return !!o.flee || fetching.has(u);
  return false;
}

/** How far (tiles) a gatherer with nowhere safe to go runs from a threat. */
const RUN_DIST = 6;

/**
 * Nowhere safe to go: run the way that ends furthest from the threat, along a wall or round a corner
 * if straight away is the map's edge. Backed into a corner with nowhere better, it stays put.
 */
function runFrom(u: Ent, threat: { x: number; y: number }): void {
  const ux = Math.floor(u.x / TS), uy = Math.floor(u.y / TS), base = Math.atan2(u.y - threat.y, u.x - threat.x);
  let best: Tile | null = null, bs = Math.hypot(u.x - threat.x, u.y - threat.y) + TS;
  for (let i = 0; i < 12; i++) {
    // straight away first, then fanning out either side
    const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
    const gx = Math.round(ux + Math.cos(a) * RUN_DIST), gy = Math.round(uy + Math.sin(a) * RUN_DIST);
    if (gx < 0 || gy < 0 || gx >= MW || gy >= MH) continue;
    const t = G.blk[gy * MW + gx] ? nearestFree(gx, gy, 2) : ([gx, gy] as Tile);
    if (!t) continue;
    const s = Math.hypot((t[0] + 0.5) * TS - threat.x, (t[1] + 0.5) * TS - threat.y);
    if (s > bs) { bs = s; best = t; }
  }
  if (!best) { setOrder(u, null); return; }
  orderMove(u, best[0], best[1]);
  if (u.order?.t === 'move') u.order.flee = true;
}

/** Run from `threat` to safety, keeping the job it was on to go back to. */
export function evade(u: Ent, threat: Ent): void {
  const o = u.order;
  if (o?.t === 'harvest') keepResume(u, { ...o } as HarvestOrder);
  fled.set(u, { id: threat.id, t: G.gameT });
  const t = havenFrom(u, threat);
  // already somewhere safe: just wait here
  if (t && Math.abs(t[0] - Math.floor(u.x / TS)) <= 1 && Math.abs(t[1] - Math.floor(u.y / TS)) <= 1) setOrder(u, null);
  else if (t) {
    orderMove(u, Math.max(0, Math.min(MW - 1, t[0])), Math.max(0, Math.min(MH - 1, t[1])));
    if (u.order?.t === 'move') u.order.flee = true;
  } else runFrom(u, threat);
  fetching.add(u); // no pause on arriving: it's not the player's walk
}

/**
 * Is the gatherer at work in danger: an enemy closing in on it, or (heading out) on the spot it's
 * heading for? Then it runs, or stays where it's safe.
 */
export function watchOut(u: Ent): boolean {
  const o = u.order;
  // on the run from something that's gone (fallen, or left): stop running, back to work
  if (o?.t === 'move' && o.flee && fled.has(u)) {
    const from = fledFrom(u);
    if ((!from || Math.hypot(from.x - u.x, from.y - u.y) > EVADE_CLEAR * TS) && safeToWork(u, peekResume(u))) setOrder(u, null);
    return false;
  }
  if (!evades(u) || !mayRun(u) || o?.t === 'move') return false;
  const t = threatNear(u) ?? (o?.t === 'harvest' && o.st === 'go' ? threatNear(u, EVADE_NEAR, (o.tx + 0.5) * TS, (o.ty + 0.5) * TS) : null);
  if (!t) return false;
  evade(u, t);
  return true;
}

/** Safe to go back to work: nothing about the gatherer, nor at the job it left. */
export function safeToWork(u: Ent, job: HarvestOrder | null): boolean {
  if (threatNear(u, EVADE_CLEAR)) return false;
  if (job && threatNear(u, EVADE_CLEAR, (job.tx + 0.5) * TS, (job.ty + 0.5) * TS)) return false;
  return true;
}
