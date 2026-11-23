// Damaged buildings burn: a column of smoke below 60% health, flames licking off the roof below 35%,
// and a roaring blaze with thick black smoke near death. Purely visual, run by the view, so it also
// shows for online players. One fixed pool of sprites drawn in two draw calls.
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import { seenAt } from '../../../game/fog.ts';
import { hash } from '../../../util/math.ts';
import { S } from './scene.ts';
import { footprintY } from './heights.ts';
import { modelHeight, ventsOf } from './entities3d.ts';

export const SMOKE_AT = 0.6, FIRE_AT = 0.35, BLAZE_AT = 0.15;
const CAP = 900;

interface Pool { pts: THREE.Points; pos: Float32Array; col: Float32Array; size: Float32Array; n: number }

const VERT = `
  attribute vec4 aColor; attribute float aSize; uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.15, d);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }`;

const uScale = { value: 400 };
function pool(additive: boolean, order: number): Pool {
  const pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 4), size = new Float32Array(CAP), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale }, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = order;
  return { pts, pos, col, size, n: 0 };
}

// particle state, struct-of-arrays: position, velocity, age, lifetime, base size, kind (0 flame, 1 smoke, 2 black smoke, 3 steam, 4 chimney smoke)
const px = new Float32Array(CAP), py = new Float32Array(CAP), pz = new Float32Array(CAP);
const vx = new Float32Array(CAP), vy = new Float32Array(CAP), vz = new Float32Array(CAP);
const age = new Float32Array(CAP), life = new Float32Array(CAP), base = new Float32Array(CAP), kind = new Uint8Array(CAP);
let count = 0;
const flames = pool(false, 6), smoke = pool(false, 5);
const group = new THREE.Group();
group.add(smoke.pts, flames.pts);
const debt = new Map<number, number>();

function emit(k: number, x: number, y: number, z: number, s: number): void {
  if (count >= CAP) return;
  const i = count++, r = Math.random;
  px[i] = x + (r() - 0.5) * 0.12; py[i] = y; pz[i] = z + (r() - 0.5) * 0.12;
  vx[i] = (r() - 0.5) * 0.15 + (k ? 0.12 : 0); vz[i] = (r() - 0.5) * 0.15 + (k ? 0.05 : 0);
  vy[i] = k === 0 ? 0.7 + r() * 0.5 : 0.45 + r() * 0.3;
  age[i] = 0;
  life[i] = k === 0 ? 0.45 + r() * 0.35 : 2.2 + r() * 1.6;
  if (k >= 3) { const j = k === 3 ? 0.2 : 0.05; px[i] = x + (r() - 0.5) * j; pz[i] = z + (r() - 0.5) * j; vy[i] = 0.55 + r() * 0.25; life[i] = 1.8 + r(); }
  base[i] = s * (0.7 + r() * 0.6);
  kind[i] = k;
}

/** Where on a building fire breaks out: a few fixed spots on its roof, more as it burns. */
function hotspots(e: Ent, n: number, out: [number, number, number][]): void {
  out.length = 0;
  const top = footprintY(e.tx, e.ty, e.w, e.h) + modelHeight(e);
  for (let k = 0; k < n; k++) {
    const a = hash(e.id * 1.7 + k * 3.1, k + 0.5), b = hash(k * 2.3 + 1, e.id * 0.9);
    out.push([e.tx + e.w * (0.2 + a * 0.6), top * (0.6 + hash(e.id, k * 5.7) * 0.3), e.ty + e.h * (0.2 + b * 0.6)]);
  }
}

const spots: [number, number, number][] = [];

function ignite(e: Ent, dt: number): void {
  const f = e.hp / e.maxhp;
  if (f >= SMOKE_AT) { debt.delete(e.id); return; }
  const size = Math.sqrt(e.w * e.h), heat = 1 - f / SMOKE_AT; // 0 at 60% health, 1 at death
  hotspots(e, f < BLAZE_AT ? 4 : f < FIRE_AT ? 2 : 1, spots);
  // particles per second, spread over the hotspots
  const smokeRate = (2 + heat * 10) * size, flameRate = f < FIRE_AT ? (8 + (1 - f / FIRE_AT) * 30) * size : 0;
  let d = (debt.get(e.id) ?? 0) + dt;
  const step = 1 / (smokeRate + flameRate);
  while (d >= step) {
    d -= step;
    const [x, y, z] = spots[(Math.random() * spots.length) | 0];
    if (Math.random() * (smokeRate + flameRate) < flameRate) emit(0, x, y, z, 0.26 + heat * 0.2);
    else emit(f < FIRE_AT ? 2 : 1, x, y + (f < FIRE_AT ? 0.25 : 0), z, 0.4 + heat * 0.35);
  }
  debt.set(e.id, Math.min(d, 0.25));
}

const steamDebt = new Map<number, number>(), at = new THREE.Vector3();

/** Steam rising from the tops of cooling towers and chimneys (model parts named vent0, vent1...). */
function vent(e: Ent, dt: number): void {
  const vents = ventsOf(e);
  if (!vents.length) return;
  let d = (steamDebt.get(e.id) ?? 0) + dt;
  const step = 1 / (5 * vents.length);
  for (; d >= step; d -= step) {
    const v = vents[(Math.random() * vents.length) | 0];
    v.at.getWorldPosition(at);
    emit(v.smoke ? 4 : 3, at.x, at.y, at.z, v.smoke ? 0.22 : 0.45);
  }
  steamDebt.set(e.id, Math.min(d, 0.25));
}

const color = new THREE.Color();

/** Advance the fires by dt seconds (0 when paused: they freeze) and refresh the sprites. */
export function updateBurning(dt: number): void {
  if (dt > 0) {
    for (const e of G.ents) if (e.kind === 'bld' && e.done && e.hp > 0 && seenAt(e.x, e.y)) { ignite(e, dt); vent(e, dt); }
    for (let i = 0; i < count; i++) {
      age[i] += dt;
      if (age[i] >= life[i]) { // swap-remove
        const j = --count;
        px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
        age[i] = age[j]; life[i] = life[j]; base[i] = base[j]; kind[i] = kind[j];
        i--;
        continue;
      }
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      if (kind[i]) { vx[i] += 0.05 * dt; vy[i] *= 1 - 0.25 * dt; } // smoke drifts downwind and slows
    }
  }
  flames.n = smoke.n = 0;
  for (let i = 0; i < count; i++) {
    const k = age[i] / life[i], p = kind[i] ? smoke : flames, n = p.n++;
    p.pos[n * 3] = px[i]; p.pos[n * 3 + 1] = py[i]; p.pos[n * 3 + 2] = pz[i];
    let a: number, s: number;
    if (kind[i] === 0) {
      color.setRGB(1, 0.8 - k * 0.6, 0.3 - k * 0.28, THREE.SRGBColorSpace); // yellow-orange to deep red
      a = (1 - k * k) * 0.85; s = base[i] * (1 - k * 0.6);
    } else {
      const g = kind[i] === 3 ? 0.92 : kind[i] === 4 ? 0.55 + k * 0.2 : kind[i] === 2 ? 0.12 + k * 0.16 : 0.45 + k * 0.15;
      color.setRGB(g, g * 0.98, g * 0.96, THREE.SRGBColorSpace);
      a = Math.min(1, k * 6) * (1 - k) * (kind[i] === 2 ? 0.75 : kind[i] >= 3 ? 0.4 : 0.5); s = base[i] * (1 + k * 2.5);
    }
    p.col.set([color.r, color.g, color.b, a], n * 4);
    p.size[n] = s;
  }
  for (const p of [flames, smoke]) {
    const g = p.pts.geometry;
    g.setDrawRange(0, p.n);
    for (const a of ['position', 'aColor', 'aSize']) g.attributes[a].needsUpdate = true;
  }
  // sprite size in world units -> pixels at distance 1
  uScale.value = S.renderer.domElement.height * 0.5 * S.camera.projectionMatrix.elements[5];
}

export function initBurning(): void {
  count = 0;
  debt.clear();
  steamDebt.clear();
  S.scene.remove(group);
  S.scene.add(group);
}
