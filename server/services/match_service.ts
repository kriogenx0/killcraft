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

interface Match {
  id: string;
  players: [Player, Player];
  worker: Worker;
  over: boolean;
}

export class MatchService {
  private matches = new Map<string, Match>();
  private byPlayer = new Map<string, Match>();

  private events: MatchEvents;

  constructor(events: MatchEvents) {
    this.events = events;
  }

  get count(): number {
    return this.matches.size;
  }

  start(a: Player, b: Player): void {
    if (this.matches.size >= MAX_MATCHES) {
      for (const p of [a, b]) { this.events.send(p.id, { k: 'error', msg: 'The server is full right now. Try again in a few minutes.' }); this.events.finished(p.id); }
      return;
    }
    const seed = Math.floor(Math.random() * 1e6);
    const worker = new Worker(new URL('../workers/match_worker.ts', import.meta.url), { workerData: { seed } });
    const m: Match = { id: randomUUID(), players: [a, b], worker, over: false };
    this.matches.set(m.id, m);
    this.byPlayer.set(a.id, m);
    this.byPlayer.set(b.id, m);
    worker.on('message', (msg: WorkerOut) => this.fromWorker(m, msg));
    worker.on('error', (err) => { console.error('match worker failed', err); this.end(m, -1, 'left'); });
    m.players.forEach((p, team) => this.events.send(p.id, { k: 'start', team, seed, opponent: m.players[1 - team].name }));
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
    for (const m of this.matches.values()) void m.worker.terminate();
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
    void m.worker.terminate();
    this.matches.delete(m.id);
    for (const p of m.players) {
      this.byPlayer.delete(p.id);
      this.events.send(p.id, { k: 'end', winner, reason });
      this.events.finished(p.id);
    }
  }
}
