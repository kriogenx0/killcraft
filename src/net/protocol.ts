// Messages between the browser and the game server, sent as JSON over a WebSocket.
import type { Command } from '../game/command.ts';
import type { EntRow, FxEvent } from './snapshot.ts';
import type { Production } from '../game/state.ts';
import type { UpgradeTrack } from '../data/era.ts';

export const MAX_NAME = 20;

export interface OpenGame { id: string; host: string }

/** Where a player is: in the lobby, waiting for a quick match, hosting a game, or in a match. */
export type PlayerStatus = 'idle' | 'quick' | 'host' | 'playing';

/** Someone connected to the server, as the lobby shows them. */
export interface OnlinePlayer {
  id: string;
  name: string;
  status: PlayerStatus;
  /** who they're playing, while in a match */
  opponent?: string;
}

/** The lobby as one player sees it. */
export interface LobbyMsg {
  k: 'lobby';
  games: OpenGame[];
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
}

export type ClientMsg =
  | { k: 'hello'; name: string }
  | { k: 'quick' }
  /** host a game; `game` re-lists a game you were hosting before a refresh, so its invite link keeps working */
  | { k: 'create'; game?: string }
  | { k: 'join'; game: string }
  | { k: 'leave' }
  | { k: 'invite'; to: string }
  | { k: 'accept'; from: string }
  | { k: 'decline'; from: string }
  | { k: 'cmd'; cmd: Command }
  | { k: 'resign' }
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
}

export type ServerMsg =
  | { k: 'welcome'; id: string }
  | LobbyMsg
  | { k: 'start'; team: number; seed: number; opponent: string; /** the match's UUID */ game?: string; /** secret this player sends to rejoin the match (see rejoin) */ key?: string; /** a rejoin: the match is already under way */ resumed?: boolean }
  | SnapMsg
  | { k: 'end'; winner: number; reason: 'destroyed' | 'left' | 'resigned' }
  | { k: 'error'; msg: string }
  | { k: 'notice'; msg: string }
  /** a rejoin found no such match: it has ended, or the key was wrong */
  | { k: 'nogame' };

/** Trim and clean a player name. */
export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, MAX_NAME) : '';
  return s || 'Commander';
}
