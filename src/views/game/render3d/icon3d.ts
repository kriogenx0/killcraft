// Sidebar pictures of the structures, rendered from their 3D models so they match the team's age
// (a thatched roundhouse in the Medieval age, a concrete barracks in the Modern age).
import * as THREE from 'three';
import type { BldType } from '../../../data/building.ts';
import { bldLook, buildingModel } from './models.ts';

const W = 128, H = 96;
const cache = new Map<string, string>();
let r: THREE.WebGLRenderer | null = null;
let failed = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 100);
const dir = new THREE.Vector3(0.55, 0.85, 1).normalize();

function renderer(): THREE.WebGLRenderer | null {
  if (r || failed) return r;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setSize(W, H, false);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    scene.background = new THREE.Color('#1a1e18');
    scene.add(new THREE.HemisphereLight('#d8ecff', '#3e4a2a', 1.3));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
    sun.position.set(-4, 8, 5);
    scene.add(sun);
  } catch {
    failed = true;
  }
  return r;
}

/** A data URL picture of a structure as `team` builds it in `era`, or null without WebGL. */
export function buildingIcon(type: BldType, team: number, era: number): string | null {
  const key = `${type}|${team}|${bldLook(type, era)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const gl = renderer();
  if (!gl) return null;
  const m = buildingModel(type, team, era);
  scene.add(m.root);
  const sphere = new THREE.Box3().setFromObject(m.root).getBoundingSphere(new THREE.Sphere());
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.72;
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.lookAt(sphere.center);
  gl.render(scene, camera);
  scene.remove(m.root);
  const url = gl.domElement.toDataURL();
  cache.set(key, url);
  return url;
}
