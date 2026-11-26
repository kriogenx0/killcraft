// Finds Workers that look confused: walking about without getting anywhere or doing anything,
// switching jobs back and forth, standing idle, or setting out for the field with a full load.
// The human side's economy is played by a simple script (Workers trained, a few structures placed)
// while the computer plays the other side. Used by dither.test.ts and by
// `node src/sim/dither.ts [seed] [seconds]`.
import { G, oreLoadOf, tileOf, type Ent } from '../game/state.ts';
import { applyCommand } from '../game/command.ts';
import { isDrawing } from '../game/aether.ts';
import { onErrand } from '../game/autogather.ts';
import { MW, STEP, TS } from '../game/const.ts';
import { ais, findSite } from '../game/ai.ts';
import { initWorld, update } from '../game/world.ts';
import { enqueue, startSite } from '../game/production.ts';
import type { BldType } from '../data/building.ts';
import { mulberry32 } from '../util/math.ts';

/** Seconds of walking looked back over, and how far a Worker must walk in that time without getting anywhere to count as dithering. */
const WINDOW = 10, WALKED = 8, NET = 1.5;
/** Seconds a Worker may stand in one spot without working before it counts as idle. */
const STILL = 8;

interface Track { still: { t: number; x: number; y: number }; last: string; res: string; swaps: number[]; flips: number[]; idleT: number; carry: number; trail: { t: number; x: number; y: number; d: number; busy: boolean }[] }

const jobOf = (u: Ent): string => (!u.order ? 'idle' : u.order.t === 'harvest' ? `${u.order.res ?? 'ore'}:${u.order.st}` : u.order.t);

/** Play `seconds` of a seeded game (seed Math.random first to repeat it exactly) and describe every confused Worker on the scripted side (team 0). */
export function watchWorkers(seed: number, seconds: number, chaos = false): string[] {
  initWorld(seed);
  ais[0].on = false;
  ais[1].on = true;
  const plan: [number, BldType][] = [[20, 'power'], [50, 'mill'], [80, 'barracks'], [110, 'refinery'], [160, 'derrick'], [200, 'power'], [250, 'barracks']];
  const seen = new Map<Ent, Track>(), out: string[] = [], told = new Map<Ent, number>();
  const pick = <T,>(a: readonly T[]): T | undefined => a[Math.floor(Math.random() * a.length)];
  const poke = () => {
    const ws = G.ents.filter((e) => !e.dead && e.team === 0 && e.type === 'worker');
    const mine = G.ents.filter((e) => !e.dead && e.team === 0 && e.kind === 'bld');
    const some = ws.filter(() => Math.random() < 0.3);
    if (!some.length) return;
    const ids = some.map((w) => w.id), r = Math.random();
    const derrick = pick(mine.filter((b) => b.type === 'derrick' && b.done));
    for (const w of some) told.set(w, G.gameT);
    if (r < 0.35) applyCommand(0, { c: 'gather', ids, res: pick(['auto', 'ore', 'wood', 'oil', 'aether'] as const) ?? 'auto' });
    else if (r < 0.5) { const w = some[0]; applyCommand(0, { c: 'move', ids, tx: tileOf(w.x) + Math.floor(Math.random() * 9) - 4, ty: tileOf(w.y) + Math.floor(Math.random() * 9) - 4 }); }
    else if (r < 0.6) applyCommand(0, { c: 'stop', ids });
    else if (r < 0.7) { const b = pick(mine); if (b) applyCommand(0, { c: 'fix', ids, target: b.id }); }
    else if (r < 0.8 && derrick) applyCommand(0, { c: 'recruit', id: derrick.id });
    else if (r < 0.9 && derrick) applyCommand(0, { c: 'haul', ids, target: derrick.id });
    else applyCommand(0, { c: 'stance', ids, stance: pick(['tend', 'passive', 'engage'] as const) ?? 'tend' });
  };
  // walking back, swapping or switching soon after a player's order is the player's doing, not the Worker's
  const say = (u: Ent, what: string) => (/stood/.test(what) || G.gameT - (told.get(u) ?? -1e9) > 15) && out.push(`${G.gameT.toFixed(0)}s Worker ${u.id} ${what} (${jobOf(u)} at ${(u.x / TS).toFixed(1)},${(u.y / TS).toFixed(1)})`);
  for (let step = 1; G.gameT < seconds && !G.over; step++) {
    update(STEP);
    if (step % 60 === 0) {
      const n = G.ents.filter((e) => !e.dead && e.team === 0 && e.type === 'worker').length;
      if (n < 10 && G.credits[0] > 400 && !G.prod[0].infantry.length) enqueue(0, 'worker');
      while (plan.length && G.gameT > plan[0][0]) { const [, t] = plan.shift() as [number, BldType]; const s = findSite(0, t); if (s) startSite(0, t, s[0], s[1]); }
    }
    // a busy player: every few seconds some Workers get a random order (gather, move, stop, fix,
    // haul oil, stance), as a player taps away on a phone
    if (chaos && step % 420 === 0) poke();
    if (step % 6) continue;
    for (const u of G.ents) {
      if (u.dead || u.team !== 0 || u.type !== 'worker') continue;
      let h = seen.get(u);
      // a Worker the player just gave an order to may stand about a moment: that's theirs to judge
      if (G.gameT - (told.get(u) ?? -1e9) < STILL) { if (h) { h.still = { t: G.gameT, x: u.x, y: u.y }; h.idleT = 0; } continue; }
      if (!h) seen.set(u, (h = { still: { t: G.gameT, x: u.x, y: u.y }, last: jobOf(u), res: '', swaps: [], flips: [], idleT: 0, carry: u.carry, trail: [] }));
      const j = jobOf(u), kind = j.split(':')[0];
      if (j !== h.last) { if (h.last.split(':')[0] !== kind) h.flips.push(G.gameT); h.last = j; }
      h.flips = h.flips.filter((t) => G.gameT - t < 30);
      // swapping resource (ore, wood, oil) over and over: Auto should settle
      // a load of oil, or a trip out for salvage, is an errand, not a swap
      const o = u.order, errand = o?.t === 'harvest' && (o.res === 'oil' || onErrand(u) || (!o.res && G.scrap[o.ty * MW + o.tx] === 1));
      const res = o?.t === 'harvest' && !errand ? o.res ?? 'ore' : '';
      if (res && res !== h.res) { if (h.res) h.swaps.push(G.gameT); h.res = res; }
      h.swaps = h.swaps.filter((t) => G.gameT - t < 120);
      if (h.swaps.length >= 3) { say(u, `swapped resource ${h.swaps.length} times in 2 minutes`); h.swaps = []; }
      if (h.flips.length >= 6) { say(u, `switched jobs ${h.flips.length} times in 30s`); h.flips = []; }
      if (u.order?.t === 'harvest' && u.order.st === 'go' && !u.order.res && u.carry >= oreLoadOf(u) - 0.5) say(u, 'set out for the field with a full load');
      // standing in one spot with nothing to show for it, order or no order (bar a Worker set to Oil
      // waiting by its derrick for the pump to fill the tank)
      const pump = u.order?.t === 'harvest' && u.order.res === 'oil' && !u.order.auto && u.order.st === 'gather';
      if (pump || u.atkT > 0 || isDrawing(u) || Math.abs(u.carry - h.carry) > 0.01 || Math.hypot(u.x - h.still.x, u.y - h.still.y) > TS / 2) h.still = { t: G.gameT, x: u.x, y: u.y };
      else if (G.gameT - h.still.t > STILL) { say(u, `stood still ${STILL}s doing nothing`); h.still = { t: G.gameT + 1e9, x: u.x, y: u.y }; }
      // walking Aether home (Return Aether) counts as busy
      if (!u.order && !isDrawing(u) && !u.aeRun) { h.idleT += STEP * 6; if (h.idleT > 6) { say(u, 'stood idle 6s'); h.idleT = -1e9; } } else h.idleT = 0;
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
  const seed = Number(process.argv[2] ?? 1), secs = Number(process.argv[3] ?? 420), chaos = process.argv[4] === 'chaos';
  Math.random = mulberry32(seed);
  const found = watchWorkers(seed, secs, chaos);
  console.log(`seed ${seed}: ${found.length} confused moments in ${G.gameT.toFixed(0)}s`);
  for (const f of found) console.log(f);
}
