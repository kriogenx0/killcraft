// Shared geometry and materials for the 3D models, so a hundred tanks share one set of buffers.
import * as THREE from 'three';
import { teamColors } from '../../../data/team.ts';

const geos = new Map<string, THREE.BufferGeometry>();
const mats = new Map<string, THREE.Material>();

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) { g = make(); geos.set(key, g); }
  return g;
}

export const box = (w: number, h: number, d: number) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
export const cyl = (rt: number, rb: number, h: number, seg = 12) => geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
export const sph = (r: number, ws = 12, hs = 8) => geo(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
export const dome = (r: number) => geo(`d${r}`, () => new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2));
export const cone = (r: number, h: number, seg = 8) => geo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
export const octa = (r: number) => geo(`o${r}`, () => new THREE.OctahedronGeometry(r));
export const dodeca = (r: number) => geo(`x${r}`, () => new THREE.DodecahedronGeometry(r));

interface MatOpts { rough?: number; metal?: number; emissive?: string; emissiveIntensity?: number; flat?: boolean }

export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.rough ?? 0.75}|${o.metal ?? 0}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 1}|${o.flat ? 1 : 0}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0, flatShading: !!o.flat });
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
  wood: () => mat('#7a5028', { rough: 0.9 }),
  darkWood: () => mat('#4a2e14', { rough: 0.9 }),
  concrete: () => mat('#a9a69c', { rough: 0.95 }),
  lightConcrete: () => mat('#c9c6bc', { rough: 0.9 }),
  metalRoof: () => mat('#8e9096', { rough: 0.55, metal: 0.4 }),
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
  rock: () => mat('#5a534a', { rough: 0.95, flat: true }),
  sandbag: () => mat('#b8a070', { rough: 1 }),
  white: () => mat('#f2ece0', { rough: 0.8 }),
};

/** A team's colors: main, dark and light. */
export function teamMat(team: number, shade: 'm' | 'd' | 'l' = 'm', metal = 0.2): THREE.MeshStandardMaterial {
  return mat(teamColors(team)[shade], { rough: 0.55, metal });
}
