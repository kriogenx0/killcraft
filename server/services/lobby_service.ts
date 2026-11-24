// Who is online, who is looking for a game, and pairing players into matches.
// Knows nothing about sockets or game simulation.
import { randomUUID } from 'node:crypto';
import type { LobbyMsg, OnlinePlayer, OpenGame, PlayerStatus } from '../../src/net/protocol.ts';

export type { PlayerStatus };

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** the opponent's name, while playing */
  opponent?: string;
  /** the player this one has challenged, waiting for an answer */
  inviting?: string;
}

export interface LobbyEvents {
  /** two players were matched; the first is team 0. `game` is the id of the listed game they met in, if any. */
  paired: (a: Player, b: Player, game?: string) => void;
  /** the list of open games or someone's status changed */
  changed: () => void;
}

/** The players list sent to each client is capped so a busy server doesn't send huge lobby updates. */
export const MAX_LISTED = 50;

const GAME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ORDER: Record<PlayerStatus, number> = { idle: 0, host: 1, quick: 2, playing: 3 };

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
    this.dropInvitesTo(id);
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

  /**
   * List a public game that anyone can join. `game` asks for a particular id (the host refreshed the page and
   * their invite link should keep working); it's used if it looks like an id and nobody else has it.
   */
  create(id: string, game?: string): string | null {
    const p = this.players.get(id);
    if (!p || p.status === 'playing') return null;
    this.leave(id);
    p.status = 'host';
    const gid = game && GAME_ID.test(game) && !this.open.has(game) ? game : randomUUID();
    this.open.set(gid, id);
    this.events.changed();
    return gid;
  }

  /** The player hosting this open game, if it's listed. */
  hostOf(game: string): string | null {
    return this.open.get(game) ?? null;
  }

  join(id: string, game: string): boolean {
    const p = this.players.get(id), host = this.players.get(this.open.get(game) ?? '');
    if (!p || !host || host.id === id || p.status === 'playing') return false;
    this.leave(id);
    this.pair(host, p, game);
    return true;
  }

  /** Challenge a specific player. Replaces any challenge, quick match or hosted game you had. */
  invite(id: string, to: string): boolean {
    const p = this.players.get(id), target = this.players.get(to);
    if (!p || !target || target.id === id || p.status === 'playing' || target.status === 'playing') return false;
    this.leave(id);
    p.inviting = to;
    this.events.changed();
    return true;
  }

  /** Accept a challenge: both players go straight into a match, the challenger as team 0. */
  accept(id: string, from: string): boolean {
    const p = this.players.get(id), challenger = this.players.get(from);
    if (!p || !challenger || challenger.inviting !== id || p.status === 'playing' || challenger.status === 'playing') return false;
    this.pair(challenger, p);
    return true;
  }

  /** Turn down a challenge. Returns the challenger so they can be told. */
  decline(id: string, from: string): Player | null {
    const challenger = this.players.get(from);
    if (!challenger || challenger.inviting !== id) return null;
    challenger.inviting = undefined;
    this.events.changed();
    return challenger;
  }

  /** Stop waiting (quick match, hosting or a challenge). */
  leave(id: string): void {
    this.quickQueue = this.quickQueue.filter((q) => q !== id);
    for (const [g, host] of this.open) if (host === id) this.open.delete(g);
    const p = this.players.get(id);
    if (p) p.inviting = undefined;
    if (p && p.status !== 'playing') p.status = 'idle';
  }

  /** A player rejoined a match already under way (after a refresh). */
  playing(id: string, opponent: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.leave(id);
    this.dropInvitesTo(id);
    p.status = 'playing';
    p.opponent = opponent;
    this.events.changed();
  }

  /** A player's match is over; they're back in the lobby. */
  finished(id: string): void {
    const p = this.players.get(id);
    if (p) { p.status = 'idle'; p.opponent = undefined; }
    this.events.changed();
  }

  games(): OpenGame[] {
    return [...this.open].map(([id, host]) => ({ id, host: this.players.get(host)?.name ?? '?' }));
  }

  /** The lobby as player `id` sees it. */
  view(id: string): LobbyMsg | null {
    const me = this.players.get(id);
    if (!me) return null;
    const others = [...this.players.values()].filter((p) => p.id !== id).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
    const players: OnlinePlayer[] = [me, ...others].slice(0, MAX_LISTED).map((p) => ({ id: p.id, name: p.name, status: p.status, ...(p.opponent ? { opponent: p.opponent } : {}) }));
    const invites = [...this.players.values()].filter((p) => p.inviting === id && p.status !== 'playing').map((p) => ({ id: p.id, name: p.name }));
    return {
      k: 'lobby',
      games: this.games(),
      online: this.players.size,
      players,
      you: id,
      waiting: me.status === 'quick' ? 'quick' : me.status === 'host' ? 'host' : null,
      hosting: [...this.open].find(([, host]) => host === id)?.[0] ?? null,
      invites,
      inviting: me.inviting ?? null,
    };
  }

  private dropInvitesTo(id: string): void {
    for (const p of this.players.values()) if (p.inviting === id) p.inviting = undefined;
  }

  private pair(a: Player, b: Player, game?: string): void {
    this.leave(a.id);
    this.leave(b.id);
    this.dropInvitesTo(a.id);
    this.dropInvitesTo(b.id);
    a.status = b.status = 'playing';
    a.opponent = b.name;
    b.opponent = a.name;
    this.events.paired(a, b, game);
    this.events.changed();
  }
}
