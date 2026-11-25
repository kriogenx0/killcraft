// Finds Workers that look confused: walking about without getting anywhere or doing anything,
// switching jobs back and forth, standing idle, or setting out for the field with a full load.
// The human side's economy is played by a simple script (Workers trained, a few structures placed)
// while the computer plays the other side. Used by dither.test.ts and by
// `node src/sim/dither.ts [seed] [seconds]`.
import { G, haulOf, type Ent } from '../game/state.ts';
import { STEP, TS } from '../game/const.ts';
import { ais, findSite } from '../game/ai.ts';
import { initWorld, update } from '../game/world.ts';
import { enqueue, startSite } from '../game/production.ts';
import type { BldType } from '../data/building.ts';
import { mulberry32 } from '../util/math.ts';

/** Seconds of walking looked back over, and how far a Worker must walk in that time without getting anywhere to count as dithering. */
const WINDOW = 10, WALKED = 8, NET = 1.5;

interface Track { last: string; flips: number[]; idleT: number; carry: number; trail: { t: number; x: number; y: number; d: number; busy: boolean }[] }

const jobOf = (u: Ent): string => (!u.order ? 'idle' : u.order.t === 'harvest' ? `${u.order.res ?? 'ore'}:${u.order.st}` : u.order.t);

/** Play `seconds` of a seeded game (seed Math.random first to repeat it exactly) and describe every confused Worker on the scripted side (team 0). */
export function watchWorkers(seed: number, seconds: number): string[] {
  initWorld(seed);
  ais[0].on = false;
  ais[1].on = true;
  const plan: [number, BldType][] = [[20, 'power'], [50, 'mill'], [80, 'barracks'], [110, 'refinery'], [160, 'derrick'], [200, 'power'], [250, 'barracks']];
  const seen = new Map<Ent, Track>(), out: string[] = [];
  const say = (u: Ent, what: string) => out.push(`${G.gameT.toFixed(0)}s Worker ${u.id} ${what} (${jobOf(u)} at ${(u.x / TS).toFixed(1)},${(u.y / TS).toFixed(1)})`);
  for (let step = 1; G.gameT < seconds && !G.over; step++) {
    update(STEP);
    if (step % 60 === 0) {
      const n = G.ents.filter((e) => !e.dead && e.team === 0 && e.type === 'worker').length;
      if (n < 10 && G.credits[0] > 400 && !G.prod[0].infantry.length) enqueue(0, 'worker');
      while (plan.length && G.gameT > plan[0][0]) { const [, t] = plan.shift() as [number, BldType]; const s = findSite(0, t); if (s) startSite(0, t, s[0], s[1]); }
    }
    if (step % 6) continue;
    for (const u of G.ents) {
      if (u.dead || u.team !== 0 || u.type !== 'worker') continue;
      let h = seen.get(u);
      if (!h) seen.set(u, (h = { last: jobOf(u), flips: [], idleT: 0, carry: u.carry, trail: [] }));
      const j = jobOf(u), kind = j.split(':')[0];
      if (j !== h.last) { if (h.last.split(':')[0] !== kind) h.flips.push(G.gameT); h.last = j; }
      h.flips = h.flips.filter((t) => G.gameT - t < 30);
      if (h.flips.length >= 6) { say(u, `switched jobs ${h.flips.length} times in 30s`); h.flips = []; }
      if (u.order?.t === 'harvest' && u.order.st === 'go' && !u.order.res && u.carry >= haulOf(u) - 0.5) say(u, 'set out for the field with a full load');
      if (!u.order) { h.idleT += STEP * 6; if (h.idleT > 6) { say(u, 'stood idle 6s'); h.idleT = -1e9; } } else h.idleT = 0;
      const p = h.trail[h.trail.length - 1];
      // busy: swinging a pick or hammer, loading or unloading, or called away to put up a new site
      const called = u.order?.t === 'heal' && u.order.sent;
      h.trail.push({ t: G.gameT, x: u.x, y: u.y, d: (p?.d ?? 0) + (p ? Math.hypot(u.x - p.x, u.y - p.y) : 0), busy: u.atkT > 0 || Math.abs(u.carry - h.carry) > 0.01 || !!called });
      h.carry = u.carry;
      while (h.trail.length && G.gameT - h.trail[0].t > WINDOW) h.trail.shift();
      const f = h.trail[0], l = h.trail[h.trail.length - 1];
      if (l.t - f.t > WINDOW - 1 && !h.trail.some((q) => q.busy) && l.d - f.d > WALKED * TS && Math.hypot(l.x - f.x, l.y - f.y) < NET * TS) {
        say(u, `walked ${((l.d - f.d) / TS).toFixed(0)} tiles in ${WINDOW}s and ended where it started`);
        h.trail = [];
      }
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seed = Number(process.argv[2] ?? 1), secs = Number(process.argv[3] ?? 420);
  Math.random = mulberry32(seed);
  const found = watchWorkers(seed, secs);
  console.log(`seed ${seed}: ${found.length} confused moments in ${G.gameT.toFixed(0)}s`);
  for (const f of found) console.log(f);
}
