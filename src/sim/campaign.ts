// Campaign simulator: plays every campaign mission headlessly with a computer player standing in for
// the person (side 0), many times each, and prints a Markdown report of win rate, time to win and how
// the losses and stalls happened.
//
//   npm run campaign-sim -- --runs 20 --as normal --max 3600 --missions first-camp,two-workers --json out.json
//
// A mission is set up exactly as the game starts it (game_view.ts startSolo): its locked map, its
// world options, its computers' levels and head starts. The stand-in plays at --as (default Normal).
// On missions with no town (an army only), the computer's wave logic waits for a big enough army,
// which a fixed army never grows into, so the stand-in also attack-moves its idle troops on the
// nearest enemy, as a person would.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { G, allied, hooks, unitDef, type Ent } from '../game/state.ts';
import { STEP, TS } from '../game/const.ts';
import { ais, setAiLevel } from '../game/ai.ts';
import { AI_LEVEL, START_ARMY, START_RESOURCES, matchOf, type Difficulty } from '../data/setup.ts';
import { foesLeft, initWorld, update } from '../game/world.ts';
import { applyCommand } from '../game/command.ts';
import { MISSIONS, missionWorld, type Mission } from '../data/campaign.ts';
import type { LockedMap } from '../game/map_lock.ts';
import { mulberry32 } from '../util/math.ts';

interface Job { mission: string; run: number; as: Difficulty; maxSeconds: number }

export interface MissionRun {
  mission: string;
  run: number;
  won: boolean;
  lost: boolean;
  timedOut: boolean;
  /** game seconds */
  length: number;
  /** goals still open at the end */
  goalsLeft: string[];
  /** enemy buildings and fighters left at the end */
  foesLeft: number;
  /** the player's armed units and buildings at the end */
  ownLeft: number;
  /** when the player's first loss came, and when its army first dropped to nothing */
  firstLoss: number | null;
  /** the player's age at the end */
  era: number;
  /** player's losses / kills by type */
  losses: Record<string, number>;
  killed: Record<string, number>;
  /** what killed the player's things (wild creatures as wild:type) */
  killers: Record<string, number>;
  /** the enemy's buildings and fighters left at the end, by type */
  leftTypes: Record<string, number>;
  /** peak enemy army near the player's base (within 14 tiles) */
  peakRaid: number;
  /** when the enemy army first came at the player (an enemy fighter within 14 tiles of a player building) */
  firstRaid: number | null;
  errors: number;
  errorText: string[];
}

const bump = (r: Record<string, number>, k: string) => { r[k] = (r[k] ?? 0) + 1; };

function lockedMap(m: Mission): LockedMap | null {
  try { return JSON.parse(readFileSync(new URL(`../../public/campaign/${m.id}.json`, import.meta.url), 'utf8')) as LockedMap; } catch { return null; }
}

export function playMission({ mission: id, run, as, maxSeconds }: Job): MissionRun {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) throw new Error(`no mission ${id}`);
  const prevHooks = { ...hooks }, prevRandom = Math.random;
  Math.random = mulberry32((run + 1) * 7919 ^ 0x5eed);
  let errors = 0;
  const errorText: string[] = [];
  hooks.error = (e) => { errors++; if (errorText.length < 3) errorText.push(String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')); };
  G.headless = true;
  const s = m.setup, { teams, ally, absent, levels } = matchOf(s, false);
  initWorld(s.seed ?? 1, teams, { share: START_RESOURCES[s.resources].share, units: START_ARMY[s.army].units, ally, absent, fog: s.fog, weather: s.weather, ...missionWorld(m), locked: lockedMap(m) });
  G.mission = m.id;
  Object.assign(G, { demo: false, visualOnly: false, viewer: -1, human: Array.from({ length: teams }, () => false), reveal: false });
  ais.forEach((a, t) => {
    const level = t === 0 ? as : levels[t];
    a.on = t < teams && !!level && (t === 0 || !m.scatter);
    if (!a.on || !level) return;
    setAiLevel(level, t);
    if (t === 0) return; // the person gets no head start
    const bonus = AI_LEVEL[level].bonus;
    if (bonus !== 1) { G.credits[t] = Math.round(G.credits[t] * bonus); G.wood[t] = Math.round(G.wood[t] * bonus); }
  });
  const r: MissionRun = { mission: id, run, won: false, lost: false, timedOut: false, length: 0, goalsLeft: [], foesLeft: 0, ownLeft: 0, firstLoss: null, era: 0, losses: {}, killed: {}, killers: {}, leftTypes: {}, peakRaid: 0, firstRaid: null, errors: 0, errorText };
  hooks.killedBy = (v: Ent, by: Ent | null) => {
    if (v.team === 0) { bump(r.losses, v.type); if (by) bump(r.killers, by.team < 0 ? `wild:${by.type}` : by.type); r.firstLoss ??= Math.round(G.gameT); }
    else if (by && by.team === 0) bump(r.killed, v.type);
  };
  let nextLook = 0;
  while (!G.over && G.gameT < maxSeconds) {
    update(STEP);
    if (G.gameT < nextLook) continue;
    nextLook = G.gameT + 2;
    const mine = G.ents.filter((e) => !e.dead && e.team === 0);
    const blds = mine.filter((e) => e.kind === 'bld');
    if (blds.length) {
      let near = 0;
      for (const e of G.ents) {
        if (e.dead || e.kind !== 'unit' || e.team < 0 || allied(e.team, 0) || !unitDef(e).weapon) continue;
        if (blds.some((b) => Math.hypot(b.x - e.x, b.y - e.y) < 14 * TS)) near++;
      }
      if (near) r.firstRaid ??= Math.round(G.gameT);
      r.peakRaid = Math.max(r.peakRaid, near);
    }
    // no town (an army mission): idle troops go for the nearest enemy, as a person would
    if (m.army && G.gameT > 5) {
      const foes = G.ents.filter((e) => !e.dead && e.team >= 0 && !allied(e.team, 0) && (e.kind === 'unit' || e.kind === 'bld'));
      const idle = mine.filter((e) => e.kind === 'unit' && !e.order && unitDef(e).weapon);
      if (foes.length && idle.length) {
        // move as one band: aim at the enemy nearest the band's middle
        const all = mine.filter((e) => e.kind === 'unit');
        const cx = all.reduce((a, e) => a + e.x, 0) / all.length, cy = all.reduce((a, e) => a + e.y, 0) / all.length;
        const tgt = foes.reduce((a, p) => (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(a.x - cx, a.y - cy) ? p : a));
        applyCommand(0, { c: 'move', ids: idle.map((e) => e.id), tx: Math.floor(tgt.x / TS), ty: Math.floor(tgt.y / TS) });
      }
    }
  }
  r.length = Math.round(G.gameT);
  r.won = G.over && G.winner >= 0 && allied(G.winner, 0);
  r.lost = G.over && !r.won;
  r.timedOut = !G.over;
  r.goalsLeft = G.goals.filter((g) => !G.goalsDone.includes(g));
  r.foesLeft = foesLeft();
  for (const e of G.ents) if (!e.dead && e.team >= 0 && !allied(e.team, 0) && (e.kind === 'bld' || (e.kind === 'unit' && unitDef(e).weapon))) bump(r.leftTypes, e.type);
  r.ownLeft = G.ents.filter((e) => !e.dead && e.team === 0 && (e.kind === 'bld' || (e.kind === 'unit' && unitDef(e).weapon))).length;
  r.era = G.era[0];
  r.errors = errors;
  Object.assign(hooks, prevHooks);
  Math.random = prevRandom;
  return r;
}

const fmtT = (s: number | null) => (s == null ? '-' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const median = (a: number[]) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const top = (rs: Record<string, number>[], n = 4) => {
  const sum: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r)) sum[k] = (sum[k] ?? 0) + v;
  return Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${(v / Math.max(1, rs.length)).toFixed(1)}`).join(', ') || '-';
};

export function campaignReport(results: MissionRun[], as: string, maxSeconds: number): string {
  const out: string[] = [`# Campaign simulation: stand-in player at ${as}`, '', `${results.length} games, up to ${maxSeconds / 60} minutes each.`, '',
    '| # | Mission | Runs | Won | Lost | Stalled | Median win | Fastest | Slowest | First raid (median) | Errors |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  const details: string[] = [];
  MISSIONS.forEach((m, i) => {
    const rs = results.filter((r) => r.mission === m.id);
    if (!rs.length) return;
    const wins = rs.filter((r) => r.won), times = wins.map((r) => r.length);
    const pct = (n: number) => `${Math.round((n / rs.length) * 100)}%`;
    out.push(`| ${i + 1} | ${m.name} | ${rs.length} | ${pct(wins.length)} | ${pct(rs.filter((r) => r.lost).length)} | ${pct(rs.filter((r) => r.timedOut).length)} | ${fmtT(median(times))} | ${fmtT(times.length ? Math.min(...times) : null)} | ${fmtT(times.length ? Math.max(...times) : null)} | ${fmtT(median(rs.filter((r) => r.firstRaid != null).map((r) => r.firstRaid!)))} | ${rs.reduce((n, r) => n + r.errors, 0)} |`);
    const lost = rs.filter((r) => r.lost), stalled = rs.filter((r) => r.timedOut);
    details.push(`### ${i + 1}. ${m.name} (${m.id})`, '',
      `- Won ${wins.length}/${rs.length}; lost ${lost.length} (median at ${fmtT(median(lost.map((r) => r.length)))}); stalled ${stalled.length}.`,
      `- Player's first loss: median ${fmtT(median(rs.filter((r) => r.firstLoss != null).map((r) => r.firstLoss!)))}. Biggest enemy force at the base: median ${median(rs.map((r) => r.peakRaid)) ?? 0}.`,
      `- Player lost per game: ${top(rs.map((r) => r.losses))}. Killed per game: ${top(rs.map((r) => r.killed))}. Killed by: ${top(rs.map((r) => r.killers))}.`);
    if (stalled.length) details.push(`- Stalled games ended with: goals open ${top(stalled.map((r) => Object.fromEntries(r.goalsLeft.map((g) => [g, 1]))))}; enemy left median ${median(stalled.map((r) => r.foesLeft))}; player left median ${median(stalled.map((r) => r.ownLeft))}; player age median ${median(stalled.map((r) => r.era))}; enemy left per stalled game: ${top(stalled.map((r) => r.leftTypes), 6)}.`);
    const errs = rs.flatMap((r) => r.errorText);
    if (errs.length) details.push(`- Errors: ${[...new Set(errs)].slice(0, 2).join(' / ')}`);
    details.push('');
  });
  return [...out, '', ...details].join('\n');
}

if (!isMainThread) {
  const port = parentPort;
  if (!port) throw new Error('no parent port');
  port.on('message', (job: Job | null) => {
    if (!job) process.exit(0);
    port.postMessage(playMission(job));
  });
  port.postMessage(null);
} else if (process.argv[1]?.endsWith('campaign.ts')) {
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args.set(argv[i].slice(2), argv[i + 1]?.startsWith('--') ? 'true' : argv[++i] ?? 'true');
  const runs = Number(args.get('runs') ?? 10), maxSeconds = Number(args.get('max') ?? 3600), as = (args.get('as') ?? 'normal') as Difficulty;
  const ids = args.get('missions')?.split(',') ?? MISSIONS.map((m) => m.id);
  const threads = Number(args.get('threads') ?? availableParallelism());
  const jobs: Job[] = ids.flatMap((mission) => Array.from({ length: runs }, (_, run) => ({ mission, run, as, maxSeconds })));
  const results: MissionRun[] = [];
  const t0 = performance.now();
  let next = 0, running = 0;
  await new Promise<void>((done) => {
    for (let w = 0; w < Math.min(threads, jobs.length); w++) {
      const worker = new Worker(new URL(import.meta.url));
      running++;
      worker.on('message', (r: MissionRun | null) => {
        if (r) { results.push(r); process.stderr.write(`\r${results.length}/${jobs.length} games`); }
        worker.postMessage(next < jobs.length ? jobs[next++] : null);
      });
      worker.on('error', (e) => { console.error(e); });
      worker.on('exit', () => { if (--running === 0) done(); });
    }
  });
  process.stderr.write(`\r${jobs.length} games in ${((performance.now() - t0) / 1000).toFixed(0)}s\n`);
  results.sort((a, b) => ids.indexOf(a.mission) - ids.indexOf(b.mission) || a.run - b.run);
  const json = args.get('json');
  if (json) writeFileSync(json, JSON.stringify(results));
  console.log(campaignReport(results, as, maxSeconds));
}
