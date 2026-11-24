// Running matches: one worker thread per match, routing commands in and snapshots out.
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { ServerMsg } from '../../src/net/protocol.ts';
import type { Player } from './lobby_service.ts';
import type { WorkerOut } from '../workers/match_worker.ts';

export interface MatchEvents {
  send: (playerId: string, msg: ServerMsg) => void;
  /** a player's match ended (they return to the lobby) */
  finished: (playerId: string) => void;
}

/** Each match runs a thread; this keeps a small server from being overloaded. */
const MAX_MATCHES = 40;
/** How long a player who lost their connection (or refreshed the page) has to come back before the opponent wins. */
export const REJOIN_GRACE = 60_000;

interface Match {
  id: string;
  players: [Player, Player];
  worker: Worker;
  seed: number;
  /** each player's secret for rejoining, and the timer running while they're away */
  keys: [string, string];
  away: [NodeJS.Timeout | null, NodeJS.Timeout | null];
  over: boolean;
}

export class MatchService {
  private matches = new Map<string, Match>();
  private byPlayer = new Map<string, Match>();

  private events: MatchEvents;
  private grace: number;

  constructor(events: MatchEvents, grace = REJOIN_GRACE) {
    this.events = events;
    this.grace = grace;
  }

  get count(): number {
    return this.matches.size;
  }

  /** Start a match; a game listed in the lobby keeps its id, so every match has a UUID from the start. */
  start(a: Player, b: Player, id: string = randomUUID()): void {
    if (this.matches.size >= MAX_MATCHES) {
      for (const p of [a, b]) { this.events.send(p.id, { k: 'error', msg: 'The server is full right now. Try again in a few minutes.' }); this.events.finished(p.id); }
      return;
    }
    const seed = Math.floor(Math.random() * 1e6);
    const worker = new Worker(new URL('../workers/match_worker.ts', import.meta.url), { workerData: { seed } });
    const m: Match = { id, players: [a, b], worker, seed, keys: [randomUUID(), randomUUID()], away: [null, null], over: false };
    this.matches.set(m.id, m);
    this.byPlayer.set(a.id, m);
    this.byPlayer.set(b.id, m);
    worker.on('message', (msg: WorkerOut) => this.fromWorker(m, msg));
    worker.on('error', (err) => { console.error('match worker failed', err); this.end(m, -1, 'left'); });
    m.players.forEach((p, team) => this.events.send(p.id, { k: 'start', team, seed, game: m.id, key: m.keys[team], opponent: m.players[1 - team].name }));
  }

  /** The player's connection dropped (often a page refresh): give them REJOIN_GRACE to come back. Returns false if they weren't playing. */
  away(playerId: string): boolean {
    const grace = this.grace;
    const m = this.byPlayer.get(playerId);
    if (!m || m.over) return false;
    const team = m.players.findIndex((p) => p.id === playerId);
    this.byPlayer.delete(playerId);
    if (m.away[team]) clearTimeout(m.away[team]);
    m.away[team] = setTimeout(() => this.end(m, 1 - team, 'left'), grace);
    this.events.send(m.players[1 - team].id, { k: 'notice', msg: `${m.players[team].name} lost connection. Waiting ${Math.round(grace / 1000)} seconds for them to come back…` });
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
    if (m.away[team]) { clearTimeout(m.away[team]); m.away[team] = null; }
    player.name = old.name;
    m.players[team] = player;
    this.byPlayer.set(player.id, m);
    const opponent = m.players[1 - team];
    this.events.send(player.id, { k: 'start', team, seed: m.seed, game: m.id, key, opponent: opponent.name, resumed: true });
    this.events.send(opponent.id, { k: 'notice', msg: `${player.name} is back.` });
    return opponent;
  }

  command(playerId: string, cmd: unknown): void {
    const m = this.byPlayer.get(playerId);
    if (!m || m.over) return;
    m.worker.postMessage({ team: m.players.findIndex((p) => p.id === playerId), cmd });
  }

  /** The player resigned or disconnected: the opponent wins. */
  quit(playerId: string, reason: 'left' | 'resigned'): void {
    const m = this.byPlayer.get(playerId);
    if (!m) return;
    this.end(m, 1 - m.players.findIndex((p) => p.id === playerId), reason);
  }

  stopAll(): void {
    for (const m of this.matches.values()) { void m.worker.terminate(); for (const t of m.away) if (t) clearTimeout(t); }
    this.matches.clear();
    this.byPlayer.clear();
  }

  private fromWorker(m: Match, msg: WorkerOut): void {
    // ignore anything else (node --watch posts its own messages from worker threads)
    if (msg?.k === 'snap') this.events.send(m.players[msg.team].id, msg.snap);
    else if (msg?.k === 'end') this.end(m, msg.winner, 'destroyed');
    else if (msg?.k === 'error') console.error('match error:', msg.msg);
  }

  private end(m: Match, winner: number, reason: 'destroyed' | 'left' | 'resigned'): void {
    if (m.over) return;
    m.over = true;
    for (const t of m.away) if (t) clearTimeout(t);
    void m.worker.terminate();
    this.matches.delete(m.id);
    for (const p of m.players) {
      this.byPlayer.delete(p.id);
      this.events.send(p.id, { k: 'end', winner, reason });
      this.events.finished(p.id);
    }
  }
}
