// Wild creatures of Greek myth: placing their lairs, how they guard them, beating one down until it
// kneels, and capturing it. Tuning lives in data/creatures.ts.
import { G, defaultStance, isOrganic, say, tileOf, unitDef, valid, type Ent, type Tile } from './state.ts';
import { GRASS, MH, MW, TS, walkable } from './const.ts';
import { mulberry32 } from '../util/math.ts';
import { layoutFor, WATER_LEVEL } from '../data/map.ts';
import { UNIT, type UnitType } from '../data/unit.ts';
import {
  BEASTS, CAPTURE_REACH, CAPTURE_TIME, GUARD_RADIUS, LAIR_FFA_SITES, LAIR_PAIRS, LAIR_PAIRS_PER_MAP, LEASH, PETRIFY_IMMUNE, REBIRTH_HP, RISE_HP,
  RESPAWN_TIME, SONG_RANGE, SUBDUE_AT, SUBDUE_RECOVER, WILD_REGEN,
} from '../data/creatures.ts';
import { eachInDisk, nearPortal } from './map.ts';
import { addUnit } from './entity.ts';
import { canAttack, combatStep } from './combat.ts';
import { orderMove, setOrder } from './order.ts';
import { followPath } from './move.ts';
import { burst, part } from './fx.ts';
import { WEAPON, type WeaponType } from '../data/weapon.ts';

const teams = (): number[] => Array.from({ length: G.teams }, (_, t) => t);

/** Ground tiles reachable on foot from the first base. */
function reachable(): Uint8Array {
  const seen = new Uint8Array(MW * MH), [ax, ay] = layoutFor(G.teams).yards[0], start = (ay + 1) * MW + ax + 1, q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop() as number, x = i % MW, y = (i / MW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, ni = ny * MW + nx;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || seen[ni] || !walkable(G.terr[ni])) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

function shuffled<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** The lairs a map with this seed gets, and the creature in each. */
export function lairsFor(seed: number): [Tile, UnitType][] {
  const rnd = mulberry32(seed ^ 0xbea57), kinds = shuffled(BEASTS, rnd);
  if (G.teams > 2) return LAIR_FFA_SITES.map((t, i) => [t, kinds[i % kinds.length]]);
  return shuffled(LAIR_PAIRS, rnd).slice(0, LAIR_PAIRS_PER_MAP).flat().map((t, i) => [t, kinds[i % kinds.length]]);
}

/** A wild creature guarding a lair at this point (px). */
export function addBeast(type: UnitType, x: number, y: number): Ent {
  const u = addUnit(type, -1, x, y);
  u.wild = { lx: x, ly: y, down: false, downT: 0, by: -1, held: 0 };
  return u;
}

/**
 * Put the lairs on a freshly generated map: clear a little meadow around each site, and if the spot
 * is cut off by water or woods, move it to the nearest ground both bases can walk to.
 */
export function placeCreatures(seed: number): void {
  G.tamed = teams().map(() => []);
  G.respawns = [];
  for (const [[sx, sy], type] of lairsFor(seed)) {
    eachInDisk(sx, sy, 2, (i) => { if (!G.blk[i]) { G.terr[i] = GRASS; G.ore[i] = 0; G.oilField[i] = 0; G.treeWood[i] = 0; G.elev[i] = Math.max(G.elev[i], WATER_LEVEL + 0.08); } });
    const ok = reachable();
    let best: Tile | null = null, bd = 1e9;
    for (let y = 1; y < MH - 1; y++)
      for (let x = 1; x < MW - 1; x++) {
        const d = Math.hypot(x - sx, y - sy), i = y * MW + x;
        if (d < bd && ok[i] && !G.blk[i] && G.ore[i] === 0 && !G.oilField[i] && !nearPortal(x, y, 2)) { bd = d; best = [x, y]; }
      }
    if (!best) continue;
    const u = addBeast(type, (best[0] + 0.5) * TS, (best[1] + 0.5) * TS);
    u.face = u.tface = (seed % 8) * 0.8 + sx;
  }
}

export const wildBeasts = (): Ent[] => G.ents.filter((e) => !e.dead && !!e.wild);

/** Is this a wild creature, beaten down and waiting to be captured? */
export const kneeling = (e: Ent): boolean => !!e.wild?.down;

/** The nearest unit that has strayed close to a creature's lair and that it can fight. */
function intruder(u: Ent): Ent | null {
  const w = u.wild;
  if (!w) return null;
  let best: Ent | null = null, bd = GUARD_RADIUS * TS;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || e.team < 0 || !canAttack(u, e)) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < bd && Math.hypot(e.x - w.lx, e.y - w.ly) < LEASH * TS) { bd = d; best = e; }
  }
  return best;
}

/** A wild creature's turn: fight off intruders near its lair, then go home and lick its wounds. */
export function updWild(u: Ent, dt: number): void {
  const w = u.wild;
  if (!w) return;
  if (w.down) {
    u.order = null;
    u.path = null;
    if (w.by < 0 && G.gameT - w.downT > SUBDUE_RECOVER) rise(u);
    return;
  }
  let t = u.order?.t === 'attack' ? valid(u.order.tgt) : null;
  if (t && (t.team < 0 || Math.hypot(t.x - w.lx, t.y - w.ly) > LEASH * TS)) t = null;
  if (!t) {
    u.scan -= dt;
    if (u.scan <= 0) { u.scan = 0.4; t = intruder(u); }
  }
  if (t) {
    if (u.order?.t !== 'attack' || u.order.tgt !== t.id) setOrder(u, { t: 'attack', tgt: t.id, auto: true, ox: w.lx, oy: w.ly });
    if (combatStep(u, t, dt)) return;
    setOrder(u, null);
  } else if (u.order?.t === 'attack') setOrder(u, null);
  // nobody about: walk back to the lair and heal
  if (Math.hypot(u.x - w.lx, u.y - w.ly) > TS * 1.2) {
    if (u.order?.t !== 'move') orderMove(u, tileOf(w.lx), tileOf(w.ly));
    if (followPath(u, dt)) setOrder(u, null);
    return;
  }
  if (u.order) setOrder(u, null);
  u.hp = Math.min(u.maxhp, u.hp + u.maxhp * WILD_REGEN * dt);
}

/** Teams with a unit within reach of a creature. */
function sidesNear(u: Ent, reach: number): boolean[] {
  const near = teams().map(() => false);
  for (const e of G.ents) {
    if (e === u || e.dead || e.kind !== 'unit' || e.team < 0) continue;
    if (Math.hypot(e.x - u.x, e.y - u.y) <= reach * TS) near[e.team] = true;
  }
  return near;
}

/** The side capturing a kneeling creature: it has a unit beside it and no other side does. -1 if nobody or contested. */
export function captorOf(u: Ent): number {
  const sides = sidesNear(u, CAPTURE_REACH).flatMap((n, t) => (n ? [t] : []));
  return sides.length === 1 ? sides[0] : -1;
}

/** Health fell to the threshold: the creature stops fighting and kneels. Returns true if it did. */
export function subdue(u: Ent): boolean {
  const w = u.wild;
  if (!w || w.down || u.hp > u.maxhp * SUBDUE_AT) return false;
  u.hp = Math.max(1, Math.ceil(u.maxhp * SUBDUE_AT));
  Object.assign(w, { down: true, downT: G.gameT, by: -1, held: 0 });
  setOrder(u, null);
  const near = sidesNear(u, GUARD_RADIUS * 2), name = unitDef(u).name;
  for (const t of teams()) if (near[t]) say(t, `The ${name} kneels! Stand beside it to capture it`);
  return true;
}

function rise(u: Ent): void {
  const w = u.wild;
  if (!w) return;
  Object.assign(w, { down: false, by: -1, held: 0 });
  u.hp = Math.max(u.hp, u.maxhp * RISE_HP);
}

function capture(u: Ent, team: number): void {
  const type = u.type as UnitType, name = UNIT[type].name;
  u.lair = { x: u.wild?.lx ?? u.x, y: u.wild?.ly ?? u.y };
  u.wild = undefined;
  u.team = team;
  u.hp = Math.max(u.hp, u.maxhp * RISE_HP);
  u.stance = defaultStance(u.type, team);
  setOrder(u, null);
  // a fresh start on its new side: no grudges against its captors, and the fire and poison they left on it go out
  u.foe = u.shot = null;
  u.burnT = u.poisonT = 0;
  for (const e of G.ents) if (e.team === team && (e.foe === u.id || e.shot === u.id)) { if (e.foe === u.id) e.foe = null; if (e.shot === u.id) e.shot = null; }
  const tamed = (G.tamed[team] ??= []), first = !tamed.includes(type);
  if (first) tamed.push(type);
  const where = UNIT[type].producer === 'air' ? 'Airfield' : 'Barracks';
  say(team, first ? `${name} captured! Train more at the ${where}` : `${name} captured!`);
  for (const t of teams()) if (t !== team) say(t, `The enemy captured a ${name}`);
}

/** Advance `dt` seconds of capturing on every kneeling creature. */
export function captureBeasts(dt: number): void {
  for (const u of G.ents) {
    const w = u.wild;
    if (u.dead || !w?.down) continue;
    const team = captorOf(u);
    if (team < 0) { w.by = -1; w.held = 0; continue; }
    if (team !== w.by) { w.by = team; w.held = 0; }
    w.held += dt;
    w.downT = G.gameT; // held: it stays down
    if (w.held >= CAPTURE_TIME - 1e-6) capture(u, team);
  }
}

/** Can this team train this creature (it has captured one)? */
export const tamed = (team: number, t: UnitType): boolean => !!G.tamed[team]?.includes(t);

/**
 * A creature from a lair died (one captured from it; wild ones only kneel): it comes back a minute
 * later at its lair, wild and belonging to nobody. Creatures trained at a Barracks or Airfield have
 * no lair and stay dead.
 */
export function beastDied(u: Ent): void {
  const home = u.wild ? { x: u.wild.lx, y: u.wild.ly } : u.lair;
  if (!home || !UNIT[u.type as UnitType]?.beast) return;
  G.respawns.push({ type: u.type as string, x: home.x, y: home.y, t: G.gameT + RESPAWN_TIME });
}

/** Bring back creatures whose minute is up. */
export function respawnBeasts(): void {
  if (!G.respawns.length) return;
  G.respawns = G.respawns.filter((r) => {
    if (r.t > G.gameT) return true;
    const u = addBeast(r.type as UnitType, r.x, r.y);
    for (const t of teams()) if (sidesNear(u, 12)[t]) say(t, `The ${UNIT[r.type as UnitType].name} has returned to its lair`);
    return false;
  });
}

// ---- the creatures' gifts: the Medusa's gaze, the Nemean Lion's hide, the Phoenix's rebirth, the Satyr's pipes ----

/** Is this unit turned to stone right now? */
export const stone = (u: Ent): boolean => (u.stoneT ?? 0) > G.gameT;

/** A Medusa's gaze: the unit turns to stone for `secs`, unless it has only just turned back. */
export function petrify(u: Ent, secs: number): void {
  if (u.kind !== 'unit' || u.wild?.down || G.gameT < (u.stoneT ?? -1e9) + PETRIFY_IMMUNE) return;
  u.stoneT = G.gameT + secs;
  u.moving = false;
  burst('debris', u.x, u.y - 6, 6, 30, 90);
}

/** Arrows, bolts and bullets glance off a hide like the Nemean Lion's. */
export function hideFactor(wt: WeaponType, t: Ent): number {
  const h = t.kind === 'unit' ? unitDef(t).hide : undefined, p = WEAPON[wt].proj;
  return h != null && (p === 'bullet' || p === 'bolt') ? h : 1;
}

/** A Phoenix struck down bursts into flame and rises again, once a life. Returns true if it did. */
export function riseFromAshes(u: Ent): boolean {
  if (u.kind !== 'unit' || u.reborn || !unitDef(u).rebirth) return false;
  u.reborn = true;
  u.hp = u.maxhp * REBIRTH_HP;
  part('flash', u.x, u.y, { max: 0.5, size: 40, z: 40, col: '#ffb030' });
  burst('spark', u.x, u.y, 18, 60, 200, null, 40);
  if (u.team >= 0) say(u.team, `The ${unitDef(u).name} rises from its ashes!`);
  return true;
}

/** Satyrs' pipes heal the friendly foot soldiers and creatures around them. Call once per `dt` seconds. */
export function satyrSong(dt: number): void {
  const pipers = G.ents.filter((e) => !e.dead && e.kind === 'unit' && e.team >= 0 && !!unitDef(e).song && !stone(e));
  if (!pipers.length) return;
  const r = SONG_RANGE * TS;
  for (const u of G.ents) {
    if (u.dead || !isOrganic(u) || u.team < 0 || u.hp >= u.maxhp) continue;
    let rate = 0;
    for (const s of pipers) if (s.team === u.team && Math.hypot(s.x - u.x, s.y - u.y) <= r) rate = Math.max(rate, unitDef(s).song ?? 0);
    if (rate) u.hp = Math.min(u.maxhp, u.hp + u.maxhp * rate * dt);
  }
}

/** Unicorns lift every harmful spell and element off the friendly units around them. Call about once a second. */
export function unicornCleanse(): void {
  const healers = G.ents.filter((e) => !e.dead && e.kind === 'unit' && e.team >= 0 && !!unitDef(e).cleanse && !stone(e));
  if (!healers.length) return;
  for (const u of G.ents) {
    if (u.dead || u.kind !== 'unit' || u.team < 0) continue;
    if (!healers.some((h) => h.team === u.team && Math.hypot(h.x - u.x, h.y - u.y) <= (unitDef(h).cleanse ?? 0) * TS)) continue;
    const cursed = [u.burnT, u.poisonT, u.wetT, u.sludgeT, u.frozenT, u.curseT, u.slowT, u.stoneT].some((t) => (t ?? 0) > G.gameT);
    if (!cursed) continue;
    u.burnT = u.poisonT = u.wetT = u.sludgeT = u.frozenT = u.curseT = u.slowT = u.stoneT = 0;
    part('flash', u.x, u.y, { max: 0.3, size: 14, z: 10, col: '#ffd0f4' });
  }
}
