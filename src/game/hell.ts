// The Gate of Hell (data/hell.ts): placing it, letting demons out, picking the leader they hunt,
// sending them on raids, and how a demon behaves at the gate and out on a raid.
import { G, allied, say, tileOf, unitDef, valid, type Ent } from './state.ts';
import { worth } from './bounty.ts';
import { GRASS, MH, MW, TS } from './const.ts';
import { WATER_LEVEL } from '../data/map.ts';
import { UNIT, type UnitType } from '../data/unit.ts';
import { isWall } from '../data/building.ts';
import {
  ARCHFIEND, ARCHFIEND_EVERY, ARCHFIEND_FIRST, BURST_GAP, DEMON_CAP, FIEND_SHARE, FIRST_RAID, GATE_CLEAR, GATE_LEASH, GATE_OPENS, GATE_SIZE, GATE_TILE,
  BRINK_AFTER, BRINK_FOES, BRINK_REACH, BRINK_SHARE, DRAKE_SHARE, LEADER_TRAINED, LINGER, RESCUE_COOLDOWN, RESCUE_DRAKES, RESCUE_SIZE, RESCUE_STAY, LURK_RADIUS, LURK_REGEN, RAID_EVERY, RAID_SIZE, RAID_WARNING, WANDER_EVERY, WANDER_SIZE, WANDER_STAY,
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
  G.hell = { gate: true, spawnT: GATE_OPENS, raidT: Infinity, archT: Infinity, prey: -1, burst: 0, burstT: 0, stay: WANDER_STAY, stir: false };
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

/** Start letting `n` demons out, one every BURST_GAP seconds, to stay out `stay` seconds (Infinity for raiders). */
function startBurst(n: number, stay: number): void {
  const H = G.hell;
  H.burst = Math.max(0, Math.round(n));
  H.burstT = G.gameT;
  H.stay = stay;
}

/** A demon for a pack: mostly Imps, some Hell Fiends and flying Hell Drakes. */
function pickDemon(): UnitType {
  const r = Math.random();
  return r < DRAKE_SHARE ? 'drake' : r < DRAKE_SHARE + FIEND_SHARE ? 'fiend' : 'imp';
}

/** Is this side about to lose: its Town Hall gone, or far behind with enemy troops in its base? */
export function onBrink(team: number): boolean {
  if (G.absent?.[team] || G.outLog?.some((o) => o.team === team)) return false;
  const mine = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld');
  if (!mine.length) return false; // nothing left to save
  if (!mine.some((e) => e.type === 'yard' && e.done)) return true;
  const w = worth(), top = Math.max(...w.filter((_, t) => !allied(t, team)));
  if (w[team] >= top * BRINK_SHARE) return false;
  let foes = 0;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || e.team < 0 || allied(e.team, team) || !unitDef(e).weapon || unitDef(e).haul) continue;
    if (mine.some((b) => Math.hypot(b.x - e.x, b.y - e.y) <= BRINK_REACH * TS) && ++foes >= BRINK_FOES) return true;
  }
  return false;
}

/** A last stand: the gate surges and sends a pack, flyers among them, to fight for this side. */
export function rescue(team: number): Ent[] {
  const H = G.hell, n = Math.round(between(RESCUE_SIZE));
  (H.rescued ??= [])[team] = G.gameT;
  const pack = Array.from({ length: n }, (_, i) => spawnDemon(i < RESCUE_DRAKES ? 'drake' : Math.random() < 0.4 ? 'fiend' : 'imp'));
  for (const d of pack) if (d.demon) { d.demon.aid = team; d.demon.until = Infinity; d.demon.calmT = G.gameT; }
  for (let t = 0; t < G.teams; t++)
    say(t, t === team ? 'The Gate of Hell answers your last stand: demons fly to your aid!' : allied(t, team) ? `Demons fly to the aid of ${teamColors(team).name}` : `The Gate of Hell sends demons to defend ${teamColors(team).name}!`);
  return pack;
}

/** Run the gate: called about once a second. */
export function updHell(): void {
  if (G.visualOnly || !G.hell?.gate) return;
  const H = G.hell, now = G.gameT;
  // a side about to lose: the gate sends help
  if (now >= BRINK_AFTER) {
    for (let t = 0; t < G.teams; t++) {
      if (now - (H.rescued?.[t] ?? -Infinity) < RESCUE_COOLDOWN || !onBrink(t)) continue;
      rescue(t);
      break; // one at a time
    }
  }
  // rescuers whose side is gone go home
  for (const d of demons()) if (d.demon && (d.demon.aid ?? -1) >= 0 && !G.ents.some((e) => !e.dead && e.team === d.demon?.aid)) goHome(d);
  // the leader
  const prey = demonPrey();
  if (prey !== H.prey) {
    const was = H.prey;
    H.prey = prey;
    if (prey >= 0) {
      if (was < 0) { H.raidT = now + FIRST_RAID; H.archT = now + ARCHFIEND_FIRST; }
      for (let t = 0; t < G.teams; t++)
        say(t, t === prey ? 'The Gate of Hell stirs: its demons hunt the strongest army, and that is yours' : `The Gate of Hell stirs: its demons hunt ${teamColors(prey).name}, the strongest army`);
    } else {
      H.raidT = H.archT = Infinity;
      H.stir = false;
      if (H.stay === Infinity) H.burst = 0;
      for (const d of demons()) if (d.demon && d.demon.raid < 0 && d.demon.until === Infinity) d.demon.until = now + LINGER;
    }
  }
  // demons out on a raid against a side that's no longer the leader go home
  for (const d of demons()) if (d.demon && d.demon.raid >= 0 && d.demon.raid !== prey && (d.demon.aid ?? -1) < 0) goHome(d);
  // no leader: now and then a few come out to prowl round the gate for a while
  if (prey < 0 && now >= H.spawnT) {
    H.spawnT = now + between(WANDER_EVERY);
    if (!demons().length) startBurst(between(WANDER_SIZE), WANDER_STAY);
  }
  // a raid coming: the gate lets the raiders out first, and any demons still about wait for it
  if (prey >= 0 && !H.stir && now >= H.raidT - RAID_WARNING) {
    H.stir = true;
    const out = demons().filter((d) => d.type !== ARCHFIEND);
    for (const d of out) if (d.demon && d.demon.raid < 0) d.demon.until = Infinity;
    startBurst(Math.min(DEMON_CAP - out.length, between(RAID_SIZE) - out.filter((d) => d.demon?.raid === -1).length), Infinity);
    if (now >= H.archT && !demons().some((d) => d.type === ARCHFIEND)) {
      H.archT = now + ARCHFIEND_EVERY;
      const a = spawnDemon(ARCHFIEND);
      if (a.demon) a.demon.until = Infinity;
      for (let t = 0; t < G.teams; t++) say(t, 'A giant Archfiend climbs out of the Gate of Hell');
    }
  }
  if ((H.burst ?? 0) > 0 && now >= (H.burstT ?? 0)) {
    H.burst = (H.burst ?? 1) - 1;
    H.burstT = now + BURST_GAP;
    const d = spawnDemon(pickDemon());
    if (d.demon) d.demon.until = now + (H.stay ?? WANDER_STAY);
  }
  // the raid sets out
  if (prey >= 0 && now >= H.raidT) {
    H.raidT = now + between(RAID_EVERY);
    H.stir = false;
    H.burst = 0;
    const waiting = demons().filter((d) => d.demon?.raid === -1 && (d.demon.aid ?? -1) < 0);
    for (const d of waiting) { if (d.demon) d.demon.raid = prey; setOrder(d, null); }
    if (waiting.length) for (let t = 0; t < G.teams; t++) say(t, t === prey ? 'Demons pour out of the Gate of Hell and come for you!' : `Demons pour out of the Gate of Hell and go for ${teamColors(prey).name}`);
  }
}

function goHome(u: Ent): void {
  if (!u.demon) return;
  u.demon.raid = -1;
  u.demon.aid = -1;
  u.demon.until = G.hell.stir ? Infinity : G.gameT + LINGER;
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

/** Whoever is attacking the side a rescuer came to save: the nearest enemy of that side within its sight, armed troops first. */
function rescueTarget(u: Ent, team: number): Ent | null {
  const r = unitDef(u).sight * TS;
  let best: Ent | null = null, bs = Infinity;
  for (const e of G.ents) {
    if (e.dead || e.team < 0 || allied(e.team, team) || e.kind === 'source' || (e.kind === 'bld' && isWall(e.type)) || !canAttack(u, e) || cloakedFrom(e, u.team)) continue;
    const d = edgeDist(u, e);
    if (d > r) continue;
    const s = d + (e.kind === 'bld' ? 200 : unitDef(e).weapon ? 0 : 40);
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}

/** Seconds a demon leaves alone an enemy it couldn't get at. */
const SNUB = 6;

/** A demon's turn. */
export function updDemon(u: Ent, dt: number): void {
  const dm = u.demon;
  if (!dm) return;
  const c = gateCentre(), sight = unitDef(u).sight * TS;
  const snubbed = (e: Ent) => dm.snub === e.id && G.gameT < (dm.snubT ?? 0);
  // whoever is hurting it gets it back if it's close, raiding or not; waiting by the gate, it won't chase anyone far off
  const aid = dm.aid ?? -1;
  const fightable = (e: Ent) => !snubbed(e) && !(aid >= 0 && allied(e.team, aid)) && (dm.raid >= 0 || aid >= 0 || Math.hypot(e.x - c.x, e.y - c.y) < GATE_LEASH * TS || Math.hypot(e.x - u.x, e.y - u.y) <= sight);
  let t = u.order?.t === 'attack' ? valid(u.order.tgt) : null;
  if (t && (!isFoe(u, t) || !fightable(t))) t = null;
  u.scan -= dt;
  if (u.scan <= 0) {
    u.scan = 0.4;
    const a = attacker(u);
    if (a && fightable(a)) t = a;
    else if (dm.raid >= 0 && (!t || t.team !== dm.raid)) t = raidTarget(u, dm.raid) ?? t;
    else if (aid >= 0 && !t) t = rescueTarget(u, aid);
  }
  if (t) {
    if (u.order?.t !== 'attack' || u.order.tgt !== t.id) setOrder(u, { t: 'attack', tgt: t.id, auto: true, ox: u.x, oy: u.y });
    if (combatStep(u, t, dt)) return;
    // can't get at it: leave it be for a while rather than trying again and again
    dm.snub = t.id;
    dm.snubT = G.gameT + SNUB;
    if (u.foe === t.id) u.foe = null;
    setOrder(u, null);
  } else if (u.order?.t === 'attack') setOrder(u, null);
  if (aid >= 0) {
    // to the rescued side's base, and stand guard there until it's been clear a while
    if (t) dm.calmT = G.gameT;
    const home = raidGoal(u, aid);
    if (!home) { goHome(u); return; }
    if (Math.hypot(u.x - home.x, u.y - home.y) > 4 * TS) {
      const gx = tileOf(home.x), gy = tileOf(home.y);
      if (u.order?.t !== 'move' || Math.hypot(u.order.gx - gx, u.order.gy - gy) > 2) orderMove(u, gx, gy);
      if (followPath(u, dt)) setOrder(u, null);
      dm.calmT = G.gameT; // still on the way
    } else if (u.order) setOrder(u, null);
    if (G.gameT - (dm.calmT ?? G.gameT) > RESCUE_STAY) goHome(u);
    return;
  }
  if (dm.raid >= 0) {
    // march on the prey's base
    const goal = raidGoal(u, dm.raid);
    if (!goal) { goHome(u); return; }
    const gx = tileOf(goal.x), gy = tileOf(goal.y);
    // at the prey's door with nothing it can get at for now: wait here rather than circling the spot
    if (edgeDist(u, goal) <= 1.5 * TS) { if (u.order) setOrder(u, null); return; }
    if (u.order?.t !== 'move' || Math.hypot(u.order.gx - gx, u.order.gy - gy) > 2) orderMove(u, gx, gy);
    if (followPath(u, dt)) setOrder(u, null);
    return;
  }
  // its time out is up: back into the gate it goes
  if (G.gameT >= (dm.until ?? Infinity)) {
    if (Math.hypot(u.x - c.x, u.y - c.y) <= (GATE_SIZE / 2 + 1.2) * TS) { sink(u); return; }
    const a = Math.atan2(u.y - c.y, u.x - c.x), gx = tileOf(c.x + Math.cos(a) * (GATE_SIZE / 2 + 0.9) * TS), gy = tileOf(c.y + Math.sin(a) * (GATE_SIZE / 2 + 0.9) * TS);
    if (u.order?.t !== 'move') orderMove(u, gx, gy);
    if (followPath(u, dt)) sink(u); // as close as it gets
    return;
  }
  // waiting: back to its spot by the gate, and lick its wounds
  if (Math.hypot(u.x - dm.hx, u.y - dm.hy) > TS * 0.8) {
    if (u.order?.t !== 'move') orderMove(u, tileOf(dm.hx), tileOf(dm.hy));
    if (followPath(u, dt)) {
      setOrder(u, null);
      // got as close as it can: if that's not there, try another spot by the gate (or settle here, after a few tries)
      if (Math.hypot(u.x - dm.hx, u.y - dm.hy) > TS * 1.5) {
        dm.lost = (dm.lost ?? 0) + 1;
        const s = dm.lost > 3 ? { x: u.x, y: u.y } : lurkSpot();
        dm.hx = s.x; dm.hy = s.y;
      }
    }
    return;
  }
  dm.lost = 0;
  if (u.order) setOrder(u, null);
  u.face = u.tface = turnToward(u.face, Math.atan2(u.y - c.y, u.x - c.x), unitDef(u).turn * dt); // keeping watch, back to the gate
  u.hp = Math.min(u.maxhp, u.hp + u.maxhp * LURK_REGEN * dt);
}

/** A demon goes back down into the gate: it leaves no body. */
function sink(u: Ent): void {
  part('flash', u.x, u.y, { max: 0.5, size: 40, z: 10, col: '#ff4010' });
  burst('spark', u.x, u.y, 14, 50, 160, null, 10);
  u.dead = true;
  u.order = null;
}

/** Tiles in the map that the gate covers: for blocking (map.ts) and the renderer. */
export function eachGateTile(f: (i: number, x: number, y: number) => void): void {
  for (let y = GATE_TILE[1]; y < GATE_TILE[1] + GATE_SIZE; y++) for (let x = GATE_TILE[0]; x < GATE_TILE[0] + GATE_SIZE; x++) if (x < MW && y < MH) f(y * MW + x, x, y);
}
