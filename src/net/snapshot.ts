// Compact per-team snapshots of the world. The server encodes what one team can see; the online
// client decodes it into its own copy of the world, which the normal renderer then draws.
import { G, valid, type Ent, type EntType } from '../game/state.ts';
import { MW, TS } from '../game/const.ts';
import { UNIT, UNIT_TYPES, isUnitType, type UnitType } from '../data/unit.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import { WEAPON, type WeaponType } from '../data/weapon.ts';
import { addBuilding, addSource, addUnit, kill } from '../game/entity.ts';
import { fire } from '../game/combat.ts';
import { rebuildBlk } from '../game/map.ts';
import { lerp } from '../util/math.ts';

const TYPES: EntType[] = [...UNIT_TYPES, 'yard', 'power', 'refinery', 'barracks', 'factory', 'turret', 'source'];
const WEAPONS = Object.keys(WEAPON) as WeaponType[];

/** [id, type, team, x, y, hp, face*100, tface*100, carry, flags, prog*100, rallyX, rallyY] */
export type EntRow = [number, number, number, number, number, number, number, number, number, number, number, number, number];
/** fire: shooter, target, weapon · died: id · say: message · alert: x, y */
export type FxEvent = ['f', number, number, number] | ['d', number] | ['m', string] | ['a', number, number];

const MOVING = 1, DONE = 2, REPAIRING = 4, FIRING = 8;

export function encodeEnt(e: Ent, own: boolean): EntRow {
  const flags = (e.moving ? MOVING : 0) | (e.done ? DONE : 0) | (e.repairing ? REPAIRING : 0) | (e.atkT > 0 ? FIRING : 0);
  const rally = own && e.rally ? e.rally : { x: -1, y: -1 };
  return [e.id, TYPES.indexOf(e.type), e.team, Math.round(e.x), Math.round(e.y), Math.ceil(e.hp), Math.round(e.face * 100), Math.round(e.tface * 100),
    Math.round(e.carry), flags, Math.round(e.prog * 100), Math.round(rally.x), Math.round(rally.y)];
}

/** Is this entity something the team can currently see (or has seen, for buildings)? */
export function visibleTo(e: Ent, team: number): boolean {
  if (e.team === team || e.team < 0) return true;
  const v = G.sight[team][Math.floor(e.y / TS) * MW + Math.floor(e.x / TS)];
  return e.kind === 'unit' ? v === 2 : v > 0;
}

export const weaponIndex = (w: string): number => WEAPONS.indexOf(w as WeaponType);

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const encodeOre = (): string => bytesToBase64(new Uint8Array(G.ore.buffer, G.ore.byteOffset, G.ore.byteLength));

export function decodeOre(b64: string): void {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length === G.ore.byteLength) G.ore.set(new Int16Array(bytes.buffer));
}

// ---- client side ----

/** Where each entity is heading, so the client can glide between snapshots. */
const targets = new Map<number, { x: number; y: number; face: number; tface: number }>();

function create(type: EntType, team: number, x: number, y: number): Ent {
  if (type === 'source') return addSource(Math.floor(x / TS), Math.floor(y / TS));
  if (isUnitType(type)) return addUnit(type, team, x, y);
  const s = BUILDING[type as BldType].size;
  return addBuilding(type as BldType, team, Math.round(x / TS - s / 2), Math.round(y / TS - s / 2), false);
}

/** Bring the local world in line with a snapshot. */
export function applySnapshot(rows: EntRow[], events: FxEvent[], onEvent: (ev: FxEvent) => void): void {
  const seen = new Set<number>();
  let structural = false;
  for (const [id, ti, team, x, y, hp, face, tface, carry, flags, prog, rx, ry] of rows) {
    const type = TYPES[ti];
    if (!type) continue;
    seen.add(id);
    let e = G.byId.get(id);
    if (!e || e.dead) {
      e = create(type, team, x, y);
      // keep the server's id so later snapshots and events find this entity
      G.byId.delete(e.id);
      e.id = id;
      G.byId.set(id, e);
      e.face = e.tface = face / 100;
      if (e.kind !== 'unit') structural = true;
    }
    if (hp < e.hp) e.flash = 0.1;
    e.hp = hp;
    e.maxhp = isUnitType(type) ? UNIT[type as UnitType].hp : type === 'source' ? 1 : BUILDING[type as BldType].hp;
    e.carry = carry;
    e.moving = (flags & MOVING) !== 0;
    e.done = (flags & DONE) !== 0;
    e.repairing = (flags & REPAIRING) !== 0;
    if (flags & FIRING) e.atkT = Math.max(e.atkT, 0.05);
    e.prog = prog / 100;
    e.rally = rx >= 0 ? { x: rx, y: ry } : null;
    targets.set(id, { x, y, face: face / 100, tface: tface / 100 });
  }
  for (const ev of events) {
    if (ev[0] === 'd') {
      const e = valid(ev[1]);
      if (e) { kill(e); structural ||= e.kind !== 'unit'; }
    } else if (ev[0] === 'f') {
      const s = valid(ev[1]), t = valid(ev[2]), w = WEAPONS[ev[3]];
      if (s && t && w) fire(s, w, t);
    } else onEvent(ev);
  }
  // anything no longer reported has left our sight
  for (const e of G.ents) if (!e.dead && !seen.has(e.id)) { e.dead = true; targets.delete(e.id); structural ||= e.kind !== 'unit'; }
  G.ents = G.ents.filter((e) => !e.dead);
  for (const [id] of targets) if (!G.byId.get(id) || G.byId.get(id)?.dead) targets.delete(id);
  for (const [id, e] of G.byId) if (e.dead) G.byId.delete(id);
  if (structural) rebuildBlk();
}

const turn = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

/** Ease every entity toward its latest reported position. Call once per frame. */
export function interpolate(dt: number): void {
  const k = Math.min(1, dt * 12);
  for (const e of G.ents) {
    const t = targets.get(e.id);
    if (!t) continue;
    const dist = Math.hypot(t.x - e.x, t.y - e.y);
    if (dist > 96) { e.x = t.x; e.y = t.y; } // teleport rather than slide across the map
    else { e.x = lerp(e.x, t.x, k); e.y = lerp(e.y, t.y, k); }
    if (e.moving) e.walk += (dist * k) / 24 + dt * 2;
    e.face = turn(e.face, t.face, k);
    e.tface = turn(e.tface, t.tface, k);
    e.atkT = Math.max(0, e.atkT - dt);
    e.flash = Math.max(0, e.flash - dt);
  }
}

export function resetSnapshots(): void {
  targets.clear();
}
