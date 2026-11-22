// Woods and rocks: four kinds of tree that sway in the wind (and shrink to stumps as they're cut,
// growing back with the wood), plus boulders on cliff tops and scattered over the fields.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G } from '../../../game/state.ts';
import { MW, MH, TREE, ROCK, GRASS } from '../../../game/const.ts';
import { TREE_WOOD } from '../../../data/economy.ts';
import { hash } from '../../../util/math.ts';
import { heightAt, slopeAt } from './heights.ts';
import { M, mat } from './materials.ts';

type Kind = 'pine' | 'fir' | 'oak' | 'birch';
const KINDS: Kind[] = ['pine', 'fir', 'oak', 'birch'];

/** Shade a geometry darker toward its base (cheap ambient occlusion), as vertex colours. */
function shaded(g: THREE.BufferGeometry, lo: number, hi: number, dark = 0.55): THREE.BufferGeometry {
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k++) {
    const t = Math.min(1, Math.max(0, (pos.getY(k) - lo) / (hi - lo))), c = dark + (1 - dark) * t;
    col.set([c, c, c], k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((p) => p.toNonIndexed())) ?? parts[0];
}

/** Lumpy blob for a broadleaf crown. */
function blob(r: number, x: number, y: number, z: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 1), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const f = 0.85 + hash(p.getX(k) * 9 + seed, p.getY(k) * 7 + p.getZ(k) * 5) * 0.3;
    p.setXYZ(k, p.getX(k) * f + x, p.getY(k) * f * 0.85 + y, p.getZ(k) * f + z);
  }
  return g;
}

const LEAVES: Record<Kind, () => THREE.BufferGeometry> = {
  pine: () => shaded(merged([
    new THREE.ConeGeometry(0.46, 0.55, 9).translate(0, 0.5, 0),
    new THREE.ConeGeometry(0.38, 0.5, 9).translate(0, 0.78, 0),
    new THREE.ConeGeometry(0.29, 0.45, 8).translate(0, 1.03, 0),
    new THREE.ConeGeometry(0.18, 0.4, 7).translate(0, 1.27, 0),
  ]), 0.25, 1.4),
  fir: () => shaded(merged([
    new THREE.ConeGeometry(0.34, 0.6, 7).translate(0, 0.55, 0),
    new THREE.ConeGeometry(0.28, 0.55, 7).translate(0, 0.9, 0),
    new THREE.ConeGeometry(0.2, 0.5, 6).translate(0, 1.22, 0),
    new THREE.ConeGeometry(0.11, 0.42, 6).translate(0, 1.5, 0),
  ]), 0.3, 1.7),
  oak: () => shaded(merged([
    blob(0.38, 0, 0.82, 0, 1), blob(0.28, 0.24, 0.7, 0.1, 2), blob(0.29, -0.22, 0.68, -0.08, 3),
    blob(0.26, 0.04, 1.02, -0.12, 4), blob(0.24, -0.05, 0.72, 0.26, 5),
  ]), 0.4, 1.2, 0.5),
  birch: () => shaded(merged([blob(0.24, 0, 0.98, 0, 6), blob(0.19, 0.12, 0.82, 0.06, 7), blob(0.18, -0.1, 1.16, -0.04, 8)]), 0.65, 1.3, 0.6),
};

const TRUNKS: Record<Kind, () => THREE.BufferGeometry> = {
  pine: () => new THREE.CylinderGeometry(0.05, 0.09, 0.42, 6).translate(0, 0.2, 0),
  fir: () => new THREE.CylinderGeometry(0.04, 0.08, 0.45, 6).translate(0, 0.22, 0),
  oak: () => merged([
    new THREE.CylinderGeometry(0.07, 0.12, 0.6, 7).translate(0, 0.3, 0),
    new THREE.CylinderGeometry(0.03, 0.05, 0.35, 5).rotateZ(-0.7).translate(0.13, 0.6, 0),
    new THREE.CylinderGeometry(0.03, 0.05, 0.32, 5).rotateZ(0.8).translate(-0.12, 0.58, 0),
  ]),
  birch: () => new THREE.CylinderGeometry(0.035, 0.05, 1.0, 6).translate(0, 0.5, 0),
};

/** Leaf colour per kind: hue, saturation, lightness (instances vary around it). */
const TINT: Record<Kind, [number, number, number]> = { pine: [0.34, 0.5, 0.17], fir: [0.38, 0.45, 0.14], oak: [0.26, 0.55, 0.22], birch: [0.2, 0.6, 0.3] };

const wind = { value: 0 };

/** Leaves sway with the wind, more toward the top; each tree on its own beat. */
function swaying(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.71 + instanceMatrix[3].z * 0.53;
        float bend = max(0.0, position.y - 0.35);
        transformed.x += sin(uWind * 1.4 + ph) * 0.035 * bend + sin(uWind * 3.7 + ph * 2.0) * 0.008 * bend;
        transformed.z += cos(uWind * 1.1 + ph) * 0.025 * bend;
      #endif`);
  };
  m.customProgramCacheKey = () => 'sway';
  return m;
}

interface Tree { i: number; kind: Kind; slot: number }
interface TreeSet { leaves: THREE.InstancedMesh; trunk: THREE.InstancedMesh; n: number }

const group = new THREE.Group();
let trees: Tree[] = [];
let sets: Record<Kind, TreeSet> | null = null;
let shown = new Uint8Array(0);
let boulders: THREE.InstancedMesh | null = null;

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();

/** Which kind grows on a tile: conifers on high ground, broadleaves low down, birches here and there. */
function kindAt(x: number, y: number): Kind {
  const h = hash(x, y), e = G.elev[y * MW + x];
  if (h < 0.12) return 'birch';
  const conifer = 0.42 + e * 0.18;
  return h < conifer ? (hash(y * 1.7, x * 0.3) < 0.4 ? 'fir' : 'pine') : 'oak';
}

/** Build the woods and rocks for the current map. */
export function initTrees(parent: THREE.Object3D): void {
  group.clear();
  trees = [];
  const counts: Record<Kind, number> = { pine: 0, fir: 0, oak: 0, birch: 0 };
  for (let i = 0; i < MW * MH; i++)
    if (G.terr[i] === TREE) { const kind = kindAt(i % MW, (i / MW) | 0); trees.push({ i, kind, slot: counts[kind]++ }); }
  const bark = M.darkWood(), birchBark = mat('#e6e0d2', { rough: 0.8 });
  sets = Object.fromEntries(KINDS.map((k) => {
    const leaves = new THREE.InstancedMesh(LEAVES[k](), swaying(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, vertexColors: true, envMapIntensity: 0.35 })), Math.max(1, counts[k]));
    const trunk = new THREE.InstancedMesh(TRUNKS[k](), k === 'birch' ? birchBark : bark, Math.max(1, counts[k]));
    for (const im of [leaves, trunk]) { im.castShadow = true; im.receiveShadow = true; im.count = 0; group.add(im); }
    return [k, { leaves, trunk, n: 0 }];
  })) as unknown as Record<Kind, TreeSet>;
  shown = new Uint8Array(trees.length);
  placeBoulders();
  parent.add(group);
  refreshTrees(true);
}

/** Boulders: crags along cliff tops, and a few stones out in the fields. Static once placed. */
function placeBoulders(): void {
  const spots: [number, number, number][] = [];
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const t = G.terr[y * MW + x], h = hash(x * 1.3 + 5, y * 0.7 - 3);
      if (t === ROCK && h < 0.7) spots.push([x + 0.2 + hash(x, y * 3) * 0.6, y + 0.2 + hash(y * 7, x) * 0.6, 0.12 + hash(x * 2.1, y + 1) * 0.16]);
      else if (t === GRASS && h < 0.025 && !G.ore[y * MW + x] && !G.oilField[y * MW + x]) spots.push([x + 0.5, y + 0.5, 0.1 + h * 4]);
    }
  const g = new THREE.DodecahedronGeometry(1, 0), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const f = 0.8 + hash(p.getX(k) * 5, p.getZ(k) * 3 + p.getY(k)) * 0.35; p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * 0.7, p.getZ(k) * f); }
  g.computeVertexNormals();
  boulders = new THREE.InstancedMesh(g, mat('#ffffff', { rough: 0.95, flat: true }), Math.max(1, spots.length));
  boulders.castShadow = boulders.receiveShadow = true;
  const color = new THREE.Color();
  spots.forEach(([x, z, s], k) => {
    q.setFromAxisAngle(up, hash(x, z) * 6.3);
    m4.compose(v.set(x, heightAt(x, z) + s * 0.25, z), q, sc.set(s * (1 + hash(z, x) * 0.5), s, s));
    boulders?.setMatrixAt(k, m4);
    boulders?.setColorAt(k, color.setHSL(0.08, 0.07, 0.3 + hash(x * 2, z) * 0.14));
  });
  group.add(boulders);
}

/** How grown a tree is (0 = stump), in eighths, so we only redraw when it visibly changes. */
const growth = (i: number): number => Math.round(Math.min(1, G.treeWood[i] / TREE_WOOD) * 8);

/** Show trees once their tile has been explored, sized by the wood left on them. */
export function refreshTrees(force = false): void {
  if (!sets) return;
  let changed = force;
  for (let k = 0; k < trees.length; k++) {
    const t = trees[k], s = G.vis[t.i] > 0 ? 1 + growth(t.i) : 0;
    if (s !== shown[k]) { shown[k] = s; changed = true; }
  }
  if (!changed) return;
  for (const s of Object.values(sets)) s.n = 0;
  const color = new THREE.Color();
  trees.forEach((t, k) => {
    if (!shown[k]) return;
    const set = sets?.[t.kind];
    if (!set) return;
    const x = t.i % MW, y = (t.i / MW) | 0, h = hash(x, y), h2 = hash(y + 3.3, x - 7.1), grown = (shown[k] - 1) / 8;
    const s = (0.8 + h2 * 0.4) * (0.25 + 0.75 * grown), px = x + 0.5 + (h - 0.5) * 0.3, pz = y + 0.5 + (h2 - 0.5) * 0.3;
    // lean a little with the slope, and a little at random
    const [sx, sz] = slopeAt(px, pz);
    q2.setFromUnitVectors(up, nrm.set(-sx * 0.3 + (h - 0.5) * 0.08, 1, -sz * 0.3 + (h2 - 0.5) * 0.08).normalize());
    q.setFromAxisAngle(up, h * Math.PI * 2).premultiply(q2);
    m4.compose(v.set(px, heightAt(px, pz) - 0.03, pz), q, sc.set(s, s * (0.9 + h * 0.3), s));
    const [hue, sat, lit] = TINT[t.kind];
    color.setHSL(hue + (h - 0.5) * 0.05, sat, lit + (h2 - 0.5) * 0.08);
    // a stump keeps only a short trunk
    set.trunk.setMatrixAt(set.n, grown < 0.15 ? m4.compose(v, q, sc.set(1.1, 0.25, 1.1)) : m4);
    if (grown < 0.15) m4.compose(v, q, sc.set(0, 0, 0));
    set.leaves.setMatrixAt(set.n, m4);
    set.leaves.setColorAt(set.n, color);
    set.n++;
  });
  for (const s of Object.values(sets)) {
    s.leaves.count = s.trunk.count = s.n;
    s.leaves.instanceMatrix.needsUpdate = s.trunk.instanceMatrix.needsUpdate = true;
    if (s.leaves.instanceColor) s.leaves.instanceColor.needsUpdate = true;
  }
}

export function animateTrees(dt: number): void {
  wind.value += dt;
}
