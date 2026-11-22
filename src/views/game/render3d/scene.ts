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
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
  sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 100;
  sc.updateProjectionMatrix();
  const fog = S.scene.fog as THREE.Fog;
  // a light haze over distant ground when the camera looks out toward the horizon
  fog.near = c.dist * 1.3 + 6;
  fog.far = c.dist * 5 + 40;
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
let aoMode: 'auto' | 'on' | 'off' = 'auto', slowFrames = 0, lastFrame = 0, frameMs = 16;

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

function resizeComposer(w: number, h: number): void {
  if (!composer && aoMode !== 'off') initComposer(w, h);
  composer?.setPixelRatio(S.renderer.getPixelRatio());
  composer?.setSize(w, h);
}

export function renderScene(): void {
  const now = performance.now();
  if (lastFrame) frameMs = frameMs * 0.95 + Math.min(100, now - lastFrame) * 0.05;
  lastFrame = now;
  // on a slow machine, drop the ambient occlusion rather than the frame rate
  if (composer && aoMode === 'auto') {
    slowFrames = frameMs > 26 ? slowFrames + 1 : 0;
    if (slowFrames > 120) { composer = null; console.info('Ambient occlusion off: frames too slow'); }
  }
  if (composer) composer.render();
  else S.renderer.render(S.scene, S.camera);
}

// in development, expose the scene for poking at from the console (draw calls, triangles)
if (import.meta.env?.DEV) (globalThis as unknown as Record<string, unknown>).__scene = S;
