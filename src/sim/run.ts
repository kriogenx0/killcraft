// Balance runner: plays many computer-only matches in parallel worker threads and prints a report.
//
//   npm run sim -- --matches 200 --teams 4 --max 3600 --seed 1 --level normal --json sim.json
//
// Every match is seeded (map and dice), so the same options always give the same report.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { playMatch, type MatchResult } from './match.ts';
import { report } from './report.ts';
import type { Difficulty } from '../data/setup.ts';

interface Job { seed: number; teams: number; maxSeconds: number; level: Difficulty | Difficulty[] }

if (!isMainThread) {
  const port = parentPort;
  if (!port) throw new Error('no parent port');
  port.on('message', (job: Job | null) => {
    if (!job) { process.exit(0); }
    port.postMessage(playMatch(job));
  });
  port.postMessage(null); // ready
} else {
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args.set(argv[i].slice(2), argv[i + 1]?.startsWith('--') ? 'true' : argv[++i] ?? 'true');
  const matches = Number(args.get('matches') ?? 100), teams = Number(args.get('teams') ?? 4), maxSeconds = Number(args.get('max') ?? 3600);
  const firstSeed = Number(args.get('seed') ?? 1), threads = Number(args.get('threads') ?? availableParallelism());
  // --level hard sets every side; --level easy,normal,hard,brutal gives one per side, rotated each match
  // so no difficulty always gets the same corner
  const levels = (args.get('level') ?? 'normal').split(',') as Difficulty[];
  const levelFor = (i: number): Difficulty | Difficulty[] => levels.length === 1 ? levels[0] : levels.map((_, t) => levels[(t + i) % levels.length]);
  const jobs: Job[] = Array.from({ length: matches }, (_, i) => ({ seed: firstSeed + i * 7919, teams, maxSeconds, level: levelFor(i) }));
  const results: MatchResult[] = [];
  const t0 = performance.now();
  let next = 0, running = 0;
  await new Promise<void>((done) => {
    for (let w = 0; w < Math.min(threads, matches); w++) {
      const worker = new Worker(new URL(import.meta.url));
      running++;
      worker.on('message', (r: MatchResult | null) => {
        if (r) {
          results.push(r);
          if (!args.has('quiet')) process.stderr.write(`\r${results.length}/${matches} matches`);
        }
        worker.postMessage(next < jobs.length ? jobs[next++] : null);
      });
      worker.on('error', (e) => { console.error(e); });
      worker.on('exit', () => { if (--running === 0) done(); });
    }
  });
  process.stderr.write(`\r${matches} matches in ${((performance.now() - t0) / 1000).toFixed(0)}s\n`);
  results.sort((a, b) => a.seed - b.seed);
  const json = args.get('json');
  if (json) writeFileSync(json, JSON.stringify(results));
  console.log(report(results));
}
