// Interface state for the game view: camera, selection, pointer and command mode.
import type { Ent, Point } from '../../game/state.ts';
import type { BldType } from '../../data/building.ts';
import { MW, MH, TS } from '../../game/const.ts';
import { clamp } from '../../util/math.ts';

export type Mode =
  | { t: 'move' }
  | { t: 'amove' }
  | { t: 'place'; type: BldType; tx: number; ty: number; ok: boolean }
  | null;

export interface Marker extends Point { t: number; color: string }
export interface Ping extends Point { t: number }

export const MARKER_LIFE = 0.6;
export const PING_LIFE = 3;

export const V = {
  cam: { x: 0, y: 0 },
  /** whole window */
  vw: 0,
  vh: 0,
  /** battlefield area not covered by the sidebar */
  viewW: 0,
  viewH: 0,
  topH: 32,
  sel: [] as Ent[],
  mode: null as Mode,
  groups: new Map<string, number[]>(),
  mouse: { x: 0, y: 0, down: false, drag: false, sx: 0, sy: 0, inside: false },
  markers: [] as Marker[],
  pings: [] as Ping[],
  started: false,
  paused: false,
  speed: 1,
  /** the team this screen plays */
  team: 0,
  /** playing a person over the network */
  online: false,
};

export function clampCam(): void {
  V.cam.x = clamp(V.cam.x, 0, Math.max(0, MW * TS - V.viewW));
  V.cam.y = clamp(V.cam.y, -V.topH, Math.max(0, MH * TS - V.viewH));
}

export function centerCam(x: number, y: number): void {
  V.cam.x = x - V.viewW / 2;
  V.cam.y = y - (V.viewH + V.topH) / 2;
  clampCam();
}

export const ownSelected = (): Ent[] => V.sel.filter((e) => !e.dead && e.team === V.team);
export const selectedUnits = (): Ent[] => ownSelected().filter((e) => e.kind === 'unit');

export function ageMarkers(dt: number): void {
  for (const m of V.markers) m.t += dt;
  V.markers = V.markers.filter((m) => m.t < MARKER_LIFE);
  for (const p of V.pings) p.t += dt;
  V.pings = V.pings.filter((p) => p.t < PING_LIFE);
}
