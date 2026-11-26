// Head-to-head unit tests for balance: two groups of equal value meet on open grass and fight to
// the end. Shows which units pay for themselves against which, per age, without the noise of a
// whole match (economy, the computer's build order, map luck).
//
//   node src/sim/duel.ts --budget 4000 --reps 3 --json duel.json > duel.md
//
// A score runs from +1 (the row unit won and lost nothing) to -1 (wiped out without a scratch on
// the other side): the share of its value still standing, minus the other side's.
import { writeFileSync } from 'node:fs';
import { G, hooks, type Ent } from '../game/state.ts';
import { GRASS, MH, MW, STEP, TS } from '../game/const.ts';
import { ais } from '../game/ai.ts';
import { initWorld, update } from '../game/world.ts';
import { addBuilding, addUnit } from '../game/entity.ts';
import { groupMove } from '../game/order.ts';
import { rebuildBlk } from '../game/map.ts';
import { UNIT, UNIT_TYPES, type UnitType } from '../data/unit.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import { ERA } from '../data/era.ts';
import { mulberry32 } from '../util/math.ts';

/** Ore an Aether point is worth when pricing a unit for a duel (it's rare and never grows back). */
export const AETHER_VALUE = 3;

export const duelPrice = (type: UnitType | BldType): number => {
  const d = type in UNIT ? UNIT[type as UnitType] : BUILDING[type as BldType];
  return d.cost + (d.wood ?? 0) + (d.oil ?? 0) + ('aether' in d ? (d.aether ?? 0) * AETHER_VALUE : 0);
};

/** Units that fight (not Workers, Harvesters or Medics). */
export const FIGHTERS = UNIT_TYPES.filter((t) => UNIT[t].weapon && t !== 'worker' && !UNIT[t].demon && !UNIT[t].summoned); // demons can't be trained, nor can Bees

/** Can units of this type be trained in this age? Creatures come in any age once captured. */
export const inAge = (t: UnitType, age: number) => UNIT[t].era <= age && (UNIT[t].until ?? 99) > age;

function arena(seed: number): void {
  for (const a of ais) a.on = false;
  G.headless = true;
  G.demo = true;
  G.reveal = true;
  G.viewer = -1;
  G.human = [];
  initWorld(seed, 2);
  G.ents = [];
  G.byId.clear();
  G.projs = [];
  G.respawns = [];
  G.portals = [];
  G.hell.gate = false;
  G.terr.fill(GRASS);
  G.elev.fill(0);
  G.ore.fill(0);
  rebuildBlk();
  // plenty of power far off, so defenses fire at full rate
  for (let t = 0; t < 2; t++) for (let i = 0; i < 4; i++) addBuilding('power', t, 2 + i * 3, t ? MH - 4 : 2, false);
  // and a Town Hall each, so neither side counts as beaten (world.ts stranded) while it still fights
  for (let t = 0; t < 2; t++) addBuilding('yard', t, MW - 5, t ? MH - 5 : 2, false);
  rebuildBlk();
}

/** Counts of each side that spend nearly the same and land near the budget. */
export function counts(pa: number, pb: number, budget: number): [number, number] {
  let best: [number, number] = [1, 1], err = Infinity;
  for (let a = 1; a * pa <= budget * 1.6 || a === 1; a++) {
    const b = Math.max(1, Math.round((a * pa) / pb));
    const spend = Math.max(a * pa, b * pb), e = Math.abs(a * pa - b * pb) / spend + Math.abs(spend - budget) / budget * 0.3;
    if (e < err) { err = e; best = [a, b]; }
  }
  return best;
}

function place(type: UnitType, team: number, n: number, cx: number): Ent[] {
  const big = UNIT[type].radius > 9, gap = big ? 1.5 : 1, rows = Math.min(n, big ? 5 : 8);
  return Array.from({ length: n }, (_, i) => {
    const col = Math.floor(i / rows), row = i % rows;
    const x = (cx + (team ? col : -col) * gap) * TS, y = (MH / 2 - (rows * gap) / 2 + row * gap) * TS;
    const u = addUnit(type, team, x, y);
    u.face = u.tface = team ? Math.PI : 0;
    return u;
  });
}

const valueLeft = (us: Ent[]) => us.reduce((s, u) => s + (u.dead ? 0 : (u.hp / u.maxhp) * duelPrice(u.type as UnitType)), 0);

export interface Duel { a: string; b: string; na: number; nb: number; score: number; time: number }

/** Two groups of units of about equal value walk at each other and fight it out. */
export function duel(a: UnitType, b: UnitType, budget: number, seed: number, maxSeconds = 150): Duel {
  const prevRandom = Math.random;
  Math.random = mulberry32(seed ^ 0xd0e1);
  hooks.error = (e) => { throw e; };
  arena(seed);
  const [na, nb] = counts(duelPrice(a), duelPrice(b), budget);
  const A = place(a, 0, na, MW / 2 - 6), B = place(b, 1, nb, MW / 2 + 6);
  const ta = na * duelPrice(a), tb = nb * duelPrice(b);
  const armed = (us: Ent[]) => us.some((u) => !u.dead);
  let t = 0;
  while (t < maxSeconds && armed(A) && armed(B)) {
    // every couple of seconds, idle units close in on the other group
    if (Math.round(t / STEP) % 120 === 0) {
      for (const [us, them] of [[A, B], [B, A]] as const) {
        const live = them.filter((u) => !u.dead);
        if (!live.length) continue;
        const gx = Math.floor(live.reduce((s, u) => s + u.x, 0) / live.length / TS), gy = Math.floor(live.reduce((s, u) => s + u.y, 0) / live.length / TS);
        groupMove(us.filter((u) => !u.dead && (!u.order || u.order.t === 'move')), gx, gy);
      }
    }
    update(STEP);
    t += STEP;
  }
  Math.random = prevRandom;
  return { a, b, na, nb, score: valueLeft(A) / ta - valueLeft(B) / tb, time: Math.round(t) };
}

/** A defensive structure against a group of attackers worth `budget`. Score is the structure's side. */
export function siege(def: BldType, atk: UnitType, budget: number, seed: number, maxSeconds = 150): Duel {
  const prevRandom = Math.random;
  Math.random = mulberry32(seed ^ 0x51e6);
  hooks.error = (e) => { throw e; };
  arena(seed);
  const nd = Math.max(1, Math.round(budget / duelPrice(def)));
  const D = Array.from({ length: nd }, (_, i) => addBuilding(def, 0, MW / 2 - 4, MH / 2 - nd + i * 2, false));
  rebuildBlk();
  const td = nd * duelPrice(def), na = Math.max(1, Math.round(td / duelPrice(atk)));
  const A = place(atk, 1, na, MW / 2 + 8), ta = na * duelPrice(atk);
  let t = 0;
  while (t < maxSeconds && D.some((d) => !d.dead) && A.some((u) => !u.dead)) {
    if (Math.round(t / STEP) % 120 === 0) {
      const live = D.filter((d) => !d.dead);
      for (const u of A) if (!u.dead && (!u.order || u.order.t === 'move')) {
        const tgt = live.reduce((m, d) => (Math.hypot(d.x - u.x, d.y - u.y) < Math.hypot(m.x - u.x, m.y - u.y) ? d : m), live[0]);
        u.order = { t: 'attack', tgt: tgt.id, auto: false, ox: u.x, oy: u.y };
      }
    }
    update(STEP);
    t += STEP;
  }
  Math.random = prevRandom;
  const left = (es: Ent[], total: number, price: number) => es.reduce((s, e) => s + (e.dead ? 0 : (e.hp / e.maxhp) * price), 0) / total;
  return { a: def, b: atk, na: nd, nb: na, score: left(D, td, duelPrice(def)) - left(A, ta, duelPrice(atk)), time: Math.round(t) };
}

/**
 * Siege speed: units worth `budget` knock down a row of Power Plants guarded by two Watchtowers. Returns building
 * hit points destroyed per second for each 1000 of value, so siege units show their purpose.
 */
export function wreck(atk: UnitType, budget: number, seed: number, maxSeconds = 120): number {
  const prevRandom = Math.random;
  Math.random = mulberry32(seed ^ 0x3ec4);
  hooks.error = (e) => { throw e; };
  arena(seed);
  const Bs = Array.from({ length: 4 }, (_, i) => addBuilding('power', 0, MW / 2 - 4, MH / 2 - 6 + i * 3, false));
  // two Watchtowers guard them: units that out-range towers (siege) can knock the base down unhurt
  for (const dy of [-3, 3]) Bs.push(addBuilding('tower', 0, MW / 2 - 1, MH / 2 + dy, false));
  rebuildBlk();
  const na = Math.max(1, Math.round(budget / duelPrice(atk)));
  const A = place(atk, 1, na, MW / 2 + 4);
  const total = Bs.reduce((s, b) => s + b.maxhp, 0);
  let t = 0;
  while (t < maxSeconds && Bs.some((b) => !b.dead)) {
    if (Math.round(t / STEP) % 60 === 0) {
      const live = Bs.filter((b) => !b.dead);
      for (const u of A) if (!u.dead && (!u.order || u.order.t === 'move')) {
        const tgt = live.reduce((m, d) => (Math.hypot(d.x - u.x, d.y - u.y) < Math.hypot(m.x - u.x, m.y - u.y) ? d : m), live[0]);
        u.order = { t: 'attack', tgt: tgt.id, auto: false, ox: u.x, oy: u.y };
      }
    }
    update(STEP);
    t += STEP;
  }
  Math.random = prevRandom;
  const done = Bs.reduce((s, b) => s + (b.dead ? b.maxhp : b.maxhp - b.hp), 0);
  return done / Math.max(1, t) / ((na * duelPrice(atk)) / 1000) * (done >= total ? 1 : done / total);
}

/** A unit "has a purpose" in an age if it wins some trade clearly, or wrecks buildings among the fastest. */
export const NICHE = 0.4;

// ---- runner ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args.set(argv[i].slice(2), argv[i + 1]?.startsWith('--') ? 'true' : argv[++i] ?? 'true');
  const budget = Number(args.get('budget') ?? 4000), reps = Number(args.get('reps') ?? 3);
  const only = args.get('only')?.split(',') as UnitType[] | undefined;
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const scores = new Map<string, number>();
  const all: Duel[] = [];
  const t0 = performance.now();
  for (let i = 0; i < FIGHTERS.length; i++)
    for (let j = i + 1; j < FIGHTERS.length; j++) {
      const a = FIGHTERS[i], b = FIGHTERS[j];
      if (only && !only.includes(a) && !only.includes(b)) continue;
      const rs = Array.from({ length: reps }, (_, r) => duel(a, b, budget, 1000 + r * 31));
      all.push(...rs);
      scores.set(`${a}|${b}`, avg(rs.map((r) => r.score)));
      scores.set(`${b}|${a}`, -avg(rs.map((r) => r.score)));
    }
  const DEFS: BldType[] = ['tower', 'turret', 'pillbox', 'atturret', 'flak'];
  const sieges = new Map<string, number>();
  for (const d of DEFS) for (const u of FIGHTERS) {
    if (UNIT[u].era > Math.max(1, BUILDING[d].era) && !UNIT[u].beast) continue;
    if (only && !only.includes(u)) continue;
    const rs = Array.from({ length: reps }, (_, r) => siege(d, u, Math.max(budget / 2, duelPrice(d)), 2000 + r * 31));
    sieges.set(`${d}|${u}`, avg(rs.map((r) => r.score)));
  }
  const wrecks = new Map<string, number>();
  for (const u of FIGHTERS) {
    if (only && !only.includes(u)) continue;
    wrecks.set(u, avg([0, 1].map((r) => wreck(u, 2000, 3000 + r * 31))));
  }
  process.stderr.write(`${all.length} duels in ${((performance.now() - t0) / 1000).toFixed(0)}s\n`);
  if (args.get('json')) writeFileSync(args.get('json') as string, JSON.stringify({ budget, reps, scores: Object.fromEntries(scores), sieges: Object.fromEntries(sieges), wrecks: Object.fromEntries(wrecks) }));

  const fmt = (n: number | undefined) => (n == null ? '' : (n >= 0 ? '+' : '') + n.toFixed(2));
  const out: string[] = [`# Unit duels: equal value, open ground (budget ${budget}, Aether at ${AETHER_VALUE} ore)`, ''];
  for (let age = 0; age < ERA.length; age++) {
    const us = FIGHTERS.filter((t) => inAge(t, age));
    out.push(`## ${ERA[age].name}`, '', 'Average score against every other unit of the age (+ wins its trades, - loses them):', '');
    const rows = us.map((a) => ({ a, s: avg(us.filter((b) => b !== a).map((b) => scores.get(`${a}|${b}`) ?? 0)) })).sort((x, y) => y.s - x.s);
    out.push('| Unit | Price | Avg score | Best against | Worst against |', '| --- | ---: | ---: | --- | --- |');
    for (const { a, s } of rows) {
      const vs = us.filter((b) => b !== a).map((b) => [b, scores.get(`${a}|${b}`) ?? 0] as const).sort((x, y) => y[1] - x[1]);
      out.push(`| ${UNIT[a].name} | ${duelPrice(a)} | ${fmt(s)} | ${vs.slice(0, 2).map(([b, v]) => `${UNIT[b].name} ${fmt(v)}`).join(', ')} | ${vs.slice(-2).reverse().map(([b, v]) => `${UNIT[b].name} ${fmt(v)}`).join(', ')} |`);
    }
    out.push('');
  }
  out.push('## Does every unit have a purpose?', '', `A unit has a purpose in an age if it beats at least one other unit of that age by ${NICHE} or more at equal value, or is among the three fastest at knocking down buildings. It is outclassed if another unit from the same producer, and no harder to get (creatures need a capture, Aether units need Aether), does at least as well against every opponent, better overall, and knocks down buildings about as fast. Things duels can't measure (cloaking, the hex slow, sight, speed for raiding) are not counted.`, '');
  out.push('| Age | Unit | Beats clearly | Wrecks buildings (hp/s per 1000) | Outclassed by | Verdict |', '| --- | --- | --- | ---: | --- | --- |');
  for (let age = 0; age < ERA.length; age++) {
    const us = FIGHTERS.filter((t) => inAge(t, age));
    const topWreck = [...us].sort((x, y) => (wrecks.get(y) ?? 0) - (wrecks.get(x) ?? 0)).slice(0, 3);
    for (const a of us) {
      const others = us.filter((b) => b !== a);
      const beats = others.filter((b) => (scores.get(`${a}|${b}`) ?? 0) >= NICHE);
      const sa = avg(others.map((b) => scores.get(`${a}|${b}`) ?? 0));
      // only something no harder to get counts: creatures need a capture, Aether units need Aether
      // and one-of-a-kind units (the Titan) or ones only an egg hatches are harder still
      const rarity = (t: UnitType) => (UNIT[t].hatched || UNIT[t].limit ? 3 : UNIT[t].beast ? 2 : UNIT[t].aether ? 1 : 0);
      const over = us.filter((c) => c !== a && UNIT[c].producer === UNIT[a].producer && rarity(c) <= rarity(a) &&
        (wrecks.get(c) ?? 0) >= (wrecks.get(a) ?? 0) * 0.9 &&
        others.filter((b) => b !== c).every((b) => (scores.get(`${c}|${b}`) ?? 0) >= (scores.get(`${a}|${b}`) ?? 0) - 0.05) &&
        avg(us.filter((b) => b !== c).map((b) => scores.get(`${c}|${b}`) ?? 0)) > sa + 0.1);
      const purpose = beats.length > 0 || topWreck.includes(a);
      const verdict = !purpose ? '**no clear purpose**' : over.length ? '**outclassed**' : 'ok';
      out.push(`| ${ERA[age].name} | ${UNIT[a].name} | ${beats.length ? beats.map((b) => UNIT[b].name).slice(0, 4).join(', ') + (beats.length > 4 ? ` +${beats.length - 4}` : '') : '–'} | ${(wrecks.get(a) ?? 0).toFixed(0)}${topWreck.includes(a) ? ' (top 3)' : ''} | ${over.map((c) => UNIT[c].name).join(', ') || '–'} | ${verdict} |`);
    }
  }
  out.push('');
  out.push('## Defenses against attackers of equal value', '', 'Score is the defense\'s side (+ it holds, - it falls cheaply).', '');
  out.push('| Defense | Attacker | Score |', '| --- | --- | ---: |');
  for (const [k, v] of sieges) { const [d, u] = k.split('|'); out.push(`| ${BUILDING[d as BldType].name} | ${UNIT[u as UnitType].name} | ${fmt(v)} |`); }
  console.log(out.join('\n'));
}
