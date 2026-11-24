// Procedural models for the creatures of Greek myth (data/creatures.ts). Like the other units they
// face +x and are about a tile tall. A wild creature wears no colours; once captured it carries its
// side's colour on a collar, sash or band. Named parts are animated by animateCreature below.
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import type { UnitType } from '../../../data/unit.ts';
import { UNIT } from '../../../data/unit.ts';
import { lerp } from '../../../util/math.ts';
import { group, limb, mesh, rod, rot, scl, type Mat, type Model, type Parts } from './model_kit.ts';
import { M, box, cone, cyl, mat, sph, teamMat, torus } from './materials.ts';

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
  gorgon: () => mat('#5f8a4a', { rough: 0.55, metal: 0.1 }),
  gorgonSkin: () => mat('#a8c094', { rough: 0.75 }),
  gaze: () => mat('#d0ff80', { rough: 0.3, emissive: '#90ff30', emissiveIntensity: 1.8 }),
  lionGold: () => mat('#d8a440', { rough: 0.4, metal: 0.45 }),
  mane: () => mat('#8a4a1a', { rough: 0.95 }),
  sand: () => mat('#d4b47a', { rough: 0.85 }),
  goat: () => mat('#7a5a3a', { rough: 0.95 }),
  ivy: () => mat('#4a7a2a', { rough: 0.9 }),
  reed: () => mat('#c8b070', { rough: 0.8 }),
  flame: () => mat('#ff9020', { rough: 0.5, emissive: '#ff5000', emissiveIntensity: 1.4 }),
  blaze: () => mat('#ffd040', { rough: 0.4, emissive: '#ffa000', emissiveIntensity: 1.6 }),
  ember: () => mat('#d02a10', { rough: 0.6, emissive: '#a01000', emissiveIntensity: 0.9 }),
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
  root.add(mesh(box(0.025, 0.025, 0.13), skin, 0.115, top + 0.19, 0)); // a heavy, hairless brow ridge
  root.add(mesh(box(0.03, 0.02, 0.08), M.dark(), 0.12, top + 0.04, 0)); // mouth
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

function medusa(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, sc = C.gorgon(), skin = C.gorgonSkin();
  // a serpent's coils on the ground, the tail curling out behind and swaying
  root.add(scl(mesh(sph(0.2, 14, 10), sc, -0.02, 0.12, 0), 1.3, 0.55, 1.1));
  root.add(mesh(cyl(0.16, 0.2, 0.06, 14), C.belly(), 0.02, 0.2, 0));
  const tail = group(-0.18, 0.08, 0);
  for (let i = 0; i < 6; i++) tail.add(mesh(sph(0.075 - i * 0.01, 8, 6), sc, -i * 0.07, -i * 0.006, Math.sin(i * 0.9) * 0.07));
  parts.tail = tail;
  root.add(tail);
  // a woman's body rising from the coils
  root.add(scl(mesh(sph(0.09, 10, 8), skin, 0.04, 0.34, 0), 0.9, 1.3, 1));
  root.add(mesh(box(0.1, 0.16, 0.14), skin, 0.05, 0.47, 0));
  root.add(rot(mesh(box(0.11, 0.04, 0.16), colour(team), 0.05, 0.47, 0), 0.6, 0, 0)); // sash
  root.add(mesh(box(0.09, 0.05, 0.15), M.gold(), 0.05, 0.55, 0)); // breastplate edge
  for (const [name, s] of [['armL', -1], ['armR', 1]] as const) {
    const arm = limb(0.05, 0.55, s * 0.09, 0.18, 0.04, skin);
    arm.rotation.x = s * 0.25;
    parts[name] = arm;
    root.add(arm);
  }
  root.add(mesh(sph(0.06, 10, 8), skin, 0.06, 0.65, 0));
  for (const z of [-0.02, 0.02]) root.add(mesh(sph(0.012, 6, 4), C.gaze(), 0.115, 0.665, z)); // the deadly eyes
  // a crown of living snakes: each one a tapering, S-curved body rising from her scalp, with a
  // flat wedge of a head, glowing eyes and a forked red tongue, all writhing (see animateCreature)
  const hair = group(0.05, 0.68, 0), belly = C.belly(), tongue = mat('#d02020', { rough: 0.6 }), eye = C.gaze();
  const SNAKES = 11;
  for (let i = 0; i < SNAKES; i++) {
    const a = (i / SNAKES) * Math.PI * 2 + 0.3, snake = group(Math.cos(a) * 0.045, 0.01, Math.sin(a) * 0.045);
    snake.rotation.y = -a; // its local +x points away from her head
    const len = i % 3 === 0 ? 1.15 : i % 3 === 1 ? 1 : 0.85;
    // an S-curve out and up, thinning toward the head
    const pts: [number, number, number][] = [[0, 0, 0], [0.035, 0.02, 0.01], [0.065, 0.05, -0.01], [0.08, 0.085, 0.008], [0.075, 0.115, -0.004]]
      .map(([x, y, z]) => [x * len, y * len, z * len]);
    for (let k = 0; k < pts.length - 1; k++) {
      const r = 0.012 - k * 0.0018;
      snake.add(rod(pts[k], pts[k + 1], r, k % 2 ? sc : C.gorgon(), 6));
      snake.add(mesh(sph(r, 6, 4), sc, ...pts[k + 1])); // round the joints
    }
    // the head: a flattened wedge looking outward, eyes either side, tongue flicking out
    const [hx, hy, hz] = pts[pts.length - 1], head = group(hx, hy, hz);
    head.add(scl(mesh(sph(0.016, 8, 6), sc, 0.012, 0, 0), 1.6, 0.7, 1.1));
    head.add(scl(mesh(sph(0.011, 6, 4), belly, 0.014, -0.006, 0), 1.5, 0.4, 0.9)); // pale jaw
    for (const z of [-0.009, 0.009]) head.add(mesh(sph(0.0045, 5, 4), eye, 0.02, 0.005, z));
    for (const z of [-0.003, 0.003]) head.add(rot(mesh(box(0.016, 0.002, 0.002), tongue, 0.04, -0.003, z), 0, z * 60, 0));
    head.rotation.z = -0.25;
    snake.add(head);
    parts[`snake${i}`] = snake;
    hair.add(snake);
  }
  parts.hair = hair;
  root.add(hair);
  return { root, parts, height: 0.82 };
}

function nemean(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, hide = C.lionGold(), mane = C.mane();
  root.add(scl(mesh(sph(0.22, 14, 10), hide, -0.04, 0.44, 0), 1.6, 0.72, 0.68));
  fourLegs(root, parts, 0.22, 0.09, 0.36, 0.34, 0.075, hide, C.talon());
  // tail with a dark tuft
  root.add(rod([-0.34, 0.47, 0], [-0.56, 0.58, 0], 0.016, hide, 5));
  root.add(mesh(sph(0.04, 8, 6), mane, -0.57, 0.6, 0));
  // great shaggy mane round a broad head
  root.add(scl(mesh(sph(0.17, 12, 10), mane, 0.24, 0.58, 0), 0.9, 1.05, 1.15));
  // its side's colours: a broad blanket over the back with gold trim and hanging tassels, and a
  // thick collar in front of the mane where it shows from every angle
  const team_ = colour(team);
  root.add(scl(mesh(sph(0.2, 14, 8), team_, -0.06, 0.5, 0), 1.05, 0.5, 0.78));
  root.add(mesh(box(0.3, 0.015, 0.33), M.gold(), -0.06, 0.555, 0));
  for (const z of [-1, 1]) {
    root.add(mesh(box(0.3, 0.16, 0.012), team_, -0.06, 0.45, z * 0.155)); // the blanket hangs down its flanks
    root.add(mesh(box(0.3, 0.02, 0.014), M.gold(), -0.06, 0.37, z * 0.156));
    for (const x of [-0.17, -0.06, 0.05]) root.add(mesh(cone(0.012, 0.04, 5), M.gold(), x, 0.345, z * 0.157));
  }
  root.add(rot(mesh(torus(0.11, 0.025, Math.PI * 2, 6, 16), team_, 0.31, 0.56, 0), 0, Math.PI / 2, 0.5)); // collar
  root.add(mesh(sph(0.025, 8, 6), M.gold(), 0.38, 0.5, 0)); // its medallion
  root.add(scl(mesh(sph(0.1, 12, 8), hide, 0.34, 0.6, 0), 1.1, 1, 0.95));
  root.add(mesh(box(0.08, 0.07, 0.09), hide, 0.43, 0.56, 0)); // muzzle
  root.add(mesh(box(0.025, 0.025, 0.04), M.dark(), 0.475, 0.585, 0)); // nose
  for (const z of [-0.04, 0.04]) {
    root.add(mesh(sph(0.013, 6, 4), mat('#ffd040', { emissive: '#c08000', emissiveIntensity: 0.7 }), 0.41, 0.64, z));
    root.add(mesh(sph(0.03, 6, 4), hide, 0.3, 0.71, z * 2));
  }
  return { root, parts, height: 0.88 };
}

function sphinx(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, body = C.sand(), wing = C.tawny();
  root.add(scl(mesh(sph(0.21, 14, 10), body, -0.05, 0.4, 0), 1.55, 0.7, 0.66));
  fourLegs(root, parts, 0.2, 0.09, 0.33, 0.31, 0.07, body, C.talon());
  root.add(rod([-0.33, 0.42, 0], [-0.5, 0.55, 0], 0.014, body, 5));
  // eagle's wings folded along her back (they don't flap: she walks)
  for (const s of [-1, 1]) {
    const w = group(0.08, 0.56, s * 0.1);
    w.rotation.set(s * 0.5, 0, 0.35);
    w.add(mesh(box(0.42, 0.02, 0.16), wing, -0.18, 0, s * 0.06));
    for (let i = 0; i < 4; i++) w.add(mesh(box(0.1, 0.015, 0.04), C.brownFeather(), -0.42 - i * 0.03, -0.005, s * (0.02 + i * 0.04)));
    root.add(w);
  }
  // a woman's head and breast, crowned with a band in the side's colour
  root.add(scl(mesh(sph(0.12, 12, 8), body, 0.2, 0.52, 0), 1, 1.15, 0.95));
  root.add(mesh(cyl(0.04, 0.05, 0.08, 8), M.skin(), 0.25, 0.66, 0));
  root.add(mesh(sph(0.07, 12, 8), M.skin(), 0.27, 0.75, 0));
  root.add(scl(mesh(sph(0.078, 10, 8), M.hair(), 0.25, 0.77, 0), 1, 1, 1.05));
  root.add(mesh(box(0.06, 0.16, 0.13), M.hair(), 0.22, 0.68, 0)); // long hair
  root.add(mesh(cyl(0.08, 0.08, 0.025, 12), colour(team), 0.26, 0.81, 0));
  for (const z of [-0.025, 0.025]) root.add(mesh(sph(0.011, 6, 4), mat('#40c0ff', { emissive: '#2090ff', emissiveIntensity: 1.2 }), 0.335, 0.765, z));
  return { root, parts, height: 0.92 };
}

function satyr(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, fur = C.goat();
  // shaggy goat legs ending in hooves
  for (const [name, s] of [['legL', -1], ['legR', 1]] as const) {
    const leg = limb(0, 0.3, s * 0.05, 0.15, 0.05, fur);
    const shin = group(0, -0.15, 0, mesh(box(0.035, 0.15, 0.035), fur, 0, -0.07, 0), mesh(box(0.045, 0.03, 0.05), M.dark(), 0.01, -0.15, 0));
    shin.rotation.z = -0.5;
    leg.add(shin);
    leg.rotation.z = 0.25;
    parts[name] = leg;
    root.add(leg);
  }
  root.add(scl(mesh(sph(0.07, 10, 8), fur, 0, 0.31, 0), 1, 0.8, 1.2));
  // a man's chest, a sash and a wreath of ivy
  root.add(mesh(box(0.09, 0.15, 0.14), M.skin(), 0, 0.42, 0));
  root.add(rot(mesh(box(0.1, 0.035, 0.16), colour(team), 0, 0.42, 0), 0.6, 0, 0));
  root.add(mesh(sph(0.052, 10, 8), M.skin(), 0.01, 0.55, 0));
  root.add(mesh(box(0.03, 0.05, 0.04), fur, 0.05, 0.51, 0)); // beard
  root.add(scl(mesh(sph(0.055, 8, 6), M.hair(), -0.005, 0.57, 0), 1, 0.75, 1.05));
  root.add(mesh(torus(0.05, 0.012, Math.PI * 2, 6, 12), C.ivy(), 0, 0.585, 0)).rotation.x = Math.PI / 2;
  for (const z of [-1, 1]) root.add(rod([0, 0.59, z * 0.03], [-0.05, 0.66, z * 0.06], 0.012, C.horn(), 5)); // little horns
  // arms raised to the panpipes at his lips
  for (const [name, s] of [['armL', -1], ['armR', 1]] as const) {
    const arm = limb(0, 0.48, s * 0.08, 0.13, 0.032, M.skin());
    arm.rotation.z = 1.2;
    arm.rotation.x = -s * 0.5;
    parts[name] = arm;
    root.add(arm);
  }
  const pipes = group(0.09, 0.5, 0);
  for (let i = 0; i < 5; i++) pipes.add(mesh(cyl(0.009, 0.009, 0.1 - i * 0.012, 6), C.reed(), 0, -i * 0.006, (i - 2) * 0.018));
  parts.gun = pipes;
  root.add(pipes);
  return { root, parts, height: 0.68 };
}

function chimera(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, lion = C.tawny(), goat = C.goat(), sc = C.scale();
  root.add(scl(mesh(sph(0.22, 14, 10), lion, -0.04, 0.44, 0), 1.6, 0.72, 0.7));
  fourLegs(root, parts, 0.22, 0.09, 0.36, 0.34, 0.07, lion, C.talon());
  root.add(mesh(cyl(0.14, 0.15, 0.05, 14), colour(team), 0.18, 0.52, 0)); // collar
  // the lion's head at the front, a fiery maw
  const head = group(0.28, 0.58, 0);
  head.add(scl(mesh(sph(0.14, 12, 8), C.mane(), -0.02, 0, 0), 0.85, 1, 1.1));
  head.add(scl(mesh(sph(0.09, 12, 8), lion, 0.07, 0.01, 0), 1.1, 1, 0.95));
  head.add(mesh(box(0.08, 0.06, 0.08), lion, 0.15, -0.03, 0));
  head.add(mesh(box(0.03, 0.025, 0.06), C.fire(), 0.19, -0.05, 0));
  for (const z of [-0.035, 0.035]) head.add(mesh(sph(0.012, 6, 4), C.fire(), 0.13, 0.04, z));
  parts.head0 = head;
  root.add(head);
  // a goat's head rising from the middle of its back
  const gh = group(0.0, 0.6, 0.05);
  gh.add(rod([0, 0, 0], [0.04, 0.16, 0], 0.035, goat, 6));
  gh.add(scl(mesh(sph(0.05, 10, 8), goat, 0.07, 0.19, 0), 1.4, 0.9, 0.9));
  gh.add(mesh(box(0.03, 0.05, 0.02), goat, 0.1, 0.14, 0)); // beard
  for (const z of [-1, 1]) gh.add(rod([0.05, 0.23, z * 0.025], [-0.04, 0.3, z * 0.04], 0.012, C.horn(), 5));
  parts.head1 = gh;
  root.add(gh);
  // a serpent for a tail, its head reared and watching behind
  const tail = group(-0.32, 0.46, 0);
  tail.add(rod([0, 0, 0], [-0.15, 0.1, 0], 0.025, sc, 6));
  tail.add(rod([-0.15, 0.1, 0], [-0.2, 0.25, 0], 0.022, sc, 6));
  tail.add(scl(mesh(sph(0.035, 8, 6), sc, -0.17, 0.28, 0), 1.4, 0.8, 1));
  parts.head2 = tail;
  root.add(tail);
  return { root, parts, height: 0.92 };
}

function phoenix(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, red = C.ember(), fire = C.flame(), gold = C.blaze();
  root.add(scl(mesh(sph(0.11, 12, 8), red, 0, 0.45, 0), 1.5, 0.85, 0.8));
  root.add(scl(mesh(sph(0.08, 10, 8), fire, 0.08, 0.47, 0), 1, 1, 0.9)); // glowing breast
  root.add(mesh(cyl(0.06, 0.07, 0.03, 10), colour(team), 0.12, 0.52, 0)); // band
  root.add(mesh(sph(0.06, 10, 8), red, 0.18, 0.56, 0));
  root.add(rot(mesh(cone(0.022, 0.08, 6), M.gold(), 0.26, 0.55, 0), 0, 0, -1.8));
  for (const z of [-0.035, 0.035]) root.add(mesh(sph(0.01, 6, 4), gold, 0.21, 0.58, z));
  for (let i = 0; i < 3; i++) root.add(rot(mesh(cone(0.015, 0.1, 4), gold, 0.15 - i * 0.03, 0.63 + i * 0.01, 0), 0, 0, 0.5 + i * 0.25)); // crest
  // long streaming tail of flame
  const tail = group(-0.14, 0.44, 0);
  for (let i = 0; i < 5; i++) tail.add(rot(mesh(box(0.34 - Math.abs(i - 2) * 0.05, 0.012, 0.035), i % 2 ? gold : fire, -0.16, -0.02, (i - 2) * 0.035), 0, (i - 2) * 0.18, 0.15));
  parts.tail = tail;
  root.add(tail);
  wings(root, parts, 0.04, 0.5, 0.48, 0.2, fire, gold);
  return { root, parts, height: 0.72 };
}

function dragon(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, sc = mat('#7a1e18', { rough: 0.5, metal: 0.2 }), belly = mat('#d8a050', { rough: 0.7 });
  const membrane = mat('#4a1410', { rough: 0.8 }), horn = C.horn(), fire = C.flame();
  // a long armored body with a pale plated belly and a row of spines down the back
  root.add(scl(mesh(sph(0.16, 14, 10), sc, 0, 0.46, 0), 1.9, 0.75, 0.75));
  root.add(scl(mesh(sph(0.13, 12, 8), belly, 0.02, 0.41, 0), 1.9, 0.6, 0.7));
  // a ridge of tall spines down the back, with smaller ones flaring out along the flanks
  for (let i = 0; i < 9; i++) root.add(rot(mesh(cone(0.03, 0.13 - Math.abs(i - 3) * 0.01, 4), horn, 0.22 - i * 0.055, 0.55 - Math.abs(i - 3) * 0.004, 0), 0, 0, 0.35));
  for (let i = 0; i < 5; i++) for (const z of [-1, 1]) root.add(rot(mesh(cone(0.016, 0.06, 4), horn, 0.14 - i * 0.08, 0.5, z * 0.1), z * 0.9, 0, 0.4));
  root.add(mesh(cyl(0.085, 0.1, 0.04, 12), colour(team), 0.25, 0.5, 0)); // collar where the neck meets the body
  // a snaking neck, spined, and a big horned head: heavy brows over burning eyes, a snarling maw full of fangs
  const head = group(0.26, 0.5, 0);
  head.add(rod([0, 0, 0], [0.12, 0.12, 0], 0.055, sc, 7));
  head.add(rod([0.12, 0.12, 0], [0.2, 0.17, 0], 0.048, sc, 7));
  for (let i = 0; i < 3; i++) head.add(rot(mesh(cone(0.02, 0.07, 4), horn, 0.05 + i * 0.065, 0.1 + i * 0.045, 0), 0, 0, 0.6));
  head.add(scl(mesh(sph(0.095, 12, 8), sc, 0.25, 0.19, 0), 1.35, 0.85, 0.95)); // skull
  head.add(mesh(box(0.15, 0.05, 0.1), sc, 0.36, 0.18, 0)); // upper jaw and snout
  head.add(rot(mesh(box(0.13, 0.03, 0.085), sc, 0.34, 0.12, 0), 0, 0, -0.3)); // lower jaw, hanging open
  head.add(rot(mesh(box(0.11, 0.025, 0.07), fire, 0.34, 0.145, 0), 0, 0, -0.15)); // fire in the throat
  for (const z of [-0.035, -0.012, 0.012, 0.035]) {
    head.add(rot(mesh(cone(0.008, 0.035, 4), C.white(), 0.41, 0.145, z), 0, 0, Math.PI)); // upper fangs
    head.add(mesh(cone(0.007, 0.025, 4), C.white(), 0.38, 0.13, z * 0.9)); // lower fangs
  }
  for (const z of [-1, 1]) {
    head.add(mesh(sph(0.016, 6, 4), mat('#ffe060', { emissive: '#ff8000', emissiveIntensity: 2 }), 0.33, 0.225, z * 0.042)); // eyes
    head.add(rot(mesh(box(0.08, 0.022, 0.03), sc, 0.33, 0.25, z * 0.045), z * 0.25, 0, -0.45)); // a scowling brow, low at the front
    head.add(rod([0.24, 0.26, z * 0.04], [0.09, 0.36, z * 0.1], 0.02, horn, 5)); // swept-back horns
    head.add(rod([0.22, 0.22, z * 0.06], [0.12, 0.27, z * 0.14], 0.012, horn, 5));
    for (let i = 0; i < 3; i++) head.add(rot(mesh(cone(0.012, 0.05, 4), horn, 0.2 - i * 0.03, 0.16, z * (0.08 + i * 0.01)), z * 1.3, 0, 0.5)); // cheek spikes
    head.add(mesh(cone(0.008, 0.03, 4), horn, 0.4, 0.21, z * 0.02)); // nose horns
  }
  head.scale.setScalar(1.3);
  parts.head0 = head;
  root.add(head);
  // a long tail ending in a spade of bone
  const tail = group(-0.3, 0.46, 0);
  tail.add(rod([0, 0, 0], [-0.18, -0.02, 0], 0.045, sc, 6));
  tail.add(rod([-0.18, -0.02, 0], [-0.36, 0.03, 0], 0.03, sc, 6));
  tail.add(rod([-0.36, 0.03, 0], [-0.5, 0.1, 0], 0.018, sc, 6));
  tail.add(rot(mesh(cone(0.04, 0.08, 4), horn, -0.53, 0.12, 0), 0, 0, 1.2));
  for (let i = 0; i < 6; i++) tail.add(rot(mesh(cone(0.018, 0.06 - i * 0.006, 4), horn, -0.05 - i * 0.08, 0.04 + (i > 3 ? (i - 3) * 0.03 : 0), 0), 0, 0, 0.4));
  parts.tail = tail;
  root.add(tail);
  // clawed feet tucked up under the belly in flight (no hanging legs: they read as a slab from above)
  for (const [x, z] of [[0.14, 0.07], [0.14, -0.07], [-0.16, 0.08], [-0.16, -0.08]]) {
    root.add(scl(mesh(sph(0.04, 8, 6), sc, x, 0.36, z), 1.3, 0.8, 1));
    for (const a of [-0.4, 0, 0.4]) root.add(rot(mesh(cone(0.008, 0.035, 4), C.talon(), x + 0.04, 0.34, z + a * 0.03), 0, a, -1.9));
  }
  // great bat wings of red membrane on spars of bone
  wings(root, parts, 0.04, 0.56, 0.78, 0.26, membrane, sc);
  return { root, parts, height: 0.8 };
}

/** The colours of the rainbow, red on the outside, glowing a little so they read at any hour. */
const RAINBOW = ['#ff4a4a', '#ff9a30', '#ffe040', '#50d860', '#40a0ff', '#9a60ff'].map((c) => mat(c, { rough: 0.5, emissive: c, emissiveIntensity: 0.45 }));

function unicorn(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, coat = C.white(), pink = mat('#ffb0d8', { rough: 0.6 });
  // a white horse with a rainbow mane, a rainbow tail and a spiral golden horn
  root.add(scl(mesh(sph(0.2, 14, 10), coat, 0, 0.48, 0), 1.6, 0.68, 0.62));
  root.add(scl(mesh(sph(0.14, 12, 8), coat, 0.2, 0.5, 0), 1, 1.05, 0.88));
  root.add(scl(mesh(sph(0.14, 12, 8), coat, -0.22, 0.5, 0), 1.05, 1, 0.92));
  horseHead(root, coat, coat);
  fourLegs(root, parts, 0.22, 0.08, 0.38, 0.36, 0.06, coat, M.gold());
  RAINBOW.forEach((m, i) => {
    root.add(rot(mesh(box(0.05, 0.05, 0.03), m, 0.31 - i * 0.025, 0.86 - i * 0.04, (i % 2 ? 1 : -1) * 0.03), 0, 0, -0.55)); // mane locks down the neck
    root.add(rot(mesh(box(0.035, 0.16, 0.022), m, -0.37 - i * 0.012, 0.47 - i * 0.012, (i - 2.5) * 0.018), 0, 0, 0.45 + i * 0.08)); // tail
  });
  const horn = group(0.47, 0.84, 0);
  horn.rotation.z = -0.75;
  horn.add(mesh(cone(0.022, 0.2, 8), M.gold(), 0, 0.1, 0));
  for (let k = 0; k < 4; k++) horn.add(mesh(torus(0.017 - k * 0.0035, 0.004, Math.PI * 2, 4, 10), M.gold(), 0, 0.03 + k * 0.04, 0)).rotation.x = Math.PI / 2 + 0.3;
  root.add(horn);
  // a happy face: big shiny eyes, pink cheeks and a smile
  for (const z of [-0.045, 0.045]) {
    root.add(mesh(sph(0.018, 8, 6), M.dark(), 0.46, 0.8, z));
    root.add(mesh(sph(0.006, 5, 4), M.white(), 0.474, 0.807, z * 0.9));
    root.add(mesh(sph(0.014, 6, 4), pink, 0.52, 0.745, z * 0.95));
  }
  root.add(rot(mesh(torus(0.022, 0.004, Math.PI, 4, 8), M.dark(), 0.592, 0.7, 0), 0, Math.PI / 2, Math.PI)); // smile
  // saddle blanket in the side's colour, with a heart
  root.add(mesh(box(0.22, 0.03, 0.27), colour(team), 0, 0.62, 0));
  for (const z of [-0.136, 0.136]) root.add(mesh(sph(0.025, 8, 6), pink, 0, 0.58, z));
  // a rainbow that arcs out behind it as it gallops
  const arc = group(-0.62, 0.12, 0);
  RAINBOW.forEach((m, i) => arc.add(mesh(torus(0.46 - i * 0.03, 0.016, Math.PI, 4, 24), m, 0, 0, 0)));
  arc.visible = false;
  parts.rainbow = arc;
  root.add(arc);
  return { root, parts, height: 1.0 };
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
    case 'medusa': return medusa(team);
    case 'nemean': return nemean(team);
    case 'sphinx': return sphinx(team);
    case 'satyr': return satyr(team);
    case 'chimera': return chimera(team);
    case 'phoenix': return phoenix(team);
    case 'dragon': return dragon(team);
    case 'unicorn': return unicorn(team);
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
    case 'chimera':
      for (let i = 0; i < 3; i++) {
        const h = P[`head${i}`];
        if (h) h.rotation.z = Math.sin(t * 2 + i * 2.1) * 0.12 - strike * 0.5;
      }
      break;
    case 'medusa':
      if (P.tail) P.tail.rotation.y = Math.sin(t * 1.6) * 0.35;
      if (P.hair) P.hair.rotation.y = Math.sin(t * 3) * 0.15;
      // each snake writhes on its own rhythm, and they all rear up as she gazes
      for (let i = 0; P[`snake${i}`]; i++) {
        const sn = P[`snake${i}`];
        sn.rotation.x = Math.sin(t * 4.5 + i * 1.7) * 0.25;
        sn.rotation.z = Math.sin(t * 3.1 + i * 2.3) * 0.18 + strike * 0.5;
      }
      // she lifts her head and fixes her stare as she gazes
      m.root.position.y += strike * 0.04;
      if (P.armR) P.armR.rotation.z = strike * 1.4;
      break;
    case 'nemean':
    case 'sphinx':
      // a pounce: the forelegs reach out as the claws strike
      if (strike) for (const k of ['legFL', 'legFR']) if (P[k]) P[k].rotation.z = strike * 1.1;
      break;
    case 'satyr': {
      // he plays as he walks; the pipes bob, and he sways to his own tune
      if (P.gun) P.gun.position.y = 0.5 + Math.sin(t * 6) * 0.008;
      m.root.rotation.x = Math.sin(t * 3) * 0.05;
      break;
    }
    case 'unicorn':
      // it prances, head high, and leaves a rainbow behind it at a gallop
      if (P.rainbow) { P.rainbow.visible = e.moving; P.rainbow.scale.setScalar(0.9 + Math.sin(t * 5) * 0.05); }
      m.root.position.y += e.moving ? Math.abs(Math.sin(w * 1.3)) * 0.05 : 0;
      break;
    case 'phoenix':
      if (P.tail) P.tail.rotation.y = Math.sin(t * 4) * 0.2;
      break;
    case 'dragon':
      // the tail sways slowly; the head rears back, then lunges as it breathes fire
      if (P.tail) P.tail.rotation.y = Math.sin(t * 1.5) * 0.3;
      if (P.head0) P.head0.rotation.z = Math.sin(t * 1.2) * 0.08 + (atk > 0 ? lerp(0.35, -0.45, atk) : 0);
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
