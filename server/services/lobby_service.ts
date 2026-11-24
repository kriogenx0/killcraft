// Who is online, who is looking for a game, and pairing players into matches.
// Knows nothing about sockets or game simulation.
import { randomUUID } from 'node:crypto';
import type { LiveGame, LobbyMsg, OnlinePlayer, OpenGame, PlayerStatus, RoomSeat, RoomView } from '../../src/net/protocol.ts';
import { MODES, isMode, isSeatPick, playable, seatOrder, type Difficulty, type Mode } from '../../src/data/setup.ts';

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

/** A seat in a game room: a person (by player id), a computer, open for a person to join, or closed. */
export type Seat = { kind: 'person'; id: string } | { kind: 'computer'; level: Difficulty } | { kind: 'open' } | { kind: 'closed' };

/** A game about to start from a room: how the sides line up and who sits where (by team; null for a closed seat). */
export interface RoomStart { id: string; mode: Mode; seats: (Player | Difficulty | null)[] }

interface Room { id: string; host: string; mode: Mode; seats: Seat[] }

export interface LobbyEvents {
  /** two players were matched; the first is team 0. `game` is the id of the listed game they met in, if any. */
  paired: (a: Player, b: Player, game?: string) => void;
  /** a game room started anything but a plain game between two people: computers, closed seats or more players */
  started?: (game: RoomStart) => void;
  /** the list of open games or someone's status changed */
  changed: () => void;
  /** matches under way, to list for watching */
  live?: () => LiveGame[];
}

/** The players list sent to each client is capped so a busy server doesn't send huge lobby updates. */
export const MAX_LISTED = 50;

const GAME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ORDER: Record<PlayerStatus, number> = { idle: 0, host: 1, room: 1, quick: 2, playing: 3, watching: 4 };

/** A new room: one against one, with the host in the first seat and the second open for a friend. */
const newSeats = (host: string): Seat[] => [{ kind: 'person', id: host }, { kind: 'open' }, { kind: 'computer', level: 'normal' }, { kind: 'computer', level: 'normal' }];

export class LobbyService {
  readonly players = new Map<string, Player>();
  private quickQueue: string[] = [];
  /** open game rooms by id */
  private rooms = new Map<string, Room>();

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
    if (!p || p.status === 'playing' || p.status === 'watching') return;
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
    if (!p || p.status === 'playing' || p.status === 'watching') return null;
    this.leave(id);
    p.status = 'host';
    const gid = game && GAME_ID.test(game) && !this.rooms.has(game) ? game : randomUUID();
    this.rooms.set(gid, { id: gid, host: id, mode: '1v1', seats: newSeats(id) });
    this.events.changed();
    return gid;
  }

  /** The player hosting this open game, if it's listed. */
  hostOf(game: string): string | null {
    return this.rooms.get(game)?.host ?? null;
  }

  /** The room a player is in (hosting or joined). */
  private roomOf(id: string): Room | null {
    for (const r of this.rooms.values()) if (r.host === id || r.seats.some((s) => s.kind === 'person' && s.id === id)) return r;
    return null;
  }

  /** Seats a room's mode uses, in team order. */
  private used = (r: Room): Seat[] => r.seats.slice(0, MODES[r.mode].teams);

  /** Take the first open seat in a room (your own side first, in the order the room lists them). A room with no open seat left starts. */
  join(id: string, game: string): boolean {
    const p = this.players.get(id), r = this.rooms.get(game);
    if (!p || !r || r.host === id || p.status === 'playing' || p.status === 'watching') return false;
    if (this.roomOf(id) === r) return true;
    const seat = seatOrder(r.mode).find((t) => r.seats[t].kind === 'open');
    if (seat == null) return false;
    this.leave(id);
    r.seats[seat] = { kind: 'person', id };
    p.status = 'room';
    if (!this.used(r).some((s) => s.kind === 'open')) this.begin(r.host);
    else this.events.changed();
    return true;
  }

  /**
   * The host changes their room: how the sides line up (`mode`), or who sits in a seat (a computer at a
   * difficulty, open for a person, or closed). Seats with people in them stay as they are.
   */
  configure(id: string, change: { mode?: unknown; seat?: unknown; pick?: unknown }): boolean {
    const r = this.roomOf(id);
    if (!r || r.host !== id) return false;
    if (change.mode !== undefined) {
      if (!isMode(change.mode)) return false;
      // one against one only has two seats: nobody can be sitting in the other two
      if (r.seats.slice(MODES[change.mode].teams).some((s) => s.kind === 'person')) return false;
      r.mode = change.mode;
    }
    if (change.seat !== undefined) {
      const t = Number(change.seat), pick = change.pick;
      if (!Number.isInteger(t) || t < 0 || t >= MODES[r.mode].teams || r.seats[t].kind === 'person') return false;
      if (pick === 'open') r.seats[t] = { kind: 'open' };
      else if (isSeatPick(pick)) r.seats[t] = pick === 'closed' ? { kind: 'closed' } : { kind: 'computer', level: pick as Difficulty };
      else return false;
    }
    this.events.changed();
    return true;
  }

  /** Can the room start: no seat waiting for a person, and someone on at least two sides. */
  private ready(r: Room): boolean {
    const seats = this.used(r);
    return !seats.some((s) => s.kind === 'open') && playable(r.mode, seats.map((s) => s.kind === 'closed'));
  }

  /** The host starts their room's game. */
  begin(id: string): boolean {
    const r = this.roomOf(id);
    if (!r || r.host !== id || !this.ready(r)) return false;
    const seats = this.used(r);
    const people = seats.flatMap((s) => (s.kind === 'person' ? [this.players.get(s.id)] : [])).filter((p): p is Player => !!p);
    this.rooms.delete(r.id);
    // a plain game between two people is the classic match
    if (r.mode === '1v1' && people.length === 2 && seats[0].kind === 'person') { this.pair(people[0], people[1], r.id); return true; }
    for (const p of people) {
      p.status = 'playing';
      p.opponent = seats.filter((s) => s.kind === 'person' && s.id !== p.id).map((s) => this.players.get((s as { id: string }).id)?.name ?? '?').join(', ') || 'the computer';
      this.dropInvitesTo(p.id);
    }
    this.events.started?.({ id: r.id, mode: r.mode, seats: seats.map((s) => (s.kind === 'person' ? this.players.get(s.id) ?? null : s.kind === 'computer' ? s.level : null)) });
    this.events.changed();
    return true;
  }

  /** Challenge a specific player. Replaces any challenge, quick match or hosted game you had. */
  invite(id: string, to: string): boolean {
    const p = this.players.get(id), target = this.players.get(to);
    if (!p || !target || target.id === id || p.status === 'playing' || p.status === 'watching' || target.status === 'playing' || target.status === 'watching') return false;
    this.leave(id);
    p.inviting = to;
    this.events.changed();
    return true;
  }

  /** Accept a challenge: both players go straight into a match, the challenger as team 0. */
  accept(id: string, from: string): boolean {
    const p = this.players.get(id), challenger = this.players.get(from);
    if (!p || !challenger || challenger.inviting !== id || p.status === 'playing' || p.status === 'watching' || challenger.status === 'playing' || challenger.status === 'watching') return false;
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

  /** Stop waiting (quick match, hosting, a room you joined, or a challenge). */
  leave(id: string): void {
    this.quickQueue = this.quickQueue.filter((q) => q !== id);
    const r = this.roomOf(id);
    if (r?.host === id) {
      // the host closed the room: everyone in it is back in the lobby
      this.rooms.delete(r.id);
      for (const s of r.seats) if (s.kind === 'person' && s.id !== id) { const q = this.players.get(s.id); if (q && q.status === 'room') q.status = 'idle'; }
    } else if (r) {
      const t = r.seats.findIndex((s) => s.kind === 'person' && s.id === id);
      r.seats[t] = { kind: 'open' };
    }
    const p = this.players.get(id);
    if (p) p.inviting = undefined;
    if (p && p.status !== 'playing' && p.status !== 'watching') p.status = 'idle';
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

  /** A player is watching a match (`players`: who's in it, for the lobby to show). */
  watching(id: string, players: string): void {
    const p = this.players.get(id);
    if (!p || p.status === 'playing') return;
    this.leave(id);
    this.dropInvitesTo(id);
    p.status = 'watching';
    p.opponent = players;
    this.events.changed();
  }

  /** A player's match is over (or they stopped watching); they're back in the lobby. */
  finished(id: string): void {
    const p = this.players.get(id);
    if (p) { p.status = 'idle'; p.opponent = undefined; }
    this.events.changed();
  }

  games(): OpenGame[] {
    return [...this.rooms.values()].map((r) => {
      const seats = this.used(r);
      return { id: r.id, host: this.players.get(r.host)?.name ?? '?', mode: r.mode, players: seats.filter((s) => s.kind === 'person').length, free: seats.filter((s) => s.kind === 'open').length };
    });
  }

  /** A room as one of the people in it sees it. */
  private roomView(r: Room, id: string): RoomView {
    const seats: RoomSeat[] = this.used(r).map((s, team) => {
      if (s.kind === 'person') return { team, kind: 'person', name: this.players.get(s.id)?.name ?? '?', ...(s.id === id ? { you: true } : {}) };
      if (s.kind === 'computer') return { team, kind: 'computer', level: s.level };
      return { team, kind: s.kind };
    });
    return { id: r.id, mode: r.mode, host: r.host === id, hostName: this.players.get(r.host)?.name ?? '?', seats, ready: this.ready(r) };
  }

  /** The lobby as player `id` sees it. */
  view(id: string): LobbyMsg | null {
    const me = this.players.get(id);
    if (!me) return null;
    const others = [...this.players.values()].filter((p) => p.id !== id).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
    const players: OnlinePlayer[] = [me, ...others].slice(0, MAX_LISTED).map((p) => ({ id: p.id, name: p.name, status: p.status, ...(p.opponent ? { opponent: p.opponent } : {}) }));
    const invites = [...this.players.values()].filter((p) => p.inviting === id && p.status !== 'playing' && p.status !== 'watching').map((p) => ({ id: p.id, name: p.name }));
    const room = this.roomOf(id);
    return {
      k: 'lobby',
      games: this.games(),
      live: this.events.live?.() ?? [],
      online: this.players.size,
      players,
      you: id,
      waiting: me.status === 'quick' ? 'quick' : me.status === 'host' ? 'host' : null,
      hosting: [...this.rooms.values()].find((r) => r.host === id)?.id ?? null,
      invites,
      inviting: me.inviting ?? null,
      room: room ? this.roomView(room, id) : null,
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
