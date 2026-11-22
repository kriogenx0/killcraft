// Procedural models for the creatures of Greek myth (data/creatures.ts). Like the other units they
// face +x and are about a tile tall. A wild creature wears no colours; once captured it carries its
// side's colour on a collar, sash or band. Named parts are animated by animateCreature below.
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import type { UnitType } from '../../../data/unit.ts';
import { UNIT } from '../../../data/unit.ts';
import { lerp } from '../../../util/math.ts';
import { group, limb, mesh, rod, rot, scl, type Mat, type Model, type Parts } from './model_kit.ts';
import { M, box, cone, cyl, mat, sph, teamMat } from './materials.ts';

const C = {
  bay: () => mat('#6e4526', { rough: 0.8 }),
  white: () => mat('#f2efe8', { rough: 0.7 }),
  feather: () => mat('#e8e4dc', { rough: 0.9 }),
  tawny: () => mat('#c08a40', { rough: 0.85 }),
  brownFeather: () => mat('#6a4a2a', { rough: 0.9 }),
  beak: () => mat('#e8b020', { rough: 0.5 }),
  bull: () => mat('#4a2c1a', { rough: 0.85 }),
  horn: () => mat('#e8dcc0', { rough: 0.5 }),
  giant: () => mat('#c89a74', { rough: 0.85 }),
  eye: () => mat('#fff6d8', { rough: 0.3 }),
  iris: () => mat('#3a7ac0', { rough: 0.3, emissive: '#1a4a90', emissiveIntensity: 0.4 }),
  scale: () => mat('#3e7a3a', { rough: 0.55, metal: 0.15 }),
  belly: () => mat('#b8c070', { rough: 0.7 }),
  hound: () => mat('#26201e', { rough: 0.8 }),
  fire: () => mat('#ff7a20', { rough: 0.5, emissive: '#ff4a00', emissiveIntensity: 1.6 }),
  harpyWing: () => mat('#4a3a4a', { rough: 0.9 }),
  talon: () => mat('#2a2420', { rough: 0.5 }),
  stone: () => mat('#7a746a', { rough: 0.95, flat: true }),
};

/** A wild creature's collar is plain leather; a captured one wears its side's colour. */
const colour = (team: number): Mat => (team < 0 ? M.leather() : teamMat(team));

/** Four legs with hooves or paws, hanging from hip and shoulder pivots, named legFL… for the walk. */
function fourLegs(root: THREE.Object3D, parts: Parts, x: number, z: number, y: number, len: number, thick: number, body: Mat, foot: Mat): void {
  for (const [name, lx, lz] of [['legFL', x, z], ['legFR', x, -z], ['legBL', -x, z], ['legBR', -x, -z]] as const) {
    const leg = limb(lx, y, lz, len, thick, body);
    leg.add(mesh(box(thick * 1.15, 0.04, thick * 1.15), foot, 0.005, -len + 0.01, 0));
    parts[name] = leg;
    root.add(leg);
  }
}

/** A horse's body (barrel, chest, rump, tail); returns nothing, the caller adds neck and head. */
function horseBody(root: THREE.Object3D, coat: Mat, hair: Mat): void {
  root.add(scl(mesh(sph(0.2, 14, 10), coat, 0, 0.48, 0), 1.6, 0.68, 0.62));
  root.add(scl(mesh(sph(0.14, 12, 8), coat, 0.2, 0.5, 0), 1, 1.05, 0.88));
  root.add(scl(mesh(sph(0.14, 12, 8), coat, -0.22, 0.5, 0), 1.05, 1, 0.92));
  for (let i = 0; i < 3; i++) root.add(rot(mesh(box(0.05 - i * 0.008, 0.1, 0.05 - i * 0.008), hair, -0.36 - i * 0.04, 0.5 - i * 0.08, 0), 0, 0, 0.5 + i * 0.25));
}

/** A horse's neck and head pointing forward and up. */
function horseHead(root: THREE.Object3D, coat: Mat, hair: Mat): void {
  root.add(rot(mesh(box(0.13, 0.3, 0.12), coat, 0.3, 0.64, 0), 0, 0, -0.55));
  root.add(rot(mesh(box(0.05, 0.3, 0.04), hair, 0.25, 0.7, 0), 0, 0, -0.55));
  root.add(rot(mesh(box(0.22, 0.1, 0.1), coat, 0.45, 0.76, 0), 0, 0, -0.3));
  root.add(mesh(box(0.08, 0.075, 0.085), coat, 0.55, 0.715, 0));
  root.add(mesh(box(0.02, 0.02, 0.07), M.dark(), 0.59, 0.72, 0));
  for (const z of [-0.035, 0.035]) {
    root.add(rot(mesh(cone(0.018, 0.06, 4), coat, 0.38, 0.86, z), 0, 0, -0.2));
    root.add(mesh(sph(0.012, 6, 4), M.dark(), 0.45, 0.79, z * 1.45));
  }
}

/** A pair of feathered wings on shoulder pivots (wingL, wingR), flapping about x. */
function wings(root: THREE.Object3D, parts: Parts, x: number, y: number, span: number, chord: number, m: Mat, tip: Mat): void {
  for (const [name, s] of [['wingL', -1], ['wingR', 1]] as const) {
    const w = group(x, y, s * 0.08);
    w.add(mesh(box(chord, 0.025, span * 0.55), m, 0, 0, s * span * 0.27));
    w.add(mesh(box(chord * 0.8, 0.02, span * 0.45), m, -chord * 0.15, 0, s * span * 0.75));
    for (let i = 0; i < 4; i++) w.add(rot(mesh(box(chord * 0.35, 0.012, 0.05), tip, -chord * 0.45 - i * 0.02, -0.005, s * (span * 0.3 + i * span * 0.18)), 0, s * 0.25, 0));
    parts[name] = w;
    root.add(w);
  }
}

/** A muscled giant's frame: legs, loins, chest, arms (armL, armR) and neck; returns the head height. */
function brute(root: THREE.Object3D, parts: Parts, k: number, skin: Mat, cloth: Mat): number {
  for (const [name, s] of [['legL', -1], ['legR', 1]] as const) {
    const leg = limb(0, 0.3 * k, s * 0.08 * k, 0.28 * k, 0.1 * k, skin);
    leg.add(mesh(box(0.14 * k, 0.05 * k, 0.11 * k), skin, 0.02 * k, -0.29 * k, 0));
    parts[name] = leg;
    root.add(leg);
  }
  root.add(mesh(box(0.18 * k, 0.1 * k, 0.24 * k), cloth, 0, 0.32 * k, 0)); // loincloth
  root.add(scl(mesh(sph(0.15 * k, 12, 8), skin, 0, 0.47 * k, 0), 0.8, 1.1, 1.15)); // belly and chest
  root.add(scl(mesh(sph(0.14 * k, 12, 8), skin, 0.01 * k, 0.58 * k, 0), 0.85, 0.8, 1.35)); // shoulders
  for (const [name, s] of [['armL', -1], ['armR', 1]] as const) {
    const arm = limb(0, 0.62 * k, s * 0.2 * k, 0.28 * k, 0.085 * k, skin);
    arm.add(mesh(sph(0.055 * k, 8, 6), skin, 0, -0.3 * k, 0));
    parts[name] = arm;
    root.add(arm);
  }
  root.add(mesh(cyl(0.05 * k, 0.06 * k, 0.06 * k, 8), skin, 0, 0.68 * k, 0));
  return 0.74 * k;
}

function centaur(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, coat = C.bay(), hair = M.hair();
  horseBody(root, coat, hair);
  fourLegs(root, parts, 0.22, 0.08, 0.38, 0.36, 0.06, coat, M.dark());
  // the man rising from the horse's chest
  root.add(mesh(box(0.13, 0.22, 0.17), M.skin(), 0.24, 0.72, 0));
  root.add(rot(mesh(box(0.14, 0.04, 0.2), colour(team), 0.24, 0.74, 0), 0.6, 0, 0)); // sash
  root.add(mesh(sph(0.06), M.skin(), 0.25, 0.89, 0));
  root.add(scl(mesh(sph(0.064), hair, 0.235, 0.91, 0), 1, 0.75, 1));
  root.add(mesh(box(0.012, 0.012, 0.012), M.dark(), 0.31, 0.9, 0.02));
  root.add(mesh(box(0.012, 0.012, 0.012), M.dark(), 0.31, 0.9, -0.02));
  // quiver on the back
  root.add(rot(mesh(cyl(0.03, 0.03, 0.2, 8), M.leather(), 0.16, 0.8, -0.09), 0, 0, 0.4));
  for (const dz of [-0.01, 0.01]) root.add(rot(mesh(box(0.01, 0.06, 0.01), C.feather(), 0.11, 0.92, -0.09 + dz), 0, 0, 0.4));
  // bow held out in front
  const bow = group(0.3, 0.8, 0.12, rot(mesh(cyl(0.012, 0.012, 0.36, 6), M.darkWood(), 0, 0, 0), 0, 0, 0), rod([0.0, 0.18, 0], [-0.08, 0, 0], 0.003, M.white(), 3), rod([-0.08, 0, 0], [0, -0.18, 0], 0.003, M.white(), 3));
  parts.gun = bow;
  root.add(bow);
  root.add(rod([0.24, 0.8, 0.09], [0.3, 0.8, 0.12], 0.025, M.skin(), 6));
  return { root, parts, height: 1.0 };
}

function pegasus(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, coat = C.white(), hair = mat('#d8e4f4', { rough: 0.8 });
  horseBody(root, coat, hair);
  horseHead(root, coat, hair);
  fourLegs(root, parts, 0.22, 0.08, 0.38, 0.36, 0.06, coat, M.gold());
  root.add(mesh(box(0.2, 0.03, 0.26), colour(team), 0, 0.62, 0)); // saddle blanket
  root.add(rot(mesh(box(0.05, 0.02, 0.12), M.gold(), 0.5, 0.79, 0), 0, 0, -0.3)); // bridle
  wings(root, parts, 0.08, 0.6, 0.46, 0.22, C.feather(), mat('#c8d4e8', { rough: 0.9 }));
  return { root, parts, height: 0.95 };
}

function griffin(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, lion = C.tawny(), plume = C.feather();
  root.add(scl(mesh(sph(0.2, 14, 10), lion, -0.04, 0.42, 0), 1.5, 0.7, 0.65));
  root.add(scl(mesh(sph(0.16, 12, 8), plume, 0.18, 0.5, 0), 1, 1.1, 0.85)); // feathered breast
  fourLegs(root, parts, 0.2, 0.08, 0.34, 0.32, 0.06, lion, C.talon());
  // lion's tail with a tuft
  root.add(rod([-0.3, 0.45, 0], [-0.5, 0.6, 0], 0.015, lion, 5));
  root.add(mesh(sph(0.035, 8, 6), C.brownFeather(), -0.51, 0.62, 0));
  // eagle's head: white, golden hooked beak, dark eyes, team collar
  root.add(mesh(cyl(0.07, 0.09, 0.05, 10), colour(team), 0.26, 0.6, 0));
  root.add(scl(mesh(sph(0.09, 12, 8), plume, 0.32, 0.7, 0), 1.2, 1, 0.9));
  root.add(rot(mesh(cone(0.04, 0.12, 6), C.beak(), 0.44, 0.68, 0), 0, 0, -1.9));
  for (const z of [-0.05, 0.05]) root.add(mesh(sph(0.014, 6, 4), M.dark(), 0.38, 0.73, z));
  for (const z of [-0.03, 0.03]) root.add(rot(mesh(box(0.08, 0.02, 0.02), plume, 0.24, 0.79, z), 0, 0, 0.5)); // ear tufts
  wings(root, parts, 0.06, 0.58, 0.44, 0.24, C.brownFeather(), C.tawny());
  return { root, parts, height: 0.85 };
}

function harpy(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, wing = C.harpyWing();
  // a woman's head and body above bird legs, wings for arms
  root.add(scl(mesh(sph(0.11, 12, 8), wing, 0, 0.42, 0), 0.9, 1.2, 0.9));
  root.add(mesh(box(0.1, 0.14, 0.12), M.skin(), 0.01, 0.52, 0));
  root.add(mesh(box(0.11, 0.03, 0.13), colour(team), 0.01, 0.47, 0)); // band
  root.add(mesh(sph(0.055), M.skin(), 0.02, 0.64, 0));
  root.add(scl(mesh(sph(0.065), mat('#3a2030', { rough: 0.9 }), -0.01, 0.66, 0), 1, 1, 1.05)); // wild hair
  root.add(rot(mesh(box(0.05, 0.16, 0.08), mat('#3a2030', { rough: 0.9 }), -0.05, 0.57, 0), 0, 0, 0.3));
  for (const z of [-0.018, 0.018]) root.add(mesh(sph(0.01, 6, 4), mat('#ff3020', { emissive: '#ff2000', emissiveIntensity: 1 }), 0.07, 0.65, z));
  for (const [name, s] of [['legL', -1], ['legR', 1]] as const) {
    const leg = limb(0, 0.34, s * 0.04, 0.12, 0.025, C.talon());
    for (const a of [-0.5, 0, 0.5]) leg.add(rot(mesh(box(0.06, 0.012, 0.012), C.talon(), 0.03, -0.12, 0), 0, a, 0));
    parts[name] = leg;
    root.add(leg);
  }
  root.add(rot(mesh(box(0.14, 0.02, 0.1), wing, -0.14, 0.4, 0), 0, 0, 0.3)); // tail feathers
  wings(root, parts, 0, 0.55, 0.36, 0.16, wing, mat('#2a1e2a', { rough: 0.9 }));
  return { root, parts, height: 0.72 };
}

function minotaur(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, hide = C.bull();
  const top = brute(root, parts, 1.1, hide, colour(team));
  // bull's head: broad skull, muzzle, nose ring, horns
  root.add(scl(mesh(sph(0.09, 12, 8), hide, 0.04, top + 0.07, 0), 1.1, 1, 1));
  root.add(mesh(box(0.1, 0.08, 0.1), mat('#3a2216', { rough: 0.8 }), 0.13, top + 0.03, 0));
  root.add(rot(scl(mesh(cyl(0.025, 0.025, 0.006, 10), M.gold(), 0.185, top + 0.0, 0), 1, 1, 1), 0, 0, Math.PI / 2));
  for (const z of [-1, 1]) {
    root.add(mesh(sph(0.014, 6, 4), mat('#ff5030', { emissive: '#c02000', emissiveIntensity: 0.8 }), 0.11, top + 0.1, z * 0.045));
    root.add(rod([0.04, top + 0.12, z * 0.08], [0.06, top + 0.2, z * 0.2], 0.022, C.horn(), 6));
    root.add(rod([0.06, top + 0.2, z * 0.2], [0.12, top + 0.27, z * 0.2], 0.014, C.horn(), 6));
  }
  // great double axe in the right hand
  const axe = group(0, -0.32, 0,
    mesh(cyl(0.018, 0.018, 0.6, 6), M.darkWood(), 0, 0.05, 0),
    mesh(box(0.2, 0.14, 0.02), M.steel(), 0, 0.3, 0),
    mesh(box(0.04, 0.18, 0.025), M.iron(), 0, 0.3, 0));
  parts.armR.add(axe);
  parts.armR.rotation.z = 0.4;
  return { root, parts, height: top + 0.3 };
}

function cyclops(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, skin = C.giant();
  const top = brute(root, parts, 1.45, skin, colour(team));
  root.add(scl(mesh(sph(0.12, 12, 8), skin, 0.02, top + 0.1, 0), 1, 1.1, 1));
  root.add(mesh(sph(0.045, 10, 8), C.eye(), 0.11, top + 0.13, 0)); // the one eye
  root.add(mesh(sph(0.022, 8, 6), C.iris(), 0.15, top + 0.135, 0));
  root.add(mesh(box(0.02, 0.02, 0.12), mat('#5a3a20', { rough: 0.9 }), 0.12, top + 0.19, 0)); // brow
  root.add(mesh(box(0.03, 0.02, 0.08), M.dark(), 0.12, top + 0.04, 0)); // mouth
  root.add(scl(mesh(sph(0.12, 10, 6), mat('#4a3018', { rough: 0.9 }), -0.01, top + 0.15, 0), 1, 0.6, 1.02)); // hair
  // a boulder in the right hand, ready to throw
  const rock = mesh(sph(0.1, 7, 5), C.stone(), 0, -0.44, 0);
  rock.name = 'rock';
  parts.rock = rock;
  parts.armR.add(rock);
  parts.armR.rotation.z = 0.5;
  return { root, parts, height: top + 0.3 };
}

function hydra(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, sc = C.scale(), belly = C.belly();
  // coiled body and tail on the ground
  root.add(scl(mesh(sph(0.26, 14, 10), sc, -0.05, 0.2, 0), 1.25, 0.75, 1));
  root.add(scl(mesh(sph(0.2, 12, 8), belly, 0.05, 0.15, 0), 1, 0.6, 0.9));
  root.add(mesh(cyl(0.27, 0.27, 0.05, 16), colour(team), -0.05, 0.32, 0));
  for (let i = 0; i < 5; i++) root.add(mesh(sph(0.09 - i * 0.015, 8, 6), sc, -0.32 - i * 0.08, 0.1 - i * 0.012, Math.sin(i) * 0.08));
  // three necks, each with a head that sways and strikes
  for (let i = 0; i < 3; i++) {
    const z = (i - 1) * 0.15, neck = group(0.08, 0.32, z);
    neck.rotation.x = -(i - 1) * 0.5;
    neck.scale.setScalar(i === 1 ? 1.35 : 1.15);
    neck.add(rod([0, 0, 0], [0.1, 0.28, 0], 0.045, sc, 8));
    neck.add(rod([0.1, 0.28, 0], [0.18, 0.46, 0], 0.038, sc, 8));
    neck.add(scl(mesh(sph(0.06, 10, 8), sc, 0.24, 0.5, 0), 1.5, 0.8, 1));
    neck.add(mesh(box(0.06, 0.02, 0.07), belly, 0.3, 0.47, 0)); // jaw
    for (const s of [-1, 1]) {
      neck.add(mesh(sph(0.012, 6, 4), mat('#ffd020', { emissive: '#c09000', emissiveIntensity: 0.8 }), 0.27, 0.53, s * 0.035));
      neck.add(rot(mesh(cone(0.012, 0.06, 4), sc, 0.18, 0.56, s * 0.03), 0, 0, 0.9)); // crest spike
    }
    parts[`head${i}`] = neck;
    root.add(neck);
  }
  return { root, parts, height: 1.0 };
}

function cerberus(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, fur = C.hound();
  root.add(scl(mesh(sph(0.2, 14, 10), fur, -0.02, 0.42, 0), 1.45, 0.75, 0.7));
  root.add(scl(mesh(sph(0.16, 12, 8), fur, 0.17, 0.48, 0), 1, 1.05, 1.15)); // deep chest
  fourLegs(root, parts, 0.2, 0.09, 0.36, 0.34, 0.065, fur, M.dark());
  root.add(rod([-0.28, 0.45, 0], [-0.45, 0.58, 0], 0.02, fur, 5)); // tail
  root.add(mesh(cone(0.03, 0.08, 6), C.fire(), -0.47, 0.62, 0)); // ember at its tip
  // spiked collar in the side's colour
  root.add(rot(mesh(cyl(0.15, 0.15, 0.05, 14), colour(team), 0.25, 0.56, 0), 0, 0, -0.6));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; root.add(mesh(cone(0.012, 0.04, 4), M.steel(), 0.25 + Math.cos(a) * 0.02, 0.56 + Math.sin(a) * 0.1, Math.cos(a + 1) * 0.14)); }
  // three heads on three necks
  for (let i = 0; i < 3; i++) {
    const z = (i - 1) * 0.13, head = group(0.27, 0.62, z);
    head.rotation.x = -(i - 1) * 0.25;
    head.add(rot(mesh(box(0.1, 0.16, 0.09), fur, 0.02, 0.04, 0), 0, 0, -0.5));
    head.add(mesh(box(0.13, 0.08, 0.08), fur, 0.1, 0.12, 0));
    head.add(mesh(box(0.06, 0.04, 0.06), fur, 0.18, 0.1, 0)); // muzzle
    head.add(mesh(box(0.03, 0.02, 0.05), C.fire(), 0.2, 0.075, 0)); // glowing maw
    for (const s of [-1, 1]) {
      head.add(mesh(sph(0.012, 6, 4), C.fire(), 0.14, 0.15, s * 0.03));
      head.add(rot(mesh(cone(0.02, 0.07, 4), fur, 0.06, 0.19, s * 0.03), 0, 0, 0.3));
    }
    parts[`head${i}`] = head;
    root.add(head);
  }
  return { root, parts, height: 0.88 };
}

/** A creature's model, or null if the type isn't one. */
export function creatureModel(type: UnitType, team: number): Model | null {
  switch (type) {
    case 'centaur': return centaur(team);
    case 'pegasus': return pegasus(team);
    case 'griffin': return griffin(team);
    case 'harpy': return harpy(team);
    case 'minotaur': return minotaur(team);
    case 'cyclops': return cyclops(team);
    case 'hydra': return hydra(team);
    case 'cerberus': return cerberus(team);
    default: return null;
  }
}

/**
 * Walk, flap, strike and kneel. `w` is the walk cycle in radians and `atk` 0..1 through a strike.
 * Runs after the shared unit animation, so it can override height for kneeling flyers.
 */
export function animateCreature(m: Model, e: Ent, w: number, atk: number): void {
  const P = m.parts, t = G.gameT + e.id;
  const gait = e.moving ? Math.sin(w * 1.3) * 0.7 : 0;
  for (const [k, s] of [['legFL', 1], ['legBR', 1], ['legFR', -1], ['legBL', -1]] as const) if (P[k]) P[k].rotation.z = gait * s;
  const strike = atk > 0 ? Math.sin(atk * Math.PI) : 0;
  switch (e.type) {
    case 'minotaur':
      P.armR.rotation.z = atk > 0 ? lerp(2.6, -0.2, atk) : 0.4;
      P.armL.rotation.z = (e.moving ? Math.sin(w) * 0.5 : 0.2);
      break;
    case 'cyclops':
      P.armR.rotation.z = atk > 0 ? lerp(2.8, -0.4, atk) : 0.5;
      P.armL.rotation.z = e.moving ? Math.sin(w) * 0.4 : 0.1;
      if (P.rock) P.rock.visible = e.atkT <= 0;
      break;
    case 'hydra':
    case 'cerberus':
      for (let i = 0; i < 3; i++) {
        const h = P[`head${i}`];
        if (h) h.rotation.z = Math.sin(t * 2 + i * 2.1) * 0.12 - strike * 0.5;
      }
      break;
    case 'centaur': {
      const rest = P.gun?.userData.rest as THREE.Vector3 | undefined;
      if (P.gun && rest) P.gun.position.x = rest.x - strike * 0.03;
      break;
    }
  }
  const alt = UNIT[e.type as UnitType].alt;
  if (P.wingL && P.wingR) {
    const flap = e.wild?.down ? -0.2 : Math.sin(t * (e.moving ? 9 : 5)) * 0.55 + 0.15;
    P.wingL.rotation.x = flap;
    P.wingR.rotation.x = -flap;
  }
  if (P.legL && P.legR && !alt) { const s = e.moving ? Math.sin(w) * 0.5 : 0; P.legL.rotation.z = s; P.legR.rotation.z = -s; }
  // beaten down: it sinks to the ground and bows its head, waiting to be captured
  if (e.wild?.down) {
    m.root.position.y = alt ? 0.05 : -0.08;
    m.root.rotation.z = -0.25;
    for (const k of ['legFL', 'legFR', 'legBL', 'legBR']) if (P[k]) P[k].rotation.z = k.includes('F') ? 1.2 : -1.2;
  } else m.root.rotation.z = 0;
}
