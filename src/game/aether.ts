// Aether deposits: placing them on the map, drawing Aether from a held deposit, and the tricks the
// hidden units use (slowing hexes and cloaks). Tuning lives in data/aether.ts.
import { G, hooks, say, unitDef, type Ent, type Tile } from './state.ts';
import { GRASS, MH, MW, TS } from './const.ts';
import { mulberry32 } from '../util/math.ts';
import { START_YARDS } from '../data/map.ts';
import {
  AETHER_MIDDLE, AETHER_MIDDLE_CHANCE, AETHER_PER_DEPOSIT, AETHER_RATE, AETHER_REACH, AETHER_SITES,
  CLOAK_DETECT, CLOAK_REVEAL, MAX_WAYGATES, SHRINE_HEAL, SHRINE_RANGE, SLOW_FACTOR, WARD_FACTOR, WARD_STONE_SIGHT,
} from '../data/aether.ts';
import { eachInDisk, nearPortal, setBlk } from './map.ts';

const TEAMS = [0, 1];

/** Ground tiles reachable on foot from the first base. */
function reachable(): Uint8Array {
  const seen = new Uint8Array(MW * MH), [ax, ay] = START_YARDS[0], start = (ay + 1) * MW + ax + 1, q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop() as number, x = i % MW, y = (i / MW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, ni = ny * MW + nx;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || seen[ni] || G.terr[ni] !== GRASS) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

/** The deposit sites a map with this seed gets. */
export function aetherSites(seed: number): Tile[] {
  const rnd = mulberry32(seed ^ 0x5eed);
  return rnd() < AETHER_MIDDLE_CHANCE ? [...AETHER_SITES, AETHER_MIDDLE] : [...AETHER_SITES];
}

/** A deposit entity holding `amount` Aether (its hp). */
export function addAether(tx: number, ty: number, amount = AETHER_PER_DEPOSIT): Ent {
  const e: Ent = {
    id: G.nextId++, kind: 'source', type: 'aether', team: -1, x: (tx + 0.5) * TS, y: (ty + 0.5) * TS, hp: amount, maxhp: AETHER_PER_DEPOSIT, dead: false, flash: 0,
    tx, ty, w: 1, h: 1,
    order: null, path: null, goal: null, cd: 0, face: 0, tface: 0, carry: 0,
    scan: 0, rep: 0, px: 0, py: 0, stkT: 0, walk: 0, moving: false, atkT: 0, stance: 'engage', shot: null,
    done: true, prog: 1, repairing: false, rally: null,
  };
  setBlk(e, true);
  G.ents.push(e);
  G.byId.set(e.id, e);
  return e;
}

/**
 * Put the deposits on a freshly generated map: clear a little meadow around each site, and if the
 * spot is cut off by water or woods, move it to the nearest ground both bases can walk to.
 */
export function placeAether(seed: number): void {
  G.aether = [0, 0];
  G.aetherFound = [false, false];
  G.ward = [false, false];
  G.waygates = [];
  G.warpTeam.fill(-1);
  for (const [sx, sy] of aetherSites(seed)) {
    eachInDisk(sx, sy, 2, (i) => { G.terr[i] = GRASS; G.ore[i] = 0; G.oilField[i] = 0; G.treeWood[i] = 0; });
    const ok = reachable();
    let best: Tile | null = null, bd = 1e9;
    for (let y = 1; y < MH - 1; y++)
      for (let x = 1; x < MW - 1; x++) {
        const d = Math.hypot(x - sx, y - sy);
        if (d < bd && ok[y * MW + x] && G.ore[y * MW + x] === 0 && !G.oilField[y * MW + x] && !G.blk[y * MW + x] && !nearPortal(x, y, 3)) { bd = d; best = [x, y]; }
      }
    if (best) addAether(best[0], best[1]);
  }
}

export const deposits = (): Ent[] => G.ents.filter((e) => !e.dead && e.type === 'aether');

/** Remove an emptied deposit without the rubble and blasts of a destroyed building. */
function exhaust(d: Ent): void {
  d.dead = true;
  setBlk(d, false);
  hooks.killed(d);
}

/** The team holding a deposit: it has a unit next to it and the enemy doesn't. -1 if nobody or contested. */
export function holderOf(d: Ent): number {
  const r = AETHER_REACH * TS, near = [false, false];
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || e.team < 0) continue;
    if (Math.hypot(e.x - d.x, e.y - d.y) <= r) near[e.team] = true;
  }
  return near[0] === near[1] ? -1 : near[0] ? 0 : 1;
}

/** Draw `dt` seconds of Aether from every held deposit. */
export function drawAether(dt: number): void {
  for (const d of deposits()) {
    const team = holderOf(d);
    if (team < 0) continue;
    const a = Math.min(d.hp, AETHER_RATE * dt);
    d.hp -= a;
    G.aether[team] = (G.aether[team] ?? 0) + a;
    if (!G.aetherFound[team]) { G.aetherFound[team] = true; say(team, 'Aether found! Hidden units revealed'); }
    if (d.hp <= 0.01) {
      exhaust(d);
      for (const t of TEAMS) say(t, 'An Aether deposit has run dry');
    }
  }
}

/** Speed multiplier for a unit (hexed units crawl for a moment). */
export const slowFactor = (u: Ent): number => ((u.slowT ?? 0) > G.gameT ? SLOW_FACTOR : 1);

/** Mark a unit hexed for `secs` seconds. */
export function hex(u: Ent, secs: number): void {
  if (u.kind === 'unit') u.slowT = Math.max(u.slowT ?? 0, G.gameT + secs);
}

/** A cloaked unit fired: it shows for a moment. */
export function unveil(u: Ent): void {
  if (u.kind === 'unit' && unitDef(u).cloak) u.shownT = G.gameT + CLOAK_REVEAL;
}

/** Is `e` a cloaked unit that `team` can't see right now? Enemies very close see through the cloak. */
export function cloakedFrom(e: Ent, team: number): boolean {
  if (e.kind !== 'unit' || e.team === team || e.team < 0 || !unitDef(e).cloak || (e.shownT ?? 0) > G.gameT) return false;
  const r = CLOAK_DETECT * TS;
  for (const o of G.ents) {
    if (o.dead || o.team !== team || o.kind === 'source') continue;
    if (o.type === 'wardstone' && o.done && Math.hypot(o.x - e.x, o.y - e.y) <= WARD_STONE_SIGHT * TS) return false;
    if (Math.hypot(o.x - e.x, o.y - e.y) - (o.w ? (o.w * TS) / 2 : 0) <= r) return false;
  }
  return true;
}

/** Damage a building takes after its side's Aether Ward. */
export const wardDamage = (t: Ent, dmg: number): number => (t.kind === 'bld' && G.ward[t.team] ? dmg * WARD_FACTOR : dmg);

// ---- Aether structures ----

/** Star Shrines heal their side's units nearby, vehicles and aircraft too. Call once per `dt` seconds. */
export function shrineHeal(dt: number): void {
  const shrines = G.ents.filter((e) => !e.dead && e.type === 'shrine' && e.done);
  if (!shrines.length) return;
  const r = (SHRINE_RANGE + 1) * TS; // from the shrine's centre: its 2×2 footprint plus the range
  for (const u of G.ents) {
    if (u.dead || u.kind !== 'unit' || u.hp >= u.maxhp) continue;
    if (shrines.some((s) => s.team === u.team && Math.hypot(s.x - u.x, s.y - u.y) <= r)) u.hp = Math.min(u.maxhp, u.hp + u.maxhp * SHRINE_HEAL * dt);
  }
}

/** The walkable tile in front of a Waygate where units step in, or null if it's hemmed in. */
function gateTile(b: Ent): Tile | null {
  const cand: Tile[] = [];
  for (let x = b.tx; x < b.tx + b.w; x++) cand.push([x, b.ty + b.h]); // in front (the arch faces +y)
  for (let y = b.ty; y < b.ty + b.h; y++) cand.push([b.tx + b.w, y], [b.tx - 1, y]);
  for (let x = b.tx; x < b.tx + b.w; x++) cand.push([x, b.ty - 1]);
  for (const [x, y] of cand) {
    if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
    const i = y * MW + x;
    if (!G.blk[i] && G.terr[i] === GRASS && G.warp[i] < 0) return [x, y];
  }
  return null;
}

/** Link each side's first two finished Waygates. Call whenever Waygates may have changed (cheap). */
export function syncWaygates(): void {
  for (const w of G.waygates) for (const [x, y] of [w.a, w.b]) { G.warp[y * MW + x] = -1; G.warpTeam[y * MW + x] = -1; }
  G.waygates = [];
  for (const team of TEAMS) {
    const gates = G.ents.filter((e) => !e.dead && e.team === team && e.type === 'waygate' && e.done).sort((a, b) => a.id - b.id).slice(0, MAX_WAYGATES);
    if (gates.length < 2) continue;
    const a = gateTile(gates[0]);
    if (!a) continue;
    G.warp[a[1] * MW + a[0]] = 0; // reserve it while choosing the other end
    const b = gateTile(gates[1]);
    G.warp[a[1] * MW + a[0]] = -1;
    if (!b) continue;
    G.waygates.push({ a, b, team });
    G.warp[a[1] * MW + a[0]] = b[1] * MW + b[0];
    G.warp[b[1] * MW + b[0]] = a[1] * MW + a[0];
    G.warpTeam[a[1] * MW + a[0]] = G.warpTeam[b[1] * MW + b[0]] = team;
  }
}

/** Is this Waygate one of a linked pair? */
export function waygateLinked(b: Ent): boolean {
  if (!G.waygates.some((w) => w.team === b.team)) return false;
  return G.ents.filter((e) => !e.dead && e.team === b.team && e.type === 'waygate' && e.done).sort((x, y) => x.id - y.id).slice(0, MAX_WAYGATES).includes(b);
}
