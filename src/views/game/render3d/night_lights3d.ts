// Night lights (Alex, 2026-11-27): after dark every unit and building gives off light: a warm pool
// on the ground round it and a soft glow over it (lanterns, lit windows, headlights). All faked with
// two instanced, additive sprites, so it costs two draws however many troops there are: no real
// lights, which would slow phones down. Fades in at dusk and out at dawn (S.dark, scene.ts).
import * as THREE from 'three';
import type { Ent } from '../../../game/state.ts';
import { TS } from '../../../game/const.ts';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { S } from './scene.ts';
import { footprintY, slopeAt, surfaceY } from './heights.ts';

const MAX = 1536;
const WARM = new THREE.Color('#ffb860'), COOL = new THREE.Color('#cfe4ff');
// troops' lights are dimmer than a building's
const WARM_UNIT = WARM.clone().multiplyScalar(0.45), COOL_UNIT = COOL.clone().multiplyScalar(0.38);

/** A soft round spot of light fading to nothing; `plateau` keeps it bright out to half way (a building's light spills from its walls). */
function glowTexture(plateau = false): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  const stops: [number, number][] = plateau ? [[0, 1], [0.45, 0.9], [0.7, 0.3], [1, 0]] : [[0, 1], [0.35, 0.55], [0.7, 0.15], [1, 0]];
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let pools: THREE.InstancedMesh | null = null, halos: THREE.InstancedMesh | null = null, yards: THREE.InstancedMesh | null = null;
const m4 = new THREE.Matrix4(), flat = new THREE.Quaternion(), tilt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3();
const pos = new THREE.Vector3(), scl = new THREE.Vector3();

const batch = (geo: THREE.BufferGeometry, tex: THREE.Texture, order: number): THREE.InstancedMesh => {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const m = new THREE.InstancedMesh(geo, mat, MAX);
  m.renderOrder = order;
  m.frustumCulled = false;
  m.count = 0;
  m.visible = false;
  m.setColorAt(0, WARM);
  return m;
};

/** Build the light batches and add them to `parent` (call again after the scene is cleared). */
export function makeNightLights(parent: THREE.Object3D): void {
  const tex = glowTexture();
  // pools lie on the ground under the team discs; halos face the camera and draw over models
  pools = batch(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), tex, 2.5);
  halos = batch(new THREE.PlaneGeometry(2, 2), tex, 5);
  yards = batch(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), glowTexture(true), 2.5);
  parent.add(pools, halos, yards);
}

/** Light round each unit and finished building drawn this frame (nothing by day). */
export function updateNightLights(units: readonly Ent[], blds: readonly Ent[]): void {
  if (!pools || !halos || !yards) return;
  const dark = S.dark;
  pools.visible = halos.visible = yards.visible = dark > 0.01;
  if (!pools.visible) return;
  (pools.material as THREE.MeshBasicMaterial).opacity = 0.6 * dark;
  (halos.material as THREE.MeshBasicMaterial).opacity = 0.35 * dark;
  (yards.material as THREE.MeshBasicMaterial).opacity = 0.7 * dark;
  const face = S.camera.quaternion;
  let p = 0, h = 0, y = 0;
  const halo = (x: number, gy: number, z: number, hr: number, c: THREE.Color) => {
    if (h >= MAX) return;
    halos!.setMatrixAt(h, m4.compose(pos.set(x, gy, z), face, scl.set(hr, hr, hr)));
    halos!.setColorAt(h++, c);
  };
  // buildings: light spilling out round the walls (the ground under them is hidden anyway) and a glow over the roof
  for (const b of blds) {
    if (y >= MAX) break;
    const x = b.x / TS, z = b.y / TS, size = Math.max(b.w, b.h), top = footprintY(b.tx, b.ty, b.w, b.h), r = size * 0.5 + 1.7;
    yards.setMatrixAt(y++, m4.compose(pos.set(x, top + 0.04, z), flat, scl.set(r, 1, r)));
    halo(x, top + size * 0.6 + 0.9, z, size * 0.4 + 0.3, WARM);
  }
  // units: a pool on the ground (lying along the slope) and a small lantern over the head, so the light doesn't wash the model out
  for (const e of units) {
    if (p >= MAX) break;
    const d = UNIT[e.type as UnitType], x = e.x / TS, z = e.y / TS, r = d.radius / TS, gy = surfaceY(x, z);
    // machines carry cold white lamps, soldiers warm lanterns; aircraft light the ground far below
    const air = !!d.alt, machine = d.cls === 'vehicle' || air, pr = r * 3 + (air ? 1.4 : 1.1);
    const [sx, sz] = slopeAt(x, z);
    tilt.setFromUnitVectors(up, n.set(-sx, 1, -sz).normalize());
    pools.setMatrixAt(p, m4.compose(pos.set(x, gy + 0.04, z), tilt, scl.set(pr, 1, pr)));
    pools.setColorAt(p++, machine ? COOL_UNIT : WARM_UNIT);
    halo(x, gy + (air ? (d.alt ?? 0) + 0.3 : r * 2.2 + 0.85), z, 0.22, machine ? COOL : WARM);
  }
  pools.count = p; halos.count = h; yards.count = y;
  for (const m of [pools, halos, yards]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
