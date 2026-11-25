// Procedural models for the demons of the Gate of Hell (data/hell.ts): the Imp, the Hell Fiend and
// the giant Archfiend. Like every unit they face +x; the Archfiend stands nearly as tall as the Titan.
// They belong to nobody, so they wear no colours: red hide, black horns, burning eyes.
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import { lerp } from '../../../util/math.ts';
import type { UnitType } from '../../../data/unit.ts';
import { group, limb, mesh, rod, rot, scl, type Mat, type Model, type Parts } from './model_kit.ts';
import { box, cone, cyl, mat, sph } from './materials.ts';

const C = {
  hide: () => mat('#9a1e14', { rough: 0.75 }),
  darkHide: () => mat('#5a0e0a', { rough: 0.8 }),
  ash: () => mat('#2a1a18', { rough: 0.9 }),
  horn: () => mat('#1a1414', { rough: 0.4, metal: 0.2 }),
  claw: () => mat('#e8dcc0', { rough: 0.4 }),
  eye: () => mat('#ffd040', { rough: 0.3, emissive: '#ffb000', emissiveIntensity: 2.2 }),
  fire: () => mat('#ff7a20', { rough: 0.5, emissive: '#ff4a00', emissiveIntensity: 1.8 }),
  lava: () => mat('#ff5010', { rough: 0.6, emissive: '#e02800', emissiveIntensity: 1.2 }),
  iron: () => mat('#2a2626', { rough: 0.5, metal: 0.6 }),
};

/**
 * A demon's frame, `k` times the size of a man: goat-jointed legs (legL, legR), a barrel chest,
 * long arms (armL, armR), a horned head with burning eyes, and a whip of a tail. Returns the head height.
 */
function fiendFrame(root: THREE.Object3D, parts: Parts, k: number, skin: Mat, dark: Mat): number {
  for (const [name, s] of [['legL', -1], ['legR', 1]] as const) {
    const leg = group(0, 0.36 * k, s * 0.09 * k);
    leg.add(rot(mesh(box(0.1 * k, 0.2 * k, 0.1 * k), skin, 0.03 * k, -0.09 * k, 0), 0, 0, 0.35)); // thigh, angled forward
    leg.add(rot(mesh(box(0.07 * k, 0.2 * k, 0.07 * k), dark, 0.02 * k, -0.25 * k, 0), 0, 0, -0.4)); // shin, angled back
    leg.add(mesh(box(0.1 * k, 0.04 * k, 0.08 * k), C.horn(), 0.06 * k, -0.35 * k, 0)); // hoof
    parts[name] = leg;
    root.add(leg);
  }
  root.add(mesh(box(0.16 * k, 0.1 * k, 0.22 * k), dark, 0, 0.38 * k, 0)); // loins
  root.add(scl(mesh(sph(0.16 * k, 12, 8), skin, 0.02 * k, 0.55 * k, 0), 0.85, 1.15, 1.2)); // chest
  root.add(scl(mesh(sph(0.15 * k, 12, 8), skin, 0.03 * k, 0.68 * k, 0), 0.8, 0.75, 1.45)); // hunched shoulders
  for (const [name, s] of [['armL', -1], ['armR', 1]] as const) {
    const arm = limb(0.02 * k, 0.7 * k, s * 0.22 * k, 0.34 * k, 0.08 * k, skin);
    arm.add(mesh(sph(0.055 * k, 8, 6), dark, 0, -0.36 * k, 0));
    for (let i = -1; i <= 1; i++) arm.add(rot(mesh(cone(0.012 * k, 0.07 * k, 5), C.claw(), 0.03 * k, -0.41 * k, i * 0.025 * k), 0, 0, Math.PI));
    parts[name] = arm;
    root.add(arm);
  }
  const top = 0.8 * k, head = group(0.06 * k, top, 0);
  head.add(scl(mesh(sph(0.085 * k, 12, 8), skin, 0, 0.04 * k, 0), 1.15, 1, 0.95));
  head.add(mesh(box(0.08 * k, 0.05 * k, 0.09 * k), dark, 0.07 * k, 0.0, 0)); // jaw
  for (let i = -1; i <= 1; i += 2) {
    head.add(mesh(sph(0.016 * k, 6, 4), C.eye(), 0.085 * k, 0.06 * k, i * 0.035 * k));
    // horns sweeping up and back
    head.add(rod([0, 0.1 * k, i * 0.05 * k], [-0.04 * k, 0.2 * k, i * 0.11 * k], 0.022 * k, C.horn(), 6));
    head.add(rod([-0.04 * k, 0.2 * k, i * 0.11 * k], [-0.12 * k, 0.26 * k, i * 0.12 * k], 0.013 * k, C.horn(), 6));
    head.add(rot(mesh(cone(0.008 * k, 0.04 * k, 4), C.claw(), 0.1 * k, -0.02 * k, i * 0.025 * k), 0, 0, Math.PI)); // fangs
  }
  parts.head = head;
  root.add(head);
  // the tail, ending in a barb
  const tail = group(-0.1 * k, 0.4 * k, 0);
  tail.add(rod([0, 0, 0], [-0.22 * k, -0.15 * k, 0], 0.025 * k, skin, 6));
  tail.add(rod([-0.22 * k, -0.15 * k, 0], [-0.4 * k, -0.1 * k, 0.05 * k], 0.016 * k, skin, 6));
  tail.add(rot(mesh(cone(0.035 * k, 0.07 * k, 4), C.horn(), -0.43 * k, -0.09 * k, 0.05 * k), 0, 0, Math.PI / 2));
  parts.tail = tail;
  root.add(tail);
  return top;
}

/** A bat wing's leathery skin, seen from both sides. */
let wingSkin: THREE.MeshStandardMaterial | null = null;
const wingGeos = new Map<number, THREE.ShapeGeometry>();

/** A bat wing's outline, `span` long, scalloped between its finger bones; it lies in the y-z plane, reaching out along +z. */
function wingGeo(span: number): THREE.ShapeGeometry {
  let g = wingGeos.get(span);
  if (g) return g;
  const pts: [number, number][] = [[0, 0], [0.45, 0.32], [0.62, 0.1], [0.5, 0.0], [0.42, -0.06], [0.3, 0.0], [0.2, -0.1], [0.08, -0.06]];
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z * span, y * span)));
  g = new THREE.ShapeGeometry(sh).rotateY(-Math.PI / 2); // shape x → world z
  wingGeos.set(span, g);
  return g;
}

/** Bat wings on shoulder pivots (wingL, wingR). */
function batWings(root: THREE.Object3D, parts: Parts, k: number, y: number, span: number): void {
  wingSkin ??= new THREE.MeshStandardMaterial({ color: '#4a0e0c', roughness: 0.85, side: THREE.DoubleSide });
  const bone = C.darkHide();
  for (const [name, s] of [['wingL', -1], ['wingR', 1]] as const) {
    const w = group(-0.1 * k, y, s * 0.12 * k);
    const skin = mesh(wingGeo(span), wingSkin, 0, 0, 0);
    skin.scale.z = s;
    w.add(skin);
    for (const [z, yy] of [[0.45, 0.32], [0.62, 0.1], [0.42, -0.06], [0.2, -0.1]] as const) w.add(rod([0, 0, 0], [0, yy * span, s * z * span], 0.012 * k + 0.004, bone, 4));
    w.rotation.y = s * 0.35; // swept back
    parts[name] = w;
    root.add(w);
  }
}

function imp(): Model {
  const root = new THREE.Group(), parts: Parts = {}, k = 0.55;
  const top = fiendFrame(root, parts, k, C.hide(), C.darkHide());
  batWings(root, parts, k, 0.68 * k, 0.4);
  // a ball of fire cupped in its claw, which it spits
  const fire = mesh(sph(0.05, 8, 6), C.fire(), 0, -0.24, 0);
  parts.fire = fire;
  parts.armR.add(fire);
  parts.armR.rotation.z = 0.9;
  return { root, parts, height: top + 0.2 };
}

function fiend(): Model {
  const root = new THREE.Group(), parts: Parts = {}, k = 1.15;
  const top = fiendFrame(root, parts, k, C.hide(), C.ash());
  // cracks of lava down its chest, and iron cuffs on its wrists
  for (let i = 0; i < 3; i++) root.add(rot(mesh(box(0.012, 0.12, 0.012), C.lava(), 0.17 * k - i * 0.004, (0.5 + i * 0.05) * k, (i - 1) * 0.05 * k), 0.2 * (i - 1), 0, 0.15));
  for (const a of [parts.armL, parts.armR]) a.add(mesh(cyl(0.06 * k, 0.06 * k, 0.06 * k, 8), C.iron(), 0, -0.26 * k, 0));
  return { root, parts, height: top + 0.3 };
}

function archfiend(): Model {
  const root = new THREE.Group(), parts: Parts = {}, k = 2.9;
  const top = fiendFrame(root, parts, k, C.darkHide(), C.ash());
  batWings(root, parts, k, 0.7 * k, 1.6);
  // lava veins and a crown of fire between the horns
  for (let i = 0; i < 5; i++) root.add(rot(mesh(box(0.03, 0.3, 0.03), C.lava(), 0.15 * k, (0.48 + i * 0.04) * k, (i - 2) * 0.07 * k), 0.25 * (i - 2), 0, 0.15));
  const crown = group(0.02 * k, 0.13 * k, 0);
  for (let i = 0; i < 5; i++) crown.add(mesh(cone(0.025 * k, 0.09 * k, 5), C.fire(), 0, 0, (i - 2) * 0.03 * k));
  parts.head.add(crown);
  parts.crown = crown;
  // a great burning blade in its right hand
  const blade = group(0, -0.36 * k, 0,
    mesh(cyl(0.03, 0.03, 0.35, 6), C.iron(), 0, 0, 0),
    mesh(box(0.25, 0.05, 0.06), C.iron(), 0, 0.17, 0),
    mesh(box(0.09, 1.5, 0.16), C.fire(), 0, 0.95, 0),
    mesh(box(0.1, 1.55, 0.05), C.lava(), 0, 0.97, 0));
  parts.blade = blade;
  parts.armR.add(blade);
  parts.armR.rotation.z = 0.5;
  return { root, parts, height: top + 0.5 };
}

/** A demon's model, or null if the type isn't one. */
export function demonModel(type: UnitType): Model | null {
  switch (type) {
    case 'imp': return imp();
    case 'fiend': return fiend();
    case 'archfiend': return archfiend();
    default: return null;
  }
}

/** Walk, flap, swing and smoulder. `w` is the walk cycle in radians and `atk` 0..1 through a strike. */
export function animateDemon(m: Model, e: Ent, w: number, atk: number): void {
  const P = m.parts, t = G.gameT + e.id * 0.37;
  const stride = e.moving ? Math.sin(w) * 0.55 : 0;
  if (P.legL) P.legL.rotation.z = stride;
  if (P.legR) P.legR.rotation.z = -stride;
  if (P.tail) P.tail.rotation.y = Math.sin(t * 2.2) * 0.35;
  if (P.head) P.head.rotation.y = Math.sin(t * 0.9) * 0.2;
  if (P.wingL && P.wingR) {
    const flap = Math.sin(t * (e.type === 'imp' ? 9 : 2.5)) * (e.type === 'imp' ? 0.5 : 0.18);
    P.wingL.rotation.x = flap;
    P.wingR.rotation.x = -flap;
  }
  const swing = (rest: number, up: number, down: number) => (atk > 0 ? lerp(up, down, atk) : rest);
  switch (e.type) {
    case 'imp':
      // it hops as it scurries, and flings its fire overarm
      m.root.position.y += e.moving ? Math.abs(Math.sin(w * 1.3)) * 0.06 : Math.sin(t * 3) * 0.01;
      if (P.armR) P.armR.rotation.z = swing(0.9, 2.6, -0.4);
      if (P.armL) P.armL.rotation.z = e.moving ? -stride * 0.6 : 0.2;
      if (P.fire) { P.fire.visible = e.atkT <= 0; P.fire.scale.setScalar(0.85 + Math.sin(t * 11) * 0.15); }
      break;
    case 'fiend':
      // raking claws, one arm then the other
      if (P.armR) P.armR.rotation.z = swing(e.moving ? stride * 0.7 : 0.3, 2.2, -0.6);
      if (P.armL) P.armL.rotation.z = swing(e.moving ? -stride * 0.7 : 0.3, -0.3, 1.6);
      break;
    case 'archfiend':
      // a slow, heavy overhead cleave
      if (P.armR) P.armR.rotation.z = swing(0.5, 2.8, -0.5);
      if (P.armL) P.armL.rotation.z = e.moving ? -stride * 0.5 : 0.25;
      if (P.crown) P.crown.scale.y = 0.85 + Math.sin(t * 7) * 0.15;
      if (P.blade) P.blade.children[2].scale.x = 0.9 + Math.sin(t * 13) * 0.1;
      break;
  }
}
