// Building blocks for the procedural models: placing meshes, groups, limbs and rods.
import * as THREE from 'three';
import { cyl } from './materials.ts';
import { taper } from './shapes.ts';

export interface Model {
  root: THREE.Group;
  parts: Record<string, THREE.Object3D>;
  /** height of the model's top (for health bars), tiles */
  height: number;
}

export type Mat = THREE.Material;
export type Parts = Record<string, THREE.Object3D>;

export function mesh(g: THREE.BufferGeometry, m: Mat, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

export function group(x = 0, y = 0, z = 0, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (children.length) g.add(...children);
  return g;
}

/** Set an object's rotation (radians) and return it. */
export function rot<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.rotation.set(x, y, z);
  return o;
}

/** Set an object's scale and return it. */
export function scl<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.scale.set(x, y, z);
  return o;
}

/** A limb hanging from a pivot (so it can swing): a faceted taper, thicker at the pivot. */
export function limb(x: number, y: number, z: number, len: number, thick: number, m: Mat): THREE.Group {
  return group(x, y, z, mesh(taper(len, +(thick * 1.12).toFixed(4), +(thick * 0.8).toFixed(4)), m));
}

export const along = <T extends THREE.Object3D>(o: T): T => { o.rotation.z = -Math.PI / 2; return o; }; // cylinder axis → +x
export const across = <T extends THREE.Object3D>(o: T): T => { o.rotation.x = Math.PI / 2; return o; }; // cylinder axis → z

/** A thin rod from a to b (rope, string, strut). */
export function rod(a: [number, number, number], b: [number, number, number], r: number, m: Mat, seg = 5): THREE.Mesh {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
  const me = mesh(cyl(r, r, +len.toFixed(4), seg), m);
  me.position.copy(va).add(vb).multiplyScalar(0.5);
  me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  return me;
}

