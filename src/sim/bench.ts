// Simulation benchmark: plays one seeded 4-player computer match headlessly and prints how long a
// game step takes, minute by minute, with how many things are on the map. Used to find and check
// performance work on the engine.
//
//   npm run bench -- --seed 1 --max 1500 --teams 4
//   npm run bench -- --max 900 --army 40 --at 600     (a big four-way battle from minute 10)
//   node --cpu-prof src/sim/bench.ts --max 1500     (then open the .cpuprofile in Chrome DevTools)
import { G } from '../game/state.ts';
import { STEP } from '../game/const.ts';
import { ais, setAiLevel } from '../game/ai.ts';
import { initWorld, update } from '../game/world.ts';
import { mulberry32 } from '../util/math.ts';
import { stageBattle } from './stage.ts';

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args.set(argv[i].slice(2), argv[++i] ?? '');
const seed = Number(args.get('seed') ?? 1), maxSeconds = Number(args.get('max') ?? 1500), teams = Number(args.get('teams') ?? 4);
// fog on makes the step do what it does in a browser game (one side watching)
const fog = args.get('fog') !== 'off';

G.headless = true; G.demo = true; G.reveal = false; G.human = [];
Math.random = mulberry32(seed ^ 0x5eed);
initWorld(seed, teams);
G.viewer = fog ? 0 : -1;
for (let t = 0; t < G.teams; t++) ais[t].on = true;
setAiLevel((args.get('level') ?? 'normal') as never);

// --army N: at --at game seconds, every side gets N more troops that march on the middle of the map
const army = Number(args.get('army') ?? 0), armyAt = Number(args.get('at') ?? 600);
let staged = army <= 0;

const rows: string[] = ['min  ents  units  projs   avg ms   p95 ms   max ms'];
let times: number[] = [], total = 0, steps = 0, nextMin = 60;
const t0 = performance.now();
while (!G.over && G.gameT < maxSeconds) {
  if (!staged && G.gameT >= armyAt) { staged = true; stageBattle(army); }
  const a = performance.now();
  update(STEP);
  const d = performance.now() - a;
  times.push(d); total += d; steps++;
  if (G.gameT >= nextMin) {
    times.sort((x, y) => x - y);
    const avg = times.reduce((s, x) => s + x, 0) / times.length;
    const units = G.ents.filter((e) => e.kind === 'unit').length;
    rows.push(`${String(Math.round(nextMin / 60)).padStart(3)} ${String(G.ents.length).padStart(5)} ${String(units).padStart(6)} ${String(G.projs.length).padStart(6)} ${avg.toFixed(3).padStart(8)} ${times[Math.floor(times.length * 0.95)].toFixed(3).padStart(8)} ${times[times.length - 1].toFixed(3).padStart(8)}`);
    times = [];
    nextMin += 60;
  }
}
console.log(rows.join('\n'));
console.log(`\n${steps} steps (${Math.round(G.gameT)} game s) in ${((performance.now() - t0) / 1000).toFixed(1)} s wall, ${(total / steps).toFixed(3)} ms per step on average${G.over ? `, winner ${G.winner}` : ''}`);
