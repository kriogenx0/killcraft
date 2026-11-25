// The Titan Chicken (data/unit.ts `chicken`), a barn-sized chicken that sometimes hatches from a Mystery
// Egg, and the Mystery Egg itself (seen only in the sidebar). The chicken faces +x like every unit and
// is drawn one unit tall inside a `body` group scaled up to CHICKEN_HEIGHT tiles. Named parts are
// animated by animateChicken below.
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import { lerp } from '../../../util/math.ts';
import { group, mesh, rot, scl, type Model, type Parts } from './model_kit.ts';
import { M, box, cone, cyl, octa, teamMat, mat } from './materials.ts';
import { ball, turned } from './shapes.ts';

/** How tall the Titan Chicken stands, in tiles, before the shared unit scale. */
const CHICKEN_HEIGHT = 3;

const C = {
  feather: () => mat('#f4f0e6', { rough: 0.95 }),
  shade: () => mat('#d8d0c0', { rough: 0.95 }),
  leg: () => mat('#e8a830', { rough: 0.6 }),
  beak: () => mat('#f0b030', { rough: 0.45 }),
  comb: () => mat('#d42828', { rough: 0.6 }),
  eye: () => mat('#141414', { rough: 0.2 }),
  shine: () => mat('#ffffff', { rough: 0.1, emissive: '#ffffff', emissiveIntensity: 0.6 }),
};

/** A scaly leg on a hip pivot with a knee pivot below it, ending in three toes and a spur. */
function leg(root: THREE.Object3D, parts: Parts, side: -1 | 1): void {
  const yellow = C.leg(), hip = group(0, 0.36, side * 0.09);
  hip.add(scl(mesh(ball(0.07), C.shade(), 0, -0.02, 0), 1, 1.3, 1)); // a feathered drumstick
  const knee = group(0, -0.14, 0);
  knee.add(mesh(cyl(0.018, 0.016, 0.2, 8), yellow, 0, -0.1, 0));
  for (const a of [-0.55, 0, 0.55]) knee.add(rot(mesh(box(0.11, 0.014, 0.022), yellow, Math.cos(a) * 0.05, -0.2, Math.sin(a) * 0.05), 0, -a, 0)); // toes
  knee.add(mesh(box(0.05, 0.014, 0.02), yellow, -0.03, -0.2, 0)); // the back toe
  hip.add(knee);
  parts[side < 0 ? 'legL' : 'legR'] = hip;
  parts[side < 0 ? 'kneeL' : 'kneeR'] = knee;
  root.add(hip);
}

function chicken(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, body = group(0, 0, 0), white = C.feather(), shade = C.shade(), team1 = teamMat(team);
  body.scale.setScalar(CHICKEN_HEIGHT);
  for (const s of [-1, 1] as const) leg(body, parts, s);
  // the plump body, rocking as a unit with the neck and wings on it
  const torso = group(0, 0.5, 0);
  torso.add(scl(mesh(ball(0.2), white, 0, 0, 0), 1.35, 1, 1.05));
  torso.add(scl(mesh(ball(0.14), shade, 0.04, -0.09, 0), 1.3, 0.7, 1)); // the fluffy underside
  // a fan of tail feathers sweeping up behind
  for (let i = 0; i < 5; i++) {
    const a = -0.5 + i * 0.25;
    torso.add(rot(scl(mesh(ball(0.08), i % 2 ? shade : white, -0.25, 0.13, a * 0.18), 0.6, 1.6, 0.35), a * 0.5, 0, 0.5));
  }
  // wings on shoulder pivots, so they can flap
  for (const [name, s] of [['wingL', -1], ['wingR', 1]] as const) {
    const w = group(0.04, 0.06, s * 0.2);
    w.add(scl(mesh(ball(0.13), shade, -0.06, -0.03, 0), 1.4, 0.75, 0.25));
    for (let i = 0; i < 3; i++) w.add(rot(scl(mesh(ball(0.05), white, -0.2 - i * 0.03, -0.04 - i * 0.03, 0), 1.6, 0.5, 0.25), 0, 0, 0.3));
    parts[name] = w;
    torso.add(w);
  }
  // a war banner in the side's colour, tied round the middle like a saddle cloth
  torso.add(scl(mesh(cyl(0.205, 0.205, 0.07, 18), team1, 0, 0.01, 0), 1.33, 1, 1.03));
  // the neck and head, on a pivot at the shoulders so it can bob and peck
  const neck = group(0.2, 0.08, 0);
  neck.add(rot(scl(mesh(ball(0.09), white, 0.04, 0.1, 0), 1, 1.6, 1), 0, 0, -0.35));
  neck.add(scl(mesh(cyl(0.1, 0.1, 0.04, 14), team1, 0.03, 0.05, 0), 1, 1, 1)); // a collar in the side's colour
  const head = group(0.09, 0.25, 0);
  head.add(mesh(ball(0.085), white, 0, 0, 0));
  head.add(rot(mesh(cone(0.032, 0.1, 10), C.beak(), 0.11, -0.01, 0), 0, 0, -Math.PI / 2)); // beak, pointing forward
  head.add(mesh(box(0.07, 0.008, 0.05), C.beak(), 0.1, -0.022, 0)); // the beak's split
  for (let i = 0; i < 4; i++) head.add(mesh(ball(0.03), C.comb(), 0.04 - i * 0.03, 0.085 + (i === 1 || i === 2 ? 0.015 : 0), 0)); // comb
  head.add(scl(mesh(ball(0.03), C.comb(), 0.08, -0.07, 0), 0.7, 1.3, 0.8)); // wattle
  for (const s of [-1, 1]) {
    head.add(mesh(ball(0.018), C.eye(), 0.04, 0.02, s * 0.075));
    head.add(mesh(ball(0.006), C.shine(), 0.048, 0.028, s * 0.088));
  }
  parts.head = head;
  neck.add(head);
  parts.neck = neck;
  torso.add(neck);
  parts.torso = torso;
  body.add(torso);
  root.add(body);
  return { root, parts, height: CHICKEN_HEIGHT * 0.95 };
}

/** The Mystery Egg, for the sidebar: a speckled egg glowing with Aether in a straw nest. */
function egg(): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const straw = mat('#c8a050', { rough: 1, flat: true }), dark = mat('#8a6a30', { rough: 1, flat: true });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    root.add(rot(mesh(box(0.2, 0.03, 0.03), i % 2 ? straw : dark, Math.cos(a) * 0.17, 0.05, Math.sin(a) * 0.17), 0.3, -a + 1.2, 0.25));
  }
  root.add(scl(mesh(ball(0.2), dark, 0, 0.02, 0), 1, 0.2, 1));
  const shell = mat('#e8dcff', { rough: 0.35, emissive: '#9a50ff', emissiveIntensity: 0.55 });
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12, y = t * 0.42; pts.push([Math.max(0.001, Math.sin(Math.PI * t) * 0.15 * (1 - t * 0.28)), y]); }
  const e = mesh(turned(pts, 18), shell, 0, 0.04, 0);
  root.add(e);
  // violet speckles, and a crack with light pouring out
  const speck = mat('#7a3ad0', { rough: 0.5 }), glow = M.aether();
  for (let i = 0; i < 9; i++) { const a = i * 2.4, y = 0.1 + (i % 4) * 0.07; root.add(mesh(ball(0.016), speck, Math.cos(a) * 0.14, 0.04 + y, Math.sin(a) * 0.14)); }
  for (let i = 0; i < 4; i++) root.add(rot(mesh(box(0.012, 0.06, 0.01), glow, 0.13, 0.28 + (i % 2) * 0.02, -0.06 + i * 0.04), 0.3, 0, i % 2 ? 0.6 : -0.6));
  const star = mesh(octa(0.05), glow, 0, 0.6, 0);
  star.scale.set(0.7, 1.4, 0.7);
  root.add(star);
  parts.star = star;
  return { root, parts, height: 0.66 };
}

/** The Titan Chicken's model, or the Mystery Egg's. */
export function chickenModel(team: number, isEgg = false): Model {
  return isEgg ? egg() : chicken(team);
}

/**
 * A strutting walk with the head jerking back and forth, wings that flap when it hurries, and a peck
 * that swings the whole neck down at the foe. `w` is the walk cycle in radians and `atk` 0..1 through
 * a strike. Runs after the shared unit animation, so it overrides what that sets.
 */
export function animateChicken(m: Model, e: Ent, w: number, atk: number): void {
  const P = m.parts, t = G.gameT + e.id * 0.7;
  const g = w * 0.8, s = e.moving ? Math.sin(g) * 0.55 : 0;
  if (P.legL && P.legR && P.kneeL && P.kneeR) {
    P.legL.rotation.z = s;
    P.legR.rotation.z = -s;
    P.kneeL.rotation.z = e.moving ? -Math.max(0, Math.sin(g + 1.2)) * 0.7 : 0;
    P.kneeR.rotation.z = e.moving ? -Math.max(0, -Math.sin(g + 1.2)) * 0.7 : 0;
  }
  m.root.position.y = e.moving ? Math.abs(Math.sin(g)) * 0.05 : 0;
  if (P.torso) { P.torso.rotation.x = e.moving ? Math.sin(g) * 0.08 : 0; P.torso.rotation.z = atk > 0 ? -Math.sin(atk * Math.PI) * 0.25 : 0; }
  // the peck: rear back, then stab the beak down into the foe; otherwise the head bobs as it walks
  if (P.neck) P.neck.rotation.z = atk > 0 ? (atk < 0.35 ? lerp(0, 0.5, atk / 0.35) : lerp(0.5, -1.25, Math.min(1, (atk - 0.35) / 0.3))) : e.moving ? Math.sin(g * 2) * 0.18 : Math.sin(t * 1.3) * 0.06;
  if (P.head) P.head.rotation.y = e.moving || atk > 0 ? 0 : Math.round(Math.sin(t * 0.9) * 2) * 0.35; // idle: jerky glances left and right
  const flap = e.moving ? Math.max(0, Math.sin(t * 9)) * 0.7 : atk > 0 ? Math.sin(atk * Math.PI) * 0.9 : 0;
  if (P.wingL) P.wingL.rotation.x = -flap;
  if (P.wingR) P.wingR.rotation.x = flap;
}
