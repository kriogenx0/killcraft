// Interface state for the game view: camera, selection, pointer and command mode.
import { G, type Ent, type Point } from '../../game/state.ts';
import type { BldType } from '../../data/building.ts';
import { clampRig, defaultRig } from './camera_rig.ts';

export type Mode =
  | { t: 'move' }
  | { t: 'patrol' }
  /** ax, ay: where a wall line being dragged out starts */
  | { t: 'place'; type: BldType; tx: number; ty: number; ok: boolean; ax?: number; ay?: number }
  | null;

export interface Marker extends Point { t: number; color: string }
export interface Ping extends Point { t: number }

export const MARKER_LIFE = 0.6;
export const PING_LIFE = 3;

export const V = {
  /** orbit camera: target on the ground (px), yaw, pitch, distance */
  cam: defaultRig(),
  /** whole window */
  vw: 0,
  vh: 0,
  /** battlefield area not covered by the sidebar (the 3D view's size) */
  viewW: 0,
  viewH: 0,
  topH: 32,
  sel: [] as Ent[],
  mode: null as Mode,
  /** the production hotkey group open on the selected building (see hotkeys.ts), e.g. 'Walls' */
  keyGroup: null as string | null,
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
  clampRig(V.cam);
}

/** Point the camera at a world spot (px). */
export function centerCam(x: number, y: number): void {
  V.cam.x = x;
  V.cam.y = y;
  clampRig(V.cam);
}

/** Watching computers play (AI vs AI): anything can be selected and inspected, nothing can be ordered. */
export const spectating = (): boolean => G.demo;

/** The selection this screen may give orders to: your own things, and nothing while spectating. */
export const ownSelected = (): Ent[] => (spectating() ? [] : V.sel.filter((e) => !e.dead && e.team === V.team));
export const selectedUnits = (): Ent[] => ownSelected().filter((e) => e.kind === 'unit');

export function ageMarkers(dt: number): void {
  for (const m of V.markers) m.t += dt;
  V.markers = V.markers.filter((m) => m.t < MARKER_LIFE);
  for (const p of V.pings) p.t += dt;
  V.pings = V.pings.filter((p) => p.t < PING_LIFE);
}
