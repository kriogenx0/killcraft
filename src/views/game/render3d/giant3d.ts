// The Titan (data/unit.ts `giant`): an elder giant of bronze and stone, woken with Aether, several
// times the height of anything else on the field, towering over buildings and the Cyborg Colossus. It faces +x like every unit. The model is drawn
// one unit tall inside a `body` group scaled up to TITAN_HEIGHT tiles (the root's own scale is set by
// entities3d). Named parts are animated by animateGiant below.
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import { lerp } from '../../../util/math.ts';
import { group, limb, mesh, rod, rot, scl, type Model, type Parts } from './model_kit.ts';
import { M, box, cyl, dodeca, dome, octa, sph, teamMat, mat } from './materials.ts';

/** How tall the Titan stands, in tiles, before the shared unit scale. */
const TITAN_HEIGHT = 7;

const C = {
  bronze: () => mat('#a8743a', { rough: 0.38, metal: 0.8, tex: 'metal' }),
  darkBronze: () => mat('#6a4a26', { rough: 0.45, metal: 0.75 }),
  stone: () => mat('#8a847a', { rough: 0.95, flat: true }),
  marble: () => mat('#e6e0d4', { rough: 0.6 }),
  vein: () => mat('#e0c0ff', { rough: 0.2, emissive: '#a050ff', emissiveIntensity: 2.4 }),
  eye: () => mat('#f4e8ff', { rough: 0.2, emissive: '#c070ff', emissiveIntensity: 3 }),
};

/** A leg on a hip pivot with a knee pivot below it (legL/kneeL, legR/kneeR). */
function leg(root: THREE.Object3D, parts: Parts, side: -1 | 1): void {
  const bronze = C.bronze(), vein = C.vein();
  const hip = limb(0, 0.46, side * 0.075, 0.22, 0.085, bronze);
  hip.add(mesh(box(0.012, 0.16, 0.01), vein, 0.044, -0.11, 0)); // a glowing vein down the thigh
  const knee = group(0, -0.22, 0);
  knee.add(mesh(sph(0.05, 8, 6), C.darkBronze(), 0, 0, 0));
  knee.add(mesh(box(0.072, 0.21, 0.072), bronze, 0, -0.11, 0));
  knee.add(mesh(box(0.082, 0.14, 0.08), C.darkBronze(), 0.008, -0.1, 0)); // greave
  knee.add(mesh(box(0.13, 0.04, 0.085), C.stone(), 0.025, -0.225, 0)); // a foot like a block of stone
  hip.add(knee);
  parts[side < 0 ? 'legL' : 'legR'] = hip;
  parts[side < 0 ? 'kneeL' : 'kneeR'] = knee;
  root.add(hip);
}

/** A broken temple column, held by its base so the capital end comes down on the foe. */
function column(): THREE.Group {
  const marble = C.marble(), g = group(0, -0.26, 0);
  g.add(mesh(cyl(0.05, 0.05, 0.03, 12), marble, 0, 0.01, 0)); // base, in the fist
  g.add(mesh(cyl(0.04, 0.042, 0.46, 12), marble, 0, -0.22, 0));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(mesh(box(0.008, 0.44, 0.008), M.lightConcrete(), Math.cos(a) * 0.041, -0.22, Math.sin(a) * 0.041)); } // fluting
  g.add(mesh(box(0.11, 0.05, 0.11), marble, 0, -0.47, 0)); // capital
  g.add(mesh(dodeca(0.04), C.stone(), 0.02, -0.5, 0.02)); // broken masonry still stuck to it
  return g;
}

function titan(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, body = group(0, 0, 0), bronze = C.bronze(), team1 = teamMat(team), vein = C.vein();
  body.scale.setScalar(TITAN_HEIGHT);
  for (const s of [-1, 1] as const) leg(body, parts, s);
  // a kilt of hanging strips in the side's colour
  body.add(mesh(cyl(0.115, 0.13, 0.06, 14), C.darkBronze(), 0, 0.47, 0));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    body.add(rot(mesh(box(0.035, 0.1, 0.012), team1, Math.cos(a) * 0.12, 0.41, Math.sin(a) * 0.12), 0, -a, 0));
  }
  // the torso bobs and leans as a unit, so it's its own group
  const chest = group(0, 0.48, 0);
  chest.add(scl(mesh(sph(0.1, 12, 8), bronze, 0, 0.08, 0), 0.8, 0.9, 1.2)); // belly
  chest.add(scl(mesh(sph(0.13, 14, 10), bronze, 0.01, 0.22, 0), 0.8, 0.95, 1.45)); // chest, a muscled cuirass
  chest.add(mesh(octa(0.035), vein, 0.1, 0.22, 0)); // the Aether heart that woke it
  for (const s of [-1, 1]) chest.add(rot(mesh(box(0.01, 0.16, 0.012), vein, 0.088, 0.14, s * 0.05), s * 0.4, 0, 0)); // veins from the heart
  // stone shoulders, a cloak hanging down the back
  for (const s of [-1, 1]) chest.add(scl(mesh(dodeca(0.075), C.stone(), 0, 0.31, s * 0.18), 1, 0.8, 1));
  chest.add(rot(mesh(box(0.02, 0.36, 0.3), team1, -0.1, 0.13, 0), 0, 0, -0.08));
  // arms: shoulder pivots with a fist at the end; the right holds the column
  for (const [name, s] of [['armL', -1], ['armR', 1]] as const) {
    const arm = limb(0, 0.3, s * 0.2, 0.3, 0.07, bronze);
    arm.add(mesh(box(0.08, 0.05, 0.08), C.darkBronze(), 0, -0.22, 0)); // bracer
    arm.add(mesh(box(0.01, 0.12, 0.012), vein, 0.036, -0.12, 0));
    arm.add(mesh(sph(0.05, 8, 6), bronze, 0, -0.31, 0)); // fist
    parts[name] = arm;
    chest.add(arm);
  }
  const col = column();
  parts.column = col;
  parts.armR.add(col);
  // head: a crested helmet with burning eyes in the dark of its visor
  const head = group(0.01, 0.4, 0);
  head.add(mesh(cyl(0.04, 0.05, 0.05, 8), bronze, 0, -0.03, 0)); // neck
  head.add(mesh(sph(0.065, 12, 10), C.darkBronze(), 0, 0.03, 0));
  head.add(mesh(dome(0.072), bronze, 0, 0.035, 0));
  for (const s of [-1, 1]) head.add(mesh(box(0.05, 0.07, 0.012), bronze, 0.04, 0.0, s * 0.05)); // cheek guards
  head.add(mesh(box(0.012, 0.06, 0.02), bronze, 0.07, 0.01, 0)); // nose guard
  for (const s of [-1, 1]) head.add(mesh(sph(0.012, 6, 4), C.eye(), 0.062, 0.04, s * 0.025));
  // a tall crest of horsehair in the side's colour, front to back
  for (let i = 0; i < 7; i++) { const a = -0.9 + i * 0.3; head.add(mesh(box(0.03, 0.05, 0.016), team1, Math.sin(a) * 0.08, 0.08 + Math.cos(a) * 0.05, 0)); }
  head.add(rot(mesh(box(0.02, 0.12, 0.014), team1, -0.1, 0.05, 0), 0, 0, -0.5)); // the crest's tail
  parts.head = head;
  chest.add(head);
  // a faint crown of Aether motes circling the head
  const halo = group(0.01, 0.5, 0);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; halo.add(mesh(octa(0.012), vein, Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11)); }
  parts.halo = halo;
  chest.add(halo);
  parts.chest = chest;
  body.add(chest);
  body.add(rod([0, 0.48, 0], [0, 0.5, 0], 0.01, bronze)); // join the hips to the torso
  root.add(body);
  return { root, parts, height: TITAN_HEIGHT * 1.02 };
}

/** The Titan's model. */
export function giantModel(team: number): Model {
  return titan(team);
}

/**
 * A slow, ground-shaking stride, and the column raised high and brought down on each blow. `w` is the
 * walk cycle in radians and `atk` 0..1 through a strike. Runs after the shared unit animation, so it
 * overrides the legs and arms it sets.
 */
export function animateGiant(m: Model, e: Ent, w: number, atk: number): void {
  const P = m.parts, t = G.gameT + e.id * 0.9;
  const g = w * 0.4, s = e.moving ? Math.sin(g) * 0.4 : 0;
  if (P.legL && P.legR && P.kneeL && P.kneeR) {
    P.legL.rotation.z = s;
    P.legR.rotation.z = -s;
    P.kneeL.rotation.z = e.moving ? -Math.max(0, Math.sin(g + 1.2)) * 0.55 : 0;
    P.kneeR.rotation.z = e.moving ? -Math.max(0, -Math.sin(g + 1.2)) * 0.55 : 0;
  }
  // each footfall drops the whole body a little
  m.root.position.y = e.moving ? -Math.abs(Math.cos(g)) * 0.06 : 0;
  // the blow: the column rises over its head, then crashes down in front of it
  if (P.armR) P.armR.rotation.z = atk > 0 ? (atk < 0.55 ? lerp(0.5, 2.9, atk / 0.55) : lerp(2.9, 0.9, (atk - 0.55) / 0.45)) : e.moving ? 0.4 - s * 0.3 : 0.5;
  if (P.armL) P.armL.rotation.z = atk > 0 ? lerp(0.6, -0.3, atk) : e.moving ? s * 0.5 : 0.1;
  if (P.chest) P.chest.rotation.z = atk > 0 ? lerp(0.12, -0.18, atk) : 0;
  if (P.head) P.head.rotation.y = Math.sin(t * 0.4) * 0.15;
  if (P.halo) P.halo.rotation.y = t * 0.8;
}
