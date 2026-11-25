// The sheep flocks (game/cows.ts, kind 'sheep'), drawn as a few instanced meshes: a lumpy fleece
// tinted per sheep (white, or the one black sheep), a dark face with floppy ears that dips to graze,
// and thin dark legs that trot.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G } from '../../../game/state.ts';
import { MW } from '../../../game/const.ts';
import { cows, updateCows } from '../../../game/cows.ts';
import { heightAt } from './heights.ts';

/** Model size: a sheep is a bit smaller than a cow. */
const S = 0.6;
const MAX = 48;
const group = new THREE.Group();
let fleece: THREE.InstancedMesh, head: THREE.InstancedMesh, legs: THREE.InstancedMesh;
let built = false;

const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))) ?? parts[0];

// local space: +x forward, y up, feet at y = 0
const LEG_H = 0.17, HIP_Y = 0.19, BODY_Y = 0.3;
const NECK: [number, number] = [0.17, 0.34];
const HIPS: [number, number][] = [[0.11, 0.065], [0.11, -0.065], [-0.11, 0.065], [-0.11, -0.065]];

function build(): void {
  // a fat woolly barrel made of puffs, plus a little tail puff and a tuft on top of the head
  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 0.14], [0.09, 0.01, 0, 0.12], [-0.09, 0.01, 0, 0.125], [0.04, 0.07, 0.05, 0.085], [-0.05, 0.07, -0.05, 0.085],
    [0.03, 0.06, -0.06, 0.08], [-0.04, 0.06, 0.06, 0.08], [0, -0.04, 0.08, 0.08], [0, -0.04, -0.08, 0.08], [-0.19, 0.03, 0, 0.045],
  ];
  const fleeceGeo = merge(puffs.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 1).translate(x, BODY_Y + y, z)));
  const dark = (g: THREE.BufferGeometry, color: string): THREE.BufferGeometry => {
    const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const headGeo = merge([
    dark(new THREE.BoxGeometry(0.11, 0.075, 0.07).translate(0.06, -0.01, 0), '#2e2824'),
    dark(new THREE.IcosahedronGeometry(0.05, 1).scale(1, 0.8, 1.1).translate(0.02, 0.04, 0), '#efebe2'),
    dark(new THREE.BoxGeometry(0.06, 0.018, 0.03).rotateX(0.5).translate(0.01, 0.01, 0.055), '#2e2824'),
    dark(new THREE.BoxGeometry(0.06, 0.018, 0.03).rotateX(-0.5).translate(0.01, 0.01, -0.055), '#2e2824'),
    dark(new THREE.SphereGeometry(0.011, 6, 5).translate(0.07, 0.012, 0.036), '#e8d070'),
    dark(new THREE.SphereGeometry(0.011, 6, 5).translate(0.07, 0.012, -0.036), '#e8d070'),
  ]);
  const legGeo = new THREE.CylinderGeometry(0.017, 0.015, LEG_H, 6).translate(0, -LEG_H / 2, 0);
  fleece = new THREE.InstancedMesh(fleeceGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), MAX);
  head = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, vertexColors: true }), MAX);
  legs = new THREE.InstancedMesh(legGeo, new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.8 }), MAX * 4);
  for (const im of [fleece, head, legs]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = 0; group.add(im); }
  built = true;
}

/** Add the flocks' meshes to the 3D layer for a new map. */
export function initSheep3d(parent: THREE.Object3D): void {
  if (!built) build();
  parent.add(group);
}

const root = new THREE.Matrix4(), part = new THREE.Matrix4(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1);
const color = new THREE.Color();

/** Pose every sheep you can see (the herds are stepped by updateCows, same clock as the cows). */
export function updateSheep3d(): void {
  if (!built) return;
  const blend = updateCows(G.gameT), t = G.gameT;
  let n = 0;
  for (let k = 0; k < cows.list.length && n < MAX; k++) {
    const c = cows.list[k];
    if (c.kind !== 'sheep') continue;
    const x = c.px + (c.x - c.px) * blend, z = c.py + (c.y - c.py) * blend;
    if (!G.vis[Math.floor(z) * MW + Math.floor(x)]) continue;
    const s = S * c.size, phase = k * 2.3;
    const gait = c.walking ? Math.sin(t * 12 * c.size + phase) : 0;
    q.setFromAxisAngle(up, -c.face);
    root.compose(v.set(x, heightAt(x, z) + Math.abs(gait) * 0.01, z), q, sc.set(s, s, s));
    fleece.setMatrixAt(n, root);
    fleece.setColorAt(n, color.set(c.color));
    // nose down in the grass while standing, nibbling; up to trot
    const graze = c.walking ? 0.1 : 0.85 + Math.sin(t * 0.9 + phase) * 0.1 + Math.max(0, Math.sin(t * 7 + phase)) * 0.05;
    q.setFromAxisAngle(zAxis, -graze);
    part.compose(v.set(NECK[0], NECK[1], 0), q, sc.set(1, 1, 1));
    m.multiplyMatrices(root, part);
    head.setMatrixAt(n, m);
    // the black sheep's topknot is black too
    head.setColorAt(n, color.set(c.color));
    HIPS.forEach(([hx, hz], j) => {
      q.setFromAxisAngle(zAxis, gait * 0.5 * (j === 0 || j === 3 ? 1 : -1));
      part.compose(v.set(hx, HIP_Y, hz), q, sc.set(1, 1, 1));
      m.multiplyMatrices(root, part);
      legs.setMatrixAt(n * 4 + j, m);
    });
    n++;
  }
  fleece.count = head.count = n;
  legs.count = n * 4;
  for (const im of [fleece, head, legs]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
}
