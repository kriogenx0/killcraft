// Creating, destroying and counting entities (units, buildings, ore crystal rocks).
import { bldHp, refitBonus } from './refit.ts';
import { G, hooks, bldDef, isVehicle, type Ent, type EntKind, type EntType } from './state.ts';
import { TS } from './const.ts';
import { UNIT, type UnitType } from '../data/unit.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import { setBlk } from './map.ts';
import { burst, explosion } from './fx.ts';

function baseEnt(kind: EntKind, type: EntType, team: number, x: number, y: number, hp: number): Ent {
  return {
    id: G.nextId++, kind, type, team, x, y, hp, maxhp: hp, dead: false, flash: 0,
    tx: 0, ty: 0, w: 0, h: 0,
    order: null, path: null, goal: null, cd: 0, face: Math.PI / 2, tface: Math.PI / 2, carry: 0,
    scan: Math.random() * 0.3, rep: 0, px: x, py: y, stkT: 0.5, walk: 0, moving: false, atkT: 0, stance: 'engage', shot: null, breach: null, foe: null, foeT: -99,
    done: true, prog: 1, repairing: false, rally: null,
  };
}

function register(e: Ent): Ent {
  G.ents.push(e);
  G.byId.set(e.id, e);
  return e;
}

export function addUnit(type: UnitType, team: number, x: number, y: number): Ent {
  return register(baseEnt('unit', type, team, x, y, UNIT[type].hp));
}

function placeRect(e: Ent, tx: number, ty: number, size: number): Ent {
  Object.assign(e, { tx, ty, w: size, h: size, x: (tx + size / 2) * TS, y: (ty + size / 2) * TS });
  setBlk(e, true);
  return register(e);
}

/** A new building rises out of the ground for a moment before it works. */
export function addBuilding(type: BldType, team: number, tx: number, ty: number, rising: boolean): Ent {
  const lvl = team >= 0 ? G.era[team] ?? 0 : 0;
  const e = baseEnt('bld', type, team, 0, 0, bldHp(type, lvl));
  e.lvl = lvl;
  e.done = !rising;
  e.prog = rising ? 0 : 1;
  e.face = e.tface = Math.PI / 2;
  return placeRect(e, tx, ty, BUILDING[type].size);
}

export function addSource(tx: number, ty: number): Ent {
  return placeRect(baseEnt('source', 'source', -1, 0, 0, 1), tx, ty, 1);
}

export function kill(e: Ent): void {
  if (e.dead) return;
  e.dead = true;
  hooks.killed(e);
  if (e.w) setBlk(e, false);
  const base = { t: 0, team: e.team, seed: e.id, w: e.w, r: 0, a: e.face };
  if (e.kind === 'unit' && !isVehicle(e)) {
    G.decals.push({ kind: 'corpse', x: e.x, y: e.y, max: 40, ...base });
    burst('blood', e.x, e.y - 4, 8, 50, 120);
    return;
  }
  if (e.kind === 'unit') {
    explosion(e.x, e.y, UNIT[e.type as UnitType].radius * 1.3);
    G.decals.push({ kind: 'wreck', x: e.x, y: e.y, max: 60, ...base, r: UNIT[e.type as UnitType].radius });
    return;
  }
  G.decals.push({ kind: 'rubble', x: e.x, y: e.y, max: 120, ...base });
  const n = e.w * e.h;
  for (let i = 0; i < n; i++) explosion(e.tx * TS + (Math.random() * e.w) * TS, e.ty * TS + Math.random() * e.h * TS, 18 + Math.random() * 10);
}

/** Power produced and used by a team's finished buildings. */
export function power(team: number): { made: number; used: number } {
  let made = 0, used = 0;
  for (const e of G.ents) {
    if (e.dead || e.team !== team || e.kind !== 'bld' || !e.done) continue;
    const p = bldDef(e).power;
    if (p > 0) made += Math.round(p * refitBonus(e) * Math.max(0.25, e.hp / e.maxhp));
    else used -= p;
  }
  return { made, used };
}

export function lowPower(team: number): boolean {
  const p = power(team);
  return p.used > p.made;
}

export function hasBuilding(team: number, type: BldType): boolean {
  return G.ents.some((e) => !e.dead && e.team === team && e.type === type && e.done);
}

export function countOf(team: number, type: EntType): number {
  return G.ents.filter((e) => !e.dead && e.team === team && e.type === type).length;
}
