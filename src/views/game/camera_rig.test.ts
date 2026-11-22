import { describe, expect, it } from 'vitest';
import { DIST_MAX, PITCH_MIN, clampRig, defaultRig, eye, panDelta } from './camera_rig.ts';
import { TS } from '../../game/const.ts';

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('camera rig', () => {
  it('sits south of the target looking north by default', () => {
    const c = { ...defaultRig(), x: 10 * TS, y: 10 * TS, pitch: Math.PI / 4, dist: Math.SQRT2 * 4 };
    close(eye(c), [10, 4, 14]);
  });

  it('orbits around the target as yaw changes', () => {
    const c = { ...defaultRig(), x: 0, y: 0, pitch: 0, dist: 5, yaw: Math.PI / 2 };
    close(eye(c), [5, 0, 0]); // looking west from the east
  });

  it('pans in screen directions whatever the yaw', () => {
    close(panDelta(0, 1, 0), [1, 0]); // right = east when facing north
    close(panDelta(0, 0, -1), [0, -1]); // up the screen = north
    close(panDelta(Math.PI, 0, -1), [0, 1]); // turned around, up the screen = south
    close(panDelta(Math.PI / 2, 0, -1), [-1, 0]); // looking west, up the screen = west
  });

  it('keeps the camera inside sensible limits', () => {
    const c = { x: -50, y: 1e6, yaw: -Math.PI / 2, pitch: 0, dist: 999 };
    clampRig(c);
    expect(c.x).toBe(0);
    expect(c.pitch).toBe(PITCH_MIN);
    expect(c.dist).toBe(DIST_MAX);
    expect(c.yaw).toBeCloseTo(Math.PI * 1.5, 6);
  });
});
