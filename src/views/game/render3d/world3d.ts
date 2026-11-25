// The battlefield's static layer: textured ground, glinting water, instanced trees and ore
// crystals, and the fog-of-war sheet laid over the ground.
import * as THREE from 'three';
import { G } from '../../../game/state.ts';
import { MW, MH } from '../../../game/const.ts';
import { buildHeights, heightAt, heights, VH, VW, WATER_LEVEL } from './heights.ts';
import { ORE_TILE_MAX } from '../../../data/ore.ts';
import { OIL_TILE_MAX } from '../../../data/economy.ts';
import { layoutFor } from '../../../data/map.ts';
import { hash, mulberry32 } from '../../../util/math.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';
import { terrain } from '../render/terrain.ts';
import { fogCanvas } from '../render/minimap.ts';
import { S } from './scene.ts';
import { M } from './materials.ts';
import { surface } from './surfaces.ts';
import { animateTrees, initTrees, refreshTrees } from './trees3d.ts';
import { initCows3d } from './cows3d.ts';
import { initSheep3d } from './sheep3d.ts';
import { initBuildZone } from './build_zone3d.ts';

const ORE_PER_TILE = 5;
const layer = new THREE.Group();
let ore: THREE.InstancedMesh | null = null;
let oil: THREE.InstancedMesh | null = null;
let fogTex: THREE.CanvasTexture | null = null;

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

/** A map-sized sheet following the ground (or the water, where it's higher), raised by `lift`. */
export function shapedPlane(lift: number, overWater = false): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(MW, MH, VW - 1, VH - 1).rotateX(-Math.PI / 2).translate(MW / 2, 0, MH / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const h = heights[k];
    pos.setY(k, (overWater ? Math.max(h, WATER_LEVEL) : h) + lift);
  }
  g.computeVertexNormals();
  return g;
}

let detail: THREE.CanvasTexture | null = null;

/** A fine, tiling grain (grass blades, grit) to keep the ground crisp up close. */
function detailTexture(): THREE.CanvasTexture {
  const N = 256, c = mkCanvas(N, N), g = ctx2d(c), img = g.createImageData(N, N), rnd = mulberry32(7);
  const val = new Float32Array(N * N);
  // soft noise plus short strokes, wrapped so it tiles
  for (let k = 0; k < N * N; k++) val[k] = 0.5 + (rnd() - 0.5) * 0.25;
  for (let k = 0; k < 2600; k++) {
    const x = rnd() * N, y = rnd() * N, len = 2 + rnd() * 4, dark = rnd() < 0.5 ? -0.22 : 0.18, lean = (rnd() - 0.5) * 0.8;
    for (let t = 0; t < len; t++) {
      const px = Math.floor(x + lean * t + N) % N, py = Math.floor(y - t + N) % N;
      val[py * N + px] += dark * (1 - t / len);
    }
  }
  for (let k = 0; k < N * N; k++) {
    const v = Math.max(0, Math.min(255, val[k] * 255));
    img.data.set([v, v, v, 255], k * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = S.renderer.capabilities.getMaxAnisotropy();
  return t;
}

/** The painted ground, with fine grain mixed in up close. */
function groundMaterial(map: THREE.Texture): THREE.Material {
  detail ??= detailTexture();
  const tex = detail, bump = tex.clone();
  bump.repeat.set(MW * 1.5, MH * 1.5);
  bump.needsUpdate = true;
  // the grain doubles as a bump map, so blades and grit catch the sun
  const m = new THREE.MeshStandardMaterial({ map, roughness: 1, bumpMap: bump, bumpScale: 1.2 });
  const rock = surface('stone');
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: tex };
    shader.uniforms.uRock = { value: rock };
    // steep faces (cliffs, banks) get rock projected from the side, instead of the top-down paint stretched down them
    shader.vertexShader = 'varying vec3 vWorld; varying vec3 vUp;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vWorld = position; vUp = normal;`);
    shader.fragmentShader = 'uniform sampler2D uDetail; uniform sampler2D uRock; varying vec3 vWorld; varying vec3 vUp;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float grain = texture2D(uDetail, vMapUv * ${(MW * 1.5).toFixed(1)}).r * 0.6 + texture2D(uDetail, vMapUv * ${(MW * 0.37).toFixed(2)}).r * 0.4;
      diffuseColor.rgb *= 0.72 + grain * 0.56;
      float steep = smoothstep(0.55, 0.85, 1.0 - abs(normalize(vUp).y));
      if (steep > 0.0) {
        vec3 w = abs(normalize(vUp)); w /= (w.x + w.z + 0.0001);
        vec3 rx = texture2D(uRock, vWorld.zy * 0.8).rgb, rz = texture2D(uRock, vWorld.xy * 0.8).rgb;
        vec3 face = (rx * w.x + rz * w.z) * vec3(0.46, 0.42, 0.37);
        diffuseColor.rgb = mix(diffuseColor.rgb, face, steep);
      }`);
  };
  m.customProgramCacheKey = () => 'ground-detail-rock';
  return m;
}

let ripples: THREE.CanvasTexture | null = null;

/** A tiling normal map of small waves, from a sum of noise bumps. */
function rippleTexture(): THREE.CanvasTexture {
  const N = 128, c = mkCanvas(N, N), g = ctx2d(c), img = g.createImageData(N, N), hgt = new Float32Array(N * N);
  const rnd = mulberry32(99), waves = Array.from({ length: 14 }, () => [1 + Math.floor(rnd() * 5), Math.floor(rnd() * 7) - 3, rnd() * 6.3, 0.4 + rnd()]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let h = 0;
      for (const [kx, ky, ph, a] of waves) h += Math.sin(((kx * x + ky * y) / N) * Math.PI * 2 + ph) * a;
      hgt[y * N + x] = h;
    }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x + N - 1) % N)], dy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
      const nx = -dx * 0.9, ny = -dy * 0.9, l = Math.hypot(nx, ny, 1), o = (y * N + x) * 4;
      img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(MW / 5, MH / 5);
  return t;
}

function waterMaterial(): THREE.Material {
  ripples ??= rippleTexture();
  return new THREE.MeshStandardMaterial({
    color: S.mood.water, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.62, depthWrite: false,
    normalMap: ripples, normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 1.4,
  });
}

/** Drift the ripples on the water. */
export function animateWater(dt: number): void {
  animateTrees(dt);
  if (!ripples) return;
  ripples.offset.x = (ripples.offset.x + dt * 0.035) % 1;
  ripples.offset.y = (ripples.offset.y + dt * 0.02) % 1;
}

/** An irregular, lumpy puddle (for oil seeping from a well). */
function puddleGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, r = 0.5 * (0.82 + 0.12 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 7 + 2));
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateX(-Math.PI / 2);
}

/** Rebuild the layer for the current map (after a new world is generated). */
export function initWorld3d(): void {
  S.scene.remove(layer);
  layer.clear();
  buildHeights();
  // ground: the painted terrain without trees, shaped into hills, cliffs and lake beds
  const tex = new THREE.CanvasTexture(terrain.ground);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = S.renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(shapedPlane(0), groundMaterial(tex));
  ground.receiveShadow = true;
  ground.castShadow = true;
  layer.add(ground);
  // water: one sheet at the water line; the ground dips below it in lakes, rivers and the sea
  const water = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH).rotateX(-Math.PI / 2).translate(MW / 2, WATER_LEVEL, MH / 2), waterMaterial());
  water.receiveShadow = true;
  water.renderOrder = 1;
  layer.add(water);
  initTrees(layer);
  initCows3d(layer);
  initSheep3d(layer);
  // ore crystals
  ore = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.09).scale(0.8, 1.7, 0.8), M.ore(), 5000);
  ore.castShadow = true;
  ore.frustumCulled = false; // instances span the map and change; three would cull them by a stale bounding sphere
  ore.count = 0;
  layer.add(ore);
  // oil wells: glossy black pools that shrink as derricks drain them
  oil = new THREE.InstancedMesh(puddleGeometry(), new THREE.MeshStandardMaterial({ color: '#2a2430', roughness: 0.1, metalness: 0, envMapIntensity: 1.2 }), 200);
  oil.receiveShadow = true;
  oil.frustumCulled = false;
  oil.count = 0;
  layer.add(oil);
  // fog of war: the minimap's fog image stretched over the map, softly filtered
  fogTex = new THREE.CanvasTexture(fogCanvas());
  fogTex.magFilter = THREE.LinearFilter;
  const fog = new THREE.Mesh(shapedPlane(0.05, true), new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, fog: false }));
  fog.renderOrder = 2;
  layer.add(fog);
  initBuildZone(layer);
  // a black frame past the map's edges, so no sliver of ground shows at the border
  const B = 40, black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  for (const [w, h, x, z] of [[MW + 2 * B, B, MW / 2, -B / 2], [MW + 2 * B, B, MW / 2, MH + B / 2], [B, MH, -B / 2, MH / 2], [B, MH, MW + B / 2, MH / 2]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(x, -2, z), black);
    strip.renderOrder = 2;
    layer.add(strip);
  }
  S.scene.add(layer);
  refreshOre();
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
      const px = x + 0.15 + hx * 0.7, pz = y + 0.15 + hy * 0.7;
      m4.compose(v.set(px, heightAt(px, pz) + 0.05, pz), q, sc.set(s, s, s));
      ore.setMatrixAt(n++, m4);
    }
  }
  ore.count = n;
  ore.instanceMatrix.needsUpdate = true;
  if (!oil) return;
  // one dark pool at the heart of each well, shrinking as it's drained
  let k = 0;
  for (const [wx, wy] of layoutFor(G.teams).oil) {
    if (!G.vis[wy * MW + wx]) continue;
    let left = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = (wy + dy) * MW + wx + dx; if (i >= 0 && i < MW * MH) { left += G.oilField[i]; n++; } }
    const f = Math.min(1, left / (n * OIL_TILE_MAX * 0.45));
    if (f <= 0.01) continue;
    const s = 0.6 + 2.2 * Math.sqrt(f), h = hash(wx * 3 + 1, wy * 5 - 2), px = wx + 0.5, pz = wy + 0.5;
    q.setFromAxisAngle(up, h * Math.PI * 2);
    m4.compose(v.set(px, heightAt(px, pz) + 0.035, pz), q, sc.set(s * (1.1 + h * 0.3), 1, s));
    oil.setMatrixAt(k++, m4);
  }
  oil.count = k;
  oil.instanceMatrix.needsUpdate = true;
}

export function refreshFog(): void {
  if (fogTex) fogTex.needsUpdate = true;
  refreshTrees();
}
