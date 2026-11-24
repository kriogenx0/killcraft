// Runs one match in its own thread (the engine keeps module-level state, so each match gets a
// fresh copy). Receives commands, steps the simulation, and posts per-team snapshots.
import { parentPort, workerData } from 'node:worker_threads';
import { G, hooks } from '../../src/game/state.ts';
import { STEP } from '../../src/game/const.ts';
import { ais } from '../../src/game/ai.ts';
import { AI_LEVEL, type Difficulty } from '../../src/data/setup.ts';
import { updFog } from '../../src/game/fog.ts';
import { initWorld, outReasons, surrender, update } from '../../src/game/world.ts';
import { captureWorld, restoreWorld, type SavedWorld } from '../../src/game/save.ts';
import { applyCommand, parseCommand } from '../../src/game/command.ts';
import { encodeEnt, encodeOre, visibleTo, weaponIndex, type FxEvent } from '../../src/net/snapshot.ts';
import type { SideStock, SnapMsg } from '../../src/net/protocol.ts';
import type { MatchSetup } from '../services/match_service.ts';

/** a player's command, how many people are watching (spectator snapshots are made only while someone is),
 * or the computer taking over (or handing back) a side whose player dropped out */
export type WorkerIn = { team: number; cmd: unknown } | { k: 'watchers'; n: number } | { k: 'ai'; team: number; on: boolean } | { k: 'save' }
  /** a player surrendered: their side is knocked out, and the game goes on for the rest */
  | { k: 'resign'; team: number };
/** team -1: the snapshot for people watching, which shows everything */
export type WorkerOut = { k: 'snap'; team: number; snap: SnapMsg } | { k: 'end'; winner: number; detail: string[] } | { k: 'error'; msg: string }
  /** the whole match as it stands, for the server to keep through a restart */
  | { k: 'saved'; world: SavedWorld };

const SNAP_EVERY = 6; // steps (10 snapshots a second)
const ORE_EVERY = 10; // snapshots
const setup: MatchSetup = workerData?.setup ?? { teams: 2, ally: [0, 1], absent: [false, false], levels: [null, null] };
/** the sides people play (the computer plays the rest, and closed seats have nobody) */
const TEAMS = Array.from({ length: setup.teams }, (_, t) => t).filter((t) => !setup.absent[t] && !setup.levels[t]);
/** every side in the match */
const ALL = Array.from({ length: setup.teams }, (_, t) => t);

const port = parentPort;
if (!port) throw new Error('match_worker must run as a worker thread');

G.headless = true;
initWorld(Number(workerData?.seed ?? 1), setup.teams, { ally: setup.ally, absent: setup.absent });
for (const a of ais) a.on = false;
G.human = ALL.map((t) => TEAMS.includes(t));
// computer seats play at the difficulty the host picked (Brutal's head start included)
ALL.forEach((t) => {
  const level = setup.levels[t];
  if (!level || setup.absent[t]) return;
  Object.assign(ais[t], { on: true, level, attackAt: AI_LEVEL[level].firstWave });
  const bonus = AI_LEVEL[level].bonus;
  if (bonus !== 1) { G.credits[t] = Math.round(G.credits[t] * bonus); G.wood[t] = Math.round(G.wood[t] * bonus); }
});
// a match the server saved when it last shut down carries on where it was
if (workerData?.saved && !restoreWorld(workerData.saved as SavedWorld)) throw new Error('saved match could not be restored');

const pending: FxEvent[][] = ALL.map(() => []);
/** events for people watching: every shot and death (no side's messages or alerts) */
const watched: FxEvent[] = [];
let watchers = 0;
hooks.notify = (team, msg) => pending[team]?.push(['m', msg]);
hooks.alert = (team, x, y) => pending[team]?.push(['a', Math.round(x), Math.round(y)]);
hooks.fired = (s, w, t) => {
  for (const team of TEAMS) if (visibleTo(s, team) || visibleTo(t, team)) pending[team].push(['f', s.id, t.id, weaponIndex(w)]);
  if (watchers) watched.push(['f', s.id, t.id, weaponIndex(w)]);
};
hooks.killed = (e) => {
  for (const team of TEAMS) if (visibleTo(e, team)) pending[team].push(['d', e.id]);
  if (watchers) watched.push(['d', e.id]);
};
hooks.error = (err) => port.postMessage({ k: 'error', msg: String(err) } satisfies WorkerOut);

/** The level the computer plays a dropped player's side at: full speed, so the side isn't held back while they're away. */
const STAND_IN: Difficulty = 'hard';

/** Hand a side to the computer while its player is away, and back when they return. */
function standIn(team: number, on: boolean): void {
  const a = ais[team];
  if (!a || !TEAMS.includes(team) || a.on === on) return;
  a.on = on;
  G.human[team] = !on;
  if (on) {
    Object.assign(a, { level: STAND_IN, thinkT: 0, attacking: false, reserve: 0, reserveWood: 0, refitSave: 0, big: null, prey: null, foe: setup.teams === 2 ? 1 - team : -1 });
    a.attackAt = AI_LEVEL[STAND_IN].firstWave;
    a.guards.clear();
    a.hunters.clear();
  } else updFog(); // the computer doesn't keep fog: give the returning player what their side sees now
}

port.on('message', (m: WorkerIn) => {
  if (m && 'k' in m) {
    if (m.k === 'watchers') watchers = Math.max(0, Number(m.n) || 0);
    else if (m.k === 'ai') standIn(m.team, !!m.on);
    else if (m.k === 'save') port.postMessage({ k: 'saved', world: captureWorld() } satisfies WorkerOut);
    else if (m.k === 'resign' && TEAMS.includes(m.team)) { if (ais[m.team]) ais[m.team].on = false; surrender(m.team); }
    return;
  }
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
      port.postMessage({ k: 'end', winner: G.winner, detail: outReasons() } satisfies WorkerOut);
      clearInterval(timer);
      return;
    }
  }
}, 1000 / 60);

function stock(team: number): SideStock {
  return {
    credits: Math.floor(G.credits[team]), wood: Math.floor(G.wood[team]), oil: Math.floor(G.oil[team]), aether: Math.floor(G.aether[team] ?? 0), aetherFound: !!G.aetherFound[team], ward: !!G.ward[team],
    tamed: G.tamed[team] ?? [], era: G.era[team], heal: G.heal[team] ?? 0, upg: G.upg[team], prod: G.prod[team],
  };
}

function sendSnapshots(): void {
  const ore = snaps++ % ORE_EVERY === 0 ? encodeOre() : undefined;
  const t = Math.round(G.gameT * 10) / 10;
  for (const team of TEAMS) {
    const snap: SnapMsg = {
      k: 'snap', t, ...stock(team),
      ents: G.ents.filter((e) => !e.dead && visibleTo(e, team)).map((e) => encodeEnt(e, e.team === team)),
      ev: pending[team].splice(0), ore,
    };
    port?.postMessage({ k: 'snap', team, snap } satisfies WorkerOut);
  }
  if (!watchers) { watched.length = 0; return; }
  // people watching see everything, with every side's details, as a player sees their own
  const sides = ALL.map(stock);
  const snap: SnapMsg = { k: 'snap', t, ...sides[0], sides, ents: G.ents.filter((e) => !e.dead).map((e) => encodeEnt(e, true)), ev: watched.splice(0), ore };
  port?.postMessage({ k: 'snap', team: -1, snap } satisfies WorkerOut);
}
