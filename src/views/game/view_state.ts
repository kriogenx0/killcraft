// Interface state for the game view: camera, selection, pointer and command mode.
import { G, type Ent, type Point } from '../../game/state.ts';
import type { BldType } from '../../data/building.ts';
import { clampRig, defaultRig } from './camera_rig.ts';

export type Mode =
  | { t: 'move' }
  | { t: 'patrol' }
  /** the army rally point (game/rally.ts) */
  | { t: 'rally' }
  /** ax, ay: where a wall line being dragged out starts */
  | { t: 'place'; type: BldType; tx: number; ty: number; ok: boolean; ax?: number; ay?: number }
  | null;

export interface Marker extends Point { t: number; color: string }
export interface Ping extends Point { t: number }

export const MARKER_LIFE = 0.6;
/** how long (s) the box around a building that was just given as a target stays up */
export const TARGET_LIFE = 1;
export interface TargetMark { id: number; t: number; color: string }
export const PING_LIFE = 3;

const FORMATION_KEY = 'killcraft.formation';

function loadFormation(): boolean {
  try { return localStorage.getItem(FORMATION_KEY) === '1'; } catch { return false; }
}

/** Turn moving in formation on or off, and remember it on this device. */
export function toggleFormation(): void {
  V.formation = !V.formation;
  try { localStorage.setItem(FORMATION_KEY, V.formation ? '1' : '0'); } catch { /* private mode: it just isn't remembered */ }
}

/** The formation flag for a move order to these units (only a group can keep formation). */
export const inFormation = (us: readonly Ent[]): { form?: true } => (V.formation && us.length > 1 ? { form: true } : {});

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
  /** the unit the camera is following (see follow_cam.ts), by id */
  follow: null as number | null,
  groups: new Map<string, number[]>(),
  /** hold: a finger pressed long enough to start a selection box */
  mouse: { x: 0, y: 0, down: false, drag: false, hold: false, sx: 0, sy: 0, inside: false },
  /** touch: one-finger drags draw a selection box instead of panning, and taps add to the selection */
  touchBox: false,
  markers: [] as Marker[],
  /** buildings just ordered at (attack, repair, drop off): boxed in red or blue for a moment */
  targets: [] as TargetMark[],
  pings: [] as Ping[],
  started: false,
  paused: false,
  speed: 1,
  /** the team this screen plays */
  team: 0,
  /** move groups of units in formation: together at the slowest one's pace, keeping their shape (remembered on this device) */
  formation: loadFormation(),
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
  for (const m of V.targets) m.t += dt;
  V.targets = V.targets.filter((m) => m.t < TARGET_LIFE);
  for (const p of V.pings) p.t += dt;
  V.pings = V.pings.filter((p) => p.t < PING_LIFE);
}
