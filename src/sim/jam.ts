// Big crowds on the move: stages scenarios where many units head into one area (a group move, a
// formation, a rally point every new unit walks to, a choke between walls, two armies crossing)
// and reports how many are still trying to get somewhere long after they should have arrived.
// Used by jam.test.ts and by `node src/sim/jam.ts [scenario]`.
import { G, isAir, unitDef, type Ent } from '../game/state.ts';
import { GRASS, MW, ROCK, STEP, TS } from '../game/const.ts';
import { ais } from '../game/ai.ts';
import { initWorld, update } from '../game/world.ts';
import { addBuilding, addUnit } from '../game/entity.ts';
import { rebuildBlk } from '../game/map.ts';
import { nearestFree } from '../game/path.ts';
import { groupMove, orderAttack, orderMove } from '../game/order.ts';
import { mulberry32 } from '../util/math.ts';
import type { UnitType } from '../data/unit.ts';

/** Open grass with nothing on it but a power plant in a far corner for each side. */
export function openField(): void {
  initWorld(1234);
  for (const a of ais) a.on = false;
  G.ents = [];
  G.byId.clear();
  G.terr.fill(GRASS);
  G.ore.fill(0);
  G.portals = [];
  G.waygates = [];
  G.warp.fill(-1);
  G.warpTeam.fill(-1);
  addBuilding('power', 0, 1, 61, false);
  addBuilding('power', 1, 61, 1, false);
  addUnit('harvester', 0, 4 * TS, 62 * TS);
  addUnit('harvester', 1, 62 * TS, 4 * TS);
  rebuildBlk();
}

const MIX: UnitType[] = ['rifleman', 'swordsman', 'tank', 'crossbowman', 'knight', 'heavy', 'gunner', 'minotaur', 'medic', 'catapult', 'rocket', 'cyclops'];
const SMALL: UnitType[] = ['rifleman', 'swordsman', 'crossbowman', 'gunner', 'medic', 'rocket'];

/** `n` units of team 0 in a block centred on tile (cx, cy). */
function block(n: number, cx: number, cy: number, mix = MIX, team = 0): Ent[] {
  const w = Math.ceil(Math.sqrt(n)), out: Ent[] = [];
  // shuffled a little (by the seed) so each run plays out differently
  for (let i = 0; i < n; i++) out.push(addUnit(mix[(i + Math.floor(Math.random() * 3)) % mix.length], team, (cx - w / 2 + (i % w) + 0.3 + Math.random() * 0.4) * TS, (cy - w / 2 + Math.floor(i / w) + 0.3 + Math.random() * 0.4) * TS));
  return out;
}

/** A ridge of rock two tiles thick down column `x`, with a gap `gap` tiles wide from row `gy`. */
function ridge(x: number, gy: number, gap: number): void {
  for (let y = 0; y < 96; y++) if (y < gy || y >= gy + gap) G.terr[y * MW + x] = G.terr[y * MW + x + 1] = ROCK;
  rebuildBlk();
}

/** The ground and units in a box of tiles, two characters per tile: # blocked, ~ water, letters units (capital: idle). */
export function asciiMap(x0: number, y0: number, x1: number, y1: number): string {
  const W = (x1 - x0 + 1) * 2, rows: string[][] = [];
  for (let y = y0 * 2; y <= y1 * 2 + 1; y++) {
    const row: string[] = [];
    for (let x = x0 * 2; x <= x1 * 2 + 1; x++) { const k = (y >> 1) * MW + (x >> 1); row.push(G.blk[k] ? '#' : G.terr[k] === GRASS ? '.' : ','); }
    rows.push(row);
  }
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || isAir(e)) continue;
    const cx = Math.floor(e.x / 16) - x0 * 2, cy = Math.floor(e.y / 16) - y0 * 2;
    if (cx < 0 || cy < 0 || cx >= W || cy >= rows.length) continue;
    const c = e.type[0];
    rows[cy][cx] = e.order ? c : c.toUpperCase();
  }
  return rows.map((r) => r.join('')).join('\n');
}

export interface JamResult { name: string; units: number; still: number; walking: number; slow: number; done: number; t: number; far: number; idleStuck: number; late: number }

/** Run until every unit has finished its order or `limit` seconds pass. */
function play(name: string, us: Ent[], limit: number, spawn?: ((t: number) => Ent | null) | null, fight = false): JamResult {
  const all = [...us], goal = new Map<Ent, [number, number]>();
  const ideal = new Map<Ent, number>(), arrived = new Map<Ent, number>();
  const note = (u: Ent) => {
    if (u.order?.t !== 'move' || goal.has(u)) return;
    goal.set(u, [u.order.gx, u.order.gy]);
    let d = 0, x = u.x, y = u.y;
    for (const [tx, ty] of u.path ?? []) { d += Math.hypot((tx + 0.5) * TS - x, (ty + 0.5) * TS - y); x = (tx + 0.5) * TS; y = (ty + 0.5) * TS; }
    ideal.set(u, G.gameT + d / (unitDef(u).spd * TS));
  };
  us.forEach(note);
  const fired = new Map<Ent, number>();
  const stall = new Map<Ent, [number, number, number]>(), stalled = new Set<Ent>();
  const last = new Map<Ent, [number, number, number]>();
  let slow = 0;
  for (let i = 0; i < limit / STEP; i++) {
    const s = spawn?.(G.gameT);
    if (s) { all.push(s); note(s); }
    update(STEP);
    const snap = process.env.JAM_SNAP?.split(',').map(Number);
    if (snap && Math.abs(G.gameT - snap[0]) < STEP / 2) console.log(asciiMap(snap[1], snap[2], snap[3], snap[4]));
    const tr = Number(process.env.JAM_TRACE ?? 0);
    if (tr && i % 15 === 0) {
      const u = G.byId.get(tr);
      if (u && !u.dead && all.includes(u)) console.log(`   ${G.gameT.toFixed(1)} #${tr} ${(u.x / TS).toFixed(2)},${(u.y / TS).toFixed(2)} face=${u.face.toFixed(2)} wp=${u.path?.[0]} len=${u.path?.length} goal=${u.goal} order=${JSON.stringify(u.order)}`);
    }
    for (const u of all) {
      if (u.atkT > 0) fired.set(u, G.gameT);
      if (G.gameT - (fired.get(u) ?? -9) < 2) { last.delete(u); stall.delete(u); continue; }
      if (u.dead || !u.order) stall.delete(u);
      else {
        const w = stall.get(u);
        if (!w || Math.hypot(u.x - w[0], u.y - w[1]) > 8) stall.set(u, [u.x, u.y, G.gameT]);
        else if (G.gameT - w[2] > 8) stalled.add(u);
      }
      if (!u.dead && !u.order && !arrived.has(u)) arrived.set(u, G.gameT);
      if (u.dead || !u.order) { last.delete(u); continue; }
      const l = last.get(u);
      if (!l) { last.set(u, [u.x, u.y, G.gameT]); continue; }
      if (Math.hypot(u.x - l[0], u.y - l[1]) > TS) last.set(u, [u.x, u.y, G.gameT]);
      else if (G.gameT - l[2] > 6) {
        slow++; last.set(u, [u.x, u.y, G.gameT]);
        if (process.env.JAM_DEBUG) {
          const o = u.order, near = G.ents.filter((e) => e !== u && !e.dead && e.kind === 'unit' && Math.hypot(e.x - u.x, e.y - u.y) < 40);
          console.log(`  t=${G.gameT.toFixed(0)} #${u.id} ${u.type} at ${(u.x / TS).toFixed(1)},${(u.y / TS).toFixed(1)} ${o.t}${o.t === 'move' ? ` to ${o.gx},${o.gy} sub=${o.sub}` : o.t === 'attack' ? ` ${o.tgt}` : ''} path=${u.path?.length ?? '-'} moving=${u.moving} near: ${near.map((e) => `${e.type}${e.team === u.team ? '' : '(foe)'}${e.order ? ':' + e.order.t : ':idle'}`).join(' ')}`);
        }
      }
    }
    if (!spawn && !fight && all.every((u) => u.dead || !u.order)) break;
  }
  const live = all.filter((u) => !u.dead && !isAir(u));
  const busy = live.filter((u) => u.order);
  const done = live.length - busy.length;
  // how far (tiles) each finished unit stopped from its own spot, beyond what a tidy crowd needs
  const tidy = Math.sqrt(live.length) * 0.9 + 1.5;
  const far = live.filter((u) => !u.order && goal.has(u)).filter((u) => { const [gx, gy] = goal.get(u) as [number, number]; return Math.hypot((gx + 0.5) * TS - u.x, (gy + 0.5) * TS - u.y) / TS > tidy; }).length;
  // seconds lost, per unit, against walking its path alone at full speed
  let lost = 0;
  for (const u of live) lost += Math.max(0, (arrived.get(u) ?? G.gameT) - (ideal.get(u) ?? G.gameT));
  const late = Math.round((lost / Math.max(1, live.length)) * 10) / 10;
  return { name, units: live.length, far, late, idleStuck: stalled.size, still: busy.filter((u) => !u.moving).length, walking: busy.filter((u) => u.moving).length, slow, done, t: Math.round(G.gameT) };
}

export const SCENARIOS: Record<string, (seed: number) => JamResult> = {
  /** 48 mixed units sent to one spot across open ground. */
  group: () => { openField(); const us = block(48, 14, 32); groupMove(us, 46, 32); return play('group', us, 60); },
  /** the same in formation */
  formation: () => { openField(); const us = block(48, 14, 32); groupMove(us, 46, 32, false, true); return play('formation', us, 70); },
  /** 40 big creatures and tanks sent to one spot */
  big: () => { openField(); const us = block(40, 14, 32, ['cyclops', 'hydra', 'heavy', 'minotaur', 'tank', 'centaur']); groupMove(us, 46, 32); return play('big', us, 80); },
  /** 48 units squeezing through a two-tile gap in a wall */
  choke: () => { openField(); ridge(30, 31, 2); const us = block(48, 18, 32); groupMove(us, 44, 32); return play('choke', us, 120); },
  /** every new unit is ordered to the same rally tile, one every half second */
  rally: () => {
    openField();
    let n = 0;
    return play('rally', [], 60, (t) => {
      if (n >= 50 || t < n * 0.5) return null;
      const u = addUnit(MIX[n++ % MIX.length], 0, 12.5 * TS, (30.5 + (n % 3)) * TS);
      orderMove(u, 40, 32);
      return u;
    });
  },
  /** a rally point with idle troops already standing on it, then a second wave sent through them */
  through: () => {
    openField();
    block(30, 32, 32, SMALL);
    for (let i = 0; i < 100; i++) update(STEP);
    const us = block(30, 14, 32);
    groupMove(us, 50, 32);
    return play('through', us, 60);
  },
  /** 40 units told to attack one enemy building */
  siege: () => {
    openField();
    const b = addBuilding('factory', 1, 40, 31, false);
    rebuildBlk();
    const us = block(40, 20, 32);
    for (const u of us) orderAttack(u, b);
    return play('siege', us, 60, null, true);
  },
  /** two armies of 40 run into each other */
  brawl: () => {
    openField();
    const a = block(40, 20, 32), b = block(40, 44, 32, MIX, 1);
    groupMove(a, 44, 32); groupMove(b, 20, 32);
    return play('brawl', [...a, ...b], 60, null, true);
  },
  /**
   * A real base: a computer builds up for a while, then 50 troops come out by its Barracks and are
   * all sent to one spot on the far side of the base, threading the lanes between its buildings.
   */
  base: (seed) => {
    G.demo = true; G.headless = true; G.viewer = -1; G.human = [];
    initWorld(seed, 2);
    for (const a of ais) a.on = true;
    while (G.gameT < 420 && !G.over) update(STEP);
    ais[0].on = false;
    const home = G.ents.find((e) => !e.dead && e.team === 0 && e.type === 'yard') as Ent;
    const foe = G.ents.find((e) => !e.dead && e.team === 1 && e.type === 'yard') as Ent;
    for (const e of G.ents) if (e.kind === 'unit' && e.team === 0 && e.type !== 'worker' && !e.dead) e.dead = true;
    const bar = G.ents.find((e) => !e.dead && e.team === 0 && (e.type === 'barracks' || e.type === 'factory')) ?? home;
    const away = [Math.sign(home.x - foe.x), Math.sign(home.y - foe.y)];
    const spot: [number, number] = [home.tx + 1 + away[0] * 5, home.ty + 1 + away[1] * 5];
    let n = 0;
    const r = play('base', [], 60, (t) => {
      if (n >= 50 || t < 420 + n * 0.4) return null;
      const u = addUnit(MIX[n++ % MIX.length], 0, (bar.tx + bar.w + 0.5) * TS, (bar.ty + (n % bar.h) + 0.5) * TS);
      orderMove(u, spot[0], spot[1]);
      return u;
    });
    return r;
  },
  /** 50 troops told to hold fire march from one corner base to the other on a real map, through its chokes */
  march: (seed) => {
    G.demo = true; G.headless = true; G.viewer = -1; G.human = [];
    initWorld(seed, 2);
    for (const a of ais) a.on = false;
    const home = G.ents.find((e) => e.team === 0 && e.type === 'yard') as Ent, foe = G.ents.find((e) => e.team === 1 && e.type === 'yard') as Ent;
    const us: Ent[] = [];
    for (let r = 3; us.length < 50 && r < 12; r++)
      for (let y = home.ty - r; y <= home.ty + 2 + r && us.length < 50; y++)
        for (let x = home.tx - r; x <= home.tx + 2 + r && us.length < 50; x++) {
          if (Math.max(Math.abs(x - home.tx - 1), Math.abs(y - home.ty - 1)) !== r || x < 0 || y < 0 || x >= MW || y >= MW || G.blk[y * MW + x]) continue;
          const u = addUnit(MIX[us.length % MIX.length], 0, (x + 0.5) * TS, (y + 0.5) * TS);
          u.stance = 'passive';
          us.push(u);
        }
    const t = nearestFree(foe.tx + 1 + Math.sign(home.tx - foe.tx) * 6, foe.ty + 1 + Math.sign(home.ty - foe.ty) * 6) as [number, number];
    groupMove(us, t[0], t[1]);
    return play('march', us, 150);
  },
  /** two armies of the same side crossing head on */
  cross: () => {
    openField();
    const a = block(30, 14, 32), b = block(30, 50, 32);
    groupMove(a, 50, 32); groupMove(b, 14, 32);
    return play('cross', [...a, ...b], 60);
  },
};

export function runAll(seed = 7, only?: string): JamResult[] {
  const out: JamResult[] = [];
  for (const k of Object.keys(SCENARIOS)) {
    if (only && !k.startsWith(only)) continue;
    const prev = Math.random;
    Math.random = mulberry32(seed);
    G.demo = true; G.headless = true;
    try { out.push(SCENARIOS[k](seed)); } finally { Math.random = prev; }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2], seeds = (process.env.JAM_SEEDS ?? '3').split(',').map(Number);
  const sum = new Map<string, { n: number; late: number; slow: number; t: number; busy: number }>();
  for (const seed of seeds)
    for (const r of runAll(seed, only)) {
      if (seeds.length === 1) console.log(`${r.name.padEnd(10)} ${r.units} units: ${r.done} done, ${r.still} standing with an order, ${r.walking} still walking, ${r.slow} six-second stalls, ${r.far} stopped far off, ${r.idleStuck} stalled 8s, ${r.late}s lost each, after ${r.t}s`);
      const a = sum.get(r.name) ?? { n: 0, late: 0, slow: 0, t: 0, busy: 0 };
      a.n++; a.late += r.late; a.slow += r.slow; a.t += r.t; a.busy += r.still + r.walking;
      sum.set(r.name, a);
    }
  if (seeds.length > 1) for (const [k, a] of sum) console.log(`${k.padEnd(10)} lost ${(a.late / a.n).toFixed(1)}s each, ${(a.slow / a.n).toFixed(1)} stalls, ${(a.busy / a.n).toFixed(1)} unfinished, ${(a.t / a.n).toFixed(0)}s`);
}
