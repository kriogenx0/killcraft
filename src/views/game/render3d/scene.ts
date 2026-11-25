// The three.js scene: renderer, orbit camera, sun and sky light, and conversions between the
// screen, the 3D scene and world px. Scene units are tiles: x east, y up, z south.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { TS } from '../../../game/const.ts';
import { eye } from '../camera_rig.ts';
import { V } from '../view_state.ts';
import { MOODS, skyEnvironment, sunDirection, type Mood } from './mood.ts';
import { groundY, surfaceY, WATER_LEVEL } from './heights.ts';

export const S = {
  renderer: null as unknown as THREE.WebGLRenderer,
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(45, 1, 0.5, 400),
  sun: new THREE.DirectionalLight('#fff1dc', 2.2),
  hemi: new THREE.HemisphereLight('#d8ecff', '#3e4a2a', 1.1),
  mood: MOODS[1],
  raycaster: new THREE.Raycaster(),
  ground: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  canvas: null as unknown as HTMLCanvasElement,
};

const SKY = '#000000'; // everything past the map's edges is black

export function initScene(canvas: HTMLCanvasElement): void {
  S.canvas = canvas;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[0].ratio));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  S.renderer = r;
  S.scene.background = new THREE.Color(SKY);
  S.scene.fog = new THREE.Fog(SKY, 30, 90);
  S.scene.add(S.hemi);
  const sun = S.sun;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  S.scene.add(sun, sun.target);
}

let sunDir = new THREE.Vector3(-0.45, 0.8, 0.33).normalize();

/** Light the scene for a map's time of day. */
export function setMood(m: Mood): void {
  S.mood = m;
  sunDir = sunDirection(m);
  S.sun.color.set(m.sun);
  S.sun.intensity = m.sunI;
  S.hemi.color.set(m.sky);
  S.hemi.groundColor.set(m.ground);
  S.hemi.intensity = m.hemiI;
  (S.scene.fog as THREE.Fog).color.set(m.haze);
  S.renderer.toneMappingExposure = m.exposure;
  S.scene.environment?.dispose();
  S.scene.environment = skyEnvironment(S.renderer, m);
  S.scene.environmentIntensity = m.envI;
}

/** Size the drawing area to the part of the window the sidebar doesn't cover. */
export function resizeScene(w: number, h: number): void {
  S.renderer.setSize(w, h, false);
  S.canvas.style.width = `${w}px`;
  S.canvas.style.height = `${h}px`;
  S.camera.aspect = w / Math.max(1, h);
  S.camera.updateProjectionMatrix();
  resizeComposer(w, h);
  if (!qualitySet) { qualitySet = true; initQuality(); }
}

let camY = 0;

/** Place the camera from the rig, and keep the sun's shadow box around what's on screen. */
export function updateCamera(): void {
  const c = V.cam, [ex, ey, ez] = eye(c), tx = c.x / TS, tz = c.y / TS;
  S.camera.position.set(ex, ey, ez);
  camY += (surfaceY(tx, tz) - camY) * 0.12; // ease over hills instead of jolting
  const ty = camY;
  S.camera.position.y += ty;
  S.camera.lookAt(tx, ty, tz);
  const span = c.dist * 1.1 + 8, sun = S.sun, sc = sun.shadow.camera;
  sun.position.set(tx + sunDir.x * 40, ty + sunDir.y * 40, tz + sunDir.z * 40);
  sun.target.position.set(tx, ty, tz);
  // the shadow box hugs the ground on screen (seen from the sun) rather than a square round the
  // target: fewer things drawn into the shadow map, and its pixels spread over less ground
  const [l, r, b, t] = shadowFit(tx, ty, tz, span);
  sc.left = l; sc.right = r; sc.top = t; sc.bottom = b; sc.near = 1; sc.far = 100;
  sc.updateProjectionMatrix();
  const fog = S.scene.fog as THREE.Fog;
  // a light haze toward the horizon, the same at every zoom so the map doesn't change colour as you zoom
  fog.near = 70;
  fog.far = 190;
}

/** Tiles added round the ground on screen, for tall things and shadows reaching in from just outside. */
const SHADOW_MARGIN = 4;
/** How far from the camera (tiles) the box reaches when looking toward the horizon. */
const SHADOW_REACH = 60;
const lightView = new THREE.Matrix4(), corner = new THREE.Vector3(), dir = new THREE.Vector3(), sunAt = new THREE.Vector3(), aim = new THREE.Vector3();
const CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/**
 * The sun's shadow box (left, right, bottom, top in the sun's view) around where the screen's
 * corners meet the ground, never bigger than a square of half-size `span` round the target.
 */
function shadowFit(tx: number, ty: number, tz: number, span: number): [number, number, number, number] {
  const cam = S.camera;
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  // the sun's view, as its shadow camera will be placed (looking from the sun at the target, y up)
  sunAt.set(tx + sunDir.x * 40, ty + sunDir.y * 40, tz + sunDir.z * 40);
  lightView.lookAt(sunAt, aim.set(tx, ty, tz), cam.up).setPosition(sunAt).invert();
  let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity;
  for (const [nx, ny] of CORNERS) {
    corner.set(nx, ny, 0.5).unproject(cam);
    dir.copy(corner).sub(cam.position).normalize();
    // where the corner's ray meets the ground at the target's height, or a point far along it
    const k = dir.y < -1e-3 ? Math.min(SHADOW_REACH, (ty - cam.position.y) / dir.y) : SHADOW_REACH;
    corner.copy(cam.position).addScaledVector(dir, k).applyMatrix4(lightView);
    l = Math.min(l, corner.x); r = Math.max(r, corner.x); b = Math.min(b, corner.y); t = Math.max(t, corner.y);
  }
  // the target itself is at (0, 0) in this view
  return [Math.max(-span, Math.min(l, 0) - SHADOW_MARGIN), Math.min(span, Math.max(r, 0) + SHADOW_MARGIN), Math.max(-span, Math.min(b, 0) - SHADOW_MARGIN), Math.min(span, Math.max(t, 0) + SHADOW_MARGIN)];
}

const ndc = new THREE.Vector2(), hit = new THREE.Vector3();

function ray(sx: number, sy: number): THREE.Raycaster {
  const r = S.canvas.getBoundingClientRect();
  ndc.set(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
  S.raycaster.setFromCamera(ndc, S.camera);
  return S.raycaster;
}

const step = new THREE.Vector3(), probe = new THREE.Vector3();

/** The world point (px) on the ground under a screen point, or null if it points at the sky. */
export function screenToWorld(sx: number, sy: number): { x: number; y: number } | null {
  const r = ray(sx, sy).ray;
  // march along the ray until it dips under the hills, then narrow down where it crossed
  if (r.direction.y < 0) {
    const start = Math.max(0, (r.origin.y - 3) / -r.direction.y);
    probe.copy(r.origin).addScaledVector(r.direction, start);
    step.copy(r.direction).multiplyScalar(0.25);
    let prev = start;
    for (let t = start; t < start + 160; t += 0.25) {
      if (probe.y <= surfaceY(probe.x, probe.z)) {
        let lo = prev, hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          r.at(mid, probe);
          if (probe.y <= surfaceY(probe.x, probe.z)) hi = mid; else lo = mid;
        }
        r.at(hi, probe);
        return { x: probe.x * TS, y: probe.z * TS };
      }
      prev = t;
      probe.add(step);
    }
  }
  const p = r.intersectPlane(S.ground, hit);
  return p ? { x: p.x * TS, y: p.z * TS } : null;
}

const proj = new THREE.Vector3();
/** Where a world point (px, at `h` tiles above the ground) appears on screen, in client px. */
export function worldToScreen(x: number, y: number, h = 0): { sx: number; sy: number; front: boolean } {
  proj.set(x / TS, h + Math.max(groundY(x, y), WATER_LEVEL), y / TS).project(S.camera);
  const r = S.canvas.getBoundingClientRect();
  return { sx: r.left + ((proj.x + 1) / 2) * r.width, sy: r.top + ((1 - proj.y) / 2) * r.height, front: proj.z < 1 };
}

/** Raycast into the scene under a screen point. */
export function raycastObjects(sx: number, sy: number, objects: THREE.Object3D[]): THREE.Intersection[] {
  return ray(sx, sy).intersectObjects(objects, true);
}

/** The ground area on screen as four world points (px), for the minimap. */
export function viewFootprint(): [number, number][] {
  const r = S.canvas.getBoundingClientRect();
  return [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]].map(([sx, sy]) => {
    const rc = ray(sx, sy);
    const p = rc.ray.intersectPlane(S.ground, hit);
    if (p && p.distanceTo(S.camera.position) < 120) return [p.x * TS, p.z * TS] as [number, number];
    // looking at the horizon: use a far point straight below the ray
    const far = rc.ray.at(90, hit);
    return [far.x * TS, far.z * TS] as [number, number];
  });
}

// ---- ambient occlusion: soft shading in corners, under eaves, and where things meet the ground ----

let composer: EffectComposer | null = null, ao: GTAOPass | null = null;
let aoMode: 'auto' | 'on' | 'off' = 'auto', lastFrame = 0, frameMs = 16;

function initComposer(w: number, h: number): void {
  const q = new URLSearchParams(location.search).get('ao');
  aoMode = q === '0' ? 'off' : q === '1' ? 'on' : 'auto';
  if (aoMode === 'off') return;
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(S.renderer, target);
  composer.addPass(new RenderPass(S.scene, S.camera));
  ao = new GTAOPass(S.scene, S.camera, w, h);
  // AO at half resolution: it's soft anyway, and that keeps it cheap
  const setSize = ao.setSize.bind(ao);
  ao.setSize = (sw: number, sh: number) => setSize(Math.ceil(sw / 2), Math.ceil(sh / 2));
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 12 });
  ao.blendIntensity = 1;
  composer.addPass(ao);
  composer.addPass(new OutputPass());
}

let viewW = 1, viewH = 1, qualitySet = false;
function resizeComposer(w: number, h: number): void {
  viewW = w; viewH = h;
  if (!composer && aoMode !== 'off') initComposer(w, h);
  composer?.setPixelRatio(S.renderer.getPixelRatio());
  composer?.setSize(w, h);
}

// ---- graphics quality: lowered step by step while frames are slow (a big battle, a weak phone), raised again once they recover ----

interface Quality { ratio: number; ao: boolean; shadowMap: number; shadowEvery: number }
/** From best to cheapest: sharpness (pixel ratio), ambient occlusion, shadow detail and how often shadows are redrawn. */
const QUALITY: Quality[] = [
  { ratio: 2, ao: true, shadowMap: 2048, shadowEvery: 1 },
  { ratio: 1.5, ao: false, shadowMap: 2048, shadowEvery: 1 },
  { ratio: 1, ao: false, shadowMap: 1024, shadowEvery: 1 },
  { ratio: 0.75, ao: false, shadowMap: 512, shadowEvery: 2 },
];
/** ms per frame (smoothed) above which quality steps down (under ~38 fps), and below which it may step back up (over ~55 fps) */
const SLOW_MS = 26, FAST_MS = 18;
/** seconds frames must stay slow before stepping down */
const DOWN_AFTER = 1.5;
let quality = 0, pinned = false, slowFor = 0, fastFor = 0, upAfter = 6, lastUp = -1e9, shadowFrame = 0;

/** Told when quality steps down (from, to), or stays at the lowest level with frames still slow (to === from). */
const onSlow: ((from: number, to: number, fps: number) => void)[] = [];
export const onSlowFrames = (f: (from: number, to: number, fps: number) => void): void => { onSlow.push(f); };
/** seconds at the lowest level with frames still slow before that's reported again */
const STILL_SLOW = 20;
let stillSlowFor = 0;

/** The current quality level (0 best), for effects that thin out with it. */
export const qualityLevel = (): number => quality;

function setQuality(q: number): void {
  quality = Math.max(0, Math.min(QUALITY.length - 1, q));
  const Q = QUALITY[quality], r = S.renderer;
  const ratio = Math.min(window.devicePixelRatio, Q.ratio);
  if (r.getPixelRatio() !== ratio) {
    r.setPixelRatio(ratio);
    r.setSize(viewW, viewH, false);
    composer?.setPixelRatio(ratio);
    composer?.setSize(viewW, viewH);
  }
  const sh = S.sun.shadow;
  if (sh.mapSize.x !== Q.shadowMap) {
    sh.mapSize.set(Q.shadowMap, Q.shadowMap);
    sh.map?.dispose();
    sh.map = null;
  }
  r.shadowMap.autoUpdate = Q.shadowEvery === 1;
  r.shadowMap.needsUpdate = true;
}

/** Step quality down while frames stay slow, and back up once they've been quick for a while. */
function adaptQuality(now: number, dt: number): void {
  if (pinned) return;
  slowFor = frameMs > SLOW_MS ? slowFor + dt : 0;
  fastFor = frameMs < FAST_MS ? fastFor + dt : 0;
  if (frameMs <= SLOW_MS) stillSlowFor = 0;
  if (slowFor > DOWN_AFTER && quality < QUALITY.length - 1) {
    // falling back soon after stepping up: that level is too much, so wait longer before trying it again
    if (now - lastUp < 15000) upAfter = Math.min(120, upAfter * 2);
    for (const f of onSlow) f(quality, quality + 1, 1000 / frameMs);
    setQuality(quality + 1);
    slowFor = fastFor = 0;
    frameMs = (SLOW_MS + FAST_MS) / 2; // judge the new level on its own frames
  } else if (quality === QUALITY.length - 1 && frameMs > SLOW_MS && (stillSlowFor += dt) > STILL_SLOW) {
    // as low as it goes and still slow: worth knowing about
    stillSlowFor = 0;
    for (const f of onSlow) f(quality, quality, 1000 / frameMs);
  } else if (fastFor > upAfter && quality > 0) {
    setQuality(quality - 1);
    slowFor = fastFor = 0; lastUp = now;
  }
}

/** ?quality=0..3 holds the graphics at one level (0 best) instead of adapting. */
export function initQuality(): void {
  const q = new URLSearchParams(location.search).get('quality');
  pinned = q !== null && q !== '';
  setQuality(pinned ? Number(q) || 0 : 0);
}

/** Smoothed time per frame (ms), for effects that thin out on slow devices. */
export const frameTime = (): number => frameMs;

/** Run just before each draw, once the scene's world matrices are up to date. */
const beforeDraw: (() => void)[] = [];
export const onBeforeDraw = (f: () => void): void => { beforeDraw.push(f); };

export function renderScene(): void {
  const now = performance.now(), dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
  if (lastFrame) frameMs = frameMs * 0.95 + dt * 0.05;
  lastFrame = now;
  adaptQuality(now, dt / 1000);
  const Q = QUALITY[quality];
  if (Q.shadowEvery > 1 && ++shadowFrame % Q.shadowEvery === 0) S.renderer.shadowMap.needsUpdate = true;
  // world matrices once per frame, here, rather than again in every pass (shadows, ambient occlusion)
  S.scene.matrixWorldAutoUpdate = false;
  S.scene.updateMatrixWorld();
  S.camera.updateMatrixWorld();
  S.camera.matrixWorldInverse.copy(S.camera.matrixWorld).invert();
  for (const f of beforeDraw) f();
  // ambient occlusion only at the best level (or when asked for with ?ao=1)
  if (composer && (aoMode === 'on' || Q.ao)) composer.render();
  else S.renderer.render(S.scene, S.camera);
}

// in development, expose the scene for poking at from the console (draw calls, triangles)
if (import.meta.env?.DEV) (globalThis as unknown as Record<string, unknown>).__scene = S;
