// Drawing Aether shows like an attack: a violet beam from the deposit's shards to each unit
// channelling it, with motes of light flowing along it and a flare at the unit as each draw lands.
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import { TS } from '../../../game/const.ts';
import { drawingFrom, isDrawing } from '../../../game/aether.ts';
import { shownToPlayer } from '../render/minimap.ts';
import { groundY } from './heights.ts';
import { modelHeight } from './entities3d.ts';
import { S } from './scene.ts';

const MOTES = 3;
const beamMat = new THREE.MeshBasicMaterial({ color: '#c070ff', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const coreMat = new THREE.MeshBasicMaterial({ color: '#f4e0ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const moteMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2); // unit length along +z
const moteGeo = new THREE.SphereGeometry(1, 8, 6);

interface Beam { group: THREE.Group; outer: THREE.Mesh; core: THREE.Mesh; motes: THREE.Mesh[]; flare: THREE.Mesh }

const layer = new THREE.Group();
const pool: Beam[] = [];
let added = false;

function makeBeam(): Beam {
  const group = new THREE.Group();
  const outer = new THREE.Mesh(beamGeo, beamMat), core = new THREE.Mesh(beamGeo, coreMat);
  const motes = Array.from({ length: MOTES }, () => new THREE.Mesh(moteGeo, moteMat));
  const flare = new THREE.Mesh(moteGeo, beamMat);
  for (const m of [outer, core, ...motes, flare]) { m.renderOrder = 4; m.frustumCulled = false; }
  group.add(outer, core, ...motes, flare);
  layer.add(group);
  return { group, outer, core, motes, flare };
}

const from = new THREE.Vector3(), to = new THREE.Vector3();

function place(b: Beam, d: Ent, u: Ent, t: number): void {
  from.set(d.x / TS, groundY(d.x, d.y) + 0.55, d.y / TS);
  to.set(u.x / TS, groundY(u.x, u.y) + Math.min(0.5, modelHeight(u) * 0.55), u.y / TS);
  const len = from.distanceTo(to), wobble = 1 + Math.sin(t * 17 + u.id) * 0.25;
  for (const [m, r] of [[b.outer, 0.07 * wobble], [b.core, 0.022]] as const) {
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(r, r, len);
  }
  // motes stream from the shards to the unit
  b.motes.forEach((m, k) => {
    const f = (t * 1.6 + k / MOTES + u.id * 0.37) % 1;
    m.position.lerpVectors(from, to, f);
    m.position.y += Math.sin(f * Math.PI) * 0.08;
    m.scale.setScalar(0.05 * (0.6 + Math.sin(f * Math.PI) * 0.6));
  });
  // a flare at the unit that swells as each draw lands (once a second)
  const pulse = u.atkT > 0 ? u.atkT / 0.25 : 0;
  b.flare.position.copy(to);
  b.flare.scale.setScalar(0.05 + pulse * 0.12);
}

/** Show a beam for every unit drawing Aether that this player can see. Call once per frame. */
export function updateAetherBeams(): void {
  if (!added) { S.scene.add(layer); added = true; }
  if (layer.parent !== S.scene) S.scene.add(layer);
  let n = 0;
  const t = performance.now() / 1000;
  for (const u of G.ents) {
    if (u.dead || u.kind !== 'unit' || !isDrawing(u) || !shownToPlayer(u)) continue;
    const d = drawingFrom(u);
    if (!d) continue;
    const b = pool[n] ?? (pool[n] = makeBeam());
    b.group.visible = true;
    place(b, d, u, t);
    n++;
  }
  for (let i = n; i < pool.length; i++) pool[i].group.visible = false;
}
