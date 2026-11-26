// Sidebar pictures of structures and units, rendered from their 3D models so they match what's on
// the map (a thatched roundhouse in the Medieval age, a concrete barracks in the Modern age). Each
// model is framed to fill the space between the cost line and the name, lit with a key and a rim
// light, set on a soft contact shadow and a backdrop tinted for its age.
import * as THREE from 'three';
import type { BldType } from '../../../data/building.ts';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { mkCanvas, ctx2d } from '../../../util/canvas.ts';
import { bldLook, buildingModel, unitModel, type Model } from './models.ts';

/** Picture size: twice the cell's size on screen, so it stays sharp on high-density displays. */
const W = 256, H = 192;
/** Where the model goes, as fractions of the picture: clear of the cost (top) and the name (bottom). */
const FIT = { x0: 0.07, x1: 0.93, y0: 0.2, y1: 0.8 };

/** Backdrop per age: Medieval torchlit earth, Industrial olive drab, Modern steel blue. */
const BACKDROP: Array<[string, string]> = [
  ['#5a4628', '#16110a'],
  ['#454a30', '#11130c'],
  ['#2e4152', '#0b1016'],
];

const cache = new Map<string, string>();
let r: THREE.WebGLRenderer | null = null;
let failed = false;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
const dir = new THREE.Vector3(0.62, 0.7, 1).normalize();
const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.45 }));

function renderer(): THREE.WebGLRenderer | null {
  if (r || failed) return r;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(W, H, false);
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.add(new THREE.HemisphereLight('#dceeff', '#4a4632', 1.35));
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0005;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    // a cool light from behind picks the outline out of the dark backdrop
    const rim = new THREE.DirectionalLight('#9ec8ff', 1.6);
    rim.position.set(3, 4, -6);
    scene.add(rim);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  } catch {
    failed = true;
  }
  return r;
}

const ageOf = (era: number) => Math.max(0, Math.min(BACKDROP.length - 1, era));

/** A data URL picture of a structure as `team` builds it in `era`, or null without WebGL. */
export function buildingIcon(type: BldType, team: number, era: number): string | null {
  const key = `${type}|${team}|${bldLook(type, era)}|${ageOf(era)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const gl = renderer();
  if (!gl) return null;
  const url = snap(gl, buildingModel(type, team, era), ageOf(era));
  cache.set(key, url);
  return url;
}

/** A data URL picture of a unit, turned three-quarters to the viewer, or null without WebGL. */
export function unitIcon(type: UnitType, team: number): string | null {
  const key = `u|${type}|${team}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const gl = renderer();
  if (!gl) return null;
  const m = unitModel(type, team);
  m.root.rotation.y = -0.5; // facing the viewer's right, three-quarters on
  const url = snap(gl, m, ageOf(UNIT[type].era));
  cache.set(key, url);
  return url;
}

/** Every vertex of the model's shown meshes, through `toSpace` (hidden parts like a muzzle flash don't count). */
function eachPoint(root: THREE.Object3D, toSpace: THREE.Matrix4, fn: (v: THREE.Vector3) => void): void {
  const v = new THREE.Vector3(), mat = new THREE.Matrix4();
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const pos = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry.getAttribute('position') : null;
    if (pos) {
      mat.multiplyMatrices(toSpace, o.matrixWorld);
      for (let i = 0; i < pos.count; i++) fn(v.fromBufferAttribute(pos, i).applyMatrix4(mat));
    }
    for (const k of o.children) walk(k);
  };
  walk(root);
}

function snap(gl: THREE.WebGLRenderer, m: Model, age: number): string {
  m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  scene.add(m.root);
  m.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  eachPoint(m.root, new THREE.Matrix4(), (v) => box.expandByPoint(v));
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const reach = size.length() + 1;

  // frame: look along `dir`, then fit the model's outline into FIT with the picture's aspect
  camera.position.copy(center).addScaledVector(dir, reach * 2);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  eachPoint(m.root, camera.matrixWorldInverse, (c) => {
    x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y);
  });
  // world units per pixel, so the outline fills the fit box on its tighter side
  const upp = Math.max((x1 - x0) / ((FIT.x1 - FIT.x0) * W), (y1 - y0) / ((FIT.y1 - FIT.y0) * H));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const px = ((FIT.x0 + FIT.x1) / 2 - 0.5) * W * upp, py = (0.5 - (FIT.y0 + FIT.y1) / 2) * H * upp;
  camera.left = cx - px - (W / 2) * upp; camera.right = cx - px + (W / 2) * upp;
  camera.bottom = cy - py - (H / 2) * upp; camera.top = cy - py + (H / 2) * upp;
  camera.far = reach * 4;
  camera.updateProjectionMatrix();

  // a contact shadow from a high sun, just over the ground plane
  ground.position.set(center.x, box.min.y + 0.001, center.z);
  ground.scale.setScalar(reach * 3);
  sun.target.position.copy(center);
  sun.position.copy(center).add(new THREE.Vector3(-0.35, 1, 0.45).multiplyScalar(reach * 1.5));
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -reach; sc.right = sc.top = reach; sc.near = 0.01; sc.far = reach * 4;
  sc.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;

  gl.render(scene, camera);
  scene.remove(m.root);

  // compose: age backdrop, a floor glow under the model, the render, then a vignette
  const c = mkCanvas(W, H), g = ctx2d(c);
  const [lit, dark] = BACKDROP[age];
  const bg = g.createRadialGradient(W / 2, H * 0.62, 8, W / 2, H * 0.5, W * 0.62);
  bg.addColorStop(0, lit); bg.addColorStop(1, dark);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.drawImage(gl.domElement, 0, 0, W, H);
  const vig = g.createLinearGradient(0, 0, 0, H);
  vig.addColorStop(0, 'rgba(0,0,0,0.45)'); vig.addColorStop(0.22, 'rgba(0,0,0,0)');
  vig.addColorStop(0.78, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig; g.fillRect(0, 0, W, H);
  return c.toDataURL();
}
