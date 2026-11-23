// Procedural models for the spellcasters and the cyborgs (data/unit.ts: `magic` and `cyborg`).
// Like every unit they face +x; sizes are in tiles before the shared unit scale. Spellcasters are
// built on the soldier's frame with a robe over the legs and a staff in the right hand; cyborgs are
// two-legged giants whose torso (the `turret` part) twists to aim. Named parts are animated by
// animateArcane below.
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import type { UnitType } from '../../../data/unit.ts';
import { lerp } from '../../../util/math.ts';
import { along, group, limb, mesh, rod, rot, scl, type Mat, type Model, type Parts } from './model_kit.ts';
import { M, box, cone, cyl, dome, lathe, mat, octa, sph, teamMat, torus } from './materials.ts';

const C = {
  ember: () => mat('#ffd080', { rough: 0.2, emissive: '#ff7a10', emissiveIntensity: 2.2 }),
  spark: () => mat('#e8f6ff', { rough: 0.2, emissive: '#60b8ff', emissiveIntensity: 2.4 }),
  star: () => mat('#fff6d0', { rough: 0.15, emissive: '#ffc040', emissiveIntensity: 2.6 }),
  rune: () => mat('#ffe0a0', { rough: 0.3, emissive: '#ffb030', emissiveIntensity: 1.8 }),
  robe: () => mat('#3a2a4a', { rough: 0.9, tex: 'canvas' }),
  coat: () => mat('#3c4450', { rough: 0.85, tex: 'canvas' }),
  ivory: () => mat('#ece4d0', { rough: 0.8, tex: 'canvas' }),
  beard: () => mat('#d8d4cc', { rough: 0.95 }),
  copper: () => mat('#b86a38', { rough: 0.35, metal: 0.85 }),
  lens: () => mat('#ffb040', { rough: 0.2, emissive: '#ff8a00', emissiveIntensity: 0.8 }),
  // the cyborgs: gunmetal plate, black joints, pale skin where the man still shows, a red machine eye
  plate: () => mat('#5a6068', { rough: 0.4, metal: 0.75, tex: 'metal' }),
  joint: () => mat('#1e2024', { rough: 0.5, metal: 0.6 }),
  piston: () => mat('#d8dce2', { rough: 0.2, metal: 0.9 }),
  flesh: () => mat('#c89a80', { rough: 0.75 }),
  eye: () => mat('#ff3020', { rough: 0.2, emissive: '#ff1000', emissiveIntensity: 2.5 }),
  cable: () => mat('#2a2a2e', { rough: 0.8 }),
  core: () => mat('#8af0ff', { rough: 0.2, emissive: '#20c0ff', emissiveIntensity: 2 }),
};

// ---------------------------------------------------------------- spellcasters

interface CasterLook { robe: Mat; trim: Mat; skin?: Mat }

/**
 * A caster's body: arms that swing from the shoulders, legs hidden under a long robe that flares
 * to the ground, a head and a belt. Returns the model with `armL`, `armR`, `legL`, `legR`.
 */
function caster(look: CasterLook): Model {
  const root = new THREE.Group(), parts: Parts = {}, skin = look.skin ?? M.skin();
  for (const [name, side] of [['legL', -1], ['legR', 1]] as const) {
    const leg = limb(0, 0.21, side * 0.05, 0.19, 0.07, look.robe);
    leg.add(mesh(box(0.1, 0.04, 0.08), M.leather(), 0.02, -0.2, 0));
    parts[name] = leg;
    root.add(leg);
  }
  // the robe: a flared skirt to the ankles, a body, a sash in the trim colour
  root.add(mesh(lathe([[0.15, 0.03], [0.13, 0.1], [0.1, 0.2], [0.085, 0.28], [0, 0.29]], 14), look.robe, 0, 0, 0));
  root.add(mesh(cyl(0.152, 0.152, 0.025, 14), look.trim, 0, 0.04, 0)); // hem
  root.add(mesh(box(0.13, 0.19, 0.18), look.robe, 0, 0.35, 0));
  root.add(mesh(box(0.14, 0.035, 0.19), look.trim, 0, 0.27, 0)); // sash
  root.add(mesh(box(0.012, 0.16, 0.03), look.trim, 0.068, 0.36, 0)); // collar to waist
  root.add(mesh(cyl(0.028, 0.032, 0.04, 8), skin, 0, 0.455, 0)); // neck
  root.add(mesh(sph(0.06), skin, 0, 0.5, 0));
  root.add(mesh(box(0.012, 0.014, 0.016), skin, 0.062, 0.495, 0)); // nose
  for (const z of [-0.022, 0.022]) root.add(mesh(box(0.008, 0.01, 0.012), M.dark(), 0.056, 0.51, z));
  for (const [name, side] of [['armL', -1], ['armR', 1]] as const) {
    const arm = limb(0, 0.42, side * 0.115, 0.17, 0.06, look.robe);
    arm.add(mesh(cyl(0.045, 0.035, 0.06, 8), look.trim, 0, -0.15, 0)); // wide cuff
    arm.add(mesh(sph(0.03, 8, 6), skin, 0, -0.19, 0));
    parts[name] = arm;
    root.add(arm);
    root.add(scl(mesh(sph(0.045, 10, 6), look.robe, 0, 0.425, side * 0.105), 1, 0.8, 1));
  }
  return { root, parts, height: 0.66 };
}

/** A staff in the right hand, held upright whatever the arm does (see animateArcane), with a head on top. */
function staff(m: Model, len: number, wood: Mat, head: THREE.Object3D): void {
  const s = group(0, -0.19, 0.02, mesh(cyl(0.012, 0.014, len, 6), wood, 0, len * 0.35, 0));
  head.position.y += len * 0.85;
  s.add(head);
  m.parts.staff = s;
  m.parts.orb = head;
  m.parts.armR.add(s);
}

/** Medieval: a hooded mage in the side's colour, with a fire-orb staff and a satchel of scrolls. */
function mage(team: number): Model {
  const m = caster({ robe: teamMat(team, 'd'), trim: M.gold() });
  const R = m.root;
  // wide-brimmed pointed hat, bent at the tip
  R.add(mesh(cyl(0.12, 0.12, 0.012, 16), M.dark(), 0, 0.545, 0));
  R.add(mesh(cone(0.065, 0.14, 12), M.dark(), -0.005, 0.62, 0));
  R.add(rot(mesh(cone(0.03, 0.08, 8), M.dark(), -0.03, 0.71, 0), 0, 0, 0.6));
  R.add(mesh(cyl(0.068, 0.068, 0.02, 12), teamMat(team), 0, 0.56, 0)); // hatband
  R.add(mesh(box(0.06, 0.09, 0.11), M.leather(), -0.09, 0.33, 0.05)); // satchel
  for (const z of [0.02, 0.06]) R.add(mesh(cyl(0.012, 0.012, 0.07, 6), M.cloth(), -0.09, 0.4, z)); // scrolls
  const orb = group(0, 0, 0,
    mesh(sph(0.04, 12, 8), C.ember(), 0, 0.03, 0),
    ...[0, 1, 2].map((i) => rot(mesh(cone(0.012, 0.05, 4), M.darkWood(), Math.cos(i * 2.1) * 0.03, 0, Math.sin(i * 2.1) * 0.03), Math.sin(i * 2.1) * 0.4, 0, -Math.cos(i * 2.1) * 0.4)));
  staff(m, 0.5, M.darkWood(), orb);
  m.parts.armL.rotation.z = 0.25;
  return { ...m, height: 0.78 };
}

/** World War: a storm caller in a greatcoat and brass goggles, carrying a copper lightning rod. */
function stormcaller(team: number): Model {
  const m = caster({ robe: C.coat(), trim: teamMat(team) });
  const R = m.root;
  R.add(mesh(box(0.135, 0.12, 0.19), teamMat(team, 'd'), 0.002, 0.37, 0)); // waistcoat
  for (let i = 0; i < 3; i++) R.add(mesh(box(0.01, 0.014, 0.014), M.brass(), 0.07, 0.42 - i * 0.04, 0.03)); // buttons
  // peaked cap and goggles pushed up on the brow
  R.add(scl(mesh(sph(0.066, 12, 8), C.coat(), 0, 0.53, 0), 1, 0.6, 1));
  R.add(mesh(box(0.05, 0.01, 0.1), M.dark(), 0.06, 0.525, 0)); // peak
  for (const z of [-0.025, 0.025]) R.add(along(mesh(cyl(0.018, 0.018, 0.02, 8), C.lens(), 0.055, 0.55, z)));
  R.add(mesh(box(0.08, 0.012, 0.13), M.leather(), 0.01, 0.55, 0)); // goggle strap
  // a battery pack on the back, wired to the rod
  R.add(mesh(box(0.07, 0.14, 0.13), M.darkSteel(), -0.1, 0.36, 0));
  for (const z of [-0.04, 0.04]) R.add(mesh(cyl(0.015, 0.015, 0.04, 8), C.copper(), -0.1, 0.45, z));
  R.add(rod([-0.1, 0.45, 0.04], [0.02, 0.3, 0.12], 0.006, C.cable(), 4));
  const head = group(0, 0, 0,
    mesh(sph(0.035, 10, 8), C.spark(), 0, 0.05, 0),
    mesh(torus(0.045, 0.008, Math.PI * 2, 6, 14), C.copper(), 0, 0.0, 0),
    rot(mesh(torus(0.045, 0.008, Math.PI * 2, 6, 14), C.copper(), 0, 0.03, 0), 0.2, 0, 0),
    mesh(cone(0.012, 0.06, 6), C.copper(), 0, 0.11, 0));
  staff(m, 0.52, C.copper(), head);
  m.parts.armL.rotation.z = 0.2;
  return { ...m, height: 0.8 };
}

/** Modern: a bearded archmage in ivory and gold, a ring of runes turning around them, a star on the staff. */
function archmage(team: number): Model {
  const m = caster({ robe: C.ivory(), trim: M.gold() });
  const R = m.root;
  R.add(mesh(lathe([[0.1, 0.38], [0.125, 0.4], [0.11, 0.445], [0.0, 0.45]], 14), teamMat(team), 0, 0.0, 0)); // short mantle
  for (const z of [-0.06, 0.06]) R.add(mesh(box(0.012, 0.3, 0.035), teamMat(team), 0.07, 0.25, z)); // stole
  R.add(scl(mesh(sph(0.05, 10, 8), C.beard(), 0.04, 0.46, 0), 0.7, 1.4, 1)); // beard
  // tall hat with a gold band and a star on the front
  R.add(mesh(cone(0.07, 0.24, 12), teamMat(team, 'd'), 0, 0.66, 0));
  R.add(mesh(cyl(0.072, 0.075, 0.03, 12), M.gold(), 0, 0.555, 0));
  R.add(scl(mesh(octa(0.02), C.star(), 0.07, 0.6, 0), 0.5, 1, 1));
  // the rune ring: a band of gold and glowing glyphs that turns slowly around the waist
  const ring = group(0, 0.3, 0, rot(mesh(torus(0.24, 0.012, Math.PI * 2, 6, 32), C.rune(), 0, 0, 0), Math.PI / 2, 0, 0));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ring.add(rot(mesh(box(0.05, 0.05, 0.008), C.rune(), Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24), 0, -a + Math.PI / 2, Math.PI / 4)); }
  m.parts.ring = ring;
  R.add(ring);
  const star = group(0, 0, 0, scl(mesh(octa(0.05), C.star(), 0, 0.05, 0), 0.8, 1.3, 0.8), rot(mesh(torus(0.05, 0.006, Math.PI * 2, 6, 14), M.gold(), 0, 0.05, 0), Math.PI / 2, 0, 0));
  staff(m, 0.62, M.gold(), star);
  m.parts.armL.rotation.z = 0.3;
  return { ...m, height: 0.95 };
}

// ---------------------------------------------------------------- cyborgs

/**
 * A cyborg's legs and hips: two armoured legs on hip pivots (legL, legR), each with a knee group
 * (kneeL, kneeR) and a big splayed foot. `k` scales the whole frame; returns the hip height.
 */
function walkerLegs(root: THREE.Object3D, parts: Parts, k: number, plate: Mat, accent: Mat): number {
  const hip = 0.5 * k, thigh = 0.24 * k, shin = 0.26 * k;
  for (const [name, side] of [['L', -1], ['R', 1]] as const) {
    const leg = group(0, hip, side * 0.13 * k);
    leg.add(mesh(sph(0.06 * k, 10, 8), C.joint(), 0, 0, 0)); // hip ball
    leg.add(mesh(box(0.13 * k, thigh, 0.11 * k), plate, 0, -thigh / 2, 0));
    leg.add(mesh(box(0.012 * k, thigh * 0.8, 0.115 * k), accent, 0.066 * k, -thigh / 2, 0)); // stripe
    leg.add(rod([-0.05 * k, -0.02 * k, 0], [-0.05 * k, -thigh, 0], 0.015 * k, C.piston(), 6)); // hydraulic
    const knee = group(0, -thigh, 0);
    knee.add(mesh(sph(0.055 * k, 10, 8), C.joint(), 0, 0, 0));
    knee.add(mesh(box(0.08 * k, 0.07 * k, 0.1 * k), plate, 0.05 * k, 0.01 * k, 0)); // knee guard
    knee.add(mesh(box(0.1 * k, shin, 0.09 * k), plate, -0.01 * k, -shin / 2, 0));
    knee.add(mesh(box(0.22 * k, 0.05 * k, 0.15 * k), C.joint(), 0.03 * k, -shin, 0)); // foot
    knee.add(mesh(box(0.06 * k, 0.04 * k, 0.16 * k), plate, 0.12 * k, -shin + 0.005 * k, 0)); // toe
    knee.add(mesh(box(0.05 * k, 0.04 * k, 0.12 * k), plate, -0.08 * k, -shin + 0.005 * k, 0)); // heel
    leg.add(knee);
    parts[`leg${name}`] = leg;
    parts[`knee${name}`] = knee;
    root.add(leg);
  }
  root.add(mesh(box(0.2 * k, 0.12 * k, 0.32 * k), C.joint(), 0, hip + 0.02 * k, 0)); // pelvis
  root.add(mesh(box(0.22 * k, 0.05 * k, 0.34 * k), plate, 0, hip + 0.08 * k, 0));
  return hip + 0.08 * k;
}

/**
 * The upper body that twists to aim: an armoured chest, the man's own face behind a cracked visor
 * with one red machine eye, power core, shoulder plates, and the given arms. Returns the torso group.
 */
function cyborgTorso(team: number, k: number, y: number): THREE.Group {
  const plate = C.plate(), tm = teamMat(team, 'm', 0.5), td = teamMat(team, 'd', 0.5);
  const t = group(0, y, 0);
  t.add(mesh(box(0.26 * k, 0.1 * k, 0.3 * k), C.joint(), 0, 0.05 * k, 0)); // waist
  t.add(mesh(box(0.3 * k, 0.26 * k, 0.44 * k), plate, 0, 0.22 * k, 0)); // chest
  t.add(rot(mesh(box(0.12 * k, 0.2 * k, 0.4 * k), tm, 0.13 * k, 0.24 * k, 0), 0, 0, -0.25)); // breastplate
  t.add(mesh(cyl(0.05 * k, 0.05 * k, 0.03 * k, 12), C.core(), 0.19 * k, 0.24 * k, 0).rotateZ(Math.PI / 2)); // power core
  t.add(mesh(torus(0.055 * k, 0.01 * k, Math.PI * 2, 6, 14), C.joint(), 0.2 * k, 0.24 * k, 0).rotateY(Math.PI / 2));
  // backpack reactor with exhaust stacks
  t.add(mesh(box(0.14 * k, 0.22 * k, 0.3 * k), td, -0.2 * k, 0.26 * k, 0));
  for (const z of [-0.09, 0.09]) {
    t.add(mesh(cyl(0.03 * k, 0.035 * k, 0.16 * k, 8), C.joint(), -0.25 * k, 0.42 * k, z * k));
    t.add(mesh(cyl(0.022 * k, 0.022 * k, 0.005 * k, 8), M.ember(), -0.25 * k, 0.5 * k, z * k));
  }
  for (let i = 0; i < 3; i++) t.add(rod([-0.27 * k, 0.2 * k, (-0.1 + i * 0.1) * k], [-0.12 * k, 0.06 * k, (-0.12 + i * 0.12) * k], 0.01 * k, C.cable(), 4));
  // head: a human face half-covered by steel, one red machine eye
  t.add(mesh(cyl(0.04 * k, 0.05 * k, 0.05 * k, 8), C.joint(), 0.02 * k, 0.37 * k, 0)); // neck
  t.add(mesh(sph(0.075 * k, 12, 10), C.flesh(), 0.03 * k, 0.44 * k, 0));
  t.add(scl(mesh(sph(0.08 * k, 12, 10, ), plate, 0.02 * k, 0.455 * k, -0.012 * k), 1, 1, 0.9)); // steel skull plate
  t.add(mesh(box(0.03 * k, 0.03 * k, 0.05 * k), C.flesh(), 0.09 * k, 0.43 * k, 0.025 * k)); // the human side of the face
  t.add(mesh(box(0.01 * k, 0.01 * k, 0.015 * k), M.dark(), 0.105 * k, 0.45 * k, 0.03 * k)); // the human eye
  t.add(mesh(sph(0.02 * k, 8, 6), C.eye(), 0.095 * k, 0.45 * k, -0.03 * k)); // the machine eye
  t.add(mesh(box(0.06 * k, 0.02 * k, 0.09 * k), C.joint(), 0.08 * k, 0.4 * k, 0)); // jaw guard
  t.add(mesh(cyl(0.004 * k, 0.004 * k, 0.16 * k, 4), C.joint(), -0.03 * k, 0.56 * k, -0.06 * k)); // antenna
  t.add(mesh(sph(0.01 * k, 6, 4), M.redLamp(), -0.03 * k, 0.64 * k, -0.06 * k));
  // shoulder plates in the side's colour
  for (const s of [-1, 1]) {
    t.add(scl(mesh(sph(0.1 * k, 12, 8), tm, 0, 0.33 * k, s * 0.26 * k), 1.1, 0.7, 0.9));
    t.add(mesh(box(0.2 * k, 0.02 * k, 0.02 * k), M.hazard(), 0, 0.36 * k, s * 0.33 * k));
  }
  return t;
}

/** A big cyborg arm on a shoulder pivot, its weapon in place of a hand. */
function cyborgArm(k: number, side: number, plate: Mat): THREE.Group {
  const a = group(0, 0.3 * k, side * 0.29 * k);
  a.add(mesh(sph(0.065 * k, 10, 8), C.joint(), 0, 0, 0));
  a.add(mesh(box(0.11 * k, 0.2 * k, 0.1 * k), plate, 0, -0.1 * k, 0));
  a.add(rod([0.05 * k, -0.02 * k, 0], [0.05 * k, -0.18 * k, 0], 0.012 * k, C.piston(), 6));
  a.add(mesh(sph(0.05 * k, 10, 8), C.joint(), 0, -0.21 * k, 0)); // elbow
  return a;
}

/** Cyborg Juggernaut: a hulking walker with a six-barrel rotary cannon for a right arm and an ammo drum on its back. */
function juggernaut(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, k = 1.05, plate = C.plate();
  const top = walkerLegs(root, parts, k, plate, teamMat(team));
  const torso = cyborgTorso(team, k, top);
  // right arm: the forearm runs forward from the elbow into the rotary cannon
  const armR = cyborgArm(k, 1, plate);
  armR.add(mesh(box(0.28 * k, 0.11 * k, 0.11 * k), plate, 0.12 * k, -0.22 * k, 0));
  armR.add(mesh(cyl(0.07 * k, 0.07 * k, 0.08 * k, 12), C.joint(), 0.29 * k, -0.22 * k, 0).rotateZ(Math.PI / 2));
  const spin = group(0.3 * k, -0.22 * k, 0);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; spin.add(along(mesh(cyl(0.013 * k, 0.013 * k, 0.32 * k, 6), M.gun(), 0.18 * k, Math.cos(a) * 0.04 * k, Math.sin(a) * 0.04 * k))); }
  spin.add(along(mesh(cyl(0.055 * k, 0.055 * k, 0.03 * k, 12), M.gun(), 0.3 * k, 0, 0)));
  spin.add(along(mesh(cyl(0.055 * k, 0.055 * k, 0.03 * k, 12), M.gun(), 0.08 * k, 0, 0)));
  armR.add(spin);
  parts.spin = spin;
  // ammo feed from the drum on its back to the cannon
  torso.add(along(mesh(cyl(0.11 * k, 0.11 * k, 0.12 * k, 14), M.olive(), -0.2 * k, 0.12 * k, 0.2 * k)).rotateX(Math.PI / 2));
  torso.add(rod([-0.15 * k, 0.12 * k, 0.28 * k], [0.12 * k, 0.1 * k, 0.32 * k], 0.022 * k, M.brass(), 6));
  // left arm: a massive steel fist
  const armL = cyborgArm(k, -1, plate);
  armL.add(mesh(box(0.1 * k, 0.18 * k, 0.1 * k), plate, 0.02 * k, -0.32 * k, 0));
  armL.add(mesh(box(0.13 * k, 0.11 * k, 0.12 * k), C.joint(), 0.03 * k, -0.45 * k, 0));
  for (let i = 0; i < 3; i++) armL.add(mesh(box(0.03 * k, 0.03 * k, 0.03 * k), plate, 0.1 * k, -0.43 * k, (i - 1) * 0.035 * k));
  armL.rotation.z = 0.15;
  armR.rotation.z = 0.1; // upper arm hangs, the cannon juts forward from the elbow
  torso.add(armL, armR);
  parts.armL = armL;
  parts.armR = armR;
  parts.turret = torso;
  root.add(torso);
  return { root, parts, height: top + 0.62 * k };
}

/** Cyborg Titan: the biggest walker, a rail cannon on each arm and a missile pod over one shoulder. */
function titan(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, k = 1.35, plate = C.plate();
  const top = walkerLegs(root, parts, k, plate, teamMat(team));
  const torso = cyborgTorso(team, k, top);
  // the rail cannons: long twin rails with copper coils, glowing at the breech; they recoil together
  const barrel = group(0, 0, 0);
  for (const s of [-1, 1]) {
    const arm = cyborgArm(k, s, plate);
    arm.rotation.z = 0.25;
    torso.add(arm);
    parts[s < 0 ? 'armL' : 'armR'] = arm;
    const z = s * 0.36 * k, y = 0.1 * k;
    barrel.add(mesh(box(0.22 * k, 0.12 * k, 0.12 * k), C.joint(), 0.2 * k, y, z)); // breech
    barrel.add(mesh(box(0.06 * k, 0.04 * k, 0.07 * k), C.core(), 0.08 * k, y + 0.07 * k, z));
    for (const dy of [-0.025, 0.025]) barrel.add(mesh(box(0.55 * k, 0.025 * k, 0.05 * k), M.darkSteel(), 0.55 * k, y + dy * k, z));
    for (let i = 0; i < 4; i++) barrel.add(along(mesh(cyl(0.05 * k, 0.05 * k, 0.03 * k, 10), C.copper(), (0.38 + i * 0.1) * k, y, z)));
    barrel.add(mesh(box(0.04 * k, 0.09 * k, 0.08 * k), M.darkSteel(), 0.82 * k, y, z)); // muzzle
  }
  torso.add(barrel);
  parts.barrel = barrel;
  // missile pod over the left shoulder
  torso.add(mesh(box(0.2 * k, 0.12 * k, 0.14 * k), teamMat(team, 'd', 0.5), -0.02 * k, 0.48 * k, -0.24 * k));
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) torso.add(along(mesh(cyl(0.016 * k, 0.016 * k, 0.01 * k, 8), M.redLamp(), 0.085 * k, (0.45 + r * 0.05) * k, (-0.28 + c * 0.04) * k)));
  // armoured collar around the head
  torso.add(mesh(dome(0.12 * k), plate, -0.02 * k, 0.38 * k, 0).rotateZ(0.5));
  parts.turret = torso;
  root.add(torso);
  return { root, parts, height: top + 0.7 * k };
}

/** A spellcaster's or cyborg's model, or null if the type is neither. */
export function arcaneModel(type: UnitType, team: number): Model | null {
  switch (type) {
    case 'mage': return mage(team);
    case 'stormcaller': return stormcaller(team);
    case 'archmage': return archmage(team);
    case 'juggernaut': return juggernaut(team);
    case 'titan': return titan(team);
    default: return null;
  }
}

/**
 * Casting and striding. `w` is the walk cycle in radians and `atk` 0..1 through an attack. Runs
 * after the shared unit animation, so it overrides the legs and arms it sets.
 */
export function animateArcane(m: Model, e: Ent, w: number, atk: number): void {
  const P = m.parts, t = G.gameT + e.id * 0.7;
  if (P.staff) {
    // the staff swings up and thrusts forward to cast, then comes back down
    const cast = atk > 0 ? Math.sin(atk * Math.PI) : 0;
    const arm = e.moving ? 0.25 + Math.sin(w) * 0.25 : 0.45;
    P.armR.rotation.z = lerp(arm, 2.2, cast);
    P.staff.rotation.z = -P.armR.rotation.z + lerp(0.1, 1.1, cast); // held upright, tipped toward the foe as it casts
    if (P.orb) P.orb.scale.setScalar(1 + Math.sin(t * 5) * 0.12 + cast * 0.6);
    if (P.ring) { P.ring.rotation.y = t * 0.9; P.ring.position.y = (P.ring.userData.rest as THREE.Vector3 | undefined)?.y ?? 0.3; P.ring.position.y += Math.sin(t * 1.7) * 0.02; }
    return;
  }
  // cyborgs: a slow, heavy stride, knees bending on the forward swing; the body dips with each step
  if (P.kneeL && P.kneeR) {
    const g = w * 0.55, s = e.moving ? Math.sin(g) * 0.45 : 0;
    P.legL.rotation.z = s;
    P.legR.rotation.z = -s;
    P.kneeL.rotation.z = e.moving ? -Math.max(0, Math.sin(g + 1.2)) * 0.6 : 0;
    P.kneeR.rotation.z = e.moving ? -Math.max(0, -Math.sin(g + 1.2)) * 0.6 : 0;
    m.root.position.y = e.moving ? -Math.abs(Math.cos(g)) * 0.03 : 0;
  }
  if (P.spin) P.spin.rotation.x = e.atkT > 0 ? t * 30 : t * 0.5; // the barrels whirl while it fires
}
