// Compact per-team snapshots of the world. The server encodes what one team can see; the online
// client decodes it into its own copy of the world, which the normal renderer then draws.
import { G, STANCES, allied, tileOf, valid, type Ent, type EntType } from '../game/state.ts';
import { MW, TS } from '../game/const.ts';
import { UNIT, UNIT_TYPES, isUnitType, type UnitType } from '../data/unit.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import { bldHp } from '../game/refit.ts';
import { WEAPON, type WeaponType } from '../data/weapon.ts';
import { addBuilding, addSource, addUnit, kill } from '../game/entity.ts';
import { fire } from '../game/combat.ts';
import { nearPortal, rebuildBlk } from '../game/map.ts';
import { warpFx } from '../game/fx.ts';
import { addAether, addShard, cloakedFrom, syncWaygates } from '../game/aether.ts';
import { AETHER_CARRY, AETHER_PER_DEPOSIT } from '../data/aether.ts';
import { clamp, lerp } from '../util/math.ts';
import { maxMana } from '../game/spells.ts';

export const TYPES: EntType[] = [...UNIT_TYPES, 'yard', 'power', 'refinery', 'barracks', 'factory', 'turret', 'tower', 'mill', 'derrick', 'airfield', 'flak', 'source', 'aether', 'hospital', 'works', 'armory',
  'palisade', 'stonewall', 'concretewall', 'pillbox', 'atturret', 'bertha',
  'shrine', 'wardstone', 'waygate', 'shard', 'camp'];
const WEAPONS = Object.keys(WEAPON) as WeaponType[];

/** [id, type, team, x, y, hp, face*100, tface*100, carry, flags, prog*100, rallyX, rallyY, building age, upgrade*100 (-1: none)] */
export type EntRow = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
/** fire: shooter, target, weapon · died: id · say: message · alert: x, y */
export type FxEvent = ['f', number, number, number] | ['d', number] | ['m', string] | ['a', number, number];

const MOVING = 1, DONE = 2, REPAIRING = 4, FIRING = 8, DRAWING = 64;
/** a wild creature kneeling, waiting to be captured */
const KNEELING = 128;
/** turned to stone by a Medusa's gaze (the top bit, above the mana) */
const STONE = 1 << 30;
/** two bits above the flags: the stance of one of our own units (the HUD shows it) */
const STANCE_SHIFT = 4;
/** Aether a unit carries, in the bits above the flags (it glows, and drops it if it falls) */
const AE_SHIFT = 8;
/** spells and elements on a unit, one bit each above the Aether (game/spells.ts) */
const STATUS_SHIFT = 16;
const STATUS = ['burnT', 'poisonT', 'wetT', 'sludgeT', 'frozenT', 'lustT', 'curseT'] as const;
/** one of our own casters' mana, as a share of its most in 7 bits, above those */
const MANA_SHIFT = 23;

function statusBits(e: Ent): number {
  if (e.kind !== 'unit') return 0;
  let b = 0;
  STATUS.forEach((k, i) => { if ((e[k] ?? 0) > G.gameT) b |= 1 << i; });
  return b << STATUS_SHIFT;
}

export function encodeEnt(e: Ent, own: boolean): EntRow {
  const stance = own && e.kind === 'unit' ? STANCES.indexOf(e.stance) << STANCE_SHIFT : 0;
  const flags = (e.moving ? MOVING : 0) | (e.done ? DONE : 0) | (e.repairing ? REPAIRING : 0) | (e.atkT > 0 ? FIRING : 0) | ((e.drawT ?? 0) > G.gameT ? DRAWING : 0) | (e.wild?.down ? KNEELING : 0) | stance | (e.kind === 'unit' ? Math.min(255, Math.ceil(e.ae ?? 0)) << AE_SHIFT : 0)
    | statusBits(e) | ((e.stoneT ?? 0) > G.gameT ? STONE : 0) | (own && maxMana(e) ? Math.round(clamp((e.mana ?? 0) / maxMana(e), 0, 1) * 127) << MANA_SHIFT : 0);
  const rally = own && e.rally ? e.rally : { x: -1, y: -1 };
  return [e.id, TYPES.indexOf(e.type), e.team, Math.round(e.x), Math.round(e.y), Math.ceil(e.hp), Math.round(e.face * 100), Math.round(e.tface * 100),
    Math.round(e.carry), flags, Math.round(e.prog * 100), Math.round(rally.x), Math.round(rally.y), e.lvl ?? 0, own && e.upT != null ? Math.floor(e.upT * 100) : -1];
}

/** Is this entity something the team can currently see (or has seen, for buildings)? */
export function visibleTo(e: Ent, team: number): boolean {
  // demons go unseen in the fog like enemy troops; ore, Aether and wild creatures at their lairs always show
  if ((e.team < 0 && !e.demon) || allied(e.team, team)) return true;
  if (cloakedFrom(e, team)) return false;
  const v = G.sight[team][Math.floor(e.y / TS) * MW + Math.floor(e.x / TS)];
  return e.kind === 'unit' ? v === 2 : v > 0;
}

export const weaponIndex = (w: string): number => WEAPONS.indexOf(w as WeaponType);

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The ore on the ground, sent once a second. Most tiles have none, so only the tiles that do go out,
 * as (tile, amount) pairs of 16-bit numbers: a few KB instead of the whole map's 18 KB.
 */
export function encodeOre(): string {
  let n = 0;
  for (let i = 0; i < G.ore.length; i++) if (G.ore[i]) n++;
  const pairs = new Int16Array(n * 2);
  for (let i = 0, k = 0; i < G.ore.length; i++) if (G.ore[i]) { pairs[k++] = i - 0x8000; pairs[k++] = G.ore[i]; }
  return bytesToBase64(new Uint8Array(pairs.buffer));
}

export function decodeOre(b64: string): void {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length % 4) return;
  const pairs = new Int16Array(bytes.buffer);
  G.ore.fill(0);
  for (let k = 0; k < pairs.length; k += 2) { const i = pairs[k] + 0x8000; if (i < G.ore.length) G.ore[i] = pairs[k + 1]; }
}

// ---- client side ----

/** Where each entity is heading, so the client can glide between snapshots. */
const targets = new Map<number, { x: number; y: number; face: number; tface: number }>();

function create(type: EntType, team: number, x: number, y: number): Ent {
  if (type === 'shard') return addShard(x, y, 1);
  if (type === 'aether') return addAether(Math.floor(x / TS), Math.floor(y / TS));
  if (type === 'source') return addSource(Math.floor(x / TS), Math.floor(y / TS));
  if (isUnitType(type)) return addUnit(type, team, x, y);
  const s = BUILDING[type as BldType].size;
  return addBuilding(type as BldType, team, Math.round(x / TS - s / 2), Math.round(y / TS - s / 2), false);
}

/**
 * Ids the client hands out itself start here, far above the server's. A new entity is made with a local
 * id and then given the server's; if the local one were also a server id in use, making it would knock
 * that entity out of G.byId, and the next snapshot would make a second copy of it (a stale twin whose
 * health the damage numbers then read as a fresh hit every frame).
 */
const LOCAL_IDS = 2 ** 30;

/** Bring the local world in line with a snapshot. */
export function applySnapshot(rows: EntRow[], events: FxEvent[], onEvent: (ev: FxEvent) => void): void {
  const seen = new Set<number>();
  G.nextId = Math.max(G.nextId, LOCAL_IDS);
  let structural = false;
  for (const [id, ti, team, x, y, hp, face, tface, carry, flags, prog, rx, ry, lvl, up] of rows) {
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
    e.maxhp = isUnitType(type) ? UNIT[type as UnitType].hp : type === 'source' ? 1 : type === 'aether' ? AETHER_PER_DEPOSIT : type === 'shard' ? Math.max(AETHER_CARRY, hp) : bldHp(type as BldType, lvl ?? 0);
    if (e.kind === 'bld') { e.lvl = lvl ?? 0; e.upT = up != null && up >= 0 ? up / 100 : undefined; }
    e.carry = carry;
    e.moving = (flags & MOVING) !== 0;
    e.done = (flags & DONE) !== 0;
    e.repairing = (flags & REPAIRING) !== 0;
    e.stance = STANCES[(flags >> STANCE_SHIFT) & 3] ?? 'engage';
    if (flags & FIRING) {
      // a slow swing (the Titan's club) plays through once from its start; anything else just flashes
      const wt = e.kind === 'unit' && isUnitType(e.type) ? UNIT[e.type as UnitType].weapon : null, sw = wt ? WEAPON[wt].swing : undefined;
      e.atkT = sw ? (e.atkT > 0 ? e.atkT : sw) : Math.max(e.atkT, 0.05);
    }
    e.drawT = flags & DRAWING ? G.gameT + 0.4 : 0;
    if (e.kind === 'unit') {
      e.ae = (flags >> AE_SHIFT) & 255;
      const st = (flags >> STATUS_SHIFT) & 127;
      STATUS.forEach((k, i) => { e[k] = st & (1 << i) ? G.gameT + 0.6 : 0; });
      e.stoneT = flags & STONE ? G.gameT + 0.4 : 0;
      if (maxMana(e)) e.mana = (((flags >> MANA_SHIFT) & 127) / 127) * maxMana(e);
    }
    // a unit with no side is a demon from the Gate of Hell, or a wild creature guarding its lair; captured ones join a side
    if (e.kind === 'unit') {
      e.team = team;
      if (team >= 0) e.wild = undefined;
      else if (UNIT[type as UnitType].demon) e.demon ??= { raid: -1, hx: x, hy: y };
      else { e.wild ??= { lx: x, ly: y, down: false, downT: 0, by: -1, held: 0 }; e.wild.down = (flags & KNEELING) !== 0; }
    }
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
  syncWaygates(); // only for drawing: the server decides who walks through
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
    if (dist > 96) {
      // teleport rather than slide across the map (and shimmer if it went through a portal)
      if (e.kind === 'unit' && nearPortal(tileOf(t.x), tileOf(t.y))) { warpFx(e.x, e.y); warpFx(t.x, t.y); }
      e.x = t.x; e.y = t.y;
    }
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
