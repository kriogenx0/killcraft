// Draws many copies of the same model in a few draw calls. Every unit and structure is a little
// tree of meshes built from shared geometry and materials (models.ts hands out clones of one
// template), so each frame the meshes of everything on screen are gathered by geometry and
// material and drawn as one InstancedMesh per pair, with each copy's own place, pose and
// animation. The original meshes stay in the scene (for picking, and so the rest of the code can
// keep moving and hiding parts as usual) but move to a layer the camera doesn't draw. A mesh with
// a material of its own (a unit flashing red, a fallen grey body) or anything see-through is
// drawn on its own as before.
import * as THREE from 'three';
import { teamTint } from './materials.ts';

/** Layer of meshes drawn by an instanced copy instead (the camera and shadows only see layer 0). */
const HIDDEN = 1 << 1, SHOWN = 1;
/** Layer only the sun's shadow camera sees: copies of models off screen that cast a shadow onto it. */
export const SHADOW_ONLY_LAYER = 2;

interface Batch { mesh: THREE.InstancedMesh | null; list: THREE.Mesh[]; shadowOnly: boolean; tinted: boolean }

const batches = new Map<string, Batch>();
const geoId = new WeakMap<THREE.BufferGeometry, number>(), matId = new WeakMap<THREE.Material, number>();
let nextId = 1;
const idOf = <T extends object>(m: WeakMap<T, number>, o: T): number => {
  let id = m.get(o);
  if (id === undefined) { id = nextId++; m.set(o, id); }
  return id;
};

/** A mesh drawn as part of a batch, or null when it must be drawn on its own. */
function keyOf(o: THREE.Mesh): string | null {
  const mt = o.material;
  if (Array.isArray(mt) || mt.transparent || o.renderOrder !== 0 || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh || o.morphTargetInfluences) return null;
  const u = o.userData;
  // remember the key while the geometry, material and shadow flags stay the same
  if (u.ikGeo === o.geometry && u.ikMat === mt && u.ikCast === o.castShadow && u.ikRecv === o.receiveShadow) return u.ik as string;
  // a team colour batches with the other teams' (one white material, tinted per copy)
  const tint = teamTint(mt);
  const k = `${idOf(geoId, o.geometry)}|${tint ? `t${idOf(matId, tint.base)}` : idOf(matId, mt)}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}`;
  u.ikGeo = o.geometry; u.ikMat = mt; u.ikCast = o.castShadow; u.ikRecv = o.receiveShadow; u.ik = k;
  return k;
}

const det = (e: number[]): number =>
  e[0] * (e[5] * e[10] - e[6] * e[9]) - e[1] * (e[4] * e[10] - e[6] * e[8]) + e[2] * (e[4] * e[9] - e[5] * e[8]);

const frustum = new THREE.Frustum(), shadowFrustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere();

/**
 * Gather the visible meshes under `holder` into instanced batches drawn from `into`. Each child of
 * `holder` is one model; `radius(root)` is how far (scene units) the model reaches from its
 * origin, to skip models out of the camera's (and the sun's shadow camera's) view. World
 * matrices must be up to date (scene.ts updates them before its draw hooks run).
 */
export function instanceModels(holder: THREE.Object3D, into: THREE.Object3D, camera: THREE.Camera, shadowCam: THREE.Camera | null, radius: (root: THREE.Object3D) => number): void {
  frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  if (shadowCam) {
    shadowCam.updateMatrixWorld();
    shadowFrustum.setFromProjectionMatrix(pv.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse));
  }
  for (const b of batches.values()) b.list.length = 0;
  for (const root of holder.children) {
    if (!root.visible) continue;
    sphere.center.setFromMatrixPosition(root.matrixWorld);
    sphere.radius = radius(root);
    // off screen and casting no shadow on screen: its meshes stay as they are (three culls the
    // ones drawn on their own; the batched ones are on the hidden layer)
    const onScreen = frustum.intersectsSphere(sphere);
    if (!onScreen && !(shadowCam && shadowFrustum.intersectsSphere(sphere))) continue;
    root.traverseVisible((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const me = o as THREE.Mesh;
      let k = det(me.matrixWorld.elements) > 0 && (onScreen || me.castShadow) ? keyOf(me) : null;
      if (k === null) { me.layers.mask = SHOWN; return; }
      // off screen it only casts a shadow: kept apart so the camera doesn't draw it for nothing
      if (!onScreen) k += 's';
      let b = batches.get(k);
      if (!b) { b = { mesh: null, list: [], shadowOnly: !onScreen, tinted: !!teamTint(me.material as THREE.Material) }; batches.set(k, b); }
      b.list.push(me);
    });
  }
  for (const b of batches.values()) {
    const n = b.list.length;
    // a lone copy is drawn as itself: no gain from a batch
    if (n < 2) {
      if (n) b.list[0].layers.mask = SHOWN;
      if (b.mesh) { b.mesh.visible = false; b.mesh.count = 0; }
      continue;
    }
    if (!b.mesh || n > b.mesh.instanceMatrix.count) {
      const cap = Math.max(16, n, (b.mesh?.instanceMatrix.count ?? 0) * 2);
      if (b.mesh) { into.remove(b.mesh); b.mesh.dispose(); }
      b.mesh = newBatch(b.list[0], cap);
      if (b.shadowOnly) b.mesh.layers.set(SHADOW_ONLY_LAYER);
      into.add(b.mesh);
    }
    const mesh = b.mesh, arr = mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const me = b.list[i];
      me.layers.mask = HIDDEN;
      arr.set(me.matrixWorld.elements, i * 16);
      if (b.tinted) mesh.setColorAt(i, (teamTint(me.material as THREE.Material) as { color: THREE.Color }).color);
    }
    if (mesh.instanceColor) {
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, n * 3);
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.count = n;
    mesh.visible = true;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }
}

function newBatch(like: THREE.Mesh, cap: number): THREE.InstancedMesh {
  const own = like.material as THREE.Material, m = new THREE.InstancedMesh(like.geometry, teamTint(own)?.base ?? own, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = like.castShadow;
  m.receiveShadow = like.receiveShadow;
  m.frustumCulled = false; // each model was checked against the view already
  m.matrixAutoUpdate = false;
  m.count = 0;
  return m;
}

/** Forget every batch (a new game). */
export function resetInstances(into: THREE.Object3D): void {
  for (const b of batches.values()) if (b.mesh) { into.remove(b.mesh); b.mesh.dispose(); }
  batches.clear();
}

// ---- materials a model takes for itself for a while (a hit flash, a grey corpse) ----

const spare = new Map<THREE.Material, THREE.Material[]>();
const originOf = new WeakMap<THREE.Material, THREE.Material>();

/**
 * A private copy of a shared material. Copies are kept and handed out again rather than disposed,
 * so their shader stays compiled: a copy coming and going on every hit would recompile it.
 */
export function borrowMaterial<T extends THREE.Material>(m: T): T {
  const c = (spare.get(m)?.pop() as T | undefined) ?? (m.clone() as T);
  originOf.set(c, m);
  return c;
}

/** Hand a copy back, reset to its original. */
export function returnMaterial(c: THREE.Material): void {
  const m = originOf.get(c);
  if (!m) { c.dispose(); return; }
  c.copy(m);
  let list = spare.get(m);
  if (!list) spare.set(m, (list = []));
  list.push(c);
}

/** The shared material a copy was made from (or the material itself). */
export const originalMaterial = (c: THREE.Material): THREE.Material => originOf.get(c) ?? c;
