// Giving orders to units. Every order goes through setOrder so stale paths are dropped.
import { G, tileOf, unitDef, type Ent, type Order, type React, type Stance, type Tile } from './state.ts';
import { MW, MH, TS, walkable } from './const.ts';
import { clamp } from '../util/math.ts';
import { WEAPON } from '../data/weapon.ts';
import { nearestFree, pathFor } from './path.ts';

/** How far (tiles) a passive unit runs from a threat. */
const FLEE_DIST = 6;

export function setOrder(u: Ent, o: Order | null): void {
  u.order = o;
  u.breach = null;
  u.path = null;
  u.goal = null;
  u.rep = 0;
}

export function orderMove(u: Ent, tx: number, ty: number): void {
  setOrder(u, { t: 'move', gx: tx, gy: ty, sub: null });
  u.goal = [tx, ty];
  u.path = pathFor(u, tx, ty);
}

/**
 * A move finished. A patrolling unit turns around and heads for the other end of its beat;
 * anyone else stops. Returns true if the order is over.
 */
export function arrive(u: Ent): boolean {
  const o = u.order;
  u.path = null;
  if (o?.t === 'move' && o.pat) {
    const back = o.pat;
    o.pat = [o.gx, o.gy];
    [o.gx, o.gy] = back;
    o.sub = null;
    u.goal = [o.gx, o.gy];
    u.path = pathFor(u, o.gx, o.gy);
    return false;
  }
  u.order = null;
  return true;
}

export function orderAttack(u: Ent, t: Ent): void {
  setOrder(u, { t: 'attack', tgt: t.id, auto: false, ox: u.x, oy: u.y, lx: t.x, ly: t.y });
}

/** Can this unit escort others? Gatherers have their work; a jet circles and can't keep close. */
export const canEscort = (u: Ent): boolean => u.kind === 'unit' && !u.wild && !u.demon && !u.bee && u.wing == null && !unitDef(u).haul && !unitDef(u).jet && (!!unitDef(u).weapon || u.type === 'medic');

/** Can this unit be escorted? Any living unit, not a Bee or Hornet (they stick to their Queen or Carrier). */
export const canBeEscorted = (w: Ent): boolean => w.kind === 'unit' && !w.dead && !w.bee && w.wing == null;

/**
 * Send a group to escort a friendly unit: each takes its own spot on a ring round it, spread evenly
 * and starting from the side it's coming from, so they surround it rather than bunching up behind.
 */
export function orderEscort(us: Ent[], w: Ent): void {
  const team = us.filter((u) => u !== w && canEscort(u));
  const n = team.length;
  if (!n) return;
  // a ring a tile and a half out, wider as more join, so nobody stands on top of the ward or each other
  const rad = Math.min(4, 1.5 + n / 8);
  const base = Math.atan2(team.reduce((s, u) => s + u.y, 0) / n - w.y, team.reduce((s, u) => s + u.x, 0) / n - w.x);
  // in order round the ring from where each one stands, so they don't cross paths getting there
  const around = (u: Ent) => (Math.atan2(u.y - w.y, u.x - w.x) - base + 3 * Math.PI) % (2 * Math.PI);
  [...team].sort((a, b) => around(a) - around(b)).forEach((u, i) => setOrder(u, { t: 'escort', tgt: w.id, sub: null, ang: base - Math.PI + ((i + 0.5) / n) * 2 * Math.PI, rad }));
}

/** Run directly away from a threat. */
export function orderFlee(u: Ent, from: { x: number; y: number }): void {
  const dx = u.x - from.x, dy = u.y - from.y, d = Math.hypot(dx, dy) || 1;
  const gx = clamp(Math.round(tileOf(u.x) + (dx / d) * FLEE_DIST), 0, MW - 1), gy = clamp(Math.round(tileOf(u.y) + (dy / d) * FLEE_DIST), 0, MH - 1);
  const t: Tile | null = G.blk[gy * MW + gx] ? nearestFree(gx, gy, 4) : [gx, gy];
  if (!t) return;
  orderMove(u, t[0], t[1]);
  if (u.order?.t === 'move') u.order.flee = true;
}

export const orderStop = (u: Ent): void => setOrder(u, null);

/** Change how a unit fights. A unit that stops attacking drops the fight it was in. */
export function setStance(u: Ent, stance: Stance): void {
  if (stance === 'tend' && u.type !== 'worker') return; // only Workers fix things
  u.stance = stance;
  u.shot = null;
  if (stance !== 'engage' && u.order?.t === 'attack') orderStop(u);
  if (u.order?.t === 'move' && u.order.sub) { u.order.sub = null; u.path = null; }
}

/** Change what a unit does when attacked. One told to stay put or get away drops a chase it started on its own. */
export function setReact(u: Ent, react: React): void {
  u.react = react;
  if (react !== 'pursue' && u.order?.t === 'attack' && u.order.auto) orderStop(u);
}

/** Harvest starting at a tile (or the nearest ore to it). */
export function orderHarvest(u: Ent, tx: number, ty: number): void {
  // sent to a wreck's salvage: stick with that wreck, however far from base
  setOrder(u, { t: 'harvest', st: 'go', tx, ty, wait: 0, ...(G.scrap[ty * MW + tx] ? { wreck: [tx, ty] as Tile } : {}) });
}

/** Chop wood in a Lumber Mill's woods (Workers only), or haul oil from an Oil Derrick back to base, over and over. */
export function orderHaul(u: Ent, src: Ent): void {
  if (src.type === 'mill' && u.type !== 'worker') return;
  setOrder(u, { t: 'harvest', st: 'go', tx: src.tx, ty: src.ty, wait: 0, res: src.type === 'mill' ? 'wood' : 'oil', src: src.id });
}

/** Chop a tree (or the nearest one with wood) and carry the wood home, over and over. Workers only. */
export function orderChop(u: Ent, tx: number, ty: number): void {
  if (u.type !== 'worker') return;
  setOrder(u, { t: 'harvest', st: 'go', tx, ty, wait: 0, res: 'wood' });
}

/** Send a Worker to mend an ally or building (a site: help build it). */
export function orderFix(u: Ent, t: Ent): void {
  setOrder(u, { t: 'heal', tgt: t.id, ox: u.x, oy: u.y, sent: true });
}

/** Take the current load to a refinery, then carry on harvesting. */
export function orderReturn(u: Ent): void {
  setOrder(u, { t: 'harvest', st: 'ret', tx: tileOf(u.x), ty: tileOf(u.y), wait: 0 });
}

/**
 * Move a group, giving each unit its own free tile around the goal. In formation (`form`) the group
 * is drawn up in ranks facing the way it's going (see formationSlots) and nobody walks faster than
 * the slowest of them, so they arrive together and in shape.
 */
export function groupMove(us: Ent[], gx: number, gy: number, patrol = false, form = false): void {
  const n = us.length;
  if (!n) return;
  const pace = form && n > 1 ? Math.min(...us.map((u) => unitDef(u).spd)) : undefined, fid = pace ? G.nextId++ : undefined;
  const send = (u: Ent, t: Tile) => {
    const from: Tile = [tileOf(u.x), tileOf(u.y)];
    orderMove(u, t[0], t[1]);
    if (u.order?.t !== 'move') return;
    if (patrol) u.order.pat = from;
    if (pace) { u.order.pace = pace; u.order.fid = fid; }
  };
  if (n === 1) { send(us[0], [gx, gy]); return; }
  const tiles: Tile[] = [], seen = new Set<number>([gy * MW + gx]), q: Tile[] = [[gx, gy]];
  while (q.length && tiles.length < n * (form ? 3 : 1)) {
    const [x, y] = q.shift() as Tile;
    if (!G.blk[y * MW + x]) tiles.push([x, y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy, k = ny * MW + nx;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || seen.has(k) || !walkable(G.terr[k])) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  const cx = us.reduce((s, u) => s + u.x, 0) / n, cy = us.reduce((s, u) => s + u.y, 0) / n;
  if (form) { formationSlots(us, gx, gy, cx, cy, tiles).forEach((t, i) => send(us[i], t)); return; }
  // keep the group's shape: sort units and slots along the axis across the direction of travel
  const ax = gx * TS - cx, ay = gy * TS - cy, al = Math.hypot(ax, ay) || 1, px = -ay / al, py = ax / al;
  const su = [...us].sort((a, b) => a.x * px + a.y * py - (b.x * px + b.y * py));
  const st = [...tiles].sort((a, b) => a[0] * px + a[1] * py - (b[0] * px + b[1] * py));
  su.forEach((u, i) => send(u, st[i] ?? st[st.length - 1] ?? [gx, gy]));
}

/** Reach (tiles) below which a unit fights up close, and from which a lightly built vehicle is siege. */
const MELEE = 2.5, SIEGE = 7;

/**
 * Where a unit belongs in a formation, front to back (Alex, 2026-11-28): 0 the front line, anything
 * heavily armoured or fighting up close (tanks, Cyborg Juggernauts, Footmen, Guardians, Knights,
 * Flamethrowers, claws and axes); 1 the ranged troops (riflemen, crossbows, rockets, mages, jeeps);
 * 2 siege (Catapults, Artillery Tanks); 3 Medics and anyone unarmed.
 */
export function formRank(u: Ent): number {
  const d = unitDef(u), w = d.weapon;
  if (u.type === 'medic' || !w) return 3;
  const r = WEAPON[w].range;
  if (d.armor === 'heavy' || r < MELEE) return 0;
  return d.cls === 'vehicle' && r >= SIEGE ? 2 : 1;
}

/**
 * Each unit's tile in formation. The group is drawn up afresh in rows across the way it's heading
 * (snapped to the eight compass directions so rows sit on the tile grid): the front line in the
 * front rows, the ranged troops behind, siege behind them and Medics at the back, each rank starting
 * a row of its own. Within a row units keep their order from side to side, so nobody crosses over.
 * The middle of the block sits on the goal; a spot that's blocked, water or already taken goes to
 * the nearest free tile around the goal (`free`) instead.
 */
function formationSlots(us: Ent[], gx: number, gy: number, cx: number, cy: number, free: Tile[]): Tile[] {
  const n = us.length, a = Math.atan2(gy + 0.5 - cy / TS, gx + 0.5 - cx / TS);
  const oct = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  const fx = Math.round(Math.cos(oct)), fy = Math.round(Math.sin(oct)), px = -fy, py = fx; // forward, and to the right
  const width = Math.max(3, Math.ceil(Math.sqrt(n * 1.6)));
  // rows front to back: each rank in rows of `width`, each row ordered from side to side
  const rows: number[][] = [];
  for (let rank = 0; rank <= 3; rank++) {
    const ids = us.map((_, i) => i).filter((i) => formRank(us[i]) === rank);
    // fill rows front to back, picking for each row the members furthest forward now
    ids.sort((i, j) => (us[j].x * fx + us[j].y * fy) - (us[i].x * fx + us[i].y * fy));
    for (let k = 0; k < ids.length; k += width) rows.push(ids.slice(k, k + width).sort((i, j) => (us[i].x * px + us[i].y * py) - (us[j].x * px + us[j].y * py)));
  }
  // a tank is longer than a tile: going straight along a row of tiles, a row with vehicles in it
  // keeps a tile clear before and after it, so they don't sit nose to tail (diagonal rows have room)
  const hull = (row: number[]) => fx !== 0 && fy !== 0 ? false : row.some((i) => unitDef(us[i]).cls === 'vehicle');
  const depth: number[] = [];
  rows.forEach((row, r) => depth.push(r ? depth[r - 1] + (hull(row) || hull(rows[r - 1]) ? 2 : 1) : 0));
  const want: Tile[] = new Array(n), mid = depth[depth.length - 1] / 2;
  rows.forEach((row, r) => row.forEach((i, c) => {
    const back = Math.round(depth[r] - mid), side = Math.round(c - (row.length - 1) / 2);
    want[i] = [gx - fx * back + px * side, gy - fy * back + py * side];
  }));
  const taken = new Set<number>(), slots: Tile[] = new Array(n);
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < MW && y < MH && !G.blk[y * MW + x] && walkable(G.terr[y * MW + x]) && !taken.has(y * MW + x);
  // front rows claim their spots first
  for (const i of rows.flat()) {
    let t = want[i];
    if (!open(t[0], t[1])) {
      let best: Tile | null = null, bd = Infinity;
      for (const f of free) {
        const d = Math.hypot(f[0] - t[0], f[1] - t[1]);
        if (d < bd && open(f[0], f[1])) { bd = d; best = f; }
      }
      t = best ?? [gx, gy];
    }
    taken.add(t[1] * MW + t[0]);
    slots[i] = t;
  }
  return slots;
}
