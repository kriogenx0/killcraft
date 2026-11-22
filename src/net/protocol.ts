// Messages between the browser and the game server, sent as JSON over a WebSocket.
import type { Command } from '../game/command.ts';
import type { EntRow, FxEvent } from './snapshot.ts';
import type { Production } from '../game/state.ts';

export const MAX_NAME = 20;

export interface OpenGame { id: string; host: string }

export type ClientMsg =
  | { k: 'hello'; name: string }
  | { k: 'quick' }
  | { k: 'create' }
  | { k: 'join'; game: string }
  | { k: 'leave' }
  | { k: 'cmd'; cmd: Command }
  | { k: 'resign' };

export interface SnapMsg {
  k: 'snap';
  /** game time */
  t: number;
  credits: number;
  /** the team's age of technology */
  era: number;
  /** the team's healing level */
  heal: number;
  prod: Production;
  ents: EntRow[];
  ev: FxEvent[];
  /** whole ore map, base64 Int16, sent about once a second */
  ore?: string;
}

export type ServerMsg =
  | { k: 'welcome'; id: string }
  | { k: 'lobby'; games: OpenGame[]; online: number; waiting: 'quick' | 'host' | null }
  | { k: 'start'; team: number; seed: number; opponent: string }
  | SnapMsg
  | { k: 'end'; winner: number; reason: 'destroyed' | 'left' | 'resigned' }
  | { k: 'error'; msg: string };

/** Trim and clean a player name. */
export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, MAX_NAME) : '';
  return s || 'Commander';
}
