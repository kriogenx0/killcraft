// The Gate of Hell (data/hell.ts): placing it, letting demons out, picking the leader they hunt,
// sending them on raids, and how a demon behaves at the gate and out on a raid.
import { G, say, tileOf, unitDef, valid, type Ent } from './state.ts';
import { GRASS, MH, MW, TS } from './const.ts';
import { WATER_LEVEL } from '../data/map.ts';
import { UNIT, type UnitType } from '../data/unit.ts';
import { isWall } from '../data/building.ts';
import {
  ARCHFIEND, ARCHFIEND_EVERY, ARCHFIEND_FIRST, DEMON_CAP, FIEND_SHARE, FIRST_RAID, GATE_CLEAR, GATE_LEASH, GATE_OPENS, GATE_SIZE, GATE_TILE,
  LEADER_TRAINED, LURK_RADIUS, LURK_REGEN, RAID_EVERY, RAID_MIN, SPAWN_EVERY,
} from '../data/hell.ts';
import { eachInDisk } from './map.ts';
import { addUnit } from './entity.ts';
import { attacker, canAttack, combatStep, isFoe } from './combat.ts';
import { orderMove, setOrder } from './order.ts';
import { followPath, turnToward } from './move.ts';
import { cloakedFrom } from './aether.ts';
import { edgeDist } from './path.ts';
import { burst, part } from './fx.ts';
import { teamColors } from '../data/team.ts';

/** The gate's footprint, in tiles. */
export const gateRect = () => ({ tx: GATE_TILE[0], ty: GATE_TILE[1], w: GATE_SIZE, h: GATE_SIZE });
/** The middle of the gate, px. */
export const gateCentre = () => ({ x: (GATE_TILE[0] + GATE_SIZE / 2) * TS, y: (GATE_TILE[1] + GATE_SIZE / 2) * TS });
/** Is this tile under the gate? */
export const onGate = (tx: number, ty: number): boolean => tx >= GATE_TILE[0] && ty >= GATE_TILE[1] && tx < GATE_TILE[0] + GATE_SIZE && ty < GATE_TILE[1] + GATE_SIZE;

/** Clear and level the ground round the gate on a fresh map, and set its clock going. */
export function placeGate(): void {
  const [gx, gy] = GATE_TILE, cx = gx + (GATE_SIZE - 1) / 2, cy = gy + (GATE_SIZE - 1) / 2;
  const h = Math.max(G.elev[Math.round(cy) * MW + Math.round(cx)], WATER_LEVEL + 0.08);
  eachInDisk(cx, cy, GATE_CLEAR, (i) => { G.terr[i] = GRASS; G.oilField[i] = 0; G.treeWood[i] = 0; G.elev[i] = h; });
  eachInDisk(cx, cy, 2, (i) => { G.ore[i] = 0; }); // under the gate and its rim (the ore grows back round it)
  G.hell = { gate: true, spawnT: GATE_OPENS, raidT: Infinity, archT: Infinity, prey: -1 };
}

export const demons = (): Ent[] => G.ents.filter((e) => !e.dead && !!e.demon);
export const isDemonType = (t: string): boolean => !!UNIT[t as UnitType]?.demon;

/** A spot by the gate for a demon to wait at, picked at random on open ground round it. */
function lurkSpot(): { x: number; y: number } {
  const c = gateCentre();
  for (let k = 0; k < 20; k++) {
    const a = Math.random() * Math.PI * 2, r = (GATE_SIZE / 2 + 1.2 + Math.random() * (LURK_RADIUS - GATE_SIZE / 2 - 1.2)) * TS;
    const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r, i = tileOf(y) * MW + tileOf(x);
    if (!G.blk[i]) return { x, y };
  }
  return { x: c.x, y: c.y + (GATE_SIZE / 2 + 0.7) * TS };
}

/** A demon climbs out of the gate. */
export function spawnDemon(type: UnitType): Ent {
  const c = gateCentre(), spot = lurkSpot(), a = Math.atan2(spot.y - c.y, spot.x - c.x);
  // it steps out of the gate toward its spot
  const u = addUnit(type, -1, c.x + Math.cos(a) * (GATE_SIZE / 2 + 0.6) * TS, c.y + Math.sin(a) * (GATE_SIZE / 2 + 0.6) * TS);
  u.demon = { raid: -1, hx: spot.x, hy: spot.y };
  u.stance = 'engage';
  u.face = u.tface = a;
  part('flash', u.x, u.y, { max: 0.5, size: 40, z: 10, col: '#ff4010' });
  burst('spark', u.x, u.y, 14, 50, 160, null, 10);
  return u;
}

/** Fighting units a side has trained this match (Workers, Harvesters and Medics don't count). */
export const trainedFighters = (team: number): number => G.stats?.[team]?.fighters ?? 0;

/** A side's army: the price of its armed units on the field (Workers and Harvesters aside). */
function armyWorth(team: number): number {
  let w = 0;
  for (const e of G.ents) {
    if (e.dead || e.team !== team || e.kind !== 'unit') continue;
    const d = unitDef(e);
    if (d.weapon && !d.haul) w += d.cost + (d.wood ?? 0) + (d.oil ?? 0) + (d.aether ?? 0) * 3;
  }
  return w;
}

/** Who the demons hunt: of the sides that have trained enough troops, the one with the strongest army; -1 if none has yet. */
export function demonPrey(): number {
  let best = -1, bw = 0;
  for (let t = 0; t < G.teams; t++) {
    if (G.absent?.[t] || G.outLog?.some((o) => o.team === t) || trainedFighters(t) < LEADER_TRAINED) continue;
    const w = armyWorth(t);
    if (w > bw) { bw = w; best = t; }
  }
  return best;
}

const between = ([a, b]: [number, number]): number => a + Math.random() * (b - a);

/** Run the gate: called about once a second. */
export function updHell(): void {
  if (G.visualOnly || !G.hell?.gate) return;
  const H = G.hell, now = G.gameT, all = demons();
  // the leader
  const prey = demonPrey();
  if (prey !== H.prey) {
    const was = H.prey;
    H.prey = prey;
    if (prey >= 0) {
      if (was < 0) { H.raidT = now + FIRST_RAID; H.archT = now + ARCHFIEND_FIRST; }
      for (let t = 0; t < G.teams; t++)
        say(t, t === prey ? 'The Gate of Hell stirs: its demons hunt the strongest army, and that is yours' : `The Gate of Hell stirs: its demons hunt ${teamColors(prey).name}, the strongest army`);
    } else { H.raidT = H.archT = Infinity; }
  }
  // demons out on a raid against a side that's no longer the leader go home
  for (const d of all) if (d.demon && d.demon.raid >= 0 && d.demon.raid !== prey) goHome(d);
  // new demons
  const small = all.filter((d) => d.type !== ARCHFIEND).length;
  if (now >= H.spawnT) {
    H.spawnT = now + SPAWN_EVERY;
    if (small < DEMON_CAP) spawnDemon(Math.random() < FIEND_SHARE ? 'fiend' : 'imp');
  }
  if (now >= H.archT) {
    H.archT = now + ARCHFIEND_EVERY;
    if (!all.some((d) => d.type === ARCHFIEND)) {
      spawnDemon(ARCHFIEND);
      for (let t = 0; t < G.teams; t++) say(t, 'A giant Archfiend climbs out of the Gate of Hell');
    }
  }
  // a raid
  if (prey >= 0 && now >= H.raidT) {
    const waiting = demons().filter((d) => d.demon?.raid === -1);
    if (waiting.length >= RAID_MIN || waiting.some((d) => d.type === ARCHFIEND)) {
      H.raidT = now + between(RAID_EVERY);
      for (const d of waiting) { if (d.demon) d.demon.raid = prey; setOrder(d, null); }
      for (let t = 0; t < G.teams; t++) say(t, t === prey ? 'Demons pour out of the Gate of Hell and come for you!' : `Demons pour out of the Gate of Hell and go for ${teamColors(prey).name}`);
    } else H.raidT = now + 20; // too few: try again a little later
  }
}

function goHome(u: Ent): void {
  if (!u.demon) return;
  u.demon.raid = -1;
  setOrder(u, null);
}

/** Where a raid heads: the prey's Town Hall nearest the demon, or else anything of theirs. */
function raidGoal(u: Ent, team: number): Ent | null {
  let best: Ent | null = null, bd = Infinity;
  for (const e of G.ents) {
    if (e.dead || e.team !== team || (e.kind === 'bld' && isWall(e.type))) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y) + (e.type === 'yard' ? 0 : e.kind === 'bld' ? 2000 : 4000);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** The best thing of the prey's to hit within sight: armed units first, then other units, then buildings; walls only right in the way. */
function raidTarget(u: Ent, team: number): Ent | null {
  const r = unitDef(u).sight * TS;
  let best: Ent | null = null, bs = Infinity;
  for (const e of G.ents) {
    if (e.dead || e.team !== team || e.kind === 'source' || !canAttack(u, e) || cloakedFrom(e, u.team)) continue;
    const d = edgeDist(u, e), wall = e.kind === 'bld' && isWall(e.type);
    if (d > r || (wall && d > 1.2 * TS)) continue;
    const s = d + (e.kind === 'bld' ? (wall ? 300 : 150) : unitDef(e).weapon ? 0 : 40);
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}

/** A demon's turn. */
export function updDemon(u: Ent, dt: number): void {
  const dm = u.demon;
  if (!dm) return;
  const c = gateCentre();
  // whoever is hurting it gets it back, raiding or not (but not too far from the gate while it waits)
  let t = u.order?.t === 'attack' ? valid(u.order.tgt) : null;
  if (t && !isFoe(u, t)) t = null;
  u.scan -= dt;
  if (u.scan <= 0) {
    u.scan = 0.4;
    const a = attacker(u);
    if (a && (dm.raid >= 0 || Math.hypot(a.x - c.x, a.y - c.y) < GATE_LEASH * TS)) t = a;
    else if (dm.raid >= 0 && (!t || t.team !== dm.raid)) t = raidTarget(u, dm.raid) ?? t;
  }
  if (t && dm.raid < 0 && Math.hypot(u.x - c.x, u.y - c.y) > GATE_LEASH * TS) { t = null; u.foe = null; }
  if (t) {
    if (u.order?.t !== 'attack' || u.order.tgt !== t.id) setOrder(u, { t: 'attack', tgt: t.id, auto: true, ox: u.x, oy: u.y });
    if (combatStep(u, t, dt)) return;
    setOrder(u, null);
  } else if (u.order?.t === 'attack') setOrder(u, null);
  if (dm.raid >= 0) {
    // march on the prey's base
    const goal = raidGoal(u, dm.raid);
    if (!goal) { goHome(u); return; }
    const gx = tileOf(goal.x), gy = tileOf(goal.y);
    if (u.order?.t !== 'move' || Math.hypot(u.order.gx - gx, u.order.gy - gy) > 2) orderMove(u, gx, gy);
    if (followPath(u, dt)) setOrder(u, null);
    return;
  }
  // waiting: back to its spot by the gate, and lick its wounds
  if (Math.hypot(u.x - dm.hx, u.y - dm.hy) > TS * 0.8) {
    if (u.order?.t !== 'move') orderMove(u, tileOf(dm.hx), tileOf(dm.hy));
    if (followPath(u, dt)) { setOrder(u, null); dm.hx = u.x; dm.hy = u.y; }
    return;
  }
  if (u.order) setOrder(u, null);
  u.face = u.tface = turnToward(u.face, Math.atan2(u.y - c.y, u.x - c.x), unitDef(u).turn * dt); // keeping watch, back to the gate
  u.hp = Math.min(u.maxhp, u.hp + u.maxhp * LURK_REGEN * dt);
}

/** Tiles in the map that the gate covers: for blocking (map.ts) and the renderer. */
export function eachGateTile(f: (i: number, x: number, y: number) => void): void {
  for (let y = GATE_TILE[1]; y < GATE_TILE[1] + GATE_SIZE; y++) for (let x = GATE_TILE[0]; x < GATE_TILE[0] + GATE_SIZE; x++) if (x < MW && y < MH) f(y * MW + x, x, y);
}
