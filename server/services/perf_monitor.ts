// Watches how hard the server works and writes it to the log: once a minute while matches run, a
// line with matches, people, CPU, memory, event-loop delay and the busiest match's step time; and a
// "SLOW" warning whenever something is over budget. Also logs what players' browsers report when
// their frame rate drops (see src/views/game/perf_report.ts), and answers /perf with the latest.
import { availableParallelism, loadavg } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { MatchPerf } from '../workers/match_worker.ts';

/** A game step is 1/60 s; a match's thread should take well under that to keep up with spare room. */
export const STEP_BUDGET_MS = 16.7;
const SLOW = {
  /** a match's average step (ms): over this, one match uses over a quarter of a core */
  stepAvg: 4,
  /** a single step (ms): over this, players feel a hitch */
  stepMax: 50,
  /** the main thread's event loop held up (ms, 99th percentile): lobby and messages lag */
  loopP99: 50,
  /** CPU use, as a share of all cores */
  cpu: 0.8,
};

export interface PerfSources {
  matches: () => { id: string; people: number; perf: MatchPerf }[];
  players: () => number;
}

export interface ServerPerf {
  at: string; matches: number; players: number; cores: number;
  /** CPU used by the whole process (all threads) as a share of all cores, over the last period */
  cpu: number; load1: number; rssMB: number; heapMB: number;
  loopP99: number; loopMax: number;
  /** the busiest match */
  worst: { id: string; people: number; stepAvg: number; stepMax: number; lostMs: number; ents: number } | null;
  slow: string[];
}

/** What a browser reports when its game runs slowly (validated, so only these fields are logged). */
export interface ClientPerf { fps: number; quality: number; from: number; units: number; online: boolean; w: number; h: number; dpr: number; gpu: string; mobile: boolean; ver: string }

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[^\w .,:;()/+-]/g, '').slice(0, max) : '');

/** A browser's report, if it's well formed. */
export function parseClientPerf(o: unknown): ClientPerf | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const fps = num(r.fps, 0, 1000), quality = num(r.quality, 0, 9), from = num(r.from, 0, 9), units = num(r.units, 0, 100000);
  const w = num(r.w, 0, 20000), h = num(r.h, 0, 20000), dpr = num(r.dpr, 0, 10);
  if (fps === null || quality === null || from === null || units === null || w === null || h === null || dpr === null) return null;
  return { fps, quality, from, units, online: r.online === true, w, h, dpr, gpu: str(r.gpu, 80), mobile: r.mobile === true, ver: str(r.ver, 20) };
}

export class PerfMonitor {
  private loop = monitorEventLoopDelay({ resolution: 20 });
  private timer: NodeJS.Timeout | null = null;
  private cpu = process.cpuUsage();
  private cpuAt = performance.now();
  latest: ServerPerf | null = null;
  /** client reports logged in the current minute, to cap the log */
  private clientCount = 0;
  private clientMinute = 0;
  private sources: PerfSources;
  private log: (line: string) => void;
  private warn: (line: string) => void;

  constructor(sources: PerfSources, log: (line: string) => void = console.info, warn: (line: string) => void = console.warn) {
    this.sources = sources;
    this.log = log;
    this.warn = warn;
  }

  start(everyMs = 60_000): void {
    this.loop.enable();
    this.timer = setInterval(() => this.sample(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.loop.disable();
  }

  /** Take a reading, and log it if matches are running or anything is slow. */
  sample(): ServerPerf {
    const now = performance.now(), used = process.cpuUsage(this.cpu), cores = availableParallelism();
    const cpu = (used.user + used.system) / 1000 / Math.max(1, now - this.cpuAt) / cores;
    this.cpu = process.cpuUsage(); this.cpuAt = now;
    const mem = process.memoryUsage();
    const matches = this.sources.matches();
    let worst: ServerPerf['worst'] = null;
    for (const m of matches) if (!worst || m.perf.stepAvg > worst.stepAvg) worst = { id: m.id, people: m.people, stepAvg: m.perf.stepAvg, stepMax: m.perf.stepMax, lostMs: m.perf.lostMs, ents: m.perf.ents };
    const p: ServerPerf = {
      at: new Date().toISOString(), matches: matches.length, players: this.sources.players(), cores,
      cpu, load1: loadavg()[0], rssMB: mem.rss / 1048576, heapMB: mem.heapUsed / 1048576,
      loopP99: this.loop.percentile(99) / 1e6, loopMax: this.loop.max / 1e6, worst, slow: [],
    };
    this.loop.reset();
    for (const m of matches) {
      const q = m.perf;
      if (q.stepAvg > SLOW.stepAvg) p.slow.push(`match ${m.id} steps take ${q.stepAvg.toFixed(1)} ms on average`);
      if (q.stepMax > SLOW.stepMax) p.slow.push(`match ${m.id} had a ${q.stepMax.toFixed(0)} ms step`);
      if (q.lostMs > 0) p.slow.push(`match ${m.id} fell behind and ran ${(q.lostMs / 1000).toFixed(1)} s slow`);
    }
    if (p.loopP99 > SLOW.loopP99) p.slow.push(`main thread held up ${p.loopP99.toFixed(0)} ms (99th percentile)`);
    if (p.cpu > SLOW.cpu) p.slow.push(`CPU at ${(p.cpu * 100).toFixed(0)}% of ${cores} cores`);
    this.latest = p;
    if (p.matches || p.slow.length) this.log(`perf: ${formatPerf(p)}`);
    if (p.slow.length) this.warn(`SLOW server: ${p.slow.join('; ')}`);
    return p;
  }

  /** Log a browser's slow-frames report (at most 30 a minute, so a crowd can't flood the log). */
  client(r: ClientPerf, ua: string): boolean {
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== this.clientMinute) { this.clientMinute = minute; this.clientCount = 0; }
    if (++this.clientCount > 30) return false;
    const where = r.online ? 'online' : 'solo';
    this.warn(`SLOW client: ${r.fps} fps, graphics level ${r.from} -> ${r.quality}, ${r.units} units, ${where}, ${r.w}x${r.h}@${r.dpr}x, ${r.mobile ? 'phone' : 'desktop'}, gpu "${r.gpu}", build ${r.ver}, ${str(ua, 120)}`);
    return true;
  }
}

export function formatPerf(p: ServerPerf): string {
  const w = p.worst;
  return [
    `${p.matches} matches, ${p.players} players`,
    `cpu ${(p.cpu * 100).toFixed(0)}% of ${p.cores} cores (load ${p.load1.toFixed(2)})`,
    `memory ${p.rssMB.toFixed(0)} MB (heap ${p.heapMB.toFixed(0)} MB)`,
    `event loop p99 ${p.loopP99.toFixed(1)} ms, max ${p.loopMax.toFixed(0)} ms`,
    w ? `busiest match ${w.id.slice(0, 8)}: step ${w.stepAvg.toFixed(2)} ms avg, ${w.stepMax.toFixed(1)} ms max, ${w.ents} entities, ${w.people} people${w.lostMs ? `, ${(w.lostMs / 1000).toFixed(1)} s behind` : ''}` : '',
  ].filter(Boolean).join(', ');
}
