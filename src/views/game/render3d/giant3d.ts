// The Titan (data/unit.ts `giant`): a bare-chested giant woken with Aether, several times the height of
// anything else on the field, towering over buildings and the Cyborg Colossus. It swings a huge club
// in a wide sideways sweep. It faces +x like every unit. The model is drawn one unit tall inside a
// `body` group scaled up to TITAN_HEIGHT tiles (the root's own scale is set by entities3d). Named
// parts are animated by animateGiant below.
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import { clamp, lerp } from '../../../util/math.ts';
import { WEAPON } from '../../../data/weapon.ts';
import { group, limb, mesh, rot, scl, type Model, type Parts } from './model_kit.ts';
import { box, cone, cyl, dodeca, octa, teamMat, mat } from './materials.ts';
import { ball, cap } from './shapes.ts';

/** How tall the Titan stands, in tiles, before the shared unit scale. */
const TITAN_HEIGHT = 7;

const C = {
  skin: () => mat('#c08860', { rough: 0.62 }),
  shade: () => mat('#9c6a48', { rough: 0.7 }), // the deeper skin between muscles
  hair: () => mat('#2a1a10', { rough: 0.9 }),
  leather: () => mat('#5a3a1e', { rough: 0.85 }),
  fur: () => mat('#7a6650', { rough: 1, flat: true }),
  bronze: () => mat('#a8743a', { rough: 0.38, metal: 0.8, tex: 'metal' }),
  wood: () => mat('#5e3c20', { rough: 0.9, tex: 'wood' }),
  stone: () => mat('#8a847a', { rough: 0.95, flat: true }),
  vein: () => mat('#e0c0ff', { rough: 0.2, emissive: '#a050ff', emissiveIntensity: 2.4 }),
  eye: () => mat('#f4e8ff', { rough: 0.2, emissive: '#c070ff', emissiveIntensity: 3 }),
};

/** A bare, muscled leg on a hip pivot with a knee pivot below it (legL/kneeL, legR/kneeR). */
function leg(root: THREE.Object3D, parts: Parts, side: -1 | 1): void {
  const skin = C.skin(), leather = C.leather();
  const hip = limb(0, 0.46, side * 0.08, 0.22, 0.1, skin);
  hip.add(scl(mesh(ball(0.065), skin, 0.02, -0.09, 0), 1, 1.5, 1)); // a thick thigh
  const knee = group(0, -0.22, 0);
  knee.add(mesh(ball(0.05), skin, 0, 0, 0));
  knee.add(mesh(box(0.075, 0.2, 0.075), skin, 0, -0.1, 0));
  knee.add(scl(mesh(ball(0.045), skin, -0.02, -0.06, 0), 1, 1.6, 1)); // calf
  knee.add(mesh(cyl(0.05, 0.048, 0.09, 8), C.fur(), 0, -0.17, 0)); // fur wrapped round the shin
  for (const y of [-0.14, -0.2]) knee.add(mesh(cyl(0.052, 0.052, 0.008, 8), leather, 0, y, 0)); // thongs binding it
  knee.add(mesh(box(0.13, 0.035, 0.085), leather, 0.025, -0.225, 0)); // a big sandalled foot
  hip.add(knee);
  parts[side < 0 ? 'legL' : 'legR'] = hip;
  parts[side < 0 ? 'kneeL' : 'kneeR'] = knee;
  root.add(hip);
}

/** The club: an oak trunk banded with bronze and studded with stones, held at the thin end. */
function club(): THREE.Group {
  const wood = C.wood(), bronze = C.bronze(), stone = C.stone(), g = group(0, -0.3, 0);
  g.add(mesh(cyl(0.022, 0.024, 0.14, 8), C.leather(), 0, -0.02, 0)); // the grip, wrapped in hide
  g.add(mesh(cyl(0.026, 0.06, 0.38, 10), wood, 0, -0.27, 0)); // the trunk, swelling toward the head
  g.add(mesh(dodeca(0.07), wood, 0, -0.47, 0)); // the knotted end
  for (const y of [-0.16, -0.36]) g.add(mesh(cyl(y < -0.2 ? 0.058 : 0.042, y < -0.2 ? 0.058 : 0.042, 0.025, 10), bronze, 0, y, 0));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, y = -0.3 - (i % 3) * 0.06;
    g.add(mesh(dodeca(0.022), stone, Math.cos(a) * 0.058, y, Math.sin(a) * 0.058)); // stones driven into the wood
  }
  g.add(mesh(octa(0.02), C.vein(), 0.05, -0.44, 0)); // an Aether shard set in its head
  return g;
}

function titan(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, body = group(0, 0, 0), team1 = teamMat(team), vein = C.vein();
  const skin = C.skin(), shade = C.shade(), leather = C.leather();
  body.scale.setScalar(TITAN_HEIGHT);
  for (const s of [-1, 1] as const) leg(body, parts, s);
  // a wide hide belt with a bronze boss, and a kilt of hanging strips in the side's colour
  body.add(mesh(cyl(0.118, 0.13, 0.05, 14), leather, 0, 0.48, 0));
  body.add(rot(mesh(cyl(0.035, 0.035, 0.012, 12), C.bronze(), 0.125, 0.48, 0), 0, 0, Math.PI / 2));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    body.add(rot(mesh(box(0.04, 0.12, 0.012), i % 2 ? team1 : C.fur(), Math.cos(a) * 0.122, 0.41, Math.sin(a) * 0.122), 0, -a, 0));
  }
  // the bare torso twists and leans as a unit, so it's its own group
  const chest = group(0, 0.5, 0);
  chest.add(scl(mesh(ball(0.1), skin, 0, 0.06, 0), 0.75, 1, 1.15)); // waist
  chest.add(scl(mesh(ball(0.14), skin, -0.01, 0.2, 0), 0.75, 0.95, 1.5)); // a broad back and ribs
  for (const s of [-1, 1]) {
    chest.add(scl(mesh(ball(0.06), skin, 0.07, 0.25, s * 0.06), 0.55, 0.8, 1.1)); // pecs
    chest.add(scl(mesh(ball(0.07), skin, -0.02, 0.29, s * 0.1), 1, 0.7, 1)); // traps rising to the neck
    for (let r = 0; r < 3; r++) chest.add(mesh(box(0.02, 0.032, 0.036), shade, 0.07, 0.07 + r * 0.045, s * 0.022)); // abs
    chest.add(scl(mesh(ball(0.05), skin, 0.075, 0.07 + 0.045, s * 0.022), 0.3, 1.2, 0.8));
  }
  // the Aether that woke it glows through the skin: a heart, and veins out from it
  chest.add(mesh(octa(0.022), vein, 0.1, 0.23, 0));
  for (const s of [-1, 1]) chest.add(rot(mesh(box(0.006, 0.14, 0.008), vein, 0.095, 0.17, s * 0.045), s * 0.5, 0, 0));
  // arms: huge bare shoulders, biceps and forearms, a bronze cuff at each wrist, a fist at the end
  for (const [name, s] of [['armL', -1], ['armR', 1]] as const) {
    chest.add(scl(mesh(ball(0.07), skin, 0, 0.3, s * 0.19), 1, 0.9, 1)); // deltoid
    const arm = limb(0, 0.3, s * 0.21, 0.3, 0.075, skin);
    arm.add(scl(mesh(ball(0.055), skin, 0.02, -0.08, 0), 1, 1.5, 1)); // bicep
    arm.add(scl(mesh(ball(0.05), skin, 0.01, -0.2, 0), 1, 1.4, 1)); // forearm
    arm.add(mesh(cyl(0.048, 0.048, 0.05, 10), C.bronze(), 0, -0.25, 0)); // cuff
    arm.add(mesh(box(0.008, 0.12, 0.008), vein, 0.04, -0.14, 0));
    arm.add(mesh(ball(0.052), skin, 0, -0.31, 0)); // fist
    if (name === 'armR') arm.rotation.order = 'YXZ'; // lift it out to the side, then sweep it round
    parts[name] = arm;
    chest.add(arm);
  }
  const weapon = club();
  parts.club = weapon;
  parts.armR.add(weapon);
  // head: a shaggy mane, a beard, a headband in the side's colour and burning eyes
  const head = group(0.01, 0.38, 0);
  head.add(mesh(cyl(0.05, 0.065, 0.06, 10), skin, 0, -0.02, 0)); // a bull neck
  head.add(scl(mesh(ball(0.062), skin, 0, 0.04, 0), 1, 1.1, 0.95));
  head.add(scl(mesh(cap(0.07), C.hair(), -0.01, 0.045, 0), 1.05, 1.1, 1.05)); // hair
  head.add(scl(mesh(ball(0.06), C.hair(), -0.045, 0.0, 0), 0.8, 1.3, 1.1)); // mane down the back
  head.add(rot(mesh(cone(0.045, 0.09, 8), C.hair(), 0.045, -0.025, 0), 0, 0, Math.PI * 0.92)); // beard
  head.add(mesh(cyl(0.068, 0.068, 0.018, 14), team1, 0, 0.06, 0)); // headband
  head.add(mesh(box(0.014, 0.024, 0.06), C.shade(), 0.058, 0.055, 0)); // heavy brow
  for (const s of [-1, 1]) head.add(mesh(ball(0.011), C.eye(), 0.058, 0.04, s * 0.022));
  parts.head = head;
  chest.add(head);
  // a faint crown of Aether motes circling the head
  const halo = group(0.01, 0.5, 0);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; halo.add(mesh(octa(0.012), vein, Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11)); }
  parts.halo = halo;
  chest.add(halo);
  parts.chest = chest;
  body.add(chest);
  root.add(body);
  return { root, parts, height: TITAN_HEIGHT * 1.0 };
}

/** The Titan's model. */
export function giantModel(team: number): Model {
  return titan(team);
}

const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const SWING = WEAPON.quake.swing ?? 1;

/**
 * A slow, ground-shaking stride, and a wide sideways swing of the club. `w` is the walk cycle in
 * radians. The swing runs over the weapon's whole `swing` time (not the shared 0.25 s attack flash):
 * wind up with the club drawn back behind it, sweep it round in front low over the ground (the blow
 * lands halfway, see landBlow), and follow through. Runs after the shared unit animation, so it
 * overrides the legs and arms it sets.
 */
export function animateGiant(m: Model, e: Ent, w: number, _atk: number): void {
  const P = m.parts, t = G.gameT + e.id * 0.9;
  const g = w * 0.4, s = e.moving ? Math.sin(g) * 0.4 : 0;
  const p = e.atkT > 0 ? 1 - Math.min(1, e.atkT / SWING) : 0; // 0..1 through the swing
  if (P.legL && P.legR && P.kneeL && P.kneeR) {
    // planted wide while it swings
    P.legL.rotation.z = p > 0 ? 0.15 : s;
    P.legR.rotation.z = p > 0 ? -0.2 : -s;
    P.legL.rotation.x = p > 0 ? 0.12 : 0;
    P.legR.rotation.x = p > 0 ? -0.12 : 0;
    P.kneeL.rotation.z = p > 0 ? -0.25 : e.moving ? -Math.max(0, Math.sin(g + 1.2)) * 0.55 : 0;
    P.kneeR.rotation.z = p > 0 ? -0.2 : e.moving ? -Math.max(0, -Math.sin(g + 1.2)) * 0.55 : 0;
  }
  // each footfall drops the whole body a little; a swing crouches into it
  m.root.position.y = p > 0 ? -0.08 * Math.sin(p * Math.PI) : e.moving ? -Math.abs(Math.cos(g)) * 0.06 : 0;
  const A = P.armR, L = P.armL, ch = P.chest;
  if (p > 0) {
    // wind up (0..0.38): drawn back behind the shoulder; sweep (0.38..0.62): round in front; follow through and recover
    const wind = smooth(p / 0.38), sweep = smooth((p - 0.38) / 0.24), back = smooth((p - 0.7) / 0.3);
    const yaw = lerp(lerp(lerp(0, -1.1, wind), 2.5, sweep), 0, back);
    const lift = lerp(lerp(lerp(0.15, 1.05, wind), 0.8, sweep), 0.15, back);
    if (A) { A.rotation.y = yaw; A.rotation.x = -lift; A.rotation.z = 0; }
    if (L) { L.rotation.z = lerp(0.3, -0.4, sweep) * (1 - back); L.rotation.x = 0.4 * (1 - back); }
    if (ch) { ch.rotation.y = lerp(lerp(0, -0.45, wind), 0.55, sweep) * (1 - back); ch.rotation.z = -0.15 * Math.sin(p * Math.PI); }
  } else {
    if (A) { A.rotation.y = 0; A.rotation.x = -0.15; A.rotation.z = e.moving ? 0.3 - s * 0.3 : 0.35; }
    if (L) { L.rotation.x = 0; L.rotation.z = e.moving ? s * 0.5 : 0.1; }
    if (ch) { ch.rotation.y = 0; ch.rotation.z = 0; }
  }
  if (P.head) P.head.rotation.y = (ch ? -ch.rotation.y * 0.6 : 0) + Math.sin(t * 0.4) * 0.12;
  if (P.halo) P.halo.rotation.y = t * 0.8;
}
