// Running matches: one worker thread per match, routing commands in and snapshots out.
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { LiveGame, ServerMsg } from '../../src/net/protocol.ts';
import type { Player } from './lobby_service.ts';
import type { WorkerIn, WorkerOut } from '../workers/match_worker.ts';

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

interface Match {
  id: string;
  players: [Player, Player];
  worker: Worker;
  seed: number;
  /** each player's secret for rejoining */
  keys: [string, string];
  /** which sides the computer is playing because their player dropped out */
  away: [boolean, boolean];
  /** running while both players are away: ends the abandoned match */
  abandon: NodeJS.Timeout | null;
  over: boolean;
  /** when it started (ms) */
  started: number;
  /** people watching, by player id */
  watchers: Set<string>;
}

/** How many people can watch one match. */
export const MAX_WATCHERS = 50;

export class MatchService {
  private matches = new Map<string, Match>();
  private byPlayer = new Map<string, Match>();
  private byWatcher = new Map<string, Match>();

  private events: MatchEvents;
  private abandonAfter: number;

  constructor(events: MatchEvents, abandonAfter = ABANDON_AFTER) {
    this.events = events;
    this.abandonAfter = abandonAfter;
  }

  get count(): number {
    return this.matches.size;
  }

  /** Is a match with this id under way? */
  has(id: string): boolean {
    const m = this.matches.get(id);
    return !!m && !m.over;
  }

  /** Start a match; a game listed in the lobby keeps its id, so every match has a UUID from the start. */
  start(a: Player, b: Player, id: string = randomUUID()): void {
    if (this.matches.size >= MAX_MATCHES) {
      for (const p of [a, b]) { this.events.send(p.id, { k: 'error', msg: 'The server is full right now. Try again in a few minutes.' }); this.events.finished(p.id); }
      return;
    }
    const seed = Math.floor(Math.random() * 1e6);
    const worker = new Worker(new URL('../workers/match_worker.ts', import.meta.url), { workerData: { seed } });
    const m: Match = { id, players: [a, b], worker, seed, keys: [randomUUID(), randomUUID()], away: [false, false], abandon: null, over: false, started: Date.now(), watchers: new Set() };
    this.matches.set(m.id, m);
    this.byPlayer.set(a.id, m);
    this.byPlayer.set(b.id, m);
    worker.on('message', (msg: WorkerOut) => this.fromWorker(m, msg));
    worker.on('error', (err) => { console.error('match worker failed', err); this.end(m, -1, 'left'); });
    m.players.forEach((p, team) => this.events.send(p.id, { k: 'start', team, seed, game: m.id, key: m.keys[team], opponent: m.players[1 - team].name }));
  }

  /** The player's connection dropped (often a page refresh): the computer plays their side until they rejoin. Returns false if they weren't playing. */
  away(playerId: string): boolean {
    const m = this.byPlayer.get(playerId);
    if (!m || m.over) return false;
    const team = m.players.findIndex((p) => p.id === playerId);
    this.byPlayer.delete(playerId);
    m.away[team] = true;
    m.worker.postMessage({ k: 'ai', team, on: true } satisfies WorkerIn);
    if (m.away.every(Boolean)) m.abandon ??= setTimeout(() => this.end(m, -1, 'left'), this.abandonAfter);
    else this.events.send(m.players[1 - team].id, { k: 'notice', msg: `${m.players[team].name} lost connection. The computer is playing for them until they're back.` });
    return true;
  }

  /** A player came back (with the key their start message gave them): they take their side again. */
  rejoin(player: Player, game: string, key: string): Player | null {
    const m = this.matches.get(game);
    if (!m || m.over) return null;
    const team = m.keys.indexOf(key);
    if (team < 0) return null;
    const old = m.players[team];
    if (this.byPlayer.get(old.id) === m) this.byPlayer.delete(old.id);
    if (m.abandon) { clearTimeout(m.abandon); m.abandon = null; }
    const wasAway = m.away[team];
    m.away[team] = false;
    if (wasAway) m.worker.postMessage({ k: 'ai', team, on: false } satisfies WorkerIn);
    player.name = old.name;
    m.players[team] = player;
    this.byPlayer.set(player.id, m);
    const opponent = m.players[1 - team];
    this.events.send(player.id, { k: 'start', team, seed: m.seed, game: m.id, key, opponent: opponent.name, resumed: true });
    if (wasAway) this.events.send(player.id, { k: 'notice', msg: 'Welcome back. The computer played your side while you were away.' });
    if (!m.away[1 - team]) this.events.send(opponent.id, { k: 'notice', msg: `${player.name} is back.` });
    return opponent;
  }

  /** Matches under way, newest first, for the lobby's list of games to watch. */
  live(): LiveGame[] {
    const now = Date.now();
    return [...this.matches.values()].filter((m) => !m.over).sort((a, b) => b.started - a.started)
      .map((m) => ({ id: m.id, players: m.players.map((p) => p.name), secs: Math.floor((now - m.started) / 1000), watchers: m.watchers.size }));
  }

  /** The players' names in a match under way, or null. */
  playersOf(game: string): string[] | null {
    const m = this.matches.get(game);
    return m && !m.over ? m.players.map((p) => p.name) : null;
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
    const players = m.players.map((p) => p.name);
    this.events.send(playerId, { k: 'spectate', game: m.id, seed: m.seed, players });
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
    m.worker.postMessage({ team: m.players.findIndex((p) => p.id === playerId), cmd } satisfies WorkerIn);
  }

  /** The player resigned or disconnected: the opponent wins. */
  quit(playerId: string, reason: 'left' | 'resigned'): void {
    const m = this.byPlayer.get(playerId);
    if (!m) return;
    this.end(m, 1 - m.players.findIndex((p) => p.id === playerId), reason);
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
      else this.events.send(m.players[msg.team].id, msg.snap);
    }
    else if (msg?.k === 'end') this.end(m, msg.winner, 'destroyed');
    else if (msg?.k === 'error') console.error('match error:', msg.msg);
  }

  private end(m: Match, winner: number, reason: 'destroyed' | 'left' | 'resigned'): void {
    if (m.over) return;
    m.over = true;
    if (m.abandon) clearTimeout(m.abandon);
    void m.worker.terminate();
    this.matches.delete(m.id);
    for (const p of m.players) {
      this.byPlayer.delete(p.id);
      this.events.send(p.id, { k: 'end', winner, reason });
      this.events.finished(p.id);
    }
    for (const w of m.watchers) {
      this.byWatcher.delete(w);
      this.events.send(w, { k: 'end', winner, reason });
      this.events.finished(w);
    }
    m.watchers.clear();
  }
}
