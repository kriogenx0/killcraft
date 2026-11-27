// Falling snow on a winter map (G.snow): a box of flakes that follows the camera, drifting down
// and sideways and wrapping round, so it looks endless wherever the view goes.
import * as THREE from 'three';
import { G } from '../../../game/state.ts';
import { S } from './scene.ts';
import { mkCanvas, ctx2d } from '../../../util/canvas.ts';
import { TS } from '../../../game/const.ts';
import { V } from '../view_state.ts';
import { surfaceY } from './heights.ts';

const COUNT = 2600;
/** half the width and the height of the box of flakes round the camera's target (tiles) */
const HALF = 22, HIGH = 16;
let flakes: THREE.Points | null = null;
let speed: Float32Array | null = null;
let t = 0;

/** A soft round dot for each flake. */
function dot(): THREE.Texture {
  const c = mkCanvas(32, 32), g = ctx2d(c), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Set up (or take down) the snowfall for the current map. */
export function initSnow3d(): void {
  if (flakes) { S.scene.remove(flakes); flakes.geometry.dispose(); flakes = null; }
  if (!G.snow) return;
  const pos = new Float32Array(COUNT * 3);
  speed = new Float32Array(COUNT);
  for (let k = 0; k < COUNT; k++) {
    pos[k * 3] = (Math.random() * 2 - 1) * HALF;
    pos[k * 3 + 1] = Math.random() * HIGH;
    pos[k * 3 + 2] = (Math.random() * 2 - 1) * HALF;
    speed[k] = 0.9 + Math.random() * 0.9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.11, map: dot(), transparent: true, opacity: 0.9, depthWrite: false, color: '#ffffff' });
  flakes = new THREE.Points(geo, mat);
  flakes.frustumCulled = false;
  flakes.renderOrder = 5;
  S.scene.add(flakes);
}

/** Let the snow fall, round the point the camera looks at. */
export function updateSnow3d(dt: number): void {
  if (!flakes || !speed) return;
  const cx = V.cam.x / TS, cz = V.cam.y / TS, cy = surfaceY(cx, cz);
  t += dt;
  const pos = flakes.geometry.attributes.position as THREE.BufferAttribute, a = pos.array as Float32Array;
  const wrap = (v: number, c: number) => { const d = v - c; return d < -HALF ? v + HALF * 2 : d > HALF ? v - HALF * 2 : v; };
  for (let k = 0; k < COUNT; k++) {
    const s = speed[k], o = k * 3;
    a[o] = wrap(a[o] + (Math.sin(t * 0.7 + k) * 0.25 + 0.35) * dt, cx);
    a[o + 2] = wrap(a[o + 2] + Math.cos(t * 0.5 + k * 1.3) * 0.2 * dt, cz);
    a[o + 1] -= s * dt;
    if (a[o + 1] < cy - 1) a[o + 1] += HIGH;
    else if (a[o + 1] > cy + HIGH) a[o + 1] -= HIGH;
  }
  pos.needsUpdate = true;
}
