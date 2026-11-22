// Building behaviour (rising, repair, turrets, effects) and placement rules.
import { G, say, tileOf, bldDef, type Ent, type Point, type Tile } from './state.ts';
import { MW, MH, TS, GRASS } from './const.ts';
import { BUILDING, BUILD_RADIUS, REPAIR_RATE, SELL_REFUND, type BldType } from '../data/building.ts';
import { addBuilding, addUnit, kill } from './entity.ts';
import { burst, part } from './fx.ts';
import { nearestFree } from './path.ts';
import { nearPortal } from './map.ts';
import { updTurret } from './combat.ts';
import { orderHarvest } from './order.ts';

const RISE_TIME = 1.2;

/** Free tile next to a building, nearest to `toward` (default: below the building, where doors are). */
export function exitTile(b: Ent, toward?: Point): Tile {
  const rx = toward ? toward.x : b.x, ry = toward ? toward.y : b.y + 400;
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
  if (b.type !== 'refinery') return;
  // every refinery comes with a harvester
  const [x, y] = exitTile(b), u = addUnit('harvester', b.team, (x + 0.5) * TS, (y + 0.5) * TS);
  orderHarvest(u, x, y);
}

function effects(b: Ent, dt: number): void {
  if (G.vis[tileOf(b.y) * MW + tileOf(b.x)] !== 2) return;
  if (b.hp < b.maxhp * 0.6 && Math.random() < dt * (b.hp < b.maxhp * 0.3 ? 18 : 7)) {
    const x = b.tx * TS + TS * 0.2 + Math.random() * (b.w - 0.4) * TS, y = b.ty * TS + Math.random() * b.h * TS * 0.6;
    part('fire', x, y, { vz: 30 + Math.random() * 30, max: 0.5 + Math.random() * 0.4, size: 4 + Math.random() * 5 });
    if (Math.random() < 0.5) part('smoke', x, y, { vz: 25 + Math.random() * 20, max: 2 + Math.random() * 1.5, size: 5 + Math.random() * 4, z: 10 });
  }
  if (b.type === 'power' && Math.random() < dt * 5) {
    const cx = b.tx * TS + (Math.random() < 0.5 ? 20 : 46);
    part('smoke', cx, b.ty * TS - 18, { vz: 26, vx: 5, max: 2.2, size: 4, soft: true });
  }
  if (b.repairing && Math.random() < dt * 4) burst('spark', b.x + (Math.random() - 0.5) * b.w * TS * 0.6, b.y - 10, 3, 40, 100);
}

function repair(b: Ent, dt: number): void {
  if (!b.repairing) return;
  if (b.hp >= b.maxhp) { b.repairing = false; return; }
  const hp = Math.min(REPAIR_RATE * dt, b.maxhp - b.hp), cost = (hp * bldDef(b).cost) / b.maxhp / 2;
  if (G.credits[b.team] < cost) return;
  G.credits[b.team] -= cost;
  b.hp += hp;
}

export function updBld(b: Ent, dt: number): void {
  b.flash = Math.max(0, b.flash - dt);
  b.atkT = Math.max(0, b.atkT - dt);
  if (!b.done) {
    b.prog += dt / RISE_TIME;
    if (b.prog >= 1) { b.prog = 1; b.done = true; completed(b); }
    return;
  }
  effects(b, dt);
  repair(b, dt);
  updTurret(b, dt);
}

/** Can a structure go on this tile? People can only build on ground they've explored. */
export function tileFree(x: number, y: number, team: number): boolean {
  if (x < 0 || y < 0 || x >= MW || y >= MH) return false;
  const i = y * MW + x;
  if (G.blk[i] || (G.human[team] && !G.reveal && G.sight[team][i] === 0)) return false;
  return !G.ents.some((e) => !e.dead && e.kind === 'unit' && tileOf(e.x) === x && tileOf(e.y) === y);
}

/** Structures must be placed within BUILD_RADIUS tiles of one of the team's buildings. */
export function nearBase(tx: number, ty: number, s: number, team: number): boolean {
  return G.ents.some((e) => !e.dead && e.team === team && e.kind === 'bld' &&
    tx < e.tx + e.w + BUILD_RADIUS && tx + s > e.tx - BUILD_RADIUS && ty < e.ty + e.h + BUILD_RADIUS && ty + s > e.ty - BUILD_RADIUS);
}

/** With margin, keeps a one-tile lane free around other buildings (used by the computer player). */
export function canPlace(tx: number, ty: number, s: number, team: number, margin = false): boolean {
  if (tx < 0 || ty < 0 || tx + s > MW || ty + s > MH || !nearBase(tx, ty, s, team)) return false;
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

export function placeBuilding(team: number, type: BldType, tx: number, ty: number): Ent | null {
  if (!canPlace(tx, ty, BUILDING[type].size, team)) { say(team, 'Cannot place there'); return null; }
  for (let y = ty; y < ty + BUILDING[type].size; y++) for (let x = tx; x < tx + BUILDING[type].size; x++) G.ore[y * MW + x] = 0;
  return addBuilding(type, team, tx, ty, true);
}

export function sell(b: Ent): void {
  if (b.dead || b.kind !== 'bld' || b.type === 'yard') return;
  const d = bldDef(b), f = SELL_REFUND * (b.hp / b.maxhp);
  G.credits[b.team] += Math.round(d.cost * f);
  G.wood[b.team] += Math.round((d.wood ?? 0) * f);
  G.oil[b.team] += Math.round((d.oil ?? 0) * f);
  burst('dust', b.x, b.y, 20, 40, 120);
  kill(b);
}

export function toggleRepair(b: Ent): void {
  if (b.kind === 'bld' && b.hp < b.maxhp) b.repairing = !b.repairing;
}
