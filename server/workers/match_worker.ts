// Runs one match in its own thread (the engine keeps module-level state, so each match gets a
// fresh copy). Receives commands, steps the simulation, and posts per-team snapshots.
import { parentPort, workerData } from 'node:worker_threads';
import { G, hooks } from '../../src/game/state.ts';
import { STEP } from '../../src/game/const.ts';
import { ais } from '../../src/game/ai.ts';
import { initWorld, update } from '../../src/game/world.ts';
import { applyCommand, parseCommand } from '../../src/game/command.ts';
import { encodeEnt, encodeOre, visibleTo, weaponIndex, type FxEvent } from '../../src/net/snapshot.ts';
import type { SnapMsg } from '../../src/net/protocol.ts';

export type WorkerIn = { team: number; cmd: unknown };
export type WorkerOut = { k: 'snap'; team: number; snap: SnapMsg } | { k: 'end'; winner: number } | { k: 'error'; msg: string };

const SNAP_EVERY = 6; // steps (10 snapshots a second)
const ORE_EVERY = 10; // snapshots
const TEAMS = [0, 1];

const port = parentPort;
if (!port) throw new Error('match_worker must run as a worker thread');

G.headless = true;
G.human = [true, true];
for (const a of ais) a.on = false;
initWorld(Number(workerData?.seed ?? 1));

const pending: FxEvent[][] = TEAMS.map(() => []);
hooks.notify = (team, msg) => pending[team]?.push(['m', msg]);
hooks.alert = (team, x, y) => pending[team]?.push(['a', Math.round(x), Math.round(y)]);
hooks.fired = (s, w, t) => { for (const team of TEAMS) if (visibleTo(s, team) || visibleTo(t, team)) pending[team].push(['f', s.id, t.id, weaponIndex(w)]); };
hooks.killed = (e) => { for (const team of TEAMS) if (visibleTo(e, team)) pending[team].push(['d', e.id]); };
hooks.error = (err) => port.postMessage({ k: 'error', msg: String(err) } satisfies WorkerOut);

port.on('message', (m: WorkerIn) => {
  const cmd = parseCommand(m?.cmd);
  if (cmd && TEAMS.includes(m.team)) applyCommand(m.team, cmd);
});

let steps = 0, snaps = 0, last = performance.now(), acc = 0;
const timer = setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    update(STEP);
    acc -= STEP;
    if (++steps % SNAP_EVERY === 0) sendSnapshots();
    if (G.over) {
      sendSnapshots();
      port.postMessage({ k: 'end', winner: G.winner } satisfies WorkerOut);
      clearInterval(timer);
      return;
    }
  }
}, 1000 / 60);

function sendSnapshots(): void {
  const ore = snaps++ % ORE_EVERY === 0 ? encodeOre() : undefined;
  for (const team of TEAMS) {
    const snap: SnapMsg = {
      k: 'snap', t: Math.round(G.gameT * 10) / 10, credits: Math.floor(G.credits[team]), prod: G.prod[team],
      ents: G.ents.filter((e) => !e.dead && visibleTo(e, team)).map((e) => encodeEnt(e, e.team === team)),
      ev: pending[team].splice(0), ore,
    };
    port?.postMessage({ k: 'snap', team, snap } satisfies WorkerOut);
  }
}
