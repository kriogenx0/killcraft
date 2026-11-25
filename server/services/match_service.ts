// Running matches: one worker thread per match, routing commands in and snapshots out.
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import type { SavedWorld } from '../../src/game/save.ts';
import { computerName, sidesTitle, type LiveGame, type MatchShape, type ServerMsg } from '../../src/net/protocol.ts';
import { MODES, type Difficulty, type FogMode, type Mode } from '../../src/data/setup.ts';
import type { Player, RoomStart } from './lobby_service.ts';
import type { MatchPerf, WorkerIn, WorkerOut } from '../workers/match_worker.ts';

export interface MatchEvents {
  send: (playerId: string, msg: ServerMsg) => void;
  /** send an already-encoded message (one spectator snapshot goes to many people) */
  sendRaw: (playerId: string, json: string) => void;
  /** a player's match ended (they return to the lobby) */
  finished: (playerId: string) => void;
}

/** Each match runs a thread; this keeps a small server from being overloaded. */
const MAX_MATCHES = 40;
/**
 * A player who loses their connection (or refreshes the page) doesn't lose the match: the computer plays
 * their side until they come back with their key. Only when nobody at all is connected does the match
 * wind down, after this long, so an abandoned match doesn't hold a thread forever.
 */
export const ABANDON_AFTER = 2 * 60_000;

/** How a match is set up: how many teams, each one's side, closed seats, and the computer's difficulty in each computer seat. */
export interface MatchSetup { teams: number; ally: number[]; absent: boolean[]; levels: (Difficulty | null)[]; /** fog of war; Always show if left out */ fog?: FogMode }

const ONE_V_ONE: MatchSetup = { teams: 2, ally: [0, 1], absent: [false, false], levels: [null, null] };

interface Match {
  id: string;
  /** each team's person (null: a computer seat, a closed seat, or a person who surrendered) */
  players: (Player | null)[];
  /** each team's name as shown to everyone: the person's, "Computer (Hard)", or '' for a closed seat */
  names: string[];
  setup: MatchSetup;
  worker: Worker;
  seed: number;
  /** each person's secret for rejoining (null for computer and closed seats) */
  keys: (string | null)[];
  /** which sides the computer is playing because their player dropped out */
  away: boolean[];
  /** teams whose player surrendered */
  resigned: Set<number>;
  /** running while both players are away: ends the abandoned match */
  abandon: NodeJS.Timeout | null;
  over: boolean;
  /** when it started (ms) */
  started: number;
  /** people watching, by player id */
  watchers: Set<string>;
  /** its thread's latest perf report */
  perf?: MatchPerf;
}

/**
 * A deploy restarts the server. Running matches are written to disk as it shuts down, and the new
 * server picks each one up when a player comes back with their key. A saved match nobody returns to
 * within this long is thrown away.
 */
export const KEEP_SAVED = 15 * 60_000;
/** How long a match's thread gets to hand over its state at shutdown. */
const SAVE_WAIT = 3000;
const SAVED_EXT = '.match';
/** match ids are UUIDs; anything else never names a file */
const MATCH_ID = /^[0-9a-f-]{8,64}$/i;

/** What a saved match file holds. */
interface SavedMatch { id: string; seed: number; keys: (string | null)[]; names: string[]; setup?: MatchSetup; started: number; savedAt: number; world: SavedWorld }

/** How many people can watch one match. */
export const MAX_WATCHERS = 50;

export class MatchService {
  private matches = new Map<string, Match>();
  private byPlayer = new Map<string, Match>();
  private byWatcher = new Map<string, Match>();

  private events: MatchEvents;
  private abandonAfter: number;
  /** where matches are kept through a restart (none: they end with the server) */
  private dataDir: string | undefined;

  constructor(events: MatchEvents, abandonAfter = ABANDON_AFTER, dataDir?: string) {
    this.events = events;
    this.abandonAfter = abandonAfter;
    this.dataDir = dataDir;
  }

  get count(): number {
    return this.matches.size;
  }

  /** Each running match's latest perf report from its thread, with how many people are in it. */
  perf(): { id: string; people: number; perf: MatchPerf }[] {
    return [...this.matches.values()].filter((m) => !m.over && m.perf).map((m) => ({ id: m.id, people: m.players.filter(Boolean).length + m.watchers.size, perf: m.perf as MatchPerf }));
  }

  /** Is a match with this id under way? */
  has(id: string): boolean {
    const m = this.matches.get(id);
    return !!m && !m.over;
  }

  /** Start a match between two people; a game listed in the lobby keeps its id, so every match has a UUID from the start. */
  start(a: Player, b: Player, id: string = randomUUID()): void {
    this.startRoom({ id, mode: '1v1', seats: [a, b] });
  }

  /** Start a match from a game room: people, computers and closed seats, one per team. */
  startRoom(room: RoomStart): void {
    const people = room.seats.filter((s): s is Player => !!s && typeof s === 'object');
    if (this.matches.size >= MAX_MATCHES) {
      for (const p of people) { this.events.send(p.id, { k: 'error', msg: 'The server is full right now. Try again in a few minutes.' }); this.events.finished(p.id); }
      return;
    }
    const mode: Mode = room.mode, shape = MODES[mode];
    const base: MatchSetup = mode === '1v1' && room.seats.every((s) => s && typeof s === 'object') ? ONE_V_ONE : {
      teams: shape.teams, ally: [...shape.ally],
      absent: Array.from({ length: shape.teams }, (_, t) => room.seats[t] == null),
      levels: Array.from({ length: shape.teams }, (_, t) => (typeof room.seats[t] === 'string' ? room.seats[t] as Difficulty : null)),
    };
    const setup: MatchSetup = room.fog && room.fog !== 'show' ? { ...base, fog: room.fog } : base;
    const players = Array.from({ length: setup.teams }, (_, t) => { const s = room.seats[t]; return s && typeof s === 'object' ? s : null; });
    const names = players.map((p, t) => p?.name ?? (setup.levels[t] ? computerName(setup.levels[t] as Difficulty) : ''));
    const seed = Math.floor(Math.random() * 1e6);
    const m = this.run(room.id, players, names, setup, seed, players.map((p) => (p ? randomUUID() : null)), Date.now());
    players.forEach((p, team) => {
      if (!p) return;
      this.byPlayer.set(p.id, m);
      this.events.send(p.id, { k: 'start', team, seed, game: m.id, key: m.keys[team] ?? undefined, opponent: this.opponentOf(m, team), ...this.shape(m) });
    });
  }

  /** The other side's names, for "you vs …". */
  private opponentOf(m: Match, team: number): string {
    const foes = m.names.filter((n, t) => n && (m.setup.ally[t] ?? t) !== (m.setup.ally[team] ?? team));
    return foes.join(' & ') || 'nobody';
  }

  /** What a client needs to set up anything but a plain one against one. */
  private shape(m: Match): MatchShape {
    const fog = m.setup.fog && m.setup.fog !== 'show' ? { fog: m.setup.fog } : {};
    return m.setup === ONE_V_ONE || (m.setup.teams === 2 && m.setup.levels.every((l) => !l)) ? fog : { teams: m.setup.teams, ally: m.setup.ally, absent: m.setup.absent, names: m.names, ...fog };
  }

  /** Start a match's thread (with the saved world, for a match carried through a restart). */
  private run(id: string, players: (Player | null)[], names: string[], setup: MatchSetup, seed: number, keys: (string | null)[], started: number, saved?: SavedWorld): Match {
    const worker = new Worker(new URL('../workers/match_worker.ts', import.meta.url), { workerData: { seed, saved, setup } });
    const m: Match = { id, players, names, setup, worker, seed, keys, away: players.map(() => false), resigned: new Set(), abandon: null, over: false, started, watchers: new Set() };
    this.matches.set(m.id, m);
    worker.on('message', (msg: WorkerOut) => this.fromWorker(m, msg));
    worker.on('error', (err) => { console.error('match worker failed', err); this.end(m, -1, 'left', ['The game server hit an error and stopped the match.']); });
    return m;
  }

  /**
   * The server is shutting down (a deploy): write every running match to disk so the next server can
   * carry it on. Returns how many were saved.
   */
  async saveAll(): Promise<number> {
    const dir = this.dataDir;
    if (!dir) return 0;
    await mkdir(dir, { recursive: true });
    const running = [...this.matches.values()].filter((m) => !m.over);
    const saved = await Promise.all(running.map(async (m) => {
      const world = await new Promise<SavedWorld | null>((done) => {
        const timer = setTimeout(() => done(null), SAVE_WAIT);
        const on = (msg: WorkerOut) => { if (msg?.k === 'saved') { clearTimeout(timer); m.worker.off('message', on); done(msg.world); } };
        m.worker.on('message', on);
        m.worker.postMessage({ k: 'save' } satisfies WorkerIn);
      });
      if (!world) return false;
      const file: SavedMatch = { id: m.id, seed: m.seed, keys: m.keys, names: m.names, setup: m.setup, started: m.started, savedAt: Date.now(), world };
      try { await writeFile(join(dir, m.id + SAVED_EXT), serialize(file)); return true; } catch (err) { console.error(`could not save match ${m.id}`, err); return false; }
    }));
    const n = saved.filter(Boolean).length;
    console.info(`saved ${n} of ${running.length} running matches for the next server`);
    return n;
  }

  /** Pick up a match the last server saved, if there is one (it starts with the computer playing both sides). */
  private async restore(game: string): Promise<Match | null> {
    const dir = this.dataDir;
    if (!dir || !MATCH_ID.test(game)) return null;
    const path = join(dir, game + SAVED_EXT);
    let s: SavedMatch;
    try {
      s = deserialize(await readFile(path)) as SavedMatch;
    } catch { return null; }
    await rm(path, { force: true });
    if (this.matches.has(game)) return this.matches.get(game) ?? null; // another rejoin got there first
    if (s.id !== game || Date.now() - s.savedAt > KEEP_SAVED) return null;
    const placeholder = (name: string): Player => ({ id: `saved-${randomUUID()}`, name, status: 'playing' });
    const setup = s.setup ?? ONE_V_ONE;
    const m = this.run(s.id, s.keys.map((k, t) => (k ? placeholder(s.names[t]) : null)), s.names, setup, s.seed, s.keys, s.started, s.world);
    m.keys.forEach((k, team) => { if (!k) return; m.away[team] = true; m.worker.postMessage({ k: 'ai', team, on: true } satisfies WorkerIn); });
    m.abandon = setTimeout(() => this.end(m, -1, 'left', ['Every player was away too long.']), this.abandonAfter);
    console.info(`match ${s.id} picked up after a restart`);
    return m;
  }

  /** Throw away saved matches too old for anyone to come back to. */
  async pruneSaved(): Promise<void> {
    const dir = this.dataDir;
    if (!dir) return;
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const f of names.filter((n) => n.endsWith(SAVED_EXT))) {
      const p = join(dir, f), st = await stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > KEEP_SAVED) await rm(p, { force: true });
    }
  }

  /** The player's connection dropped (often a page refresh): the computer plays their side until they rejoin. Returns false if they weren't playing. */
  away(playerId: string): boolean {
    const m = this.byPlayer.get(playerId);
    if (!m || m.over) return false;
    const team = m.players.findIndex((p) => p?.id === playerId), name = m.names[team];
    this.byPlayer.delete(playerId);
    m.away[team] = true;
    m.worker.postMessage({ k: 'ai', team, on: true } satisfies WorkerIn);
    if (this.present(m).length === 0) m.abandon ??= setTimeout(() => this.end(m, -1, 'left', [m.players.filter(Boolean).length > 2 ? 'Every player was away too long.' : 'Both players were away too long.']), this.abandonAfter);
    else for (const p of this.present(m)) this.events.send(p.id, { k: 'notice', msg: `${name} lost connection. The computer is playing for them until they're back.` });
    return true;
  }

  /** A player came back (with the key their start message gave them): they take their side again. */
  async rejoin(player: Player, game: string, key: string): Promise<string | null> {
    const m = this.matches.get(game) ?? await this.restore(game);
    if (!m || m.over || !key) return null;
    const team = m.keys.indexOf(key), old = m.players[team];
    if (team < 0 || !old) return null;
    if (this.byPlayer.get(old.id) === m) this.byPlayer.delete(old.id);
    if (m.abandon) { clearTimeout(m.abandon); m.abandon = null; }
    const wasAway = m.away[team];
    m.away[team] = false;
    if (wasAway) m.worker.postMessage({ k: 'ai', team, on: false } satisfies WorkerIn);
    player.name = old.name;
    m.players[team] = player;
    this.byPlayer.set(player.id, m);
    const opponent = this.opponentOf(m, team);
    this.events.send(player.id, { k: 'start', team, seed: m.seed, game: m.id, key, opponent, resumed: true, ...this.shape(m) });
    if (wasAway) this.events.send(player.id, { k: 'notice', msg: 'Welcome back. The computer played your side while you were away.' });
    for (const p of this.present(m)) if (p !== player) this.events.send(p.id, { k: 'notice', msg: `${player.name} is back.` });
    return opponent;
  }

  /** The people in a match who are connected now. */
  private present(m: Match): Player[] {
    return m.players.filter((p, t): p is Player => !!p && !m.away[t]);
  }

  /** Matches under way, newest first, for the lobby's list of games to watch. */
  live(): LiveGame[] {
    const now = Date.now();
    return [...this.matches.values()].filter((m) => !m.over).sort((a, b) => b.started - a.started)
      .map((m) => ({ id: m.id, players: m.names, ...(m.setup === ONE_V_ONE ? {} : { title: sidesTitle(m.names, m.setup.ally) }), secs: Math.floor((now - m.started) / 1000), watchers: m.watchers.size }));
  }

  /** The players' names in a match under way, or null. */
  playersOf(game: string): string[] | null {
    const m = this.matches.get(game);
    return m && !m.over ? m.names : null;
  }

  /** Start watching a match under way: everything on the map, every side's stock, no orders. Returns its players' names, or null. */
  watch(playerId: string, game: string): string[] | null {
    const m = this.matches.get(game);
    if (!m || m.over || this.byPlayer.get(playerId) === m) return null;
    if (m.watchers.size >= MAX_WATCHERS && !m.watchers.has(playerId)) return null;
    this.unwatch(playerId);
    m.watchers.add(playerId);
    this.byWatcher.set(playerId, m);
    m.worker.postMessage({ k: 'watchers', n: m.watchers.size });
    const players = m.names;
    this.events.send(playerId, { k: 'spectate', game: m.id, seed: m.seed, players, ...this.shape(m) });
    return players;
  }

  /** Stop watching (left, or lost connection). Returns true if they were watching. */
  unwatch(playerId: string): boolean {
    const m = this.byWatcher.get(playerId);
    if (!m) return false;
    this.byWatcher.delete(playerId);
    m.watchers.delete(playerId);
    if (!m.over) m.worker.postMessage({ k: 'watchers', n: m.watchers.size });
    return true;
  }

  command(playerId: string, cmd: unknown): void {
    const m = this.byPlayer.get(playerId);
    if (!m || m.over) return;
    m.worker.postMessage({ team: m.players.findIndex((p) => p?.id === playerId), cmd } satisfies WorkerIn);
  }

  /**
   * The player surrendered. One against one, the opponent wins there and then. With more sides, their
   * side is knocked out (its base blows up) and the game goes on for everyone else until one side is left.
   */
  quit(playerId: string, reason: 'left' | 'resigned'): void {
    const m = this.byPlayer.get(playerId);
    if (!m) return;
    const team = m.players.findIndex((p) => p?.id === playerId);
    if (m.setup.teams === 2) { this.end(m, 1 - team, reason); return; }
    const player = m.players[team];
    m.resigned.add(team);
    m.players[team] = null;
    m.keys[team] = null;
    this.byPlayer.delete(playerId);
    m.worker.postMessage({ k: 'resign', team } satisfies WorkerIn);
    // they're out: a side they're not on wins, as far as they're concerned
    const foe = m.setup.ally.findIndex((a, t) => a !== m.setup.ally[team] && !m.setup.absent[t]);
    this.events.send(playerId, { k: 'end', winner: foe, reason });
    if (player) this.events.finished(player.id);
    for (const p of this.present(m)) this.events.send(p.id, { k: 'notice', msg: `${m.names[team]} surrendered.` });
    if (!this.present(m).length) m.abandon ??= setTimeout(() => this.end(m, -1, 'left', ['Every player left.']), this.abandonAfter);
  }

  stopAll(): void {
    for (const m of this.matches.values()) { void m.worker.terminate(); if (m.abandon) clearTimeout(m.abandon); }
    this.matches.clear();
    this.byPlayer.clear();
    this.byWatcher.clear();
  }

  private fromWorker(m: Match, msg: WorkerOut): void {
    // ignore anything else (node --watch posts its own messages from worker threads)
    if (msg?.k === 'snap') {
      if (msg.team < 0) { if (m.watchers.size) { const json = JSON.stringify(msg.snap); for (const w of m.watchers) this.events.sendRaw(w, json); } }
      else { const p = m.players[msg.team]; if (p) this.events.send(p.id, msg.snap); }
    }
    else if (msg?.k === 'end') this.end(m, msg.winner, m.resigned.size ? 'resigned' : 'destroyed', msg.detail);
    else if (msg?.k === 'error') console.error('match error:', msg.msg);
    else if (msg?.k === 'perf') m.perf = msg.perf;
  }

  private end(m: Match, winner: number, reason: 'destroyed' | 'left' | 'resigned', detail: string[] = []): void {
    if (m.over) return;
    m.over = true;
    // one line per finished match in the server log, so a report of a game that ended can be traced by its id
    console.info(`match ${m.id} ended after ${Math.round((Date.now() - m.started) / 1000)}s: ${reason}, winner ${winner}${detail.length ? `. ${detail.join(' ')}` : ''}`);
    if (m.abandon) clearTimeout(m.abandon);
    void m.worker.terminate();
    this.matches.delete(m.id);
    for (const p of m.players) {
      if (!p) continue;
      this.byPlayer.delete(p.id);
      this.events.send(p.id, { k: 'end', winner, reason, detail });
      this.events.finished(p.id);
    }
    for (const w of m.watchers) {
      this.byWatcher.delete(w);
      this.events.send(w, { k: 'end', winner, reason, detail });
      this.events.finished(w);
    }
    m.watchers.clear();
  }
}
