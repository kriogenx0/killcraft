// The battlefield's static layer: textured ground, glinting water, instanced trees and ore
// crystals, and the fog-of-war sheet laid over the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G } from '../../../game/state.ts';
import { MW, MH, WATER, TREE } from '../../../game/const.ts';
import { ORE_TILE_MAX } from '../../../data/ore.ts';
import { hash } from '../../../util/math.ts';
import { terrain } from '../render/terrain.ts';
import { fogCanvas } from '../render/minimap.ts';
import { S } from './scene.ts';
import { M, mat } from './materials.ts';

const ORE_PER_TILE = 5;
const layer = new THREE.Group();
let pines: THREE.InstancedMesh | null = null, pineTrunks: THREE.InstancedMesh | null = null;
let oaks: THREE.InstancedMesh | null = null, oakTrunks: THREE.InstancedMesh | null = null;
let ore: THREE.InstancedMesh | null = null;
let fogTex: THREE.CanvasTexture | null = null;
let treeTiles: { i: number; pine: boolean; idx: number }[] = [];
let shownTrees = new Uint8Array(0);

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

function pineGeometry(): THREE.BufferGeometry {
  const a = new THREE.ConeGeometry(0.42, 0.62, 8).translate(0, 0.55, 0);
  const b = new THREE.ConeGeometry(0.32, 0.52, 8).translate(0, 0.88, 0);
  const c = new THREE.ConeGeometry(0.2, 0.4, 8).translate(0, 1.15, 0);
  return mergeGeometries([a, b, c]) ?? a;
}

function oakGeometry(): THREE.BufferGeometry {
  const parts = [[0, 0.78, 0, 0.36], [0.2, 0.68, 0.1, 0.26], [-0.18, 0.66, -0.08, 0.27], [0.02, 0.95, -0.12, 0.24]]
    .map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z));
  return mergeGeometries(parts) ?? parts[0];
}

/** Rebuild the layer for the current map (after a new world is generated). */
export function initWorld3d(): void {
  S.scene.remove(layer);
  layer.clear();
  // ground: the painted terrain without trees
  const tex = new THREE.CanvasTexture(terrain.ground);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = S.renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH).rotateX(-Math.PI / 2).translate(MW / 2, 0, MH / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.receiveShadow = true;
  layer.add(ground);
  // water: a glossy sheet over open water that catches the sun (coasts keep their painted shape)
  const quads: THREE.BufferGeometry[] = [];
  const wet = (x: number, y: number) => x < 0 || y < 0 || x >= MW || y >= MH || G.terr[y * MW + x] === WATER;
  for (let i = 0; i < MW * MH; i++)
    if (G.terr[i] === WATER && wet((i % MW) - 1, (i / MW) | 0) && wet((i % MW) + 1, (i / MW) | 0) && wet(i % MW, ((i / MW) | 0) - 1) && wet(i % MW, ((i / MW) | 0) + 1))
      quads.push(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate((i % MW) + 0.5, 0.02, ((i / MW) | 0) + 0.5));
  if (quads.length) {
    const water = new THREE.Mesh(mergeGeometries(quads) ?? quads[0], new THREE.MeshStandardMaterial({ color: '#2a5f8a', roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.45 }));
    water.receiveShadow = true;
    layer.add(water);
  }
  // trees
  treeTiles = [];
  let nPine = 0, nOak = 0;
  for (let i = 0; i < MW * MH; i++) if (G.terr[i] === TREE) { const pine = hash(i % MW, (i / MW) | 0) > 0.42; treeTiles.push({ i, pine, idx: pine ? nPine++ : nOak++ }); }
  const leaves = mat('#2f6a2c', { rough: 0.85, flat: true }), trunk = M.darkWood();
  pines = new THREE.InstancedMesh(pineGeometry(), leaves, Math.max(1, nPine));
  pineTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 0.35, 6).translate(0, 0.17, 0), trunk, Math.max(1, nPine));
  oaks = new THREE.InstancedMesh(oakGeometry(), mat('#4a8a36', { rough: 0.85, flat: true }), Math.max(1, nOak));
  oakTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6).translate(0, 0.25, 0), trunk, Math.max(1, nOak));
  for (const im of [pines, pineTrunks, oaks, oakTrunks]) { im.castShadow = true; im.receiveShadow = true; im.count = 0; layer.add(im); }
  shownTrees = new Uint8Array(treeTiles.length);
  // ore crystals
  ore = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.09).scale(0.8, 1.7, 0.8), M.ore(), 2600);
  ore.castShadow = true;
  ore.count = 0;
  layer.add(ore);
  // fog of war: the minimap's fog image stretched over the map, softly filtered
  fogTex = new THREE.CanvasTexture(fogCanvas());
  fogTex.magFilter = THREE.LinearFilter;
  const fog = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH).rotateX(-Math.PI / 2).translate(MW / 2, 0.06, MH / 2), new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, fog: false }));
  fog.renderOrder = 2;
  layer.add(fog);
  // a black frame past the map's edges, so no sliver of ground shows at the border
  const B = 40, black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  for (const [w, h, x, z] of [[MW + 2 * B, B, MW / 2, -B / 2], [MW + 2 * B, B, MW / 2, MH + B / 2], [B, MH, -B / 2, MH / 2], [B, MH, MW + B / 2, MH / 2]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(x, 0.06, z), black);
    strip.renderOrder = 2;
    layer.add(strip);
  }
  S.scene.add(layer);
  refreshTrees(true);
  refreshOre();
}

/** Show trees once their tile has been explored. */
export function refreshTrees(force = false): void {
  if (!pines || !oaks || !pineTrunks || !oakTrunks) return;
  let changed = force;
  for (let k = 0; k < treeTiles.length; k++) {
    const seen = G.vis[treeTiles[k].i] > 0 ? 1 : 0;
    if (seen !== shownTrees[k]) { shownTrees[k] = seen; changed = true; }
  }
  if (!changed) return;
  let np = 0, no = 0;
  const color = new THREE.Color();
  treeTiles.forEach((t, k) => {
    if (!shownTrees[k]) return;
    const x = t.i % MW, y = (t.i / MW) | 0, h = hash(x, y), h2 = hash(y + 3.3, x - 7.1), s = 0.85 + h2 * 0.35;
    q.setFromAxisAngle(up, h * Math.PI * 2);
    m4.compose(v.set(x + 0.5 + (h - 0.5) * 0.25, 0, y + 0.5 + (h2 - 0.5) * 0.25), q, sc.set(s, s * (0.9 + h * 0.3), s));
    color.setHSL(0.28 + h * 0.06, 0.45, 0.32 + h2 * 0.12);
    if (t.pine) { pines?.setMatrixAt(np, m4); pines?.setColorAt(np, color); pineTrunks?.setMatrixAt(np, m4); np++; }
    else { oaks?.setMatrixAt(no, m4); oaks?.setColorAt(no, color); oakTrunks?.setMatrixAt(no, m4); no++; }
  });
  pines.count = pineTrunks.count = np;
  oaks.count = oakTrunks.count = no;
  for (const im of [pines, pineTrunks, oaks, oakTrunks]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
}

/** Crystals on every explored ore tile, more of them on richer tiles. */
export function refreshOre(): void {
  if (!ore) return;
  let n = 0;
  for (let i = 0; i < MW * MH && n < ore.instanceMatrix.count - ORE_PER_TILE; i++) {
    const amount = G.ore[i];
    if (amount <= 0 || !G.vis[i]) continue;
    const x = i % MW, y = (i / MW) | 0, f = amount / ORE_TILE_MAX, k = 1 + Math.round(f * (ORE_PER_TILE - 1));
    for (let c = 0; c < k; c++) {
      const hx = hash(x * 7 + c, y * 3 - c), hy = hash(y * 5 + c, x - c * 2), s = 0.6 + f * 0.7 + hx * 0.3;
      q.setFromAxisAngle(v.set(hx - 0.5, 1, hy - 0.5).normalize(), hx * 6);
      m4.compose(v.set(x + 0.15 + hx * 0.7, 0.05, y + 0.15 + hy * 0.7), q, sc.set(s, s, s));
      ore.setMatrixAt(n++, m4);
    }
  }
  ore.count = n;
  ore.instanceMatrix.needsUpdate = true;
}

export function refreshFog(): void {
  if (fogTex) fogTex.needsUpdate = true;
  refreshTrees();
}
