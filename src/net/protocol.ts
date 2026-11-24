// Messages between the browser and the game server, sent as JSON over a WebSocket.
import type { Command } from '../game/command.ts';
import type { EntRow, FxEvent } from './snapshot.ts';
import type { Production } from '../game/state.ts';
import type { UpgradeTrack } from '../data/era.ts';
import type { Difficulty, Mode, SeatPick } from '../data/setup.ts';

export const MAX_NAME = 20;

/** A game room listed in the lobby: how the sides line up, and how many seats are still open for players. */
export interface OpenGame { id: string; host: string; mode?: Mode; /** people in it */ players?: number; /** seats still open for people */ free?: number }

/** One seat in a game room: a person, a computer, open for a person to join, or closed. */
export interface RoomSeat {
  team: number;
  kind: 'person' | 'computer' | 'open' | 'closed';
  name?: string;
  level?: Difficulty;
  /** it's you */
  you?: boolean;
}

/** The game room you're in (as host or after joining), before it starts. */
export interface RoomView {
  id: string;
  mode: Mode;
  /** you're the host: you set the seats and start the game */
  host: boolean;
  hostName: string;
  /** every seat the mode uses, by team */
  seats: RoomSeat[];
  /** the host can start now: no seat is waiting for a player and both sides have someone */
  ready: boolean;
}

/** A match under way that anyone can watch. */
export interface LiveGame {
  id: string;
  /** the players' names, team 0 first ('' for a closed seat) */
  players: string[];
  /** who plays whom, by side: "Ann & Computer vs Ben & Cal" */
  title?: string;
  /** seconds since it started */
  secs: number;
  /** how many people are watching */
  watchers: number;
}

/** Where a player is: in the lobby, waiting for a quick match, hosting a game, in a match, or watching one. */
export type PlayerStatus = 'idle' | 'quick' | 'host' | 'room' | 'playing' | 'watching';

/** Someone connected to the server, as the lobby shows them. */
export interface OnlinePlayer {
  id: string;
  name: string;
  status: PlayerStatus;
  /** who they're playing, while in a match; who's playing, while watching */
  opponent?: string;
}

/** The lobby as one player sees it. */
export interface LobbyMsg {
  k: 'lobby';
  games: OpenGame[];
  /** matches under way, to watch */
  live: LiveGame[];
  /** everyone connected, including players in a match */
  online: number;
  /** the players list (capped; you first, then who's free, then who's playing) */
  players: OnlinePlayer[];
  /** your own player id */
  you: string;
  waiting: 'quick' | 'host' | null;
  /** the id of the game you're hosting, for its invite link */
  hosting: string | null;
  /** players challenging you right now */
  invites: { id: string; name: string }[];
  /** the player you've challenged, if any */
  inviting: string | null;
  /** the game room you're in, hosting or joined, until it starts */
  room?: RoomView | null;
}

export type ClientMsg =
  | { k: 'hello'; name: string }
  | { k: 'quick' }
  /** host a game; `game` re-lists a game you were hosting before a refresh, so its invite link keeps working */
  | { k: 'create'; game?: string }
  | { k: 'join'; game: string }
  /** the host sets up their room: how the sides line up, or who sits in a seat (a computer, open for a person, or closed) */
  | { k: 'room'; mode?: Mode; seat?: number; pick?: SeatPick | 'open' }
  /** the host starts their room's game */
  | { k: 'begin' }
  | { k: 'leave' }
  | { k: 'invite'; to: string }
  | { k: 'accept'; from: string }
  | { k: 'decline'; from: string }
  | { k: 'cmd'; cmd: Command }
  | { k: 'resign' }
  /** watch a match under way */
  | { k: 'watch'; game: string }
  /** stop watching */
  | { k: 'unwatch' }
  /** come back to a match after a refresh or a dropped connection, with the key its start message gave */
  | { k: 'rejoin'; game: string; key: string };

export interface SnapMsg {
  k: 'snap';
  /** game time */
  t: number;
  /** ore */
  credits: number;
  wood: number;
  oil: number;
  aether: number;
  /** the team has found Aether (hidden units show) */
  aetherFound: boolean;
  /** the team has researched the Aether Ward */
  ward: boolean;
  /** creature kinds the team has captured, and so can train */
  tamed: string[];
  /** the team's age of technology */
  era: number;
  /** the team's healing level */
  heal: number;
  /** the team's Armory upgrade levels */
  upg?: Record<UpgradeTrack, number>;
  prod: Production;
  ents: EntRow[];
  ev: FxEvent[];
  /** whole ore map, base64 Int16, sent about once a second */
  ore?: string;
  /** every side's stock, for someone watching (the fields above are then side 0's) */
  sides?: SideStock[];
}

/** One side's stock, sent to people watching (players only get their own, in the snapshot itself). */
export interface SideStock {
  credits: number;
  wood: number;
  oil: number;
  aether: number;
  aetherFound: boolean;
  ward: boolean;
  tamed: string[];
  era: number;
  heal: number;
  upg?: Record<UpgradeTrack, number>;
  prod: Production;
}

/** How a match's sides line up, for games other than one against one (left out: two teams, each its own side). */
export interface MatchShape {
  teams?: number;
  /** each team's side */
  ally?: number[];
  /** closed seats */
  absent?: boolean[];
  /** every team's player: a name, "Computer (Hard)", or '' for a closed seat */
  names?: string[];
}

export type ServerMsg =
  | { k: 'welcome'; id: string }
  | LobbyMsg
  | { k: 'start'; team: number; seed: number; opponent: string; /** the match's UUID */ game?: string; /** secret this player sends to rejoin the match (see rejoin) */ key?: string; /** a rejoin: the match is already under way */ resumed?: boolean } & MatchShape
  | SnapMsg
  /** you're now watching this match (sent again on a reconnect) */
  | ({ k: 'spectate'; game: string; seed: number; players: string[] } & MatchShape)
  | { k: 'end'; winner: number; reason: 'destroyed' | 'left' | 'resigned'; /** how each side was knocked out */ detail?: string[] }
  /** `live`: the game asked for is a match under way, which can be watched instead */
  | { k: 'error'; msg: string; live?: LiveGame }
  | { k: 'notice'; msg: string }
  /** a rejoin found no such match: it has ended, or the key was wrong */
  | { k: 'nogame' }
  /** the server is going down for an update (a deploy) and will be back shortly */
  | { k: 'restarting' };

/** Trim and clean a player name. */
export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, MAX_NAME) : '';
  return s || 'Commander';
}

/** A computer's name in player lists. */
export const computerName = (level: Difficulty): string => `Computer (${level[0].toUpperCase()}${level.slice(1)})`;

/** Who plays whom, by side: "Ann vs Ben", or "Ann & Computer (Hard) vs Ben & Cal". Closed seats ('') are left out. */
export function sidesTitle(names: readonly string[], ally?: readonly number[]): string {
  const sides = new Map<number, string[]>();
  names.forEach((n, t) => { if (!n) return; const a = ally?.[t] ?? t; sides.set(a, [...(sides.get(a) ?? []), n]); });
  return [...sides.values()].map((s) => s.join(' & ')).join(' vs ');
}
