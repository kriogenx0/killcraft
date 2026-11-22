// Orbit camera math, kept free of three.js so it can be tested. The camera looks at a target point
// on the ground (in world px) from a direction (yaw), elevation (pitch) and distance (tiles).
import { MW, MH, TS } from '../../game/const.ts';
import { clamp } from '../../util/math.ts';

export interface CamRig {
  /** target on the ground, world px */
  x: number;
  y: number;
  /** compass angle the camera looks from: 0 = from the south, looking north */
  yaw: number;
  /** elevation above the ground, radians */
  pitch: number;
  /** distance from the target, tiles */
  dist: number;
}

export const PITCH_MIN = 0.42;
export const PITCH_MAX = 1.4;
export const DIST_MIN = 6;
export const DIST_MAX = 42;

export const defaultRig = (): CamRig => ({ x: 0, y: 0, yaw: 0, pitch: 0.92, dist: 17 });

export function clampRig(c: CamRig): void {
  c.x = clamp(c.x, 0, MW * TS);
  c.y = clamp(c.y, 0, MH * TS);
  c.pitch = clamp(c.pitch, PITCH_MIN, PITCH_MAX);
  c.dist = clamp(c.dist, DIST_MIN, DIST_MAX);
  c.yaw = ((c.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

/** Camera position in scene units (1 = one tile; x east, y up, z south). */
export function eye(c: CamRig): [number, number, number] {
  const flat = Math.cos(c.pitch) * c.dist;
  return [c.x / TS + Math.sin(c.yaw) * flat, Math.sin(c.pitch) * c.dist, c.y / TS + Math.cos(c.yaw) * flat];
}

/**
 * World-px movement for a pan in screen directions: `right` moves the view right, `down` moves it
 * toward the bottom of the screen. Whatever way the camera faces, W always scrolls "up the screen".
 */
export function panDelta(yaw: number, right: number, down: number): [number, number] {
  return [Math.cos(yaw) * right + Math.sin(yaw) * down, -Math.sin(yaw) * right + Math.cos(yaw) * down];
}
