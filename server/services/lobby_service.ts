// Who is online, who is looking for a game, and pairing players into matches.
// Knows nothing about sockets or game simulation.
import { randomUUID } from 'node:crypto';
import type { OpenGame } from '../../src/net/protocol.ts';

export type PlayerStatus = 'idle' | 'quick' | 'host' | 'playing';

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
}

export interface LobbyEvents {
  /** two players were matched; the first is team 0 */
  paired: (a: Player, b: Player) => void;
  /** the list of open games or someone's status changed */
  changed: () => void;
}

export class LobbyService {
  readonly players = new Map<string, Player>();
  private quickQueue: string[] = [];
  /** open game id -> host player id */
  private open = new Map<string, string>();

  private events: LobbyEvents;

  constructor(events: LobbyEvents) {
    this.events = events;
  }

  add(id: string, name: string): Player {
    const p: Player = { id, name, status: 'idle' };
    this.players.set(id, p);
    this.events.changed();
    return p;
  }

  remove(id: string): void {
    this.leave(id);
    this.players.delete(id);
    this.events.changed();
  }

  /** Pair with someone already waiting for a quick match, or start waiting. */
  quick(id: string): void {
    const p = this.players.get(id);
    if (!p || p.status === 'playing') return;
    this.leave(id);
    const other = this.quickQueue.map((q) => this.players.get(q)).find((q) => q && q.id !== id);
    if (other) { this.pair(other, p); return; }
    p.status = 'quick';
    this.quickQueue.push(id);
    this.events.changed();
  }

  /** List a public game that anyone can join. */
  create(id: string): void {
    const p = this.players.get(id);
    if (!p || p.status === 'playing') return;
    this.leave(id);
    p.status = 'host';
    this.open.set(randomUUID().slice(0, 8), id);
    this.events.changed();
  }

  join(id: string, game: string): boolean {
    const p = this.players.get(id), host = this.players.get(this.open.get(game) ?? '');
    if (!p || !host || host.id === id || p.status === 'playing') return false;
    this.leave(id);
    this.pair(host, p);
    return true;
  }

  /** Stop waiting (quick match or hosting). */
  leave(id: string): void {
    this.quickQueue = this.quickQueue.filter((q) => q !== id);
    for (const [g, host] of this.open) if (host === id) this.open.delete(g);
    const p = this.players.get(id);
    if (p && p.status !== 'playing') p.status = 'idle';
  }

  /** A player's match is over; they're back in the lobby. */
  finished(id: string): void {
    const p = this.players.get(id);
    if (p) p.status = 'idle';
    this.events.changed();
  }

  games(): OpenGame[] {
    return [...this.open].map(([id, host]) => ({ id, host: this.players.get(host)?.name ?? '?' }));
  }

  private pair(a: Player, b: Player): void {
    this.leave(a.id);
    this.leave(b.id);
    a.status = b.status = 'playing';
    this.events.paired(a, b);
    this.events.changed();
  }
}
