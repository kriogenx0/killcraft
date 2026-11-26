// A soft colored disc on the ground under every unit, so whose is whose reads at a glance in a mixed
// fight: green for yours, blue for an ally's, red for an enemy's (the same colors as the selection
// rings). Spectators see each side's own team color instead. One instanced draw for all of them.
import * as THREE from 'three';
import { allied, type Ent } from '../../../game/state.ts';
import { TS } from '../../../game/const.ts';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { teamColors } from '../../../data/team.ts';
import { V, spectating } from '../view_state.ts';
import { slopeAt, surfaceY } from './heights.ts';

const MAX = 1024;
const OWN = new THREE.Color('#3d3'), ALLY = new THREE.Color('#4cf'), ENEMY = new THREE.Color('#f44'), NEUTRAL = new THREE.Color('#ee5');

/** a faint fill that brightens toward a soft rim, white so each instance's color tints it */
function discTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,.22)');
  grad.addColorStop(0.62, 'rgba(255,255,255,.3)');
  grad.addColorStop(0.82, 'rgba(255,255,255,.7)');
  grad.addColorStop(0.92, 'rgba(255,255,255,.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let discs: THREE.InstancedMesh | null = null;
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3();
const pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color();

/** Build the disc batch and add it to `parent` (call again after the scene is cleared). */
export function makeTeamDiscs(parent: THREE.Object3D): void {
  const mat = new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, opacity: 0.55, depthWrite: false, fog: false });
  // drawn over the ground and the fog layer, under the selection rings
  discs = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat, MAX);
  discs.renderOrder = 2.6;
  discs.frustumCulled = false;
  discs.count = 0;
  discs.setColorAt(0, OWN);
  parent.add(discs);
}

function colorFor(team: number): THREE.Color {
  if (team < 0) return NEUTRAL;
  if (spectating()) return col.set(teamColors(team).l);
  return team === V.team ? OWN : allied(team, V.team) ? ALLY : ENEMY;
}

/** Place a disc under each unit drawn this frame. */
export function updateTeamDiscs(units: readonly Ent[]): void {
  if (!discs) return;
  let i = 0;
  for (const e of units) {
    if (i >= MAX) break;
    // Workers and Harvesters never fight, and a base full of them shouldn't glow (Alex, 2026-11-26)
    if (UNIT[e.type as UnitType].haul) continue;
    const x = e.x / TS, z = e.y / TS, r = UNIT[e.type as UnitType].radius / TS * 1.3 + 0.12;
    // lie along the slope so it neither floats nor sinks into a hillside
    const [sx, sz] = slopeAt(x, z);
    q.setFromUnitVectors(up, n.set(-sx, 1, -sz).normalize());
    m4.compose(pos.set(x, surfaceY(x, z) + 0.05, z), q, scl.set(r, 1, r));
    discs.setMatrixAt(i, m4);
    discs.setColorAt(i, colorFor(e.team));
    i++;
  }
  discs.count = i;
  discs.instanceMatrix.needsUpdate = true;
  if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
}
