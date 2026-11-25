// Shared geometry and materials for the 3D models, so a hundred tanks share one set of buffers.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { teamColors } from '../../../data/team.ts';
import { surface, type Surface } from './surfaces.ts';

const geos = new Map<string, THREE.BufferGeometry>();
const mats = new Map<string, THREE.Material>();

export function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) { g = make(); geos.set(key, g); }
  return g;
}

/** How deep each surface's relief reads. */
const BUMP: Record<Surface, number> = { wood: 1.2, stone: 2.5, brick: 2.5, thatch: 2, concrete: 1, metal: 1.5, canvas: 0.8, plaster: 0.8 };

/** A smooth, lumpy stone: a subdivided sphere pushed in and out by a little noise. */
export function lumpy(r: number, seed = 1, flatten = 1, detail = 2): THREE.BufferGeometry {
  const g = mergeVertices(new THREE.IcosahedronGeometry(r, detail)), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k) / r, y = p.getY(k) / r, z = p.getZ(k) / r;
    const f = 1 + Math.sin(x * 4.1 + seed) * 0.08 + Math.sin(y * 5.3 + z * 3.7 + seed * 2) * 0.07 + Math.sin(z * 6.1 - x * 2.3) * 0.05;
    p.setXYZ(k, x * r * f, y * r * f * flatten, z * r * f);
  }
  g.computeVertexNormals();
  return g;
}

// Curves get plenty of segments and boxes get slightly rounded edges, so models read as smooth
// rather than faceted (tiny parts stay plain boxes: rounding them costs vertices nobody sees).
const round = (seg: number) => Math.min(24, Math.max(12, Math.round(seg * 1.5)));
export const box = (w: number, h: number, d: number) => geo(`b${w},${h},${d}`, () => {
  const min = Math.min(w, h, d);
  return min >= 0.06 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(0.02, min * 0.15)) : new THREE.BoxGeometry(w, h, d);
});
export const cyl = (rt: number, rb: number, h: number, seg = 12) => geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, round(seg)));
export const sph = (r: number, ws = 12, hs = 8) => geo(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, round(ws), round(hs)));
export const dome = (r: number) => geo(`d${r}`, () => new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2));
export const cone = (r: number, h: number, seg = 8) => geo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, round(seg)));
export const octa = (r: number) => geo(`o${r}`, () => new THREE.OctahedronGeometry(r));
export const dodeca = (r: number) => geo(`x${r}`, () => lumpy(r));
export const torus = (r: number, tube: number, arc = Math.PI * 2, rs = 6, ts = 16) => geo(`t${r},${tube},${arc},${rs},${ts}`, () => new THREE.TorusGeometry(r, tube, Math.max(10, rs), round(ts), arc));
/** A triangular prism (a gable roof) with its ridge along x: length, width across z, height. */
export const prism = (len: number, w: number, h: number) => geo(`p${len},${w},${h}`, () => {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2).rotateY(Math.PI / 2);
});
/** A surface of revolution through [radius, height] points, around y. */
export const lathe = (pts: [number, number][], seg = 16) => geo(`l${pts.join(';')},${seg}`, () => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), round(seg)));

interface MatOpts { rough?: number; metal?: number; emissive?: string; emissiveIntensity?: number; flat?: boolean; tex?: Surface }

export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.rough ?? 0.75}|${o.metal ?? 0}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 1}|${o.flat ? 1 : 0}|${o.tex ?? ''}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0, flatShading: !!o.flat });
    if (o.tex) { m.map = surface(o.tex); m.bumpMap = m.map; m.bumpScale = BUMP[o.tex]; } // the grain also catches the light
    if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
    mats.set(key, m);
  }
  return m;
}

/** Common surfaces. */
export const M = {
  steel: () => mat('#c4cad2', { rough: 0.35, metal: 0.75 }),
  darkSteel: () => mat('#4a4f58', { rough: 0.45, metal: 0.6 }),
  gun: () => mat('#2a2d30', { rough: 0.5, metal: 0.5 }),
  rubber: () => mat('#1c1c1c', { rough: 0.9 }),
  wood: () => mat('#8a5c30', { rough: 0.9, tex: 'wood' }),
  darkWood: () => mat('#563618', { rough: 0.9, tex: 'wood' }),
  concrete: () => mat('#b8b4aa', { rough: 0.95, tex: 'concrete' }),
  lightConcrete: () => mat('#d8d4ca', { rough: 0.9, tex: 'concrete' }),
  metalRoof: () => mat('#9a9ca2', { rough: 0.55, metal: 0.4, tex: 'metal' }),
  glass: () => mat('#9ec4d8', { rough: 0.15, metal: 0.3 }),
  window: () => mat('#ffd98a', { rough: 0.6, emissive: '#ffb84a', emissiveIntensity: 0.7 }),
  olive: () => mat('#6e7448'),
  khaki: () => mat('#a8996e'),
  skin: () => mat('#e2b48a', { rough: 0.8 }),
  leather: () => mat('#6a4220', { rough: 0.85 }),
  gold: () => mat('#e0b040', { rough: 0.35, metal: 0.8 }),
  hazard: () => mat('#e8c020', { rough: 0.7 }),
  horse: () => mat('#7a4e2a', { rough: 0.8 }),
  ore: () => mat('#f0b830', { rough: 0.3, metal: 0.4, emissive: '#7a4a00', emissiveIntensity: 0.6, flat: true }),
  rock: () => mat('#6a6258', { rough: 0.95, tex: 'stone' }),
  aether: () => mat('#d8a0ff', { rough: 0.15, metal: 0.2, emissive: '#9a40ff', emissiveIntensity: 1.6, flat: true }),
  starRock: () => mat('#2a2436', { rough: 0.9, flat: true }),
  sandbag: () => mat('#c4ac7c', { rough: 1, tex: 'canvas' }),
  white: () => mat('#f2ece0', { rough: 0.8 }),
  iron: () => mat('#3a3c40', { rough: 0.6, metal: 0.7 }),
  brass: () => mat('#b08a3a', { rough: 0.4, metal: 0.8 }),
  rope: () => mat('#a8885a', { rough: 1 }),
  cloth: () => mat('#e0d4b8', { rough: 0.95, tex: 'canvas' }),
  mail: () => mat('#8a9098', { rough: 0.55, metal: 0.6 }),
  hair: () => mat('#2a1a0e', { rough: 0.9 }),
  dark: () => mat('#141618', { rough: 0.7 }),
  plume: () => mat('#f4f0e6', { rough: 0.95 }),
  lamp: () => mat('#fff2c0', { rough: 0.4, emissive: '#ffd070', emissiveIntensity: 1.2 }),
  beacon: () => mat('#ff8a20', { rough: 0.4, emissive: '#ff6a00', emissiveIntensity: 1.1 }),
  redLamp: () => mat('#ff4030', { rough: 0.4, emissive: '#ff2010', emissiveIntensity: 1.2 }),
  brick: () => mat('#a06650', { rough: 0.95, tex: 'brick' }),
  tarp: () => mat('#666c48', { rough: 0.95, tex: 'canvas' }),
  // medieval building surfaces
  stone: () => mat('#aaa49a', { rough: 0.95, tex: 'stone' }),
  darkStone: () => mat('#7c7870', { rough: 0.95, tex: 'stone' }),
  dressedStone: () => mat('#c8c0b0', { rough: 0.9, tex: 'stone' }),
  plaster: () => mat('#ece2c8', { rough: 0.95, tex: 'plaster' }),
  thatch: () => mat('#d0ac58', { rough: 1, tex: 'thatch' }),
  shingle: () => mat('#88543a', { rough: 0.9, tex: 'wood' }),
  slate: () => mat('#56606c', { rough: 0.8 }),
  dirt: () => mat('#8a7652', { rough: 1 }),
  timber: () => mat('#4a3220', { rough: 0.9, tex: 'wood' }),
  ember: () => mat('#ff9a40', { rough: 0.5, emissive: '#ff5a10', emissiveIntensity: 1.4 }),
  straw: () => mat('#e0c880', { rough: 1, tex: 'thatch' }),
  bronze: () => mat('#8a6a34', { rough: 0.4, metal: 0.8 }),
  log: () => mat('#7a5634', { rough: 0.95, tex: 'wood' }),
  wattle: () => mat('#9a7c50', { rough: 1, tex: 'thatch' }),
  clay: () => mat('#b47a52', { rough: 0.95, tex: 'plaster' }),
};

/** A team's colors: main, dark and light. */
export function teamMat(team: number, shade: 'm' | 'd' | 'l' = 'm', metal = 0.2): THREE.MeshStandardMaterial {
  const m = mat(teamColors(team)[shade], { rough: 0.55, metal });
  if (!tintOf.has(m)) {
    const key = `tint|${metal}`;
    let base = mats.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!base) { base = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: metal }); mats.set(key, base); }
    tintOf.set(m, { base, color: m.color });
  }
  return m;
}

/**
 * Team colours are the same white material tinted: the batches (instancer.ts) draw every team's
 * copies of a part together, each with its own colour.
 */
const tintOf = new WeakMap<THREE.Material, { base: THREE.Material; color: THREE.Color }>();
export const teamTint = (m: THREE.Material): { base: THREE.Material; color: THREE.Color } | undefined => tintOf.get(m);
