// Weather (game/weather.ts): rain streaks round the camera and a gloomier sky while it rains, and for
// each storm crossing the map a dark, tinted patch on the ground (the storm's shadow) with a dashed
// edge showing where it bites and, for hail, hailstones pelting down. No cloud is drawn over it: the
// fight underneath has to stay in view. Meteor shower stones are projectiles, drawn
// as burning stars like the Archmage's meteor (fx3d.ts, burn3d.ts).
import * as THREE from 'three';
import { G, type Storm } from '../../../game/state.ts';
import { TS } from '../../../game/const.ts';
import { STORM_FORM } from '../../../data/weather.ts';
import { mkCanvas, ctx2d } from '../../../util/canvas.ts';
import { V } from '../view_state.ts';
import { S } from './scene.ts';
import { heightAt, WATER_LEVEL } from './heights.ts';

const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const DROPS = touch ? 700 : 1600, HAIL = touch ? 220 : 450;
/** rain falls in a box this many tiles round the camera's target, from this high */
const RAIN_BOX = 24, RAIN_TOP = 16, RAIN_SPEED = 24, RAIN_LEN = 0.55, WIND = 0.22;
const HAIL_TOP = 12, HAIL_SPEED = 16;
/** grid of the ground patch under a storm (it drapes over the hills) */
const PATCH_SEG = 24;

const layer = new THREE.Group();
const ground = (x: number, z: number): number => Math.max(heightAt(x, z), WATER_LEVEL);

// ---- rain ----
const rainPos = new Float32Array(DROPS * 6);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: '#b8cce0', transparent: true, opacity: 0, depthWrite: false, fog: false });
const rain = new THREE.LineSegments(rainGeo, rainMat);
rain.frustumCulled = false;
rain.renderOrder = 7;
const dropX = new Float32Array(DROPS), dropY = new Float32Array(DROPS), dropZ = new Float32Array(DROPS);

// ---- storms ----
interface StormView { group: THREE.Group; patch: THREE.Mesh; hail: THREE.Points | null; hx: Float32Array; hy: Float32Array; hz: Float32Array; r: number }
const views = new Map<number, StormView>();
const texCache = new Map<string, THREE.CanvasTexture>();

/** A soft round patch with a bright edge: icy for hail, ember red for meteors. */
function patchTexture(kind: Storm['kind']): THREE.CanvasTexture {
  const hit = texCache.get(kind);
  if (hit) return hit;
  const N = 256, c = mkCanvas(N, N), g = ctx2d(c), m = N / 2;
  const [r, gr, b] = kind === 'hail' ? [190, 220, 255] : [255, 90, 30];
  // the storm's shadow, darkest in the middle, with its colour toward the edge
  const fill = g.createRadialGradient(m, m, 0, m, m, m);
  fill.addColorStop(0, 'rgba(10,14,24,0.38)');
  fill.addColorStop(0.75, `rgba(${r >> 2},${gr >> 2},${b >> 2},0.32)`);
  fill.addColorStop(0.93, `rgba(${r},${gr},${b},0.45)`);
  fill.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = fill;
  g.beginPath(); g.arc(m, m, m, 0, Math.PI * 2); g.fill();
  // a dashed warning line just inside the edge
  g.strokeStyle = `rgba(${Math.min(255, r + 40)},${Math.min(255, gr + 40)},${Math.min(255, b + 40)},0.85)`;
  g.lineWidth = 3;
  g.setLineDash([14, 10]);
  g.beginPath(); g.arc(m, m, m * 0.93, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(kind, t);
  return t;
}

const hailMat = new THREE.PointsMaterial({ color: '#f4faff', size: 0.16, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false, fog: false });

function makeStorm(s: Storm): StormView {
  const r = s.r / TS, group = new THREE.Group();
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 2, r * 2, PATCH_SEG, PATCH_SEG).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: patchTexture(s.kind), transparent: true, depthWrite: false, fog: false }),
  );
  patch.renderOrder = 3;
  patch.frustumCulled = false;
  group.add(patch);
  let hail: THREE.Points | null = null;
  const hx = new Float32Array(s.kind === 'hail' ? HAIL : 0), hy = new Float32Array(hx.length), hz = new Float32Array(hx.length);
  if (s.kind === 'hail') {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HAIL * 3), 3));
    hail = new THREE.Points(geo, hailMat);
    hail.frustumCulled = false;
    for (let i = 0; i < HAIL; i++) { const [x, z] = inDisk(r); hx[i] = x; hz[i] = z; hy[i] = Math.random() * HAIL_TOP; }
    group.add(hail);
  }
  layer.add(group);
  return { group, patch, hail, hx, hy, hz, r };
}

const inDisk = (r: number): [number, number] => { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; return [Math.cos(a) * d, Math.sin(a) * d]; };

function dropStorm(id: number): void {
  const v = views.get(id);
  if (!v) return;
  layer.remove(v.group);
  v.patch.geometry.dispose();
  (v.patch.material as THREE.Material).dispose();
  v.hail?.geometry.dispose();
  views.delete(id);
}

/** Set up the weather layer for the current map. */
export function initWeather3d(): void {
  for (const id of [...views.keys()]) dropStorm(id);
  S.scene.remove(layer);
  layer.clear();
  for (let i = 0; i < DROPS; i++) { dropX[i] = (Math.random() * 2 - 1) * RAIN_BOX; dropZ[i] = (Math.random() * 2 - 1) * RAIN_BOX; dropY[i] = Math.random() * RAIN_TOP; }
  layer.add(rain);
  S.scene.add(layer);
}

/** Move the rain, the storms and their hail; dim the light while it's wet. Call once a frame. */
export function updateWeather3d(dt: number): void {
  const w = G.weather;
  if (!w) return;
  const cx = V.cam.x / TS, cz = V.cam.y / TS, base = ground(cx, cz);
  // ---- rain round the camera ----
  rain.visible = w.rain > 0.01;
  if (rain.visible) {
    rainMat.opacity = 0.42 * w.rain;
    const fall = RAIN_SPEED * dt;
    for (let i = 0; i < DROPS; i++) {
      dropY[i] -= fall;
      dropX[i] += fall * WIND;
      if (dropY[i] < -2 || dropX[i] > RAIN_BOX) { dropY[i] = RAIN_TOP + Math.random() * 3; dropX[i] = (Math.random() * 2 - 1) * RAIN_BOX - RAIN_TOP * WIND; dropZ[i] = (Math.random() * 2 - 1) * RAIN_BOX; }
      const x = cx + dropX[i], z = cz + dropZ[i], y = base + dropY[i], o = i * 6;
      rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
      rainPos[o + 3] = x - RAIN_LEN * WIND; rainPos[o + 4] = y + RAIN_LEN; rainPos[o + 5] = z;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  // ---- storms ----
  const seen = new Set<number>();
  let near = 0;
  const t = performance.now() / 1000;
  for (const s of w.storms) {
    seen.add(s.id);
    const v = views.get(s.id) ?? makeStorm(s);
    views.set(s.id, v);
    const x = s.x / TS, z = s.y / TS, form = Math.min(1, s.age / STORM_FORM);
    // the patch drapes over the ground it's crossing
    const pos = v.patch.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) pos.setY(k, ground(x + pos.getX(k), z + pos.getZ(k)) + 0.08);
    pos.needsUpdate = true;
    v.patch.position.set(x, 0, z);
    // while it gathers the patch pulses; once it bites it stays bright
    const m = v.patch.material as THREE.MeshBasicMaterial;
    m.opacity = form < 1 ? 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 6)) : 0.9;
    if (v.hail) {
      v.hail.visible = form >= 1;
      const hp = v.hail.geometry.attributes.position as THREE.BufferAttribute, fall = HAIL_SPEED * dt;
      for (let i = 0; i < v.hx.length; i++) {
        v.hy[i] -= fall;
        const gx = x + v.hx[i], gz = z + v.hz[i];
        if (v.hy[i] < 0) { const [nx, nz] = inDisk(v.r); v.hx[i] = nx; v.hz[i] = nz; v.hy[i] = HAIL_TOP; }
        hp.setXYZ(i, gx, ground(gx, gz) + v.hy[i], gz);
      }
      hp.needsUpdate = true;
    }
    // how much of the sky over the camera this storm darkens
    const d = Math.hypot(x - cx, z - cz) - v.r;
    near = Math.max(near, form * (d <= 0 ? 1 : Math.max(0, 1 - d / 14)));
  }
  for (const id of [...views.keys()]) if (!seen.has(id)) dropStorm(id);
  // ---- light: a grey sky while it rains, darker still under a storm ----
  const gloom = Math.max(w.rain * 0.6, near);
  S.sun.intensity = S.mood.sunI * (1 - 0.5 * gloom);
  S.hemi.intensity = S.mood.hemiI * (1 - 0.3 * gloom);
}
