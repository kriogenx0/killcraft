// Frame timing for performance work. Off unless the page has ?perf: then each frame's time spent
// in the simulation, the scene updates, the 3D draw and the 2D interface is recorded, with the
// draw calls and triangles, and kept on window.__perf for a test (or the console) to read.
import { S } from './render3d/scene.ts';

export interface FrameSample { sim: number; scene: number; draw: number; ui: number; steps: number; calls: number; tris: number }

const on = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
const frames: FrameSample[] = [];
let mark = 0, cur: FrameSample = { sim: 0, scene: 0, draw: 0, ui: 0, steps: 0, calls: 0, tris: 0 };

if (on) (globalThis as unknown as Record<string, unknown>).__perf = { frames, reset: () => { frames.length = 0; } };

/** Start timing a frame. */
export function perfStart(): void {
  if (!on) return;
  cur = { sim: 0, scene: 0, draw: 0, ui: 0, steps: 0, calls: 0, tris: 0 };
  // count every pass of the frame (shadows, ambient occlusion), not just the last
  if (S.renderer) { S.renderer.info.autoReset = false; S.renderer.info.reset(); }
  mark = performance.now();
}

/** Charge the time since the last mark to one part of the frame. */
export function perfLap(part: 'sim' | 'scene' | 'draw' | 'ui', steps = 0): void {
  if (!on) return;
  const now = performance.now();
  cur[part] += now - mark;
  cur.steps += steps;
  mark = now;
}

/** Finish the frame's record. */
export function perfEnd(): void {
  if (!on) return;
  const info = S.renderer?.info.render;
  cur.calls = info?.calls ?? 0;
  cur.tris = info?.triangles ?? 0;
  frames.push(cur);
  if (frames.length > 2000) frames.shift();
}
