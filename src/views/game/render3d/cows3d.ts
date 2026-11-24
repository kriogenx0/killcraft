// The herds of cows (game/cows.ts), drawn as a handful of instanced meshes: a coat tinted per cow,
// white (or black) patches, a head that dips to graze, swinging legs, and a pink muzzle with horns.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G } from '../../../game/state.ts';
import { MW } from '../../../game/const.ts';
import { cows, updateCows } from '../../../game/cows.ts';
import { heightAt } from './heights.ts';

/** Model size: a cow is about half a tile long. */
const S = 0.62;
const MAX = 64;
const group = new THREE.Group();
let coat: THREE.InstancedMesh, spots: THREE.InstancedMesh, head: THREE.InstancedMesh, face: THREE.InstancedMesh, legs: THREE.InstancedMesh;
let built = false;

/** Paint a geometry one colour (multiplied by the instance colour where there is one). */
function tint(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))) ?? parts[0];

// local space: +x forward, y up, the cow's feet at y = 0
const LEG_H = 0.2, HIP_Y = 0.21, BODY_Y = 0.31;
const NECK: [number, number] = [0.2, 0.36];
const HIPS: [number, number][] = [[0.15, 0.075], [0.15, -0.075], [-0.15, 0.075], [-0.15, -0.075]];

function build(): void {
  const coatMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, vertexColors: true });
  const body = merge([
    tint(new THREE.CapsuleGeometry(0.11, 0.28, 6, 14).rotateZ(Math.PI / 2).scale(1, 1, 0.95).translate(0, BODY_Y, 0), '#ffffff'),
    tint(new THREE.CylinderGeometry(0.008, 0.012, 0.2, 5).translate(0, -0.1, 0).rotateZ(-0.35).translate(-0.24, BODY_Y + 0.06, 0), '#ffffff'),
    tint(new THREE.SphereGeometry(0.022, 6, 5).translate(-0.31, BODY_Y - 0.12, 0), '#3a2a20'),
    tint(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 0.7, 1).translate(-0.08, BODY_Y - 0.1, 0), '#f0a0b0'),
  ]);
  const spotGeo = merge([[0.06, 0.06, 1, 0.055], [-0.1, 0.03, 1, 0.065], [0.02, 0.08, -1, 0.06], [-0.13, 0.05, -1, 0.05], [0.12, 0.1, 0, 0.045]].map(([x, y, side, r]) =>
    side === 0
      ? new THREE.SphereGeometry(r, 10, 6).scale(1.3, 0.25, 1.1).translate(x, BODY_Y + 0.112, 0.02)
      : new THREE.SphereGeometry(r, 10, 6).scale(1.2, 1, 0.25).translate(x, BODY_Y + y - 0.04, side * 0.103)));
  const headGeo = merge([
    tint(new THREE.BoxGeometry(0.15, 0.1, 0.1).translate(0.07, 0, 0), '#ffffff'),
    tint(new THREE.BoxGeometry(0.03, 0.025, 0.06).translate(0.0, 0.035, 0.07), '#ffffff'),
    tint(new THREE.BoxGeometry(0.03, 0.025, 0.06).translate(0.0, 0.035, -0.07), '#ffffff'),
  ]);
  const faceGeo = merge([
    tint(new THREE.BoxGeometry(0.06, 0.075, 0.104).translate(0.15, -0.012, 0), '#f2a8b4'),
    tint(new THREE.SphereGeometry(0.012, 6, 5).translate(0.1, 0.02, 0.051), '#111111'),
    tint(new THREE.SphereGeometry(0.012, 6, 5).translate(0.1, 0.02, -0.051), '#111111'),
    tint(new THREE.ConeGeometry(0.013, 0.06, 6).rotateX(-1.1).translate(0.04, 0.06, 0.06), '#efe4c8'),
    tint(new THREE.ConeGeometry(0.013, 0.06, 6).rotateX(1.1).translate(0.04, 0.06, -0.06), '#efe4c8'),
  ]);
  const legGeo = merge([
    tint(new THREE.CylinderGeometry(0.026, 0.022, LEG_H - 0.03, 7).translate(0, -(LEG_H - 0.03) / 2, 0), '#ffffff'),
    tint(new THREE.CylinderGeometry(0.024, 0.027, 0.035, 7).translate(0, -LEG_H + 0.012, 0), '#2a2220'),
  ]);
  const plain = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, vertexColors: true });
  const spotMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
  coat = new THREE.InstancedMesh(body, coatMat, MAX);
  spots = new THREE.InstancedMesh(spotGeo, spotMat, MAX);
  head = new THREE.InstancedMesh(headGeo, coatMat, MAX);
  face = new THREE.InstancedMesh(faceGeo, plain, MAX);
  legs = new THREE.InstancedMesh(legGeo, coatMat, MAX * 4);
  for (const im of [coat, spots, head, face, legs]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = 0; group.add(im); }
  built = true;
}

/** Add the herds' meshes to the 3D layer for a new map. */
export function initCows3d(parent: THREE.Object3D): void {
  if (!built) build();
  parent.add(group);
}

const root = new THREE.Matrix4(), part = new THREE.Matrix4(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1);
const color = new THREE.Color(), dark = new THREE.Color('#2a2624'), white = new THREE.Color('#f6f3ec');

/** Move the herds on to the current game time and pose every cow you can see. */
export function updateCows3d(): void {
  if (!built) return;
  const blend = updateCows(G.gameT), t = G.gameT;
  let n = 0;
  for (let k = 0; k < cows.list.length && n < MAX; k++) {
    const c = cows.list[k], x = c.px + (c.x - c.px) * blend, z = c.py + (c.y - c.py) * blend;
    if (!G.vis[Math.floor(z) * MW + Math.floor(x)]) continue;
    const s = S * c.size, phase = k * 1.7;
    const gait = c.walking ? Math.sin(t * 9 * c.size + phase) : 0;
    q.setFromAxisAngle(up, -c.face);
    root.compose(v.set(x, heightAt(x, z) + Math.abs(gait) * 0.006, z), q, sc.set(s, s, s));
    coat.setMatrixAt(n, root);
    spots.setMatrixAt(n, root);
    color.set(c.color);
    coat.setColorAt(n, color);
    spots.setColorAt(n, color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.7 ? dark : white);
    // the head hangs down to graze while standing, chewing now and then; held up to walk
    const graze = c.walking ? 0.05 : 0.75 + Math.sin(t * 0.7 + phase) * 0.12 + Math.max(0, Math.sin(t * 6 + phase)) * 0.06;
    q.setFromAxisAngle(zAxis, -graze);
    part.compose(v.set(NECK[0], NECK[1], 0), q, sc.set(1, 1, 1));
    m.multiplyMatrices(root, part);
    head.setMatrixAt(n, m);
    face.setMatrixAt(n, m);
    head.setColorAt(n, color.set(c.color));
    HIPS.forEach(([hx, hz], j) => {
      q.setFromAxisAngle(zAxis, gait * 0.45 * (j === 0 || j === 3 ? 1 : -1));
      part.compose(v.set(hx, HIP_Y, hz), q, sc.set(1, 1, 1));
      m.multiplyMatrices(root, part);
      legs.setMatrixAt(n * 4 + j, m);
      legs.setColorAt(n * 4 + j, color.set(c.color).multiplyScalar(0.85));
    });
    n++;
  }
  coat.count = spots.count = head.count = face.count = n;
  legs.count = n * 4;
  for (const im of [coat, spots, head, face, legs]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
}
