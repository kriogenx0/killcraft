// Finds units that have an order but have stopped doing anything about it: standing still without
// shooting or harvesting, or milling about without getting any closer to where they're going.
// Used by the stuck-unit regression test and by `node src/sim/stuck.ts [matches] [seconds]`.
import { G, valid, type Ent } from '../game/state.ts';
import { STEP, TS } from '../game/const.ts';
import { ais } from '../game/ai.ts';
import { initWorld, update } from '../game/world.ts';
import { edgeDist } from '../game/path.ts';
import { ORE_BANKS, bankAt } from '../game/haul.ts';
import { mulberry32 } from '../util/math.ts';

/** How long (seconds) a unit may sit still with an order before it counts as stuck. */
export const STUCK_AFTER = 8;
/** How long (seconds) a unit may walk about without getting a tile closer to its goal. */
export const CIRCLING_AFTER = 20;
/** Dropping a target and taking the same one up again within REFIGHT_GAP seconds is a stutter; STUTTERS of them within STUTTER_WINDOW seconds get reported. */
export const REFIGHT_GAP = 2;
export const STUTTERS = 4;
export const STUTTER_WINDOW = 20;

/** The enemy a unit is fighting right now, if any. */
const fightOf = (u: Ent): number | null => (u.order?.t === 'attack' ? u.order.tgt : u.order?.t === 'move' ? u.order.sub : null);

interface FightWatch { cur: number | null; dropped: Map<number, number>; flips: number[] }

export interface StuckReport {
  /**
   * 'still': not moving at all; 'circling': moving, but getting no closer; 'stutter': dropping a
   * fight and taking it up again with the same enemy, over and over
   */
  kind: 'still' | 'circling' | 'stutter';
  seed: number;
  t: number;
  id: number;
  type: string;
  team: number;
  stance: string;
  order: string;
  x: number;
  y: number;
  path: number | null;
  /** distance to its goal or target, in tiles */
  dist: number | null;
}

interface Watch { x: number; y: number; since: number; key: string; carry: number; best: number; bestT: number; path: unknown }

const orderKey = (u: Ent): string => {
  const o = u.order;
  if (!o) return '';
  switch (o.t) {
    case 'move': return `move ${o.gx},${o.gy} sub=${o.sub ?? '-'}`;
    case 'attack': return `attack ${o.tgt}${o.auto ? ' auto' : ''}`;
    case 'harvest': return `harvest ${o.st} ${o.tx},${o.ty}`;
    case 'heal': return `heal ${o.tgt}`;
    case 'escort': return `escort ${o.tgt} sub=${o.sub ?? '-'}`;
  }
};

function distToGoal(u: Ent): number | null {
  const o = u.order;
  if (!o) return null;
  if (o.t === 'move') return Math.hypot((o.gx + 0.5) * TS - u.x, (o.gy + 0.5) * TS - u.y) / TS;
  if (o.t === 'harvest') {
    const ref = o.st === 'ret' ? bankAt(u, ORE_BANKS) : null;
    return ref ? edgeDist(u, ref) / TS : Math.hypot((o.tx + 0.5) * TS - u.x, (o.ty + 0.5) * TS - u.y) / TS;
  }
  const t = valid(o.tgt);
  return t ? edgeDist(u, t) / TS : null;
}

/** How far the unit still has to walk along its path, in tiles. */
function pathLeft(u: Ent): number | null {
  if (!u.path?.length) return null;
  let d = 0, x = u.x, y = u.y;
  for (const [tx, ty] of u.path) {
    const cx = (tx + 0.5) * TS, cy = (ty + 0.5) * TS;
    d += Math.hypot(cx - x, cy - y);
    x = cx; y = cy;
  }
  return d / TS;
}

/**
 * A unit doing its job while standing still: shooting, scooping or unloading, or a harvester
 * waiting with a load because its side has no refinery left.
 */
const busy = (u: Ent): boolean =>
  u.atkT > 0 || (u.order?.t === 'harvest' && (u.order.st === 'gather' || u.order.st === 'unload' || (u.order.st === 'ret' && !bankAt(u, ORE_BANKS))));

/**
 * Play a computer-only match and report every unit that held an order for STUCK_AFTER seconds
 * without moving, firing or harvesting. Each unit is reported at most once per order.
 */
export function findStuck(seed: number, seconds: number, teams = 4): StuckReport[] {
  const prevRandom = Math.random;
  Math.random = mulberry32(seed ^ 0x5eed);
  G.headless = true; G.demo = true; G.reveal = false; G.viewer = -1; G.human = [];
  initWorld(seed, teams);
  G.viewer = -1;
  for (let t = 0; t < G.teams; t++) ais[t].on = true;
  const watch = new Map<number, Watch>(), fights = new Map<number, FightWatch>(), out: StuckReport[] = [], told = new Set<string>();
  const report = (kind: StuckReport['kind'], u: Ent, key: string) => out.push({
    kind, seed, t: Math.round(G.gameT), id: u.id, type: u.type, team: u.team, stance: u.stance, order: key,
    x: Math.round(u.x / TS * 10) / 10, y: Math.round(u.y / TS * 10) / 10, path: u.path ? u.path.length : null,
    dist: distToGoal(u) == null ? null : Math.round((distToGoal(u) as number) * 10) / 10,
  });
  try {
    while (!G.over && G.gameT < seconds) {
      update(STEP);
      for (const u of G.ents) {
        if (u.dead || u.kind !== 'unit') continue;
        const key = orderKey(u), dist = pathLeft(u) ?? distToGoal(u) ?? 0;
        // stutter: the same enemy dropped and taken up again moments later
        const fight = fightOf(u);
        let f = fights.get(u.id);
        if (!f) fights.set(u.id, (f = { cur: fight, dropped: new Map(), flips: [] }));
        if (fight !== f.cur) {
          // switching to a more pressing enemy is fine; letting go of the fight altogether is what we watch
          if (f.cur != null && fight == null) f.dropped.set(f.cur, G.gameT);
          const was = fight == null ? undefined : f.dropped.get(fight);
          if (was != null && G.gameT - was < REFIGHT_GAP && valid(fight)) {
            f.flips.push(G.gameT);
            while (f.flips.length && G.gameT - f.flips[0] > STUTTER_WINDOW) f.flips.shift();
            if (f.flips.length >= STUTTERS && !told.has(`${u.id}|stutter`)) { told.add(`${u.id}|stutter`); report('stutter', u, key); }
          }
          f.cur = fight;
        }
        const w = watch.get(u.id);
        if (!w || key !== w.key || busy(u) || !u.order || u.carry !== w.carry) {
          watch.set(u.id, { x: u.x, y: u.y, since: G.gameT, key, carry: u.carry, best: dist, bestT: G.gameT, path: u.path });
          continue;
        }
        if (Math.hypot(u.x - w.x, u.y - w.y) > 6) { w.x = u.x; w.y = u.y; w.since = G.gameT; }
        // a new path is measured afresh (it may be a longer way round)
        if (u.path !== w.path) { w.path = u.path; w.best = dist; w.bestT = G.gameT; }
        if (dist < w.best - 1) { w.best = dist; w.bestT = G.gameT; }
        // a fight on the way (or a moving target) is progress of its own
        const heading = u.order.t === 'harvest' || (u.order.t === 'move' && u.order.sub == null);
        const kind = G.gameT - w.since >= STUCK_AFTER ? 'still' : heading && G.gameT - w.bestT >= CIRCLING_AFTER ? 'circling' : null;
        if (!kind) continue;
        const tag = `${u.id}|${key}`;
        if (told.has(tag)) continue;
        told.add(tag);
        report(kind, u, key);
      }
      for (const id of watch.keys()) if (!G.byId.get(id) || G.byId.get(id)?.dead) { watch.delete(id); fights.delete(id); }
    }
  } finally {
    Math.random = prevRandom;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(process.argv[2] ?? 4), secs = Number(process.argv[3] ?? 900);
  let total = 0;
  for (let s = 0; s < seeds; s++) {
    const seed = 1 + s * 7919, found = findStuck(seed, secs);
    total += found.length;
    for (const r of found) console.log(JSON.stringify(r));
    console.error(`seed ${seed}: ${found.length} stuck`);
  }
  console.error(`total ${total}`);
}
