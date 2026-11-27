// Procedural 3D models for every unit, building and ore rock. Units face +x; buildings face +z
// (doors toward the default camera). Sizes are in tiles. Named parts are animated by entities3d.ts.
//
// Models are built from many small primitives for detail, then baked: inside each group, the meshes
// that never move on their own are merged into one mesh per material. Each type and team is built
// and baked once, and every entity gets a cheap clone that shares the merged buffers, so a detailed
// tank costs about a dozen draw calls no matter how many bolts it has.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { isAetherBld, type AetherBld, type BldType } from '../../../data/building.ts';
import { aetherBuilding } from './aether3d.ts';
import { across, along, group, mesh, rod, rot, scl, type Mat, type Model, type Parts } from './model_kit.ts';
import { infirmary, medievalBuilding, smithy } from './medieval.ts';
import { bertha, missileTurret, pillbox, wallModel } from './defenses.ts';
import { airfield, balloon, biplane, drone, fighter, flak, helicopter, striker } from './aircraft.ts';
import { creatureModel } from './creatures3d.ts';
import { demonModel } from './demons3d.ts';
import { arcaneModel } from './arcane3d.ts';
import { giantModel } from './giant3d.ts';
import { chickenModel } from './chicken3d.ts';
import { mageTower } from './magetower3d.ts';
import { ball, cap, gem, loft, loftX, slab, taper, turned } from './shapes.ts';
import { M, box, cone, cyl, dodeca, dome, lathe, mat, octa, prism, sph, teamMat, torus } from './materials.ts';

export type { Model } from './model_kit.ts';

// ---------------------------------------------------------------- baking

const templates = new Map<string, Model>();

/** Build a model once per key, bake it, and hand out clones that share its geometry. */
function cached(key: string, make: () => Model): Model {
  let t = templates.get(key);
  if (!t) { t = make(); bake(t); templates.set(key, t); }
  const root = t.root.clone();
  const parts: Parts = {};
  for (const name of Object.keys(t.parts)) {
    const p = root.getObjectByName(name);
    if (p) parts[name] = p;
  }
  return { root, parts, height: t.height };
}

const ATTRS = ['position', 'normal', 'uv'];

/**
 * Baked geometry, by content: the same part of a model built for another team (or another model)
 * comes out the same, and sharing it lets them all be drawn together (instancer.ts).
 */
const bakedGeos = new Map<string, THREE.BufferGeometry>();
function shared(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let h = 2166136261;
  for (const a of ATTRS) {
    const arr = g.getAttribute(a)?.array as Float32Array | undefined;
    if (!arr) continue;
    const words = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 16777619);
  }
  const key = `${(h >>> 0).toString(36)}|${g.getAttribute('position').count}`;
  const had = bakedGeos.get(key);
  if (had && sameData(had, g)) { g.dispose(); return had; }
  if (!had) bakedGeos.set(key, g);
  return g;
}
function sameData(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  return ATTRS.every((n) => {
    const x = a.getAttribute(n)?.array, y = b.getAttribute(n)?.array;
    if (!x || !y) return x === y;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  });
}

/** Merge the static meshes directly under each group into one mesh per material. */
function bake(m: Model): void {
  const keep = new Set<THREE.Object3D>();
  for (const [name, p] of Object.entries(m.parts)) { p.name = name; keep.add(p); }
  const groups: THREE.Object3D[] = [];
  m.root.traverse((o) => { if (!(o instanceof THREE.Mesh)) groups.push(o); });
  for (const g of groups) {
    const byMat = new Map<Mat, THREE.Mesh[]>();
    for (const c of g.children) {
      if (!(c instanceof THREE.Mesh) || keep.has(c) || c.children.length) continue;
      const list = byMat.get(c.material as Mat) ?? [];
      list.push(c);
      byMat.set(c.material as Mat, list);
    }
    for (const [material, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((me) => {
        me.updateMatrix();
        const src = me.geometry.index ? me.geometry.toNonIndexed() : me.geometry.clone();
        const out = new THREE.BufferGeometry();
        for (const a of ATTRS) {
          const attr = src.getAttribute(a);
          out.setAttribute(a, attr ?? new THREE.Float32BufferAttribute(new Float32Array(src.getAttribute('position').count * (a === 'uv' ? 2 : 3)), a === 'uv' ? 2 : 3));
        }
        return out.applyMatrix4(me.matrix);
      });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      g.remove(...list);
      g.add(mesh(shared(merged), material));
    }
  }
}

// ---------------------------------------------------------------- infantry

interface SoldierLook { torso: Mat; legs: Mat; arms: Mat; boots: Mat; hands?: Mat }

/** The soldier's torso, hips to neck: [height, depth (x), width (z)]. Chest out, waist in. */
const TORSO: [number, number, number][] = [
  [0.19, 0.11, 0.155], [0.235, 0.1, 0.148], [0.3, 0.124, 0.18], [0.37, 0.13, 0.2], [0.405, 0.112, 0.19], [0.428, 0.06, 0.1],
];
function torsoAt(y: number): [number, number] {
  for (let i = 1; i < TORSO.length; i++) {
    const [y1, x1, z1] = TORSO[i], [y0, x0, z0] = TORSO[i - 1];
    if (y <= y1 || i === TORSO.length - 1) {
      const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
      return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
    }
  }
  return [TORSO[0][1], TORSO[0][2]];
}
/** A layer worn over the torso from y0 to y1, `out` thick: vests, tabards, belts, sashes. */
function shell(y0: number, y1: number, out: number): THREE.BufferGeometry {
  const ys = [y0, ...TORSO.map(([y]) => y).filter((y) => y > y0 && y < y1), y1];
  return loft(ys.map((y) => { const [x, z] = torsoAt(y); return [+y.toFixed(4), +(x + out * 2).toFixed(4), +(z + out * 2).toFixed(4)]; }), 8, 2.6);
}
/** How far the front of the torso (or a layer `out` thick on it) stands at height y. */
const chest = (y: number, out = 0) => +(torsoAt(y)[0] / 2 + out).toFixed(4);
/** A skirt flaring from the waist down to y0. */
const skirt = (y0: number, y1: number, flare: number, out = 0.006) => {
  const [x, z] = torsoAt(y1);
  return loft([[y0, x + flare * 0.8, z + flare], [y1, x + out * 2, z + out * 2]], 8, 2.6);
};

/** A soldier about 0.62 tall: legs and arms swing from hip and shoulder pivots. */
function soldier(look: SoldierLook): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const hands = look.hands ?? M.skin();
  for (const [name, side] of [['legL', -1], ['legR', 1]] as const) {
    const leg = group(0, 0.21, side * 0.05, mesh(taper(0.18, 0.078, 0.056, 6, 1.05), look.legs));
    // a boot with a toe, a heel and a turned-down cuff
    leg.add(mesh(slab([[-0.036, -0.222], [0.06, -0.222], [0.078, -0.21], [0.07, -0.196], [0.03, -0.184], [0.032, -0.15], [-0.034, -0.15]], 0.072, 0.008), look.boots));
    parts[name] = leg;
    root.add(leg);
  }
  root.add(mesh(loft(TORSO, 8, 2.6), look.torso));
  root.add(mesh(shell(0.222, 0.25, 0.006), M.leather())); // belt
  root.add(mesh(box(0.01, 0.024, 0.03), M.brass(), chest(0.236, 0.009), 0.236, 0)); // buckle
  root.add(mesh(loft([[0.41, 0.05, 0.05], [0.44, 0.045, 0.045]], 6), M.skin(), 0.004, 0, 0)); // neck
  root.add(mesh(loft([[0.425, 0.05, 0.05, 0.012], [0.445, 0.096, 0.086, 0.008], [0.47, 0.118, 0.11], [0.5, 0.118, 0.112, -0.004], [0.522, 0.092, 0.092, -0.006], [0.533, 0.04, 0.04, -0.006]], 8), M.skin()));
  root.add(mesh(slab([[0, 0.012], [0.018, -0.01], [0, -0.014]], 0.018), M.skin(), 0.056, 0.478, 0)); // nose
  for (const z of [-0.022, 0.022]) root.add(mesh(box(0.008, 0.01, 0.012), M.dark(), 0.057, 0.486, z)); // eyes
  for (const [name, side] of [['armL', -1], ['armR', 1]] as const) {
    const arm = group(0, 0.39, side * 0.12, mesh(taper(0.16, 0.06, 0.044, 6), look.arms));
    arm.add(mesh(gem(0.04, 1, 0.8, 1), look.arms, 0, 0.004, 0)); // shoulder
    arm.add(mesh(gem(0.03, 1, 1.15, 0.9), hands, 0, -0.175, 0));
    parts[name] = arm;
    root.add(arm);
  }
  return { root, parts, height: 0.62 };
}

/** A kite shield's outline, [z, y], point down. */
const KITE: [number, number][] = [[0, -0.2], [0.095, -0.03], [0.095, 0.1], [0.07, 0.125], [-0.07, 0.125], [-0.095, 0.1], [-0.095, -0.03]];

/** A heater shield's outline, [z, y]. */
const HEATER: [number, number][] = [[0, -0.12], [0.06, -0.06], [0.08, 0.02], [0.08, 0.1], [-0.08, 0.1], [-0.08, 0.02], [-0.06, -0.06]];

/** A rounded shoulder plate. */
const pauldron = () => turned([[0, 0], [0.062, 0], [0.058, 0.022], [0.04, 0.038], [0, 0.044]], 7);

/** An army helmet with a brim, crown at y + 0.08. */
function helmet(root: THREE.Object3D, m: Mat, y = 0.485): void {
  root.add(mesh(turned([[0, 0], [0.09, 0], [0.09, 0.008], [0.076, 0.014], [0.074, 0.04], [0.06, 0.064], [0.034, 0.077], [0, 0.081]], 10), m, -0.004, y, 0));
  root.add(mesh(box(0.01, 0.06, 0.13), M.leather(), 0.01, y - 0.03, 0)); // chin strap
}

function rifleman(team: number): Model {
  const m = soldier({ torso: M.olive(), legs: M.olive(), arms: M.olive(), boots: M.rubber() });
  m.root.add(mesh(shell(0.295, 0.39, 0.008), teamMat(team))); // vest
  for (const z of [-0.05, 0.05]) m.root.add(mesh(box(0.024, 0.05, 0.045), M.khaki(), chest(0.33, 0.016), 0.33, z)); // chest pouches
  for (const z of [-0.055, 0, 0.055]) m.root.add(mesh(box(0.022, 0.035, 0.04), M.leather(), chest(0.245, 0.014), 0.25, z)); // belt pouches
  helmet(m.root, teamMat(team, 'd'));
  // pack with a bedroll
  m.root.add(mesh(box(0.07, 0.13, 0.15), mat('#565a3a'), -0.1, 0.33, 0));
  m.root.add(across(mesh(cyl(0.03, 0.03, 0.17, 8), M.khaki(), -0.1, 0.415, 0)));
  m.root.add(mesh(box(0.02, 0.06, 0.04), M.leather(), -0.07, 0.24, -0.08)); // canteen
  m.parts.armL.rotation.z = m.parts.armR.rotation.z = 1.25; // both hands on the rifle
  const gun = group(0.17, 0.35, 0.05,
    mesh(box(0.11, 0.05, 0.03), M.wood(), -0.135, -0.01, 0), // stock
    mesh(box(0.12, 0.04, 0.034), M.gun(), -0.03, 0, 0), // receiver
    mesh(box(0.14, 0.032, 0.036), M.wood(), 0.09, 0, 0), // handguard
    along(mesh(cyl(0.009, 0.009, 0.12, 6), M.gun(), 0.21, 0.005, 0)), // barrel
    mesh(box(0.028, 0.06, 0.02), M.gun(), -0.01, -0.045, 0), // magazine
    mesh(box(0.05, 0.015, 0.012), M.gun(), -0.03, 0.026, 0), // sight
    mesh(box(0.01, 0.02, 0.008), M.gun(), 0.26, 0.018, 0)); // front sight
  m.parts.gun = gun;
  m.root.add(gun);
  return m;
}

/** Industrial: a machine gunner in a peaked cap with an ammo belt, a belt-fed gun and its bipod. */
function gunner(team: number): Model {
  const m = soldier({ torso: M.khaki(), legs: M.olive(), arms: M.khaki(), boots: M.leather() });
  m.root.add(mesh(shell(0.295, 0.39, 0.008), teamMat(team))); // tunic front
  helmet(m.root, teamMat(team, 'd'));
  // bandolier across the chest and an ammo box on the back
  m.root.add(rot(mesh(box(0.012, 0.2, 0.035), M.brass(), chest(0.34, 0.012), 0.34, 0), 0.7, 0, 0));
  m.root.add(mesh(box(0.08, 0.1, 0.12), M.olive(), -0.1, 0.33, 0));
  m.parts.armL.rotation.z = m.parts.armR.rotation.z = 1.3;
  const gun = group(0.15, 0.33, 0.05,
    mesh(box(0.1, 0.05, 0.03), M.wood(), -0.13, -0.01, 0), // stock
    mesh(box(0.14, 0.06, 0.045), M.gun(), 0, 0, 0), // receiver
    along(mesh(cyl(0.024, 0.024, 0.2, 10), M.darkSteel(), 0.16, 0.005, 0)), // cooling jacket
    along(mesh(cyl(0.008, 0.008, 0.06, 6), M.gun(), 0.29, 0.005, 0)), // muzzle
    mesh(box(0.04, 0.05, 0.05), M.olive(), 0, -0.05, -0.04), // ammo pan
    rod([0.2, -0.01, 0.015], [0.24, -0.13, 0.05], 0.005, M.gun(), 4), // bipod legs
    rod([0.2, -0.01, -0.015], [0.24, -0.13, -0.05], 0.005, M.gun(), 4));
  m.parts.gun = gun;
  m.root.add(gun);
  return m;
}

/**
 * Industrial: a flamethrower trooper in a heavy fire-proof coat and a gas mask, two fuel tanks strapped
 * to his back, a hose running down to the wand in his hands and a pilot light burning at its tip.
 */
function flamer(team: number): Model {
  const coat = mat('#5c5a48', { rough: 0.95, tex: 'canvas' });
  const m = soldier({ torso: coat, legs: M.olive(), arms: coat, boots: M.rubber(), hands: M.leather() });
  m.root.add(mesh(shell(0.27, 0.4, 0.01), teamMat(team))); // team apron over the coat
  m.root.add(mesh(shell(0.2, 0.235, 0.014), M.leather())); // belt
  helmet(m.root, teamMat(team, 'd'));
  // gas mask: round goggles and a snout with its filter can
  for (const z of [-0.035, 0.035]) m.root.add(along(mesh(cyl(0.02, 0.02, 0.012, 8), M.glass(), 0.112, 0.485, z)));
  m.root.add(along(mesh(cyl(0.022, 0.03, 0.04, 8), M.rubber(), 0.12, 0.445, 0)));
  m.root.add(along(mesh(cyl(0.025, 0.025, 0.03, 8), M.darkSteel(), 0.15, 0.44, 0)));
  // two fuel tanks with a pressure bottle between them, on a frame
  const tank = mat('#8c2a1c', { rough: 0.5, metal: 0.4 });
  for (const z of [-0.045, 0.045]) {
    m.root.add(mesh(cyl(0.04, 0.04, 0.2, 10), tank, -0.12, 0.34, z));
    m.root.add(mesh(cap(0.04, 10), tank, -0.12, 0.44, z));
    m.root.add(mesh(cyl(0.042, 0.042, 0.014, 10), M.darkSteel(), -0.12, 0.3, z)); // band
  }
  m.root.add(mesh(cyl(0.024, 0.024, 0.17, 8), M.steel(), -0.155, 0.33, 0)); // pressure bottle
  m.root.add(mesh(cyl(0.01, 0.01, 0.03, 6), M.brass(), -0.155, 0.43, 0)); // valve
  m.root.add(mesh(box(0.012, 0.03, 0.15), M.darkSteel(), -0.1, 0.235, 0)); // frame foot
  m.root.add(rod([-0.12, 0.25, 0.045], [0.02, 0.2, 0.09], 0.01, M.rubber(), 5)); // hose
  m.root.add(rod([0.02, 0.2, 0.09], [0.11, 0.3, 0.07], 0.01, M.rubber(), 5));
  m.parts.armL.rotation.z = m.parts.armR.rotation.z = 1.2;
  const gun = group(0.15, 0.31, 0.06,
    mesh(box(0.05, 0.04, 0.03), M.gun(), -0.05, 0, 0), // rear grip housing
    mesh(box(0.02, 0.05, 0.02), M.gun(), -0.06, -0.04, 0), // trigger grip
    along(mesh(cyl(0.022, 0.022, 0.1, 8), M.brass(), 0.02, 0.008, 0)), // fuel reservoir
    along(mesh(cyl(0.011, 0.011, 0.2, 6), M.darkSteel(), 0.12, 0, 0)), // wand
    mesh(box(0.02, 0.045, 0.02), M.gun(), 0.07, -0.035, 0), // front grip
    along(mesh(cyl(0.02, 0.016, 0.04, 8), M.darkSteel(), 0.22, 0, 0)), // nozzle
    mesh(ball(0.016), M.ember(), 0.25, -0.016, 0)); // pilot light
  m.parts.gun = gun;
  m.root.add(gun);
  return m;
}

/** Unarmed: a white smock with red crosses, a team-colored cap and a satchel of bandages. */
function medic(team: number): Model {
  const white = M.white(), red = mat('#c42a22', { rough: 0.7 });
  const m = soldier({ torso: white, legs: teamMat(team, 'd'), arms: white, boots: M.leather() });
  for (const x of [0.067, -0.067]) {
    m.root.add(mesh(box(0.006, 0.09, 0.026), red, x * 1.01, 0.33, 0));
    m.root.add(mesh(box(0.006, 0.026, 0.09), red, x * 1.01, 0.33, 0));
  }
  m.root.add(mesh(turned([[0, 0], [0.07, 0], [0.072, 0.018], [0.062, 0.04], [0.034, 0.052], [0, 0.055]], 9), teamMat(team), -0.006, 0.478, 0)); // cap
  m.root.add(mesh(slab([[0, 0], [0.05, -0.004], [0.04, 0.008], [0, 0.012]], 0.09, 0.004), teamMat(team, 'd'), 0.05, 0.482, 0)); // peak
  m.root.add(mesh(box(0.06, 0.08, 0.1), M.leather(), -0.04, 0.25, -0.1)); // satchel
  m.root.add(rod([0.06, 0.4, 0.09], [-0.04, 0.27, -0.09], 0.008, M.leather(), 4)); // strap
  return m;
}

/** The Spy: a dark stealth suit and hood, night-vision goggles glowing green and a radio pack with a whip aerial. */
function spy(team: number): Model {
  const suit = mat('#2b3033', { rough: 0.85 }), patch = mat('#3c4440', { rough: 0.9 });
  const m = soldier({ torso: suit, legs: patch, arms: suit, boots: M.rubber(), hands: M.rubber() });
  // camouflage blotches on the suit
  for (const [y, z] of [[0.3, -0.06], [0.36, 0.05], [0.25, 0.03]] as const) m.root.add(mesh(box(0.008, 0.035, 0.05), patch, chest(y, 0.004), y, z));
  m.root.add(mesh(shell(0.222, 0.25, 0.008), teamMat(team, 'd'))); // a team-coloured belt, the only colour on it
  m.root.add(mesh(box(0.008, 0.03, 0.03), teamMat(team), chest(0.37, 0.004), 0.37, 0.05)); // shoulder patch
  // hood pulled over the head, leaving the goggles
  m.root.add(mesh(loft([[0.43, 0.07, 0.07], [0.45, 0.112, 0.1], [0.47, 0.132, 0.124], [0.5, 0.132, 0.126, -0.004], [0.525, 0.104, 0.104, -0.006], [0.542, 0.05, 0.05, -0.006]], 8), suit));
  const lens = mat('#3cff6a', { rough: 0.2, emissive: '#2aff55', emissiveIntensity: 1.6 });
  for (const z of [-0.024, 0.024]) {
    m.root.add(along(mesh(cyl(0.017, 0.019, 0.026, 8), M.gun(), 0.068, 0.49, z)));
    m.root.add(along(mesh(cyl(0.013, 0.013, 0.004, 8), lens, 0.082, 0.49, z)));
  }
  // radio pack and its aerial
  m.root.add(mesh(box(0.065, 0.12, 0.12), M.gun(), -0.095, 0.33, 0));
  m.root.add(mesh(box(0.01, 0.02, 0.05), lens, -0.13, 0.36, 0)); // a dim status light
  m.root.add(rod([-0.11, 0.39, 0.045], [-0.14, 0.74, 0.06], 0.004, M.gun(), 4));
  m.root.add(mesh(sph(0.009, 6, 4), M.gun(), -0.14, 0.745, 0.06));
  return m;
}

function rocketeer(team: number): Model {
  const m = soldier({ torso: M.olive(), legs: M.olive(), arms: M.olive(), boots: M.rubber() });
  m.root.add(mesh(shell(0.295, 0.39, 0.008), teamMat(team)));
  helmet(m.root, teamMat(team, 'd'));
  // rocket pack with two spare rounds
  m.root.add(mesh(box(0.08, 0.16, 0.15), M.leather(), -0.1, 0.33, 0));
  for (const z of [-0.04, 0.04]) {
    m.root.add(mesh(cyl(0.022, 0.022, 0.16, 8), mat('#5a6232'), -0.11, 0.45, z));
    m.root.add(mesh(cone(0.022, 0.06, 8), M.darkSteel(), -0.11, 0.56, z));
  }
  m.parts.armR.rotation.z = 2.2;
  m.parts.armL.rotation.z = 1.4;
  const tube = mat('#5a6232');
  const gun = group(0.04, 0.47, 0.11,
    along(mesh(cyl(0.045, 0.045, 0.44, 10), tube, 0, 0, 0)),
    along(mesh(cyl(0.05, 0.06, 0.06, 10), M.darkSteel(), -0.24, 0, 0)), // rear flare
    along(mesh(cyl(0.05, 0.05, 0.03, 10), M.darkSteel(), 0.2, 0, 0)), // muzzle ring
    along(mesh(cyl(0.05, 0.05, 0.03, 10), M.darkSteel(), -0.06, 0, 0)), // band
    along(mesh(cone(0.04, 0.09, 10), M.darkSteel(), 0.26, 0, 0)), // warhead
    mesh(box(0.025, 0.07, 0.025), M.gun(), 0.04, -0.07, 0), // grip
    mesh(box(0.025, 0.07, 0.025), M.gun(), -0.08, -0.07, 0), // shoulder rest
    mesh(box(0.06, 0.035, 0.02), M.gun(), 0.02, 0.03, -0.05)); // sight
  m.parts.gun = gun;
  m.root.add(gun);
  return m;
}

/** A closed great helm with a visor slit, breathing holes and a crest. */
function greatHelm(root: THREE.Object3D, team: number, x: number, y: number, plume = true): void {
  root.add(mesh(turned([[0, -0.062], [0.071, -0.062], [0.069, 0.02], [0.064, 0.05], [0.048, 0.08], [0.024, 0.096], [0, 0.1]], 10), M.steel(), x, y, 0));
  root.add(mesh(box(0.012, 0.014, 0.1), M.dark(), x + 0.066, y + 0.015, 0)); // eye slit
  root.add(mesh(box(0.01, 0.1, 0.012), M.darkSteel(), x + 0.07, y - 0.005, 0)); // nose ridge
  for (const dy of [-0.025, -0.045]) for (const z of [-0.03, 0.03]) root.add(mesh(box(0.006, 0.006, 0.012), M.dark(), x + 0.068, y + dy, z));
  root.add(mesh(turned([[0.07, -0.006], [0.075, -0.006], [0.075, 0.006], [0.07, 0.006]], 10), M.gold(), x, y - 0.054, 0)); // rim
  if (!plume) return;
  root.add(mesh(cyl(0.01, 0.01, 0.04, 6), M.gold(), x, y + 0.115, 0));
  for (let i = 0; i < 4; i++) root.add(rot(mesh(gem(0.03, 1.4, 0.6, 0.5), teamMat(team), x - 0.03 * i, y + 0.15 - i * 0.012, 0), 0, 0, 0.3 + i * 0.25));
}

function swordsman(team: number): Model {
  const m = soldier({ torso: M.steel(), legs: M.mail(), arms: M.mail(), boots: M.darkSteel(), hands: M.steel() });
  const r = m.root;
  // the tabard wraps the whole steel chest (narrower, the chest and belt stuck out through it as boxes)
  r.add(mesh(shell(0.205, 0.395, 0.008), teamMat(team))); // tabard
  r.add(mesh(shell(0.204, 0.224, 0.011), M.gold())); // tabard hem
  r.add(mesh(box(0.004, 0.09, 0.03), M.white(), chest(0.32, 0.011), 0.32, 0)); // device on the tabard
  r.add(mesh(box(0.004, 0.03, 0.08), M.white(), chest(0.34, 0.011), 0.34, 0));
  r.add(mesh(shell(0.222, 0.248, 0.013), M.leather())); // sword belt cinching the tabard
  r.add(mesh(box(0.012, 0.024, 0.03), M.gold(), chest(0.235, 0.016), 0.235, 0)); // its buckle
  r.add(mesh(skirt(0.15, 0.205, 0.04), M.mail())); // mail skirt
  r.add(mesh(loft([[0.39, 0.115, 0.17], [0.43, 0.08, 0.12]], 8), M.steel())); // gorget
  for (const side of [-1, 1]) r.add(rot(mesh(pauldron(), M.steel(), 0, 0.385, side * 0.115), side * 0.35, 0, 0)); // pauldrons
  greatHelm(r, team, 0, 0.48);
  // kite shield with a boss and rim on the left arm
  const shield = group(0.07, -0.1, -0.02,
    rot(mesh(slab(KITE, 0.026, 0.008), M.gold(), -0.006, 0, 0), 0, Math.PI / 2, 0),
    rot(scl(mesh(slab(KITE, 0.026, 0.006), teamMat(team), 0.002, 0.006, 0), 0.88, 0.9, 1), 0, Math.PI / 2, 0),
    mesh(box(0.03, 0.18, 0.024), M.white(), 0.004, -0.01, 0),
    mesh(box(0.03, 0.024, 0.11), M.white(), 0.004, 0.03, 0),
    mesh(gem(0.022), M.gold(), 0.02, 0.03, 0));
  m.parts.armL.add(shield);
  m.parts.armL.rotation.z = 0.9;
  // arming sword: pommel, grip, crossguard, blade with a fuller, point
  const sword = group(0, -0.16, 0,
    mesh(gem(0.018), M.gold(), 0, 0.045, 0),
    mesh(loft([[-0.03, 0.022, 0.022], [0.03, 0.026, 0.026]], 6), M.leather()),
    mesh(box(0.025, 0.02, 0.12), M.gold(), 0, -0.035, 0),
    mesh(slab([[-0.012, -0.045], [-0.011, -0.33], [0, -0.38], [0.011, -0.33], [0.012, -0.045]], 0.01, 0.0035), M.steel()));
  m.parts.armR.add(sword);
  // scabbard on the hip
  r.add(rot(mesh(box(0.02, 0.24, 0.03), M.leather(), -0.04, 0.16, -0.11), 0, 0, 0.5));
  return m;
}

/** A tower shield's outline, [z, y]: tall and square, the top corners clipped. */
const TOWER: [number, number][] = [[-0.08, -0.17], [0.08, -0.17], [0.088, 0.09], [0.064, 0.125], [-0.064, 0.125], [-0.088, 0.09]];

/** How much bigger than a foot soldier the Guardian stands. */
const GUARDIAN_SCALE = 1.85;

/**
 * The Guardian: a hulking foot soldier sealed in heavy plate, a tower shield on one arm and a great
 * giant axe in the other. Built as a soldier, armored over, then scaled up inside a wrapper (the renderer
 * sets the root's own scale).
 */
function guardian(team: number): Model {
  const m = soldier({ torso: M.darkSteel(), legs: M.steel(), arms: M.steel(), boots: M.darkSteel(), hands: M.darkSteel() });
  const r = m.root, tm = teamMat(team);
  // layered plate: breastplate, fauld bands, a team surcoat between them, a heavy gorget
  r.add(mesh(shell(0.255, 0.41, 0.014), M.steel())); // breastplate
  r.add(mesh(shell(0.3, 0.39, 0.02), tm)); // surcoat panel
  r.add(mesh(shell(0.295, 0.305, 0.024), M.gold())); // its hem
  r.add(mesh(box(0.005, 0.075, 0.022), M.gold(), chest(0.35, 0.021), 0.35, 0)); // a gold bar down the chest
  for (const [y, o] of [[0.236, 0.016], [0.214, 0.022], [0.192, 0.026]] as const) r.add(mesh(shell(y - 0.011, y + 0.011, o), M.darkSteel())); // fauld
  r.add(mesh(skirt(0.12, 0.19, 0.06), M.mail())); // mail skirt under the fauld
  r.add(mesh(loft([[0.38, 0.13, 0.2], [0.41, 0.125, 0.17], [0.45, 0.085, 0.12]], 8), M.steel())); // gorget
  // great stacked pauldrons, team-edged
  for (const side of [-1, 1]) {
    r.add(rot(scl(mesh(pauldron(), M.steel(), 0, 0.39, side * 0.125), 1.5, 1.3, 1.5), side * 0.4, 0, 0));
    r.add(rot(scl(mesh(pauldron(), tm, 0, 0.372, side * 0.13), 1.62, 0.5, 1.62), side * 0.4, 0, 0));
  }
  // closed helm with a team crest, cheek guards and breaths
  greatHelm(r, team, 0, 0.48, false);
  r.add(mesh(slab([[-0.07, 0], [0.05, 0], [0.07, 0.03], [0.04, 0.06], [-0.05, 0.065], [-0.08, 0.04]], 0.018, 0.004), tm, -0.005, 0.57, 0)); // crest
  for (const z of [-0.064, 0.064]) r.add(mesh(box(0.06, 0.05, 0.01), M.darkSteel(), 0.035, 0.445, z)); // cheek guards
  // knee cops and greaves ride on the legs
  for (const k of ['legL', 'legR']) {
    m.parts[k].add(mesh(gem(0.038, 1.1, 0.9, 1), M.steel(), 0.014, -0.09, 0));
    m.parts[k].add(mesh(taper(0.07, 0.076, 0.07, 6, 1.05), M.darkSteel(), 0.004, -0.11, 0));
  }
  // tower shield on the left arm: steel rim, team face, gold boss and a white bar
  const shield = group(0.075, -0.07, -0.02,
    rot(mesh(slab(TOWER, 0.03, 0.008), M.darkSteel(), -0.006, 0, 0), 0, Math.PI / 2, 0),
    rot(scl(mesh(slab(TOWER, 0.03, 0.006), tm, 0.003, 0.006, 0), 0.86, 0.9, 1), 0, Math.PI / 2, 0),
    mesh(box(0.03, 0.21, 0.022), M.white(), 0.006, -0.02, 0),
    mesh(gem(0.028, 0.7, 1, 1), M.gold(), 0.022, 0.01, 0));
  m.parts.armL.add(shield);
  m.parts.armL.rotation.z = 0.9;
  // giant double-bitted axe: a long haft, a broad crescent blade forward, a smaller one behind, a spike on top
  const BLADE: [number, number][] = [[0.01, -0.25], [0.07, -0.225], [0.15, -0.17], [0.18, -0.26], [0.17, -0.35], [0.14, -0.43], [0.07, -0.37], [0.01, -0.34]];
  const axe = group(0, -0.16, 0,
    mesh(taper(0.42, 0.024, 0.022, 6), M.darkWood(), 0, 0.08, 0),
    mesh(loft([[-0.04, 0.03, 0.03], [0.02, 0.032, 0.032]], 6), M.leather()), // grip
    mesh(loft([[-0.35, 0.04, 0.04], [-0.24, 0.04, 0.04]], 6), M.darkSteel()), // socket
    mesh(slab(BLADE, 0.016, 0.005), M.steel()),
    mesh(slab(BLADE.map(([x, y]) => [-x * 0.6, y * 0.92 - 0.02] as [number, number]), 0.016, 0.005), M.steel()),
    mesh(slab([[0.172, -0.17], [0.19, -0.26], [0.178, -0.35], [0.145, -0.435], [0.13, -0.42], [0.165, -0.26]], 0.008), M.white()), // bright honed edge
    rot(mesh(cone(0.016, 0.07, 5), M.steel(), 0, -0.375, 0), 0, 0, Math.PI), // spike past the head
    mesh(loft([[-0.31, 0.045, 0.045], [-0.29, 0.045, 0.045]], 6), M.gold(), 0, 0, 0)); // gold ring at the socket
  m.parts.armR.add(axe);
  m.parts.armR.rotation.z = 2.3; // carried on the shoulder (entities3d.ts GUARDIAN_REST)
  m.parts.body = r; // twists into each swing
  // scale the whole figure up inside a wrapper, so the renderer's own scale still applies on top
  const outer = new THREE.Group();
  r.scale.setScalar(GUARDIAN_SCALE);
  outer.add(r);
  return { root: outer, parts: m.parts, height: m.height * GUARDIAN_SCALE };
}

function crossbowman(team: number): Model {
  const m = soldier({ torso: M.khaki(), legs: M.leather(), arms: M.khaki(), boots: M.rubber() });
  const r = m.root;
  // quilted gambeson: stitch lines
  for (const y of [0.27, 0.31, 0.35]) r.add(mesh(shell(y - 0.003, y + 0.003, 0.003), mat('#8a7c56')));
  r.add(mesh(shell(0.37, 0.415, 0.008), teamMat(team))); // team collar
  r.add(mesh(skirt(0.135, 0.26, 0.05, 0.008), teamMat(team, 'd'))); // tunic skirt
  // kettle hat over a mail coif
  r.add(mesh(gem(0.066, 1, 1.05, 1.02, 1), M.mail(), -0.018, 0.47, 0));
  r.add(mesh(turned([[0, 0], [0.115, -0.006], [0.116, 0.004], [0.07, 0.012], [0.068, 0.035], [0.05, 0.058], [0, 0.068]], 10), M.steel(), 0, 0.5, 0));
  r.add(mesh(cyl(0.004, 0.004, 0.14, 4), M.darkSteel(), 0, 0.545, 0));
  // quiver of bolts on the back
  r.add(rot(mesh(box(0.06, 0.2, 0.06), M.leather(), -0.09, 0.36, -0.05), 0.2, 0, 0));
  for (const z of [-0.03, -0.05, -0.07]) r.add(mesh(box(0.012, 0.04, 0.004), M.white(), -0.09, 0.48, z + 0.02));
  m.parts.armL.rotation.z = m.parts.armR.rotation.z = 1.35;
  // crossbow: stock, steel prod swept forward, string, stirrup and a loaded bolt
  const bow = group(0.17, 0.36, 0.03,
    mesh(box(0.28, 0.035, 0.035), M.wood(), 0, 0, 0),
    mesh(box(0.06, 0.05, 0.04), M.darkWood(), -0.13, -0.01, 0),
    rot(mesh(box(0.025, 0.022, 0.16), M.darkSteel(), 0.1, 0.01, 0.075), 0, 0.35, 0),
    rot(mesh(box(0.025, 0.022, 0.16), M.darkSteel(), 0.1, 0.01, -0.075), 0, -0.35, 0),
    rod([0.075, 0.01, 0.15], [0.02, 0.02, 0], 0.003, M.rope(), 3),
    rod([0.075, 0.01, -0.15], [0.02, 0.02, 0], 0.003, M.rope(), 3),
    rot(mesh(torus(0.025, 0.004, Math.PI, 3, 8), M.darkSteel(), 0.15, 0, 0), 0, 0, -Math.PI / 2),
    mesh(box(0.14, 0.006, 0.006), M.darkWood(), 0.08, 0.022, 0),
    mesh(box(0.02, 0.012, 0.012), M.steel(), 0.155, 0.022, 0),
    mesh(box(0.03, 0.03, 0.01), M.darkSteel(), -0.04, -0.03, 0));
  m.parts.gun = bow;
  r.add(bow);
  return m;
}

function knight(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const horse = M.horse(), hair = M.hair(), tm = teamMat(team);
  // the horse: barrel, chest and rump
  root.add(mesh(loftX([[-0.35, 0.1, 0.08, 0.04], [-0.31, 0.24, 0.2, 0.01], [-0.2, 0.29, 0.26], [0, 0.26, 0.24, -0.015], [0.17, 0.29, 0.24, 0.01], [0.28, 0.25, 0.2, 0.03], [0.34, 0.12, 0.1, 0.06]], 8), horse, 0, 0.49, 0));
  // caparison: team drape with a gold hem down both flanks and over the rump
  root.add(mesh(loftX([[-0.33, 0.16, 0.2, 0.02], [-0.2, 0.23, 0.28], [0.05, 0.22, 0.265], [0.2, 0.23, 0.27]], 8, 2.4), tm, -0.04, 0.43, 0));
  root.add(mesh(loftX([[-0.33, 0.03, 0.21, -0.065], [-0.2, 0.03, 0.29, -0.09], [0.05, 0.03, 0.275, -0.09], [0.2, 0.03, 0.28, -0.09]], 8, 2.4), M.gold(), -0.04, 0.43, 0));
  for (const z of [-0.139, 0.139]) {
    root.add(mesh(box(0.08, 0.08, 0.004), M.gold(), -0.05, 0.46, z)); // heraldic lozenge
    root.add(rot(mesh(box(0.05, 0.05, 0.005), M.white(), -0.05, 0.46, z), 0, 0, 0.785));
  }
  // saddle, horn, cantle, stirrups
  root.add(mesh(box(0.2, 0.04, 0.22), M.leather(), -0.03, 0.6, 0));
  root.add(mesh(box(0.03, 0.06, 0.12), M.leather(), 0.07, 0.63, 0));
  root.add(mesh(box(0.03, 0.08, 0.16), M.leather(), -0.13, 0.64, 0));
  for (const z of [-0.14, 0.14]) {
    root.add(rod([-0.03, 0.58, z * 0.85], [-0.03, 0.36, z], 0.005, M.leather(), 3));
    root.add(mesh(box(0.05, 0.012, 0.035), M.iron(), -0.03, 0.35, z));
  }
  // neck, mane, head, muzzle, ears, chanfron and reins
  const neck = rot(mesh(loft([[-0.17, 0.17, 0.13], [0, 0.13, 0.11], [0.16, 0.1, 0.085]], 7), horse, 0.3, 0.64, 0), 0, 0, -0.55);
  const mane = rot(mesh(slab([[-0.03, -0.14], [0.02, -0.15], [0.03, 0.16], [-0.01, 0.17], [-0.035, 0.05]], 0.035, 0.008), hair, 0.25, 0.7, 0), 0, 0, -0.55);
  root.add(neck, mane);
  root.add(rot(mesh(loftX([[-0.11, 0.1, 0.1], [-0.02, 0.105, 0.095, -0.005], [0.07, 0.08, 0.075, -0.012], [0.14, 0.075, 0.07, -0.015], [0.155, 0.05, 0.05, -0.02]], 7), horse, 0.45, 0.76, 0), 0, 0, -0.3));
  root.add(mesh(box(0.02, 0.02, 0.07), M.dark(), 0.59, 0.72, 0)); // nostrils
  for (const z of [-0.035, 0.035]) {
    root.add(rot(mesh(cone(0.018, 0.06, 4), horse, 0.38, 0.86, z), 0, 0, -0.2));
    root.add(mesh(sph(0.012, 6, 4), M.dark(), 0.45, 0.79, z * 1.45));
  }
  root.add(rot(mesh(box(0.17, 0.02, 0.09), M.steel(), 0.46, 0.815, 0), 0, 0, -0.3)); // chanfron
  root.add(rot(mesh(cone(0.012, 0.07, 6), M.steel(), 0.44, 0.86, 0), 0, 0, -0.5)); // spike
  for (const z of [-0.05, 0.05]) root.add(rod([0.53, 0.72, z], [0.12, 0.7, z * 1.2], 0.004, M.leather(), 3));
  // tail
  root.add(rot(mesh(loft([[-0.24, 0.02, 0.03], [-0.15, 0.06, 0.06], [0, 0.05, 0.05]], 6), hair, -0.35, 0.56, 0), 0, 0, -0.6));
  // legs with hooves and feathering
  for (const [name, x, z] of [['legFL', 0.22, 0.08], ['legFR', 0.22, -0.08], ['legBL', -0.22, 0.08], ['legBR', -0.22, -0.08]] as const) {
    const leg = group(x, 0.38, z, mesh(loft([[-0.34, 0.05, 0.045], [-0.2, 0.05, 0.045], [-0.12, 0.08, 0.06], [0, 0.1, 0.075]], 6), horse));
    leg.add(mesh(loft([[-0.335, 0.072, 0.07], [-0.29, 0.056, 0.052]], 6), M.cloth()));
    leg.add(mesh(loft([[-0.375, 0.078, 0.072, 0.006], [-0.335, 0.06, 0.058]], 6), M.dark()));
    parts[name] = leg;
    root.add(leg);
  }
  // the rider: legs astride, plate body, surcoat, pauldrons, great helm
  for (const z of [-0.12, 0.12]) {
    root.add(rot(mesh(loft([[-0.075, 0.06, 0.055], [0.075, 0.075, 0.065]], 6), M.steel(), 0.01, 0.6, z), 0, 0, -0.4));
    root.add(mesh(loft([[-0.065, 0.05, 0.05], [0.065, 0.06, 0.058]], 6), M.steel(), 0.03, 0.49, z * 1.05));
    root.add(mesh(slab([[-0.03, -0.018], [0.05, -0.018], [0.058, -0.004], [0.03, 0.016], [-0.03, 0.016]], 0.06, 0.006), M.darkSteel(), 0.03, 0.42, z * 1.05));
  }
  root.add(mesh(loft([[0.63, 0.11, 0.15], [0.7, 0.115, 0.155], [0.79, 0.13, 0.19], [0.845, 0.11, 0.17]], 8, 2.6), M.steel(), -0.03, 0, 0));
  root.add(mesh(loft([[0.62, 0.15, 0.2], [0.7, 0.13, 0.17], [0.79, 0.146, 0.2]], 8, 2.6), tm, -0.03, 0, 0));
  root.add(mesh(loft([[0.615, 0.156, 0.206], [0.635, 0.15, 0.2]], 8, 2.6), M.gold(), -0.03, 0, 0));
  root.add(mesh(loft([[0.83, 0.115, 0.17], [0.875, 0.08, 0.12]], 8), M.steel(), -0.03, 0, 0)); // gorget
  for (const z of [-0.1, 0.1]) root.add(rot(mesh(pauldron(), M.steel(), -0.03, 0.82, z), Math.sign(z) * 0.35, 0, 0));
  greatHelm(root, team, -0.03, 0.92);
  // heater shield on the left
  root.add(rot(mesh(slab(HEATER, 0.024, 0.007), M.gold(), -0.024, 0.7, -0.155), 0, Math.PI / 2, 0));
  root.add(rot(scl(mesh(slab(HEATER, 0.024, 0.005), tm, -0.018, 0.705, -0.155), 0.86, 0.88, 1), 0, Math.PI / 2, 0));
  for (const s of [-1, 1]) root.add(rot(mesh(box(0.008, 0.11, 0.025), M.gold(), -0.006, 0.73, -0.155 + s * 0.03), s * 0.7, 0, 0)); // chevron
  // lance with a vamplate and a pennon
  const lance = group(0.05, 0.78, 0.12,
    along(mesh(cyl(0.016, 0.024, 1.05, 8), M.wood(), 0.45, 0, 0)),
    along(mesh(cone(0.016, 0.1, 6), M.steel(), 1.02, 0, 0)),
    along(mesh(cone(0.06, 0.1, 10), M.steel(), 0.08, 0, 0)),
    along(mesh(cyl(0.02, 0.02, 0.1, 6), M.leather(), -0.04, 0, 0)),
    mesh(box(0.14, 0.07, 0.006), tm, 0.85, 0.05, 0),
    mesh(box(0.06, 0.035, 0.006), tm, 0.75, 0.065, 0),
    mesh(box(0.14, 0.012, 0.007), M.gold(), 0.85, 0.075, 0));
  parts.lance = lance;
  root.add(lance);
  return { root, parts, height: 1.08 };
}

// ---------------------------------------------------------------- vehicles

/** A rubber tyre with a steel hub, axle along z. */
function wheel(root: THREE.Object3D, x: number, z: number, r: number, w: number, hub: Mat = M.darkSteel()): void {
  root.add(across(mesh(cyl(r, r, w, 14), M.rubber(), x, r, z)));
  root.add(across(mesh(cyl(r * 0.55, r * 0.55, w + 0.008, 10), hub, x, r, z)));
  root.add(across(mesh(cyl(r * 0.18, r * 0.18, w + 0.02, 6), M.gun(), x, r, z)));
}

function jeep(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team), td = teamMat(team, 'd');
  for (const [x, z] of [[0.2, 0.17], [0.2, -0.17], [-0.2, 0.17], [-0.2, -0.17]]) wheel(root, x, z, 0.1, 0.07);
  root.add(mesh(box(0.64, 0.05, 0.22), M.darkSteel(), 0, 0.12, 0)); // chassis
  root.add(mesh(slab([[-0.31, 0.15], [0.29, 0.15], [0.315, 0.2], [0.31, 0.25], [-0.3, 0.26], [-0.315, 0.2]], 0.3, 0.012), tm)); // tub
  for (const [x, z] of [[0.2, 0.175], [0.2, -0.175], [-0.2, 0.175], [-0.2, -0.175]]) root.add(mesh(box(0.25, 0.025, 0.09), td, x, 0.255, z)); // fenders
  root.add(mesh(slab([[0.11, 0.25], [0.31, 0.25], [0.31, 0.29], [0.11, 0.31]], 0.28, 0.01), td)); // hood
  for (let z = -0.09; z <= 0.091; z += 0.03) root.add(mesh(box(0.01, 0.08, 0.012), M.gun(), 0.315, 0.21, z)); // grille
  for (const z of [-0.11, 0.11]) root.add(along(mesh(cyl(0.025, 0.025, 0.02, 8), M.lamp(), 0.31, 0.23, z)));
  root.add(mesh(box(0.06, 0.04, 0.32), M.gun(), 0.33, 0.14, 0)); // bumper
  // windshield frame and glass
  root.add(mesh(box(0.02, 0.11, 0.28), M.glass(), 0.09, 0.32, 0));
  root.add(mesh(box(0.024, 0.014, 0.3), td, 0.09, 0.38, 0));
  for (const z of [-0.145, 0.145]) root.add(mesh(box(0.024, 0.12, 0.014), td, 0.09, 0.32, z));
  // seats and roll bar
  for (const z of [-0.07, 0.07]) {
    root.add(mesh(box(0.08, 0.03, 0.09), M.leather(), 0, 0.27, z));
    root.add(mesh(box(0.02, 0.08, 0.09), M.leather(), -0.04, 0.31, z));
  }
  root.add(mesh(box(0.14, 0.05, 0.26), M.leather(), -0.12, 0.27, 0));
  for (const z of [-0.14, 0.14]) root.add(mesh(cyl(0.01, 0.01, 0.16, 6), M.gun(), -0.07, 0.34, z));
  root.add(across(mesh(cyl(0.01, 0.01, 0.28, 6), M.gun(), -0.07, 0.42, 0)));
  // spare wheel, jerrycan and whip antenna at the back
  root.add(along(mesh(cyl(0.08, 0.08, 0.05, 12), M.rubber(), -0.34, 0.22, 0)));
  root.add(along(mesh(cyl(0.045, 0.045, 0.054, 8), M.darkSteel(), -0.34, 0.22, 0)));
  root.add(mesh(box(0.05, 0.08, 0.07), mat('#4a5a2a'), -0.3, 0.3, 0.11));
  root.add(mesh(cyl(0.004, 0.004, 0.5, 4), M.gun(), -0.28, 0.5, -0.13));
  // pintle machine gun with a shield and an ammo box
  const barrel = group(0, 0.15, 0,
    mesh(box(0.14, 0.06, 0.05), M.darkSteel(), 0, 0, 0),
    along(mesh(cyl(0.022, 0.022, 0.16, 8), M.gun(), 0.13, 0, 0)), // cooling jacket
    along(mesh(cyl(0.01, 0.01, 0.12, 6), M.gun(), 0.25, 0, 0)),
    along(mesh(cone(0.016, 0.03, 6), M.gun(), 0.31, 0, 0)),
    mesh(box(0.06, 0.05, 0.05), mat('#4a5a2a'), -0.01, -0.02, 0.05),
    mesh(box(0.02, 0.1, 0.13), td, 0.08, 0.02, 0),
    mesh(box(0.04, 0.03, 0.02), M.gun(), -0.08, -0.02, 0));
  const turret = group(-0.14, 0.27, 0,
    mesh(cyl(0.025, 0.035, 0.14, 8), M.gun(), 0, 0.07, 0),
    barrel);
  parts.turret = turret;
  parts.barrel = barrel;
  root.add(turret);
  return { root, parts, height: 0.6 };
}

/** A track belt's side outline: a long run with rounded ends, from y = 0 to h. */
function beltProfile(len: number, h: number): [number, number][] {
  const r = h / 2, cx = len / 2 - r, pts: [number, number][] = [];
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i / 5) * Math.PI; pts.push([+(cx + Math.cos(a) * r).toFixed(4), +(r + Math.sin(a) * r).toFixed(4)]); }
  for (let i = 0; i <= 5; i++) { const a = Math.PI / 2 + (i / 5) * Math.PI; pts.push([+(-cx + Math.cos(a) * r).toFixed(4), +(r + Math.sin(a) * r).toFixed(4)]); }
  return pts;
}

/** A track run along x at z: belt, road wheels, sprocket, idler and a fender above. */
function track(root: THREE.Object3D, len: number, h: number, w: number, z: number, wheels: number, fender: Mat | null): void {
  const rr = h * 0.34;
  root.add(mesh(slab(beltProfile(len, h), w, 0.012), M.rubber(), 0, 0, z));
  for (let i = 0; i < wheels; i++) {
    const x = (i - (wheels - 1) / 2) * ((len - h * 1.4) / (wheels - 1));
    root.add(across(mesh(cyl(rr, rr, w + 0.012, 10), M.darkSteel(), x, rr + 0.012, z)));
    root.add(across(mesh(cyl(rr * 0.4, rr * 0.4, w + 0.03, 6), M.gun(), x, rr + 0.012, z)));
  }
  root.add(across(mesh(cyl(h * 0.36, h * 0.36, w + 0.016, 8), M.iron(), len / 2 - h * 0.3, h * 0.55, z))); // sprocket
  root.add(across(mesh(cyl(h * 0.3, h * 0.3, w + 0.016, 8), M.darkSteel(), -len / 2 + h * 0.3, h * 0.55, z))); // idler
  // tread blocks across the top run
  const n = Math.round(len / 0.07);
  for (let i = 0; i < n; i++) root.add(mesh(box(0.025, 0.012, w + 0.004), M.gun(), (i - (n - 1) / 2) * 0.07 * ((len - h) / len), h + 0.004, z));
  if (fender) root.add(mesh(box(len + 0.02, 0.02, w + 0.03), fender, 0, h + 0.03, z));
}

function tank(team: number, heavy: boolean): Model {
  const k = heavy ? 1.22 : 1, root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team), td = teamMat(team, 'd'), tl = teamMat(team, 'l');
  const hull = new THREE.Group();
  for (const side of [-1, 1]) {
    track(hull, 0.9, 0.17, 0.14, side * 0.19, heavy ? 6 : 5, td);
    // tool box and a tow cable on the fenders
    hull.add(mesh(box(0.18, 0.05, 0.08), M.darkSteel(), -0.2, 0.225, side * 0.2));
    hull.add(along(mesh(cyl(0.012, 0.012, 0.3, 5), M.rope(), 0.16, 0.21, side * 0.215)));
    if (heavy) {
      // side skirts over the top of the tracks
      hull.add(mesh(box(0.82, 0.08, 0.015), td, 0, 0.15, side * 0.272));
      for (let i = -3; i <= 3; i++) hull.add(mesh(box(0.012, 0.012, 0.02), M.gun(), i * 0.11, 0.17, side * 0.278));
    }
  }
  hull.add(mesh(slab([[-0.34, 0.15], [0.3, 0.15], [0.42, 0.232], [0.43, 0.255], [0.31, 0.316], [-0.34, 0.316], [-0.41, 0.282], [-0.41, 0.2]], 0.34, 0.012), tm));
  hull.add(mesh(slab([[0.3, 0.15], [0.42, 0.232], [0.43, 0.255], [0.41, 0.258], [0.29, 0.17]], 0.345, 0.006), td)); // lower glacis plate
  hull.add(mesh(box(0.07, 0.03, 0.08), M.darkSteel(), 0.29, 0.31, -0.08)); // driver's hatch
  hull.add(mesh(box(0.012, 0.018, 0.05), M.glass(), 0.33, 0.3, -0.08)); // vision block
  for (const z of [-0.14, 0.14]) {
    hull.add(along(mesh(cyl(0.022, 0.026, 0.03, 8), M.gun(), 0.39, 0.28, z)));
    hull.add(along(mesh(cyl(0.018, 0.018, 0.006, 8), M.lamp(), 0.41, 0.28, z)));
  }
  // spare track links on the front plate
  for (const z of [-0.05, 0, 0.05]) hull.add(rot(mesh(box(0.03, 0.012, 0.045), M.gun(), 0.37, 0.29, z), 0, 0, -0.46));
  // engine deck: grilles, exhausts, jerrycans
  for (let i = 0; i < 5; i++) hull.add(mesh(box(0.016, 0.01, 0.22), M.gun(), -0.16 - i * 0.035, 0.318, 0));
  for (const z of [-0.1, 0.1]) {
    hull.add(along(mesh(cyl(0.025, 0.025, 0.05, 8), M.iron(), -0.39, 0.25, z)));
    hull.add(along(mesh(cyl(0.017, 0.017, 0.052, 8), M.dark(), -0.39, 0.25, z)));
  }
  hull.add(mesh(box(0.04, 0.07, 0.1), mat('#4a5a2a'), -0.42, 0.25, 0));
  hull.scale.setScalar(k);
  root.add(hull);
  // turret: cast body, mantlet, commander's cupola, periscope, smoke launchers, stowage, antenna
  const turret = group(-0.04 * k, 0.33 * k, 0);
  const tt = new THREE.Group();
  tt.add(mesh(loft([[-0.055, 0.36, 0.34, -0.02], [-0.01, 0.4, 0.37, -0.025], [0.045, 0.36, 0.32, -0.035], [0.07, 0.28, 0.25, -0.045]], 8, 2.3), tl)); // cast turret
  tt.add(mesh(slab([[0.13, -0.055], [0.2, -0.042], [0.215, 0], [0.2, 0.042], [0.13, 0.055]], 0.17, 0.01), tm)); // mantlet
  tt.add(mesh(turned([[0, 0], [0.056, 0], [0.05, 0.05], [0.054, 0.05], [0.054, 0.062], [0, 0.062]], 8), td, -0.06, 0.055, 0.07)); // cupola
  for (let a = 0; a < 5; a++) tt.add(mesh(box(0.012, 0.016, 0.018), M.glass(), -0.06 + Math.cos(a * 1.26) * 0.05, 0.09, 0.07 + Math.sin(a * 1.26) * 0.05));
  tt.add(mesh(box(0.03, 0.025, 0.03), M.darkSteel(), 0.04, 0.075, -0.07)); // periscope
  tt.add(mesh(box(0.05, 0.05, 0.2), M.darkSteel(), -0.25, 0.0, 0)); // bustle rack
  tt.add(mesh(loftX([[-0.04, 0.03, 0.2], [0, 0.045, 0.24], [0.04, 0.035, 0.2]], 6), M.tarp(), -0.24, 0.045, 0)); // stowage
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) tt.add(rot(mesh(cyl(0.012, 0.012, 0.05, 6), M.gun(), 0.06 + i * 0.02, 0.03, side * 0.17), side * 0.6, 0, -0.5));
  tt.add(mesh(cyl(0.004, 0.004, 0.45, 4), M.gun(), -0.14, 0.27, -0.1));
  tt.add(mesh(cyl(0.012, 0.016, 0.03, 6), M.gun(), -0.14, 0.055, -0.1));
  if (heavy) for (const side of [-1, 1]) tt.add(mesh(slab([[-0.08, -0.04], [0.1, -0.04], [0.12, 0.0], [0.08, 0.04], [-0.08, 0.04]], 0.02, 0.005), td, 0.0, 0.0, side * 0.19)); // appliqué armor
  tt.scale.setScalar(k);
  turret.add(tt);
  const barrel = group(0.12 * k, 0.01 * k, 0);
  const bb = new THREE.Group();
  for (const z of heavy ? [-0.07, 0.07] : [0]) {
    bb.add(mesh(loftX([[0, 0.064, 0.064], [0.5, 0.054, 0.054]], 8), M.gun(), 0, 0, z));
    bb.add(mesh(loftX([[0.22, 0.06, 0.06], [0.245, 0.082, 0.082], [0.315, 0.082, 0.082], [0.34, 0.06, 0.06]], 8), M.gun(), 0, 0, z)); // fume extractor
    bb.add(mesh(loftX([[0.465, 0.05, 0.07], [0.48, 0.056, 0.082], [0.535, 0.05, 0.08]], 6, 3), M.gun(), 0, 0, z)); // muzzle brake
    for (const s of [-1, 1]) bb.add(mesh(box(0.05, 0.03, 0.006), M.dark(), 0.5, 0, z + s * 0.038));
  }
  bb.scale.setScalar(k);
  barrel.add(bb);
  turret.add(barrel);
  parts.turret = turret;
  parts.barrel = barrel;
  root.add(turret);
  return { root, parts, height: 0.5 * k };
}

/**
 * The Artillery Tank: a self-propelled howitzer on a tank's tracks. A tall boxy gun house sits
 * toward the back with a long barrel; spades at the tail fold down when it digs in to fire (parts:
 * turret, elev (the barrel's elevation), barrel (recoil), spadeL/spadeR).
 */
function artillery(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team), td = teamMat(team, 'd'), tl = teamMat(team, 'l');
  for (const side of [-1, 1]) {
    track(root, 0.94, 0.16, 0.13, side * 0.19, 6, td);
    root.add(mesh(box(0.14, 0.05, 0.07), M.darkSteel(), 0.22, 0.215, side * 0.2)); // tool box on the fender
  }
  // a low hull with a sloped nose: the driver sits up front beside the engine
  root.add(mesh(slab([[-0.41, 0.15], [0.33, 0.15], [0.44, 0.22], [0.42, 0.25], [0.32, 0.29], [-0.41, 0.29]], 0.34, 0.012), tm));
  root.add(mesh(slab([[0.33, 0.15], [0.44, 0.22], [0.42, 0.25], [0.41, 0.24], [0.31, 0.17]], 0.345, 0.006), td));
  root.add(mesh(box(0.08, 0.03, 0.08), M.darkSteel(), 0.28, 0.3, 0.09)); // driver's hatch
  root.add(mesh(box(0.012, 0.018, 0.05), M.glass(), 0.32, 0.3, 0.09));
  for (let i = 0; i < 4; i++) root.add(mesh(box(0.014, 0.01, 0.12), M.gun(), 0.12 + i * 0.035, 0.29, -0.09)); // engine grille
  root.add(along(mesh(cyl(0.02, 0.02, 0.05, 8), M.iron(), 0.27, 0.3, -0.14))); // exhaust
  for (const z of [-0.13, 0.13]) root.add(along(mesh(cyl(0.018, 0.022, 0.026, 8), M.lamp(), 0.42, 0.26, z)));
  // the travel lock the barrel rests in on the march
  root.add(mesh(box(0.025, 0.1, 0.025), M.darkSteel(), 0.36, 0.33, 0));
  root.add(mesh(box(0.03, 0.02, 0.06), M.darkSteel(), 0.36, 0.385, 0));
  // spades at the tail, folded up on the march, dug into the ground to fire
  for (const [k, z] of [['spadeL', -0.11], ['spadeR', 0.11]] as const) {
    const sp = group(-0.42, 0.22, z,
      mesh(box(0.03, 0.06, 0.03), M.iron(), 0, -0.02, 0),
      mesh(box(0.035, 0.2, 0.12), M.darkSteel(), 0, -0.12, 0),
      mesh(box(0.05, 0.03, 0.13), M.iron(), 0, -0.22, 0));
    sp.rotation.z = -2.6;
    parts[k] = sp;
    root.add(sp);
  }
  // the gun house: tall, boxy and set well back, team coloured, with a stripe, hatches and ammo racks
  const turret = group(-0.1, 0.29, 0);
  turret.add(mesh(loft([[0, 0.44, 0.32], [0.12, 0.44, 0.32], [0.19, 0.38, 0.28, -0.01]], 8, 4), tl));
  turret.add(mesh(loft([[0.18, 0.395, 0.29, -0.01], [0.205, 0.37, 0.27, -0.01]], 8, 4), td)); // roof edge
  for (const z of [-0.163, 0.163]) {
    turret.add(mesh(box(0.3, 0.035, 0.004), M.hazard(), -0.02, 0.12, z)); // stripe down each side
    turret.add(mesh(box(0.1, 0.08, 0.004), M.darkSteel(), -0.13, 0.08, z * 1.01)); // side door
  }
  turret.add(mesh(cyl(0.045, 0.05, 0.04, 10), td, -0.08, 0.22, 0.08)); // commander's cupola
  turret.add(mesh(box(0.03, 0.04, 0.03), M.darkSteel(), -0.08, 0.255, 0.08));
  turret.add(mesh(box(0.08, 0.025, 0.08), M.darkSteel(), -0.1, 0.205, -0.08)); // loader's hatch
  turret.add(mesh(box(0.05, 0.12, 0.27), M.darkSteel(), -0.245, 0.09, 0)); // bustle with ammo racks
  for (const z of [-0.09, -0.03, 0.03, 0.09]) turret.add(along(mesh(cyl(0.018, 0.018, 0.02, 8), M.brass(), -0.275, 0.09, z)));
  turret.add(mesh(cyl(0.004, 0.004, 0.42, 4), M.gun(), -0.18, 0.4, -0.12)); // antenna
  turret.add(mesh(slab([[0.19, 0.02], [0.25, 0.04], [0.265, 0.1], [0.25, 0.16], [0.19, 0.17]], 0.18, 0.01), td)); // mantlet
  // the howitzer: elevated to fire, lowered onto the travel lock to move
  const elev = group(0.24, 0.1, 0);
  const barrel = group(0, 0, 0,
    along(mesh(cyl(0.03, 0.034, 0.66, 10), M.gun(), 0.33, 0, 0)),
    along(mesh(cyl(0.045, 0.045, 0.14, 10), M.gun(), 0.07, 0, 0)), // recoil cylinders
    along(mesh(cyl(0.04, 0.04, 0.06, 10), M.gun(), 0.42, 0, 0)), // fume extractor
    mesh(box(0.09, 0.06, 0.08), M.gun(), 0.67, 0, 0)); // muzzle brake
  for (const z of [-0.042, 0.042]) barrel.add(mesh(box(0.06, 0.035, 0.006), M.dark(), 0.67, 0, z));
  elev.add(barrel);
  parts.elev = elev;
  parts.barrel = barrel;
  turret.add(elev);
  parts.turret = turret;
  root.add(turret);
  return { root, parts, height: 0.55 };
}

/**
 * A Worker in a work shirt with rolled sleeves, team-coloured overalls and a hard hat with a lamp,
 * a tool belt with a hammer, a short beard, a pick, and a basket on the back that fills with ore.
 */
function worker(team: number): Model {
  const shirt = mat('#cdb890', { rough: 0.95 }), glove = mat('#8e6438', { rough: 0.9 }), boot = mat('#4a3020', { rough: 0.85 });
  const tm = teamMat(team), td = teamMat(team, 'd');
  const m = soldier({ torso: shirt, legs: td, arms: M.skin(), boots: boot, hands: glove });
  const r = m.root;
  // overalls: team-coloured trousers up to the waist and a bib on the chest, held by two straps
  r.add(mesh(shell(0.19, 0.27, 0.007), td));
  r.add(rot(mesh(slab([[-0.052, 0], [0.052, 0], [0.048, 0.1], [-0.048, 0.1]], 0.012, 0.003), td, chest(0.31, 0.004), 0.265, 0), 0, -Math.PI / 2, 0)); // bib
  r.add(mesh(box(0.006, 0.03, 0.04), tm, chest(0.34, 0.012), 0.33, 0.016)); // bib pocket
  for (const z of [-0.042, 0.042]) {
    r.add(rod([chest(0.36, 0.006), 0.36, z], [0.0, 0.415, z * 1.45], 0.007, td, 4)); // straps over the shoulders
    r.add(rod([0.0, 0.415, z * 1.45], [-chest(0.33, 0.006), 0.27, z * 0.5], 0.007, td, 4));
    r.add(mesh(gem(0.009), M.brass(), chest(0.36, 0.01), 0.36, z)); // strap buttons
  }
  // tool belt: a wide leather belt slung low, a buckle, pouches on both hips and a hammer
  r.add(mesh(shell(0.205, 0.235, 0.016), M.leather()));
  r.add(mesh(box(0.008, 0.026, 0.032), M.brass(), chest(0.22, 0.02), 0.22, 0));
  for (const side of [-1, 1]) {
    r.add(mesh(loft([[0.14, 0.05, 0.03], [0.21, 0.056, 0.036], [0.225, 0.05, 0.034]], 6, 2.4), M.leather(), 0.03, 0, side * 0.094)); // pouch
    r.add(mesh(box(0.054, 0.014, 0.008), mat('#4a2c14'), 0.03, 0.205, side * 0.112)); // its flap
  }
  r.add(mesh(box(0.012, 0.12, 0.012), M.wood(), -0.03, 0.17, 0.118)); // hammer handle
  r.add(mesh(box(0.06, 0.024, 0.024), M.iron(), -0.03, 0.235, 0.118)); // hammer head
  // rolled sleeves: the shirt covers the upper arm, then a cuff
  for (const k of ['armL', 'armR']) {
    m.parts[k].add(mesh(taper(0.085, 0.066, 0.06, 6), shirt));
    m.parts[k].add(mesh(loft([[-0.096, 0.064, 0.064], [-0.078, 0.07, 0.07]], 6), shirt));
    m.parts[k].add(mesh(gem(0.034, 1.1, 0.7, 1.1), glove, 0, -0.165, 0)); // glove cuff
  }
  // a short beard and sideburns
  r.add(mesh(loft([[0.43, 0.06, 0.06], [0.45, 0.098, 0.1], [0.47, 0.096, 0.104]], 8), M.hair(), 0.012, 0, 0));
  r.add(mesh(box(0.012, 0.01, 0.05), M.hair(), 0.058, 0.468, 0)); // moustache
  // hard hat in team colour: a dome, a brim all round, a ridge over the crown and a lamp on the front
  r.add(mesh(turned([[0, 0], [0.098, 0], [0.098, 0.008], [0.076, 0.016], [0.074, 0.045], [0.06, 0.07], [0.034, 0.084], [0, 0.088]], 10), tm, -0.004, 0.488, 0));
  r.add(mesh(slab([[-0.07, 0.04], [-0.05, 0.07], [0, 0.088], [0.05, 0.07], [0.07, 0.04], [0.07, 0.05], [0.05, 0.078], [0, 0.098], [-0.05, 0.078], [-0.07, 0.05]], 0.022, 0.003), td, -0.004, 0.488, 0)); // ridge
  r.add(mesh(box(0.024, 0.03, 0.03), M.brass(), 0.078, 0.52, 0)); // lamp
  r.add(along(mesh(cyl(0.012, 0.012, 0.006, 8), M.lamp(), 0.092, 0.52, 0)));
  // wicker basket on the back with leather straps, heaped with ore as it fills
  r.add(mesh(turned([[0, 0], [0.055, 0], [0.07, 0.14], [0.064, 0.14], [0, 0.1]], 8), M.wattle(), -0.11, 0.29, 0));
  r.add(mesh(turned([[0.07, 0.13], [0.075, 0.13], [0.075, 0.145], [0.068, 0.145]], 8), M.leather(), -0.11, 0.29, 0)); // rim
  for (const z of [-0.05, 0.05]) r.add(rod([-0.06, 0.41, z], [-0.08, 0.31, z], 0.007, M.leather(), 4));
  const heap = mesh(gem(0.05, 1, 1, 1, 1), M.ore(), -0.11, 0.43, 0);
  m.parts.heap = heap;
  r.add(heap);
  // a pick held in the right fist: the haft runs through the hand (gripped near its butt) and
  // the iron head sits across its far end, so it moves with the arm when it swings
  m.parts.armR.rotation.z = 1.0;
  // the striking side (-y, it leads the downswing) curves to a long point; the back is a flat chisel
  const pick = group(0, -0.175, 0,
    mesh(loftX([[-0.07, 0.026, 0.026], [-0.055, 0.03, 0.03], [-0.04, 0.022, 0.022], [0.25, 0.02, 0.02]], 6), M.wood()), // haft
    mesh(loftX([[0.214, 0.03, 0.03], [0.258, 0.03, 0.03]], 6), M.iron()), // eye round the haft
    mesh(slab([[0.2, -0.15], [0.226, -0.07], [0.25, -0.02], [0.25, 0.02], [0.238, 0.06], [0.234, 0.1], [0.208, 0.1], [0.214, 0.06], [0.222, 0.02], [0.222, -0.02], [0.212, -0.07]], 0.022, 0.004), M.iron()),
    mesh(box(0.028, 0.008, 0.026), M.steel(), 0.221, 0.1, 0)); // the chisel's bright edge
  m.parts.gun = pick;
  m.parts.armR.add(pick);
  return m;
}

function harvester(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team), td = teamMat(team, 'd');
  for (const side of [-1, 1]) track(root, 0.94, 0.17, 0.14, side * 0.22, 5, null);
  root.add(mesh(slab([[-0.43, 0.15], [0.4, 0.15], [0.43, 0.2], [0.43, 0.27], [-0.43, 0.27]], 0.42, 0.01), M.darkSteel()));
  root.add(mesh(box(0.86, 0.04, 0.43), td, 0, 0.28, 0));
  for (let i = -3; i <= 3; i++) root.add(mesh(box(0.04, 0.04, 0.44), M.hazard(), i * 0.12, 0.26, 0)); // hazard stripes on the deck edge
  // cab: windows all round, roof beacon, light bar, mirror
  root.add(mesh(slab([[0.155, 0.27], [0.405, 0.27], [0.405, 0.38], [0.375, 0.51], [0.155, 0.51]], 0.38, 0.012), tm));
  root.add(mesh(slab([[0.145, 0.505], [0.4, 0.505], [0.41, 0.52], [0.4, 0.535], [0.145, 0.535]], 0.4, 0.008), td));
  root.add(rot(mesh(box(0.012, 0.1, 0.32), M.glass(), 0.397, 0.445, 0), 0, 0, -0.23));
  for (const z of [-0.191, 0.191]) root.add(mesh(box(0.16, 0.09, 0.004), M.glass(), 0.3, 0.44, z));
  root.add(mesh(cyl(0.025, 0.025, 0.04, 8), M.beacon(), 0.22, 0.555, 0.12));
  root.add(mesh(box(0.03, 0.025, 0.28), M.gun(), 0.39, 0.545, 0));
  for (const z of [-0.09, -0.03, 0.03, 0.09]) root.add(mesh(box(0.006, 0.016, 0.04), M.lamp(), 0.406, 0.545, z));
  // exhaust stack and an air filter
  root.add(mesh(cyl(0.022, 0.022, 0.32, 8), M.iron(), 0.12, 0.5, -0.17));
  root.add(mesh(cyl(0.03, 0.03, 0.03, 8), M.iron(), 0.12, 0.67, -0.17));
  root.add(mesh(cyl(0.04, 0.04, 0.1, 10), M.darkSteel(), 0.12, 0.37, 0.15));
  // ladder up the cab
  for (const y of [0.24, 0.3, 0.36]) root.add(mesh(box(0.06, 0.008, 0.008), M.steel(), 0.3, y, 0.215));
  // ore bin with ribs
  root.add(mesh(slab([[-0.39, 0.27], [0.09, 0.27], [0.1, 0.47], [-0.4, 0.47]], 0.4, 0.008), M.metalRoof()));
  for (const x of [-0.36, -0.24, -0.12, 0, 0.08]) root.add(mesh(box(0.025, 0.21, 0.41), M.darkSteel(), x, 0.37, 0));
  root.add(mesh(box(0.51, 0.025, 0.41), td, -0.15, 0.48, 0));
  root.add(mesh(box(0.12, 0.06, 0.003), tm, -0.15, 0.37, 0.206));
  root.add(mesh(box(0.12, 0.06, 0.003), tm, -0.15, 0.37, -0.206));
  const heap = mesh(gem(0.21, 1, 1, 1, 1), M.ore(), -0.15, 0.47, 0);
  heap.scale.set(1.05, 0.5, 0.85);
  parts.heap = heap;
  root.add(heap);
  // front scoop: blade, teeth, side plates and rams
  const scoop = group(0.47, 0.13, 0,
    mesh(box(0.06, 0.14, 0.44), M.darkSteel(), 0, 0, 0),
    mesh(box(0.065, 0.028, 0.444), M.hazard(), 0, 0.05, 0),
    mesh(box(0.1, 0.12, 0.02), M.darkSteel(), 0.03, 0, 0.22),
    mesh(box(0.1, 0.12, 0.02), M.darkSteel(), 0.03, 0, -0.22));
  for (let z = -0.18; z <= 0.18; z += 0.09) scoop.add(rot(mesh(cone(0.018, 0.06, 4), M.steel(), 0.07, -0.05, z), 0, 0, -Math.PI / 2));
  for (const z of [-0.12, 0.12]) scoop.add(rot(mesh(cyl(0.012, 0.012, 0.14, 6), M.steel(), -0.06, 0.07, z), 0, 0, 1.1));
  parts.scoop = scoop;
  root.add(scoop);
  return { root, parts, height: 0.62 };
}

/** A wooden cartwheel with spokes and an iron tyre; axle along z. */
function spokedWheel(root: THREE.Object3D, x: number, z: number, r: number): void {
  root.add(mesh(torus(r - 0.015, 0.022, Math.PI * 2, 5, 16), M.darkWood(), x, r, z));
  root.add(mesh(torus(r - 0.002, 0.01, Math.PI * 2, 4, 16), M.iron(), x, r, z));
  for (let i = 0; i < 4; i++) root.add(rot(mesh(box(0.016, r * 2 - 0.03, 0.016), M.wood(), x, r, z), 0, 0, (i * Math.PI) / 4));
  root.add(across(mesh(cyl(0.03, 0.03, 0.06, 8), M.iron(), x, r, z)));
}

function catapult(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const wood = M.wood(), dw = M.darkWood(), iron = M.iron(), tm = teamMat(team);
  for (const [x, z] of [[0.24, 0.23], [0.24, -0.23], [-0.24, 0.23], [-0.24, -0.23]]) spokedWheel(root, x, z, 0.12);
  for (const x of [-0.24, 0.24]) root.add(across(mesh(cyl(0.02, 0.02, 0.48, 6), iron, x, 0.12, 0)));
  // base frame with iron corner plates
  for (const z of [-0.18, 0.18]) {
    root.add(mesh(box(0.74, 0.07, 0.06), wood, 0, 0.2, z));
    for (const x of [-0.33, 0.33]) root.add(mesh(box(0.05, 0.075, 0.065), iron, x, 0.2, z));
    // uprights with diagonal braces
    root.add(mesh(box(0.06, 0.34, 0.06), wood, 0, 0.38, z));
    root.add(rod([0.22, 0.23, z], [0.02, 0.48, z], 0.018, dw, 5));
    root.add(rod([-0.22, 0.23, z], [-0.02, 0.48, z], 0.018, dw, 5));
    root.add(mesh(box(0.07, 0.04, 0.07), iron, 0, 0.53, z));
  }
  for (const x of [-0.3, 0.3, -0.1]) root.add(mesh(box(0.06, 0.06, 0.42), wood, x, 0.2, 0));
  // stop bar the arm slams into, padded with leather
  for (const z of [-0.18, 0.18]) root.add(rod([0.22, 0.23, z], [0.16, 0.66, z], 0.02, wood, 5));
  root.add(mesh(box(0.06, 0.06, 0.42), wood, 0.16, 0.66, 0));
  root.add(mesh(box(0.07, 0.07, 0.14), M.leather(), 0.15, 0.66, 0));
  // axle wound with twisted rope (the torsion bundle)
  root.add(across(mesh(cyl(0.025, 0.025, 0.42, 8), iron, 0, 0.52, 0)));
  for (const z of [-0.11, 0.11]) root.add(across(mesh(cyl(0.05, 0.05, 0.1, 10), M.rope(), 0, 0.52, z)));
  // windlass at the back
  root.add(across(mesh(cyl(0.03, 0.03, 0.38, 8), dw, -0.32, 0.27, 0)));
  for (const z of [-0.14, 0.14]) root.add(mesh(box(0.012, 0.12, 0.012), dw, -0.32, 0.27, z));
  // team banners on the sides and a pennant at the front
  for (const z of [0.215, -0.215]) {
    root.add(mesh(box(0.2, 0.12, 0.012), tm, -0.22, 0.31, z));
    root.add(mesh(box(0.2, 0.02, 0.014), M.gold(), -0.22, 0.37, z));
  }
  root.add(mesh(cyl(0.008, 0.008, 0.3, 4), dw, 0.34, 0.38, 0.19));
  root.add(mesh(box(0.1, 0.06, 0.005), tm, 0.4, 0.5, 0.19));
  // throwing arm on the axle: the bucket end rests low at the back and whips forward to fire
  const arm = group(0, 0.52, 0,
    mesh(box(0.72, 0.05, 0.05), wood, -0.26, 0, 0),
    mesh(box(0.025, 0.06, 0.06), iron, -0.1, 0, 0),
    mesh(box(0.025, 0.06, 0.06), iron, -0.35, 0, 0),
    mesh(box(0.12, 0.14, 0.14), iron, 0.12, -0.07, 0),
    rot(mesh(torus(0.065, 0.012, Math.PI * 2, 4, 12), iron, -0.6, 0.04, 0), Math.PI / 2, 0, 0),
    scl(mesh(dome(0.065), dw, -0.6, 0.0, 0), 1, 0.7, 1),
    rot(mesh(dome(0.065), dw, -0.6, 0.06, 0), Math.PI, 0, 0));
  parts.stone = mesh(dodeca(0.06), M.rock(), -0.6, 0.09, 0);
  arm.add(parts.stone);
  parts.arm = arm;
  root.add(arm);
  return { root, parts, height: 0.75 };
}

/** The same surface touched by Aether: tinted violet and faintly glowing. */
const aetherMats = new Map<Mat, Mat>();
function aetherTouched(m: Mat): Mat {
  let a = aetherMats.get(m);
  if (!a) {
    a = m.clone();
    if (a instanceof THREE.MeshStandardMaterial) {
      a.color.lerp(new THREE.Color('#8a50c0'), 0.35);
      a.emissive = new THREE.Color('#7a30e0');
      a.emissiveIntensity = 0.45;
    }
    aetherMats.set(m, a);
  }
  return a;
}

/** A hidden unit: its regular unit's model, steeped in Aether, with a shard floating above. */
function aetherUnit(type: UnitType, team: number): Model {
  const look = UNIT[type].look ?? 'rifleman', m = makeUnit(look, team);
  m.root.traverse((o) => { if (o instanceof THREE.Mesh) o.material = aetherTouched(o.material as Mat); });
  const shard = mesh(octa(0.07), M.aether(), 0, m.height + 0.12, 0);
  shard.scale.set(0.7, 1.4, 0.7);
  m.root.add(shard);
  return m;
}

function makeUnit(type: UnitType, team: number): Model {
  if (UNIT[type].beast) return creatureModel(type, team) ?? rifleman(team);
  if (UNIT[type].demon) return demonModel(type) ?? rifleman(team);
  if (UNIT[type].magic || UNIT[type].cyborg) return arcaneModel(type, team) ?? rifleman(team);
  if (UNIT[type].giant) return giantModel(team);
  if (type === 'chicken' || UNIT[type].hatches) return chickenModel(team, !!UNIT[type].hatches);
  if (UNIT[type].look) return aetherUnit(type, team);
  switch (type) {
    case 'rifleman': return rifleman(team);
    case 'gunner': return gunner(team);
    case 'rocket': return rocketeer(team);
    case 'swordsman': return swordsman(team);
    case 'guardian': return guardian(team);
    case 'flamer': return flamer(team);
    case 'crossbowman': return crossbowman(team);
    case 'knight': return knight(team);
    case 'medic': return medic(team);
    case 'spy': return spy(team);
    case 'jeep': return jeep(team);
    case 'tank': return tank(team, false);
    case 'heavy': return tank(team, true);
    case 'harvester': return harvester(team);
    case 'worker': return worker(team);
    case 'catapult': return catapult(team);
    case 'artillery': return artillery(team);
    case 'balloon': return balloon(team);
    case 'biplane': return biplane(team);
    case 'helicopter': return helicopter(team);
    case 'drone': return drone(team);
    case 'fighter': return fighter(team);
    case 'striker': return striker(team);
    default: return rifleman(team);
  }
}

export function unitModel(type: UnitType, team: number): Model {
  return cached(`u:${type}:${team}`, () => makeUnit(type, team));
}

// ---------------------------------------------------------------- buildings

function pad(s: number): THREE.Mesh {
  const p = mesh(box(s - 0.06, 0.06, s - 0.06), M.concrete(), 0, 0.03, 0);
  p.name = 'pad';
  return p;
}

/** A kerb around a pad's edge, so the slab reads as poured concrete. */
function kerb(root: THREE.Object3D, s: number): void {
  const e = s / 2 - 0.05;
  for (const side of [-1, 1]) {
    root.add(mesh(box(s - 0.04, 0.08, 0.04), M.lightConcrete(), 0, 0.04, side * e));
    root.add(mesh(box(0.04, 0.08, s - 0.04), M.lightConcrete(), side * e, 0.04, 0));
  }
}

/** A row of lit windows with sills on a wall facing +z (or -z with dir -1). */
function windows(root: THREE.Object3D, x0: number, x1: number, n: number, y: number, z: number, w = 0.14, h = 0.12): void {
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1);
    root.add(mesh(box(w, h, 0.02), M.window(), x, y, z));
    root.add(mesh(box(w + 0.04, 0.02, 0.05), M.lightConcrete(), x, y - h / 2 - 0.01, z));
    root.add(mesh(box(0.012, h, 0.024), M.darkSteel(), x, y, z));
  }
}

/** Rooftop clutter: vents and an air conditioner. */
function roofKit(root: THREE.Object3D, x: number, y: number, z: number): void {
  root.add(mesh(box(0.22, 0.1, 0.16), M.metalRoof(), x, y + 0.05, z));
  for (let i = 0; i < 3; i++) root.add(mesh(box(0.012, 0.08, 0.17), M.darkSteel(), x - 0.07 + i * 0.07, y + 0.05, z));
  root.add(mesh(cyl(0.04, 0.04, 0.1, 8), M.steel(), x + 0.22, y + 0.05, z - 0.05));
  root.add(mesh(cone(0.06, 0.05, 8), M.darkSteel(), x + 0.22, y + 0.125, z - 0.05));
}

function yard(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team);
  root.add(pad(3));
  kerb(root, 3);
  // main block
  root.add(mesh(box(1.9, 0.9, 1.5), M.lightConcrete(), -0.35, 0.51, -0.3));
  root.add(mesh(box(1.96, 0.06, 1.56), M.metalRoof(), -0.35, 0.99, -0.3));
  root.add(mesh(box(1.92, 0.1, 1.52), tm, -0.35, 0.82, -0.3));
  for (const x of [-1.29, 0.59]) for (const z of [-1.04, 0.44]) root.add(mesh(box(0.08, 0.92, 0.08), M.concrete(), x, 0.52, z)); // corner piers
  windows(root, -1.05, 0.35, 5, 0.62, 0.46);
  // big doors with a frame and a hazard lintel
  root.add(mesh(box(0.6, 0.42, 0.02), M.darkSteel(), -0.35, 0.27, 0.46));
  for (let i = 0; i < 6; i++) root.add(mesh(box(0.58, 0.012, 0.024), M.gun(), -0.35, 0.1 + i * 0.06, 0.465));
  root.add(mesh(box(0.7, 0.05, 0.05), M.hazard(), -0.35, 0.5, 0.47));
  // second storey control room with antennas
  root.add(mesh(box(0.7, 0.36, 0.6), M.lightConcrete(), -0.8, 1.2, -0.55));
  root.add(mesh(box(0.74, 0.04, 0.64), M.metalRoof(), -0.8, 1.4, -0.55));
  root.add(mesh(box(0.6, 0.14, 0.02), M.window(), -0.8, 1.24, -0.24));
  root.add(mesh(cyl(0.008, 0.008, 0.6, 4), M.gun(), -0.55, 1.7, -0.75));
  root.add(mesh(sph(0.025, 6, 4), M.redLamp(), -0.55, 2.0, -0.75));
  roofKit(root, 0.05, 1.02, -0.6);
  roofKit(root, -0.3, 1.02, 0.15);
  // crane: lattice mast, jib, counterweight, cab, hook
  const mast = new THREE.Group();
  mast.position.set(1.05, 0, 0.85);
  for (const [x, z] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) mast.add(mesh(box(0.025, 2.1, 0.025), M.hazard(), x, 1.1, z));
  for (let i = 0; i < 9; i++) {
    const y = 0.15 + i * 0.22;
    mast.add(rod([-0.06, y, 0.065], [0.06, y + 0.22, 0.065], 0.007, M.hazard(), 4));
    mast.add(rod([0.065, y, -0.06], [0.065, y + 0.22, 0.06], 0.007, M.hazard(), 4));
    mast.add(mesh(box(0.14, 0.015, 0.14), M.hazard(), 0, y, 0));
  }
  mast.add(mesh(box(0.3, 0.06, 0.3), M.concrete(), 0, 0.09, 0));
  root.add(mast);
  const crane = group(1.05, 2.18, 0.85,
    mesh(box(2.1, 0.09, 0.09), M.hazard(), -0.65, 0, 0),
    mesh(box(1.8, 0.02, 0.06), M.darkSteel(), -0.75, 0.07, 0),
    mesh(box(0.3, 0.22, 0.22), M.darkSteel(), 0.4, -0.05, 0), // counterweight
    mesh(box(0.14, 0.14, 0.14), M.hazard(), 0.05, -0.12, 0.1), // cab
    mesh(box(0.004, 0.08, 0.1), M.glass(), 0.12, -0.12, 0.1),
    mesh(cone(0.04, 0.3, 4), M.hazard(), 0, 0.19, 0), // peak
    rod([0, 0.33, 0], [-1.5, 0.04, 0], 0.005, M.gun(), 3),
    rod([0, 0.33, 0], [0.5, 0.04, 0], 0.005, M.gun(), 3),
    mesh(box(0.08, 0.04, 0.08), M.darkSteel(), -1.4, -0.04, 0),
    mesh(cyl(0.01, 0.01, 0.6, 4), M.gun(), -1.4, -0.35, 0),
    mesh(box(0.12, 0.08, 0.12), M.darkSteel(), -1.4, -0.68, 0),
    mesh(torus(0.03, 0.008, Math.PI * 1.4, 3, 8), M.steel(), -1.4, -0.75, 0),
    mesh(sph(0.025, 6, 4), M.redLamp(), -1.7, 0.06, 0));
  parts.crane = crane;
  root.add(crane);
  // radar dish on a tower
  for (const [x, z] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) root.add(mesh(box(0.02, 0.42, 0.02), M.gun(), -1.0 + x, 1.2, -0.75 + z));
  const dish = rot(mesh(lathe([[0, 0], [0.12, 0.02], [0.22, 0.06], [0.28, 0.11], [0.27, 0.115], [0.21, 0.07], [0.12, 0.035], [0, 0.015]], 16), M.white(), 0.06, 0, 0), 0, 0, -1.1);
  const radar = group(-1.0, 1.42, -0.75, dish,
    rot(mesh(cyl(0.008, 0.008, 0.2, 4), M.gun(), 0.12, 0.04, 0), 0, 0, -1.1),
    mesh(box(0.06, 0.06, 0.06), M.darkSteel(), 0, 0, 0));
  parts.radar = radar;
  root.add(radar);
  // yard clutter: crates, barrels, a team flag
  for (const [x, z, s] of [[0.6, 1.15, 0.16], [0.78, 1.15, 0.14], [0.68, 1.15, 0.12]]) root.add(mesh(box(s, s, s), M.wood(), x, 0.06 + s / 2 + (s === 0.12 ? 0.15 : 0), z));
  for (const [x, z] of [[-1.25, 1.1], [-1.13, 1.18], [-1.22, 0.96]]) {
    root.add(mesh(cyl(0.055, 0.055, 0.15, 10), mat('#3c5a7a', { rough: 0.6, metal: 0.4 }), x, 0.135, z));
    root.add(mesh(cyl(0.057, 0.057, 0.015, 10), M.darkSteel(), x, 0.17, z));
  }
  root.add(mesh(cyl(0.012, 0.012, 1.2, 6), M.steel(), 1.32, 0.66, -1.3));
  const flag = mesh(box(0.34, 0.2, 0.01), tm, 1.49, 1.14, -1.3);
  parts.flag = flag;
  root.add(flag);
  return { root, parts, height: 2.3 };
}

function powerPlant(team: number): Model {
  const root = new THREE.Group();
  const tm = teamMat(team);
  root.add(pad(2));
  kerb(root, 2);
  // hyperbolic cooling towers with rims, stripes and ladders
  const tower: [number, number][] = [[0.42, 0], [0.36, 0.4], [0.3, 0.85], [0.29, 1.05], [0.31, 1.3]];
  const parts: Parts = {};
  for (const x of [-0.45, 0.45]) {
    // where the steam rises from (see burn3d.ts)
    const vent = new THREE.Object3D();
    vent.position.set(x, 1.36, -0.2);
    root.add(vent);
    parts[`vent${x < 0 ? 0 : 1}`] = vent;
    root.add(mesh(lathe(tower, 20), M.lightConcrete(), x, 0.06, -0.2));
    root.add(mesh(torus(0.31, 0.018, Math.PI * 2, 4, 20), M.concrete(), x, 1.36, -0.2).rotateX(Math.PI / 2));
    root.add(mesh(cyl(0.29, 0.29, 0.02, 20), M.dark(), x, 1.3, -0.2));
    root.add(mesh(lathe([[0.336, 0], [0.326, 0.08]], 20), tm, x, 0.92, -0.2));
    root.add(mesh(lathe([[0.4, 0], [0.38, 0.06]], 20), M.concrete(), x, 0.06, -0.2));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      root.add(rot(mesh(box(0.04, 0.12, 0.06), M.concrete(), x + Math.cos(a) * 0.42, 0.1, -0.2 + Math.sin(a) * 0.42), 0, -a, 0));
    }
  }
  // generator hall with a stepped roof, vents and a door
  root.add(mesh(box(0.8, 0.36, 0.42), M.concrete(), 0, 0.24, 0.5));
  root.add(mesh(box(0.82, 0.08, 0.44), tm, 0, 0.38, 0.5));
  root.add(mesh(box(0.84, 0.03, 0.46), M.metalRoof(), 0, 0.435, 0.5));
  windows(root, -0.25, 0.25, 3, 0.25, 0.715, 0.12, 0.08);
  root.add(mesh(box(0.14, 0.2, 0.02), M.darkSteel(), 0.32, 0.16, 0.715));
  for (const x of [-0.2, 0.15]) {
    root.add(mesh(cyl(0.05, 0.05, 0.08, 10), M.steel(), x, 0.49, 0.5));
    root.add(mesh(cyl(0.055, 0.055, 0.015, 10), M.darkSteel(), x, 0.535, 0.5));
  }
  // pipes from the hall into each tower
  for (const x of [-0.45, 0.45]) root.add(rod([x * 0.4, 0.3, 0.3], [x * 0.85, 0.3, 0.05], 0.035, M.steel(), 8));
  // transformer with insulators and a warning sign
  root.add(mesh(box(0.22, 0.2, 0.18), M.darkSteel(), 0.72, 0.16, 0.65));
  for (let i = 0; i < 4; i++) root.add(mesh(box(0.005, 0.18, 0.19), M.gun(), 0.63 + i * 0.06, 0.16, 0.65));
  for (const z of [0.6, 0.65, 0.7]) for (let j = 0; j < 3; j++) root.add(mesh(cyl(0.018 - j * 0.002, 0.018 - j * 0.002, 0.025, 8), mat('#6a8a6a', { rough: 0.3 }), 0.72, 0.28 + j * 0.03, z));
  root.add(mesh(box(0.004, 0.06, 0.06), M.hazard(), 0.832, 0.16, 0.65));
  // chain-link fence posts along the front
  for (let i = 0; i < 6; i++) root.add(mesh(cyl(0.01, 0.01, 0.2, 4), M.steel(), -0.85 + i * 0.12, 0.15, 0.9));
  root.add(mesh(box(0.62, 0.006, 0.006), M.steel(), -0.55, 0.24, 0.9));
  return { root, parts, height: 1.45 };
}

/**
 * Power Plant, Modern: a solar and wind farm. Rows of tilted blue solar panels, a white wind turbine
 * whose blades turn (the `sails` part), a glass-fronted control centre, a bank of battery containers
 * and a substation. No smoke, no cooling towers: nothing like the Industrial coal plant.
 */
function solarPlant(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, tm = teamMat(team);
  root.add(pad(2));
  kerb(root, 2);
  const cell = mat('#1c3368', { rough: 0.2, metal: 0.6 }), frame = M.steel();
  // three rows of solar panels on steel legs, tilted to the sun
  for (const z of [0.12, 0.44, 0.76]) {
    for (const x of [-0.6, -0.08, 0.44]) {
      root.add(rot(group(x + 0.2, 0.2, z,
        mesh(box(0.48, 0.025, 0.24), frame, 0, 0, 0),
        mesh(box(0.46, 0.03, 0.22), cell, 0, 0.003, 0),
        mesh(box(0.006, 0.034, 0.22), frame, -0.115, 0.004, 0),
        mesh(box(0.006, 0.034, 0.22), frame, 0, 0.004, 0),
        mesh(box(0.006, 0.034, 0.22), frame, 0.115, 0.004, 0),
        mesh(box(0.46, 0.034, 0.006), frame, 0, 0.004, 0)), 0.45, 0, 0));
      for (const dx of [-0.15, 0.15]) root.add(mesh(box(0.02, 0.17, 0.02), M.darkSteel(), x + 0.2 + dx, 0.12, z - 0.04));
    }
  }
  // the wind turbine: a tall white tapered mast, a nacelle with a team band, three turning blades
  const tx = -0.62, tz = -0.6, hub = 1.38;
  root.add(mesh(cyl(0.1, 0.13, 0.08, 12), M.lightConcrete(), tx, 0.1, tz));
  root.add(mesh(cyl(0.035, 0.065, hub - 0.1, 10), M.white(), tx, 0.1 + (hub - 0.1) / 2, tz));
  root.add(mesh(box(0.12, 0.12, 0.28), M.white(), tx, hub, tz - 0.06));
  root.add(mesh(box(0.125, 0.03, 0.285), tm, tx, hub - 0.03, tz - 0.06));
  const rotor = new THREE.Group();
  rotor.position.set(tx, hub, tz + 0.1);
  rotor.add(rot(mesh(cone(0.05, 0.1, 10), M.white(), 0, 0, 0.03), Math.PI / 2, 0, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const blade = mesh(box(0.06, 0.52, 0.015), M.white(), 0, 0.28, 0);
    const arm = new THREE.Group();
    arm.rotation.z = a;
    arm.add(blade);
    arm.add(mesh(box(0.062, 0.06, 0.017), tm, 0, 0.5, 0)); // team-coloured tips
    rotor.add(arm);
  }
  root.add(rotor);
  parts.sails = rotor;
  // the control centre: white walls, a glass front, a team band and a rooftop dish
  const cx = 0.35, cz = -0.5;
  root.add(mesh(box(0.86, 0.4, 0.5), M.white(), cx, 0.26, cz));
  root.add(mesh(box(0.82, 0.3, 0.02), M.glass(), cx, 0.25, cz + 0.255));
  for (let i = 0; i < 5; i++) root.add(mesh(box(0.015, 0.32, 0.025), M.steel(), cx - 0.4 + i * 0.2, 0.25, cz + 0.26));
  root.add(mesh(box(0.9, 0.05, 0.54), tm, cx, 0.48, cz));
  root.add(mesh(box(0.88, 0.02, 0.52), M.metalRoof(), cx, 0.515, cz));
  root.add(mesh(box(0.2, 0.06, 0.14), M.steel(), cx + 0.2, 0.555, cz - 0.08));
  // battery containers along the back, green charge lights on each
  const charge = mat('#5cff8a', { emissive: '#3dff6a', emissiveIntensity: 1.2 });
  for (const x of [-0.25, 0.05]) {
    root.add(mesh(box(0.26, 0.2, 0.14), M.lightConcrete(), x, 0.16, -0.86));
    root.add(mesh(box(0.265, 0.03, 0.145), tm, x, 0.2, -0.86));
    root.add(mesh(box(0.03, 0.03, 0.01), charge, x + 0.08, 0.13, -0.785));
  }
  // substation: transformer and insulators
  root.add(mesh(box(0.18, 0.18, 0.16), M.darkSteel(), 0.82, 0.15, -0.84));
  for (const x of [0.77, 0.82, 0.87]) for (let j = 0; j < 3; j++) root.add(mesh(cyl(0.014, 0.014, 0.02, 8), mat('#6a8a6a', { rough: 0.3 }), x, 0.26 + j * 0.025, -0.84));
  return { root, parts, height: 1.8 };
}

function refinery(team: number): Model {
  const root = new THREE.Group();
  const tm = teamMat(team);
  root.add(pad(3));
  kerb(root, 3);
  // harvester dock with a hazard border and guide lights
  root.add(mesh(box(1.6, 0.03, 0.78), M.hazard(), 0, 0.075, 1.05));
  root.add(mesh(box(1.2, 0.04, 0.5), M.darkSteel(), 0, 0.1, 1.05));
  for (let i = 0; i < 8; i++) root.add(mesh(box(0.06, 0.042, 0.5), M.gun(), -0.52 + i * 0.15, 0.1, 1.05)); // grating
  for (const x of [-0.75, 0.75]) for (const z of [0.72, 1.38]) root.add(mesh(cyl(0.025, 0.025, 0.04, 8), M.beacon(), x, 0.11, z));
  // processing hall
  root.add(mesh(box(1.5, 0.8, 1.3), M.concrete(), -0.6, 0.47, -0.5));
  root.add(mesh(box(1.54, 0.05, 1.34), M.metalRoof(), -0.6, 0.89, -0.5));
  root.add(mesh(box(1.52, 0.1, 1.32), tm, -0.6, 0.75, -0.5));
  windows(root, -1.15, -0.05, 4, 0.55, 0.16);
  root.add(mesh(box(0.4, 0.3, 0.02), M.darkSteel(), -0.6, 0.22, 0.16));
  for (let i = 0; i < 5; i++) root.add(mesh(box(0.38, 0.01, 0.024), M.gun(), -0.6, 0.1 + i * 0.05, 0.165));
  roofKit(root, -0.9, 0.92, -0.7);
  // smokestack with team bands
  root.add(mesh(cyl(0.1, 0.13, 1.1, 12), M.brick(), -1.15, 1.4, -0.95));
  for (const y of [1.6, 1.85]) root.add(mesh(cyl(0.105, 0.105, 0.06, 12), tm, -1.15, y, -0.95));
  root.add(mesh(cyl(0.12, 0.1, 0.05, 12), M.dark(), -1.15, 1.97, -0.95));
  const flue = new THREE.Object3D();
  flue.position.set(-1.15, 2.0, -0.95);
  root.add(flue);
  // storage silos with ladders and hoops
  root.add(mesh(cyl(0.33, 0.33, 1.15, 18), M.white(), 0.85, 0.64, -0.8));
  root.add(mesh(dome(0.33), M.white(), 0.85, 1.21, -0.8));
  root.add(mesh(cyl(0.28, 0.28, 0.85, 18), M.white(), 0.85, 0.49, 0.1));
  root.add(mesh(cyl(0.29, 0.29, 0.06, 18), tm, 0.85, 0.8, 0.1));
  for (const y of [0.3, 0.65, 1.0]) root.add(mesh(cyl(0.335, 0.335, 0.02, 18), M.darkSteel(), 0.85, y, -0.8));
  for (const y of [0.3, 0.6]) root.add(mesh(cyl(0.285, 0.285, 0.02, 18), M.darkSteel(), 0.85, y, 0.1));
  for (const dz of [-0.04, 0.04]) root.add(mesh(box(0.012, 1.2, 0.012), M.steel(), 1.19, 0.66, -0.8 + dz));
  for (let i = 0; i < 12; i++) root.add(mesh(box(0.01, 0.008, 0.09), M.steel(), 1.19, 0.12 + i * 0.1, -0.8));
  root.add(mesh(cyl(0.29, 0.29, 0.03, 18), M.steel(), 0.85, 0.94, 0.1)); // catwalk ring
  // pipework: hall to silos, a valve wheel, and an ore chute over the dock
  root.add(along(mesh(cyl(0.05, 0.05, 0.6, 8), M.darkSteel(), 0.4, 0.6, -0.6)));
  root.add(along(mesh(cyl(0.04, 0.04, 0.5, 8), M.steel(), 0.4, 0.35, 0.05)));
  root.add(mesh(torus(0.05, 0.008, Math.PI * 2, 3, 10), M.redLamp(), 0.4, 0.42, 0.05));
  for (const x of [0.25, 0.55]) root.add(along(mesh(cyl(0.06, 0.06, 0.03, 8), M.darkSteel(), x, 0.6, -0.6)));
  root.add(rot(mesh(box(0.2, 0.06, 0.4), M.darkSteel(), 0.05, 0.5, 0.45), 0.5, 0, 0));
  root.add(mesh(box(0.22, 0.02, 0.42), M.hazard(), 0.05, 0.535, 0.43).rotateX(0.5));
  return { root, parts: { flue0: flue }, height: 1.5 };
}

function barracks(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team), olive = M.olive();
  root.add(pad(2));
  kerb(root, 2);
  // Quonset hut with ribs, side windows and a front wall
  root.add(mesh(new THREE.CylinderGeometry(0.58, 0.58, 1.4, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), olive, 0, 0.06, -0.12));
  root.add(mesh(new THREE.CircleGeometry(0.58, 16, 0, Math.PI), olive, 0, 0.06, 0.58));
  for (let i = 0; i < 6; i++) root.add(mesh(torus(0.585, 0.014, Math.PI, 3, 16), M.darkSteel(), 0, 0.06, -0.8 + i * 0.27));
  for (const side of [-1, 1]) for (const z of [-0.5, 0, 0.35]) root.add(rot(mesh(box(0.02, 0.1, 0.14), M.window(), side * 0.43, 0.45, z), 0, 0, side * 0.74));
  // door with a frame, canopy and steps
  root.add(mesh(box(0.3, 0.38, 0.03), M.darkWood(), 0, 0.25, 0.6));
  root.add(mesh(box(0.36, 0.03, 0.04), M.darkSteel(), 0, 0.45, 0.6));
  for (const x of [-0.165, 0.165]) root.add(mesh(box(0.03, 0.4, 0.04), M.darkSteel(), x, 0.26, 0.6));
  root.add(rot(mesh(box(0.44, 0.02, 0.16), tm, 0, 0.5, 0.67), 0.25, 0, 0));
  root.add(mesh(box(0.34, 0.04, 0.1), M.concrete(), 0, 0.08, 0.66));
  root.add(mesh(sph(0.02, 6, 4), M.lamp(), 0, 0.52, 0.62));
  for (const x of [-0.35, 0.35]) root.add(mesh(box(0.16, 0.12, 0.02), M.window(), x, 0.3, 0.59));
  root.add(mesh(box(1.18, 0.05, 0.03), tm, 0, 0.5, 0.59));
  // sandbag walls, two courses, staggered
  for (const z of [0.86, -0.88]) for (let i = 0; i < 7; i++) {
    root.add(mesh(box(0.16, 0.08, 0.1), M.sandbag(), -0.75 + i * 0.25, 0.1, z));
    if (i < 6) root.add(mesh(box(0.16, 0.07, 0.1), M.sandbag(), -0.625 + i * 0.25, 0.175, z));
  }
  // crates and a rifle rack
  for (const [x, z, s] of [[-0.78, 0.7, 0.14], [-0.62, 0.72, 0.12]]) {
    root.add(mesh(box(s, s, s), M.wood(), x, 0.06 + s / 2, z));
    root.add(mesh(box(s + 0.005, 0.015, s + 0.005), M.darkWood(), x, 0.06 + s / 2, z));
  }
  root.add(mesh(box(0.3, 0.04, 0.04), M.darkWood(), 0.6, 0.3, 0.68));
  for (let i = 0; i < 4; i++) root.add(rot(mesh(box(0.012, 0.26, 0.02), M.gun(), 0.48 + i * 0.08, 0.2, 0.7), 0.15, 0, 0));
  // flagpole with a finial
  root.add(mesh(cyl(0.015, 0.015, 1.3, 6), M.steel(), 0.85, 0.65, 0.75));
  root.add(mesh(sph(0.025, 8, 6), M.gold(), 0.85, 1.31, 0.75));
  root.add(mesh(box(0.1, 0.05, 0.1), M.concrete(), 0.85, 0.085, 0.75));
  const flag = mesh(box(0.32, 0.18, 0.01), tm, 1.01, 1.18, 0.75);
  parts.flag = flag;
  root.add(flag);
  return { root, parts, height: 1.3 };
}

function factory(team: number): Model {
  const root = new THREE.Group();
  const tm = teamMat(team);
  root.add(pad(3));
  kerb(root, 3);
  root.add(mesh(box(2.7, 1.0, 2.1), M.concrete(), 0, 0.56, -0.3));
  root.add(mesh(box(2.72, 0.14, 2.12), tm, 0, 0.92, -0.3));
  root.add(mesh(box(2.78, 0.04, 2.18), M.metalRoof(), 0, 1.01, -0.3));
  // sawtooth roof with north lights
  for (let i = 0; i < 4; i++) {
    const z = -1.1 + i * 0.5;
    root.add(rot(mesh(box(2.6, 0.03, 0.5), M.metalRoof(), 0, 1.15, z + 0.02), 0.5, 0, 0));
    root.add(mesh(box(2.6, 0.22, 0.02), M.glass(), 0, 1.13, z + 0.24));
  }
  // wall pilasters
  for (let i = 0; i < 6; i++) root.add(mesh(box(0.06, 0.98, 0.05), M.lightConcrete(), -1.33 + i * 0.532, 0.55, 0.76));
  // roller door with slats, frame and hazard lintel
  root.add(mesh(box(1.3, 0.72, 0.03), M.darkSteel(), 0, 0.42, 0.76));
  for (let i = 0; i < 12; i++) root.add(mesh(box(1.28, 0.012, 0.036), M.gun(), 0, 0.1 + i * 0.06, 0.77));
  root.add(mesh(box(1.3, 0.06, 0.04), M.hazard(), 0, 0.81, 0.76));
  for (const x of [-0.68, 0.68]) {
    root.add(mesh(box(0.06, 0.78, 0.06), M.hazard(), x, 0.45, 0.77));
    for (let i = 0; i < 5; i++) root.add(mesh(box(0.062, 0.06, 0.062), M.dark(), x, 0.15 + i * 0.15, 0.77));
  }
  for (const x of [-1.05, 1.05]) {
    windows(root, x, x, 1, 0.62, 0.76, 0.4, 0.12);
    root.add(mesh(sph(0.04), M.lamp(), x * 0.75, 0.88, 0.78));
    root.add(mesh(box(0.2, 0.25, 0.02), M.darkSteel(), x, 0.2, 0.77));
  }
  windows(root, -1.0, 1.0, 5, 0.62, -1.36, 0.22, 0.1);
  // chimneys and rooftop fans
  for (const [x, z] of [[-1.0, -1.0], [-0.7, -1.0]]) {
    root.add(mesh(cyl(0.08, 0.1, 0.8, 10), M.brick(), x, 1.4, z));
    root.add(mesh(cyl(0.09, 0.09, 0.05, 10), M.dark(), x, 1.8, z));
    root.add(mesh(cyl(0.085, 0.085, 0.05, 10), tm, x, 1.6, z));
  }
  for (const x of [0.4, 0.9]) {
    root.add(mesh(cyl(0.12, 0.12, 0.08, 12), M.steel(), x, 1.29, -0.95));
    root.add(mesh(box(0.2, 0.01, 0.03), M.dark(), x, 1.335, -0.95));
  }
  // loading ramp with chevrons
  root.add(mesh(box(1.3, 0.02, 0.9), M.hazard(), 0, 0.065, 1.15));
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) root.add(rot(mesh(box(0.06, 0.022, 0.34), M.dark(), s * 0.15, 0.067, 0.9 + i * 0.2), 0, s * 0.8, 0));
  return { root, parts: {}, height: 1.3 };
}

function turret(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team), tl = teamMat(team, 'l');
  // octagonal bunker, armored ring, sandbags and an ammo crate
  root.add(mesh(cyl(0.4, 0.46, 0.22, 8), M.concrete(), 0, 0.11, 0));
  root.add(mesh(cyl(0.41, 0.41, 0.03, 8), M.lightConcrete(), 0, 0.225, 0));
  root.add(mesh(cyl(0.3, 0.3, 0.04, 16), M.darkSteel(), 0, 0.24, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    root.add(mesh(sph(0.012, 4, 3), M.steel(), Math.cos(a) * 0.27, 0.262, Math.sin(a) * 0.27));
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    root.add(rot(mesh(box(0.06, 0.02, 0.19), tm, Math.cos(a) * 0.43, 0.1, Math.sin(a) * 0.43), 0, -a, 0));
  }
  root.add(mesh(box(0.12, 0.08, 0.08), mat('#4a5a2a'), -0.3, 0.27, 0.22));
  // gun house with a mantlet, sight and a vent
  const head = group(0, 0.33, 0,
    mesh(cyl(0.22, 0.25, 0.16, 16), tl, 0, 0, 0),
    mesh(cyl(0.2, 0.22, 0.03, 16), tm, 0, 0.095, 0),
    mesh(box(0.1, 0.13, 0.18), tm, 0.2, 0, 0),
    mesh(box(0.06, 0.05, 0.05), M.darkSteel(), 0.05, 0.11, 0.1),
    mesh(box(0.01, 0.025, 0.03), M.glass(), 0.08, 0.11, 0.1),
    mesh(cyl(0.04, 0.04, 0.04, 8), M.darkSteel(), -0.1, 0.11, -0.06),
    mesh(box(0.1, 0.08, 0.2), M.darkSteel(), -0.24, 0, 0));
  const barrel = group(0.14, 0.01, 0,
    along(mesh(cyl(0.035, 0.04, 0.55, 10), M.gun(), 0.27, 0, 0)),
    along(mesh(cyl(0.05, 0.05, 0.1, 10), M.gun(), 0.25, 0, 0)),
    mesh(box(0.08, 0.06, 0.08), M.gun(), 0.56, 0, 0),
    mesh(box(0.06, 0.035, 0.084), M.dark(), 0.56, 0, 0));
  head.add(barrel);
  parts.turret = head;
  parts.barrel = barrel;
  root.add(head);
  return { root, parts, height: 0.6 };
}

/** Engine Works: a sheet-roofed machine hall with two smokestacks, a fuel tank and a team banner. */
function engineWorks(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, tm = teamMat(team);
  root.add(pad(2));
  kerb(root, 2);
  // hall with a pitched sheet roof and big doors facing +z
  root.add(mesh(box(1.3, 0.55, 1.0), M.concrete(), -0.2, 0.33, -0.15));
  root.add(rot(mesh(box(1.34, 0.04, 0.58), M.metalRoof(), -0.2, 0.7, -0.38), 0.45, 0, 0));
  root.add(rot(mesh(box(1.34, 0.04, 0.58), M.metalRoof(), -0.2, 0.7, 0.08), -0.45, 0, 0));
  root.add(mesh(box(0.5, 0.4, 0.02), M.darkSteel(), -0.2, 0.26, 0.36));
  root.add(mesh(box(1.3, 0.08, 0.02), tm, -0.2, 0.52, 0.36));
  windows(root, -0.75, 0.35, 4, 0.45, 0.36);
  // smokestacks
  for (const x of [-0.65, -0.35]) {
    root.add(mesh(cyl(0.07, 0.09, 0.9, 12), M.lightConcrete(), x, 0.95, -0.5));
    root.add(mesh(cyl(0.08, 0.08, 0.05, 12), M.dark(), x, 1.41, -0.5));
    const flue = new THREE.Object3D();
    flue.position.set(x, 1.44, -0.5);
    root.add(flue);
    parts[`flue${x < -0.5 ? 0 : 1}`] = flue;
  }
  // fuel tank and pipe to the hall
  root.add(mesh(cyl(0.22, 0.22, 0.5, 16), M.steel(), 0.68, 0.31, -0.45));
  root.add(mesh(cyl(0.23, 0.23, 0.06, 16), tm, 0.68, 0.42, -0.45));
  root.add(rod([0.5, 0.15, -0.4], [0.45, 0.15, -0.2], 0.03, M.darkSteel(), 8));
  // crates of parts by the door
  for (const [x, z] of [[0.6, 0.45], [0.75, 0.3]]) root.add(mesh(box(0.16, 0.14, 0.16), M.wood(), x, 0.13, z));
  return { root, parts, height: 1.45 };
}

/**
 * Oil Derrick: a big pump jack that fills most of its pad and stands well above the buildings
 * around it. Its walking beam nods (the `pump` part) on a tall A-frame, with a heavy horse head
 * over the wellhead and a counterweight over the gearbox. A small storage tank sits at the back.
 */
function derrick(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, tm = teamMat(team);
  root.add(pad(2));
  kerb(root, 2);
  // storage tank with a team band and a ladder, tucked into the back corner
  root.add(mesh(cyl(0.24, 0.24, 0.6, 18), M.steel(), 0.66, 0.36, -0.66));
  root.add(mesh(cyl(0.25, 0.25, 0.07, 18), tm, 0.66, 0.48, -0.66));
  root.add(mesh(cyl(0.25, 0.23, 0.05, 18), M.darkSteel(), 0.66, 0.68, -0.66));
  root.add(mesh(box(0.05, 0.6, 0.02), M.darkSteel(), 0.66, 0.36, -0.41));
  // skid the jack stands on
  root.add(mesh(box(1.9, 0.08, 0.5), M.darkSteel(), -0.02, 0.1, 0.15));
  // samson post: a tall braced A-frame
  const px = -0.06, top = 1.42;
  for (const z of [-0.04, 0.34]) {
    root.add(rod([px - 0.38, 0.12, z], [px, top, 0.15], 0.045, M.darkSteel(), 6));
    root.add(rod([px + 0.38, 0.12, z], [px, top, 0.15], 0.045, M.darkSteel(), 6));
    root.add(rod([px - 0.26, 0.55, z], [px + 0.26, 0.55, z], 0.025, M.darkSteel(), 6));
  }
  root.add(mesh(box(0.14, 0.1, 0.46), M.darkSteel(), px, top, 0.15));
  // walking beam, horse head and counterweight, pivoting on the post
  const pump = group(px, top + 0.07, 0.15,
    mesh(box(1.66, 0.14, 0.13), M.hazard(), 0, 0, 0),
    mesh(box(0.2, 0.5, 0.18), M.hazard(), -0.78, -0.12, 0),
    mesh(box(0.08, 0.36, 0.18), M.hazard(), -0.9, -0.12, 0),
    mesh(cyl(0.22, 0.22, 0.09, 18), M.darkSteel(), 0.76, -0.22, 0).rotateX(Math.PI / 2),
    mesh(box(0.1, 0.1, 0.2), M.dark(), 0, 0, 0),
    mesh(box(0.05, 0.5, 0.05), M.darkSteel(), 0.76, -0.46, 0));
  parts.pump = pump;
  root.add(pump);
  // gearbox and motor under the counterweight
  root.add(mesh(box(0.36, 0.42, 0.34), M.darkSteel(), 0.7, 0.35, 0.15));
  root.add(mesh(cyl(0.12, 0.12, 0.38, 14), M.steel(), 0.7, 0.42, 0.15).rotateX(Math.PI / 2));
  root.add(mesh(box(0.26, 0.2, 0.24), tm, 0.7, 0.66, 0.15));
  // wellhead under the horse head, the polished rod, and the pipe to the tank
  root.add(mesh(cyl(0.08, 0.11, 0.24, 10), M.darkSteel(), -0.96, 0.18, 0.15));
  root.add(mesh(cyl(0.09, 0.09, 0.05, 10), tm, -0.96, 0.3, 0.15));
  root.add(mesh(cyl(0.016, 0.016, 0.8, 6), M.steel(), -0.96, 0.7, 0.15));
  root.add(rod([-0.96, 0.12, 0.15], [0.66, 0.12, -0.42], 0.035, M.darkSteel(), 8));
  return { root, parts, height: 1.75 };
}

/** A Hospital is a barracks-sized ward with a red-cross sign out front. */
function hospital(m: Model): Model {
  const red = mat('#c42a22', { rough: 0.7 }), h = Math.max(0.7, m.height * 0.8);
  m.root.add(mesh(cyl(0.025, 0.03, h, 6), M.darkWood(), 0.78, h / 2, 0.82));
  m.root.add(group(0.78, h + 0.1, 0.82,
    mesh(box(0.3, 0.3, 0.03), M.white(), 0, 0, 0),
    mesh(box(0.07, 0.22, 0.04), red, 0, 0, 0),
    mesh(box(0.22, 0.07, 0.04), red, 0, 0, 0)));
  return m;
}

/**
 * Armory, Industrial and Modern: an arsenal. A flat-roofed, windowless magazine with a stepped
 * parapet, a tall square chimney from its foundry (the `flue0` part smokes), a roller door under the
 * team's crossed-swords crest, and a yard of shell pyramids, ammunition crates and a gun barrel on
 * trestles. Squared off and chimneyed, so it never reads as the Barracks' round hut.
 */
function arsenal(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, tm = teamMat(team);
  root.add(pad(2));
  kerb(root, 2);
  // the magazine: thick walls, a parapet, a team band, roof vents
  root.add(mesh(box(1.5, 0.62, 0.86), M.concrete(), 0, 0.37, -0.45));
  root.add(mesh(box(1.56, 0.08, 0.92), M.lightConcrete(), 0, 0.72, -0.45));
  root.add(mesh(box(1.52, 0.06, 0.88), tm, 0, 0.6, -0.45));
  root.add(mesh(box(0.7, 0.2, 0.6), M.concrete(), -0.3, 0.86, -0.5));
  root.add(mesh(box(0.74, 0.04, 0.64), M.metalRoof(), -0.3, 0.98, -0.5));
  for (const x of [0.25, 0.5]) {
    root.add(mesh(cyl(0.05, 0.05, 0.1, 10), M.steel(), x, 0.81, -0.6));
    root.add(mesh(cone(0.07, 0.05, 10), M.darkSteel(), x, 0.885, -0.6));
  }
  // buttresses along the front
  for (const x of [-0.72, -0.2, 0.2, 0.72]) root.add(rot(mesh(box(0.08, 0.5, 0.14), M.lightConcrete(), x, 0.27, -0.0), -0.18, 0, 0));
  // roller door with hazard stripes, and the crest over it
  root.add(mesh(box(0.5, 0.42, 0.02), M.darkSteel(), -0.0, 0.27, -0.01));
  for (let i = 0; i < 6; i++) root.add(mesh(box(0.5, 0.008, 0.024), M.gun(), 0, 0.1 + i * 0.065, -0.005));
  for (let i = 0; i < 6; i++) root.add(rot(mesh(box(0.05, 0.05, 0.022), i % 2 ? M.dark() : M.hazard(), -0.22 + i * 0.088, 0.075, 0.0), 0, 0, Math.PI / 4));
  root.add(group(0, 0.57, 0.0,
    mesh(box(0.24, 0.2, 0.03), tm, 0, 0.02, 0),
    rot(mesh(cone(0.12, 0.1, 4), tm, 0, -0.12, 0), Math.PI, Math.PI / 4, 0),
    rot(mesh(box(0.03, 0.3, 0.04), M.steel(), 0, 0, 0.02), 0, 0, 0.7),
    rot(mesh(box(0.03, 0.3, 0.04), M.steel(), 0, 0, 0.02), 0, 0, -0.7)));
  // foundry chimney at the back corner
  root.add(mesh(box(0.22, 1.5, 0.22), M.brick(), 0.62, 0.8, -0.72));
  for (const y of [1.2, 1.4]) root.add(mesh(box(0.235, 0.05, 0.235), tm, 0.62, y, -0.72));
  root.add(mesh(box(0.27, 0.05, 0.27), M.darkStone(), 0.62, 1.57, -0.72));
  const flue = new THREE.Object3D();
  flue.position.set(0.62, 1.6, -0.72);
  root.add(flue);
  parts.flue0 = flue;
  // the yard: a pyramid of shells, ammunition crates, a gun barrel on trestles
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 3 - row; i++) {
      const x = -0.75 + i * 0.09 + row * 0.045, y = 0.1 + row * 0.075;
      root.add(along(mesh(cyl(0.035, 0.035, 0.22, 8), M.brass(), x, y, 0.45)));
    }
  for (const [x, z, h] of [[-0.42, 0.62, 0], [-0.42, 0.62, 1], [-0.25, 0.65, 0]] as const) {
    root.add(mesh(box(0.16, 0.1, 0.12), M.olive(), x, 0.11 + h * 0.1, z));
    root.add(mesh(box(0.165, 0.02, 0.125), tm, x, 0.11 + h * 0.1, z));
  }
  for (const x of [0.3, 0.7]) root.add(mesh(box(0.05, 0.14, 0.2), M.darkWood(), x, 0.13, 0.55));
  root.add(along(mesh(cyl(0.05, 0.07, 0.7, 12), M.gun(), 0.5, 0.24, 0.55)));
  root.add(along(mesh(cyl(0.065, 0.065, 0.06, 12), M.darkSteel(), 0.2, 0.24, 0.55)));
  return { root, parts, height: 1.6 };
}

function makeBuilding(type: Exclude<BldType, 'airfield' | 'flak' | 'hospital' | 'armory' | 'magetower' | AetherBld | FixedLook>, team: number): Model {
  switch (type) {
    case 'yard': return yard(team);
    case 'power': return powerPlant(team);
    case 'refinery': return refinery(team);
    case 'barracks': return barracks(team);
    case 'factory': return factory(team);
    case 'turret': return turret(team);
    case 'tower': case 'mill': case 'camp': return medievalBuilding(type, team, 'stone');
    case 'derrick': return derrick(team);
    case 'works': return engineWorks(team);
  }
}

/** Walls and the newer defenses look the same in every age (each belongs to one). */
type FixedLook = 'palisade' | 'stonewall' | 'concretewall' | 'pillbox' | 'atturret' | 'bertha';
const FIXED_LOOK = new Set<BldType>(['palisade', 'stonewall', 'concretewall', 'pillbox', 'atturret', 'bertha']);
const isFixedLook = (t: BldType): t is FixedLook => FIXED_LOOK.has(t);

/** A flagpole with a waving team flag (the `flag` part). */
function hallFlag(root: THREE.Object3D, parts: Parts, team: number, x: number, y: number, z: number, h: number): void {
  root.add(mesh(cyl(0.012, 0.015, h, 6), M.steel(), x, y + h / 2, z));
  root.add(mesh(sph(0.022, 8, 6), M.gold(), x, y + h + 0.01, z));
  const flag = group(x, y + h - 0.1, z,
    mesh(box(0.3, 0.16, 0.01), teamMat(team), 0.15, 0, 0),
    mesh(box(0.1, 0.16, 0.012), teamMat(team, 'd'), 0.27, 0, 0));
  parts.flag = flag;
  root.add(flag);
}

/**
 * The Town Hall in the Industrial age: a brick civic hall with a columned stone porch and a clock
 * tower. (The Medieval hall is a timber longhouse inside a palisade: see medieval.ts.)
 */
function townHallBrick(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, tm = teamMat(team);
  const p = pad(3);
  p.material = M.darkStone();
  root.add(p);
  const hz = -0.35, front = hz + 0.55;
  root.add(mesh(box(2.3, 0.12, 1.2), M.dressedStone(), 0, 0.12, hz)); // plinth
  root.add(mesh(box(2.2, 0.8, 1.1), M.brick(), 0, 0.56, hz));
  root.add(mesh(box(2.28, 0.06, 1.18), M.dressedStone(), 0, 0.98, hz)); // cornice
  root.add(mesh(prism(2.24, 1.14, 0.38), M.slate(), 0, 1.01, hz));
  for (const x of [-1.1, 1.1]) root.add(mesh(box(0.06, 0.9, 1.12), M.dressedStone(), x, 0.56, hz)); // quoins
  // tall windows either side of the porch, and a row upstairs
  windows(root, -0.95, -0.6, 2, 0.5, front + 0.005, 0.12, 0.26);
  windows(root, 0.6, 0.95, 2, 0.5, front + 0.005, 0.12, 0.26);
  // columned porch with a pediment, and steps up to the doors
  for (const x of [-0.42, -0.14, 0.14, 0.42]) root.add(mesh(cyl(0.045, 0.05, 0.66, 10), M.dressedStone(), x, 0.51, front + 0.3));
  root.add(mesh(box(1.12, 0.08, 0.4), M.dressedStone(), 0, 0.88, front + 0.17));
  root.add(rot(mesh(prism(0.36, 1.12, 0.24), M.dressedStone(), 0, 0.92, front + 0.17), 0, Math.PI / 2, 0));
  root.add(mesh(box(0.5, 0.06, 0.02), tm, 0, 0.88, front + 0.375));
  for (let i = 0; i < 3; i++) root.add(mesh(box(1.1 - i * 0.08, 0.05, 0.14), M.dressedStone(), 0, 0.03 + i * 0.05, front + 0.55 - i * 0.1));
  root.add(mesh(box(0.3, 0.44, 0.02), M.darkWood(), 0, 0.4, front + 0.005));
  for (const x of [-0.27, 0.27]) root.add(mesh(box(0.12, 0.3, 0.012), tm, x, 0.55, front + 0.012)); // banners
  // clock tower rising from the ridge
  const tz = hz - 0.1;
  root.add(mesh(box(0.44, 1.25, 0.44), M.brick(), 0, 1.45, tz));
  root.add(mesh(box(0.5, 0.06, 0.5), M.dressedStone(), 0, 2.1, tz));
  for (const [dx, dz, ry] of [[0, 0.225, 0], [0, -0.225, Math.PI], [0.225, 0, Math.PI / 2], [-0.225, 0, -Math.PI / 2]] as const) {
    const face = group(dx, 1.85, tz + dz,
      rot(mesh(cyl(0.14, 0.14, 0.02, 16), M.dressedStone(), 0, 0, 0), Math.PI / 2, 0, 0),
      rot(mesh(cyl(0.12, 0.12, 0.022, 16), M.white(), 0, 0, 0.002), Math.PI / 2, 0, 0),
      mesh(box(0.01, 0.09, 0.008), M.dark(), 0, 0.04, 0.016),
      rot(mesh(box(0.008, 0.07, 0.008), M.dark(), 0.025, 0.01, 0.016), 0, 0, -1.2));
    face.rotation.y = ry;
    root.add(face);
  }
  // open belfry and a slate spire
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) root.add(mesh(box(0.06, 0.3, 0.06), M.dressedStone(), sx * 0.19, 2.28, tz + sz * 0.19));
  root.add(mesh(cyl(0.07, 0.09, 0.12, 10), M.bronze(), 0, 2.25, tz)); // bell
  root.add(mesh(box(0.48, 0.05, 0.48), M.dressedStone(), 0, 2.45, tz));
  root.add(rot(mesh(cone(0.34, 0.55, 4), M.slate(), 0, 2.74, tz), 0, Math.PI / 4, 0));
  root.add(mesh(sph(0.03, 8, 6), M.gold(), 0, 3.03, tz));
  // chimneys, lamp posts and a flag out front
  for (const x of [-0.75, 0.75]) root.add(mesh(box(0.14, 0.4, 0.14), M.brick(), x, 1.25, hz - 0.2));
  for (const x of [-0.75, 0.75]) {
    root.add(mesh(cyl(0.012, 0.016, 0.5, 6), M.iron(), x, 0.25, 0.95));
    root.add(mesh(sph(0.04, 8, 6), M.lamp(), x, 0.52, 0.95));
  }
  hallFlag(root, parts, team, 1.15, 0, 1.1, 1.0);
  return { root, parts, height: 3.0 };
}

/** The Town Hall in the Modern age: a glass and concrete civic tower on a podium, with a helipad. */
function townHallModern(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, tm = teamMat(team);
  root.add(pad(3));
  kerb(root, 3);
  // podium with a glass lobby
  root.add(mesh(box(2.4, 0.45, 1.5), M.lightConcrete(), 0, 0.28, -0.3));
  root.add(mesh(box(1.4, 0.32, 0.02), M.glass(), 0.2, 0.24, 0.46));
  root.add(mesh(box(2.44, 0.05, 1.54), tm, 0, 0.52, -0.3));
  // the tower: glass between concrete fins, a floor band every storey
  const tx = -0.5, tz = -0.5, th = 2.0;
  root.add(mesh(box(0.95, th, 0.8), M.glass(), tx, 0.5 + th / 2, tz));
  for (let i = 0; i <= 5; i++) root.add(mesh(box(0.06, th, 0.06), M.lightConcrete(), tx - 0.475 + i * 0.19, 0.5 + th / 2, tz + 0.41));
  for (let i = 1; i <= 6; i++) root.add(mesh(box(0.99, 0.04, 0.84), M.concrete(), tx, 0.5 + (i * th) / 6, tz));
  root.add(mesh(box(1.0, 0.1, 0.86), tm, tx, 0.5 + th + 0.05, tz));
  // helipad and mast on the roof
  const ry = 0.5 + th + 0.1;
  root.add(mesh(cyl(0.36, 0.36, 0.04, 20), M.darkSteel(), tx, ry + 0.02, tz));
  root.add(mesh(box(0.04, 0.005, 0.24), M.white(), tx - 0.08, ry + 0.045, tz));
  root.add(mesh(box(0.04, 0.005, 0.24), M.white(), tx + 0.08, ry + 0.045, tz));
  root.add(mesh(box(0.16, 0.005, 0.04), M.white(), tx, ry + 0.045, tz));
  root.add(mesh(cyl(0.01, 0.01, 0.5, 4), M.gun(), tx + 0.42, ry + 0.25, tz - 0.35));
  root.add(mesh(sph(0.025, 6, 4), M.redLamp(), tx + 0.42, ry + 0.5, tz - 0.35));
  // low council wing with a row of windows
  root.add(mesh(box(1.0, 0.5, 1.0), M.concrete(), 0.65, 0.75, -0.4));
  root.add(mesh(box(1.04, 0.05, 1.04), M.metalRoof(), 0.65, 1.02, -0.4));
  windows(root, 0.3, 1.0, 4, 0.78, 0.105);
  roofKit(root, 0.55, 1.04, -0.55);
  // entrance canopy and a row of flags
  root.add(mesh(box(1.3, 0.04, 0.45), M.white(), 0.2, 0.62, 0.72));
  for (const x of [-0.35, 0.75]) root.add(mesh(cyl(0.015, 0.015, 0.6, 6), M.steel(), x, 0.3, 0.9));
  for (const x of [-0.5, 0.75]) {
    root.add(mesh(cyl(0.01, 0.012, 0.9, 6), M.steel(), x - 0.6, 0.45, 1.15));
    root.add(mesh(box(0.22, 0.12, 0.008), tm, x - 0.49, 0.82, 1.15));
  }
  hallFlag(root, parts, team, 1.15, 0, 1.15, 1.0);
  return { root, parts, height: th + 0.9 };
}

/** Industrial-age surfaces: the modern layouts in brick, cast iron and slate, before concrete. */
function industrial(m: Model): Model {
  const swap = new Map<THREE.Material, THREE.Material>([
    [M.concrete(), M.brick()],
    [M.lightConcrete(), M.dressedStone()],
    [M.metalRoof(), M.slate()],
    [M.white(), mat('#8a8a80', { rough: 0.7, metal: 0.4 })],
    [M.hazard(), M.iron()],
  ]);
  m.root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = swap.get(o.material as THREE.Material) ?? o.material;
  });
  // cobbled yards, and no radar yet
  const pad = m.root.getObjectByName('pad');
  if (pad instanceof THREE.Mesh) pad.material = M.darkStone();
  if (m.parts.radar) m.parts.radar.visible = false;
  return m;
}

/**
 * Which look a structure has in an age. Each age rebuilds the base one step further:
 * 0 wood and thatch (Medieval), 2 brick and iron (Industrial), 3 concrete and steel (Modern).
 * The Watchtower, Lumber Mill and Resource Drop grow into dressed stone (look 1) and stop there; the Oil Derrick,
 * Engine Works and Flak Cannon are brick and iron until the Modern age, even in a Medieval town.
 */
const ERA_LOOK = [0, 2, 3] as const;

export function bldLook(type: BldType, era: number): 0 | 1 | 2 | 3 {
  const e = ERA_LOOK[Math.max(0, Math.min(ERA_LOOK.length - 1, era))];
  if (isFixedLook(type)) return 3;
  if (type === 'tower' || type === 'mill' || type === 'camp') return e >= 1 ? 1 : 0;
  if (type === 'derrick' || type === 'works' || type === 'flak') return e < 2 ? 2 : e;
  if (type === 'turret' || type === 'airfield') return e < 1 ? 1 : e;
  return e;
}

/** A structure as its team builds it in their current age (see data/era.ts). */
export function buildingModel(type: BldType, team: number, era = ERA_LOOK.length - 1, wallMask = 0): Model {
  if (isFixedLook(type)) {
    if (type === 'palisade' || type === 'stonewall' || type === 'concretewall') return cached(`w:${type}:${team}:${wallMask}`, () => wallModel(type, team, wallMask));
    return cached(`b:${type}:${team}`, () => (type === 'pillbox' ? pillbox(team) : type === 'atturret' ? missileTurret(team) : bertha(team)));
  }
  const lk = bldLook(type, era);
  if (isAetherBld(type)) return cached(`b:${type}:${team}`, () => aetherBuilding(type, team)); // timeless: the same in every age
  if (type === 'airfield') return cached(`b:${type}:${team}:${lk}`, () => (lk === 1 ? airfield(team, 'field') : lk === 2 ? industrial(airfield(team, 'hangar')) : airfield(team, 'hangar')));
  if (type === 'armory') return cached(`b:${type}:${team}:${lk}`, () => (lk <= 1 ? smithy(team, lk === 1) : lk === 2 ? industrial(arsenal(team)) : arsenal(team)));
  if (type === 'magetower') return cached(`b:${type}:${team}:${lk}`, () => (lk === 2 ? industrial(mageTower(team, 3)) : mageTower(team, lk)));
  if (type === 'hospital') {
    // Medieval: its own infirmary chapel; later ages: a barracks-sized ward told apart by the red cross out front
    if (lk <= 1) return cached(`b:${type}:${team}:${lk}`, () => infirmary(team, lk === 1));
    return cached(`b:${type}:${team}:${lk}`, () => hospital(lk === 2 ? industrial(makeBuilding('barracks', team)) : makeBuilding('barracks', team)));
  }
  // the Modern Power Plant is solar and wind, not the Industrial coal plant's cooling towers in concrete
  if (type === 'power' && lk === 3) return cached(`b:${type}:${team}:${lk}`, () => solarPlant(team));
  // the Town Hall is its own building in each age, not the Town Hall's block made over
  if (type === 'yard' && lk >= 2) return cached(`b:${type}:${team}:${lk}`, () => (lk === 2 ? townHallBrick(team) : townHallModern(team)));
  if (type === 'flak') return cached(`b:${type}:${team}:${lk}`, () => (lk === 2 ? industrial(flak(team)) : flak(team)));
  return cached(`b:${type}:${team}:${lk}`, () =>
    lk === 0 ? medievalBuilding(type, team, 'wood')
      : lk === 1 ? medievalBuilding(type, team, 'stone')
        : lk === 2 ? industrial(makeBuilding(type, team))
          : makeBuilding(type, team));
}

/** A dark rock studded with ore crystals, with loose shards around it. */
function makeSource(): Model {
  const root = new THREE.Group();
  const rock = mesh(dodeca(0.3), M.rock(), 0, 0.18, 0);
  rock.scale.set(1.2, 0.8, 1);
  root.add(rock);
  root.add(rot(scl(mesh(dodeca(0.16), M.rock(), 0.26, 0.08, -0.18), 1.1, 0.7, 1), 0.4, 0.8, 0));
  root.add(rot(scl(mesh(dodeca(0.12), M.rock(), -0.28, 0.06, 0.16), 1, 0.6, 1.2), 0.2, 0.3, 0.5));
  for (const [x, z, h, a] of [[0.05, 0, 0.5, 0], [-0.18, 0.1, 0.36, 0.4], [0.2, 0.12, 0.32, -0.4], [0.02, -0.2, 0.3, 0.3], [-0.12, -0.12, 0.28, -0.3], [0.14, -0.08, 0.22, -0.6], [-0.05, 0.18, 0.2, 0.7]]) {
    const c = mesh(octa(0.1), M.ore(), x, 0.35 + h * 0.3, z);
    c.scale.set(0.8, h * 4, 0.8);
    c.rotation.z = a;
    root.add(c);
  }
  for (const [x, z, s] of [[0.38, 0.1, 0.05], [-0.3, -0.25, 0.04], [0.1, 0.36, 0.045], [-0.4, 0.05, 0.035], [0.3, -0.3, 0.03]]) {
    root.add(rot(scl(mesh(octa(s), M.ore(), x, s, z), 1, 1.6, 1), 0.3, x * 5, z * 3));
  }
  return { root, parts: {}, height: 0.9 };
}

export function sourceModel(): Model {
  return cached('source', makeSource);
}

/** A fallen star: a scorched black stone split open by tall glowing violet shards. */
function makeAether(): Model {
  const root = new THREE.Group();
  root.add(scl(mesh(dodeca(0.28), M.starRock(), 0, 0.12, 0), 1.3, 0.55, 1.1));
  root.add(rot(scl(mesh(dodeca(0.14), M.starRock(), 0.3, 0.05, 0.2), 1, 0.6, 1), 0.3, 0.6, 0));
  root.add(rot(scl(mesh(dodeca(0.11), M.starRock(), -0.32, 0.04, -0.15), 1.2, 0.5, 1), 0.1, 0.2, 0.4));
  for (const [x, z, h, a, b] of [[0, 0, 0.75, 0, 0], [-0.14, 0.08, 0.5, 0.35, 0.2], [0.15, 0.1, 0.45, -0.4, 0.1], [0.05, -0.16, 0.42, 0.25, -0.35], [-0.1, -0.1, 0.32, -0.2, -0.3], [0.2, -0.05, 0.28, -0.6, 0.2]]) {
    const c = mesh(octa(0.1), M.aether(), x, 0.2 + h * 0.35, z);
    c.scale.set(0.7, h * 4.2, 0.7);
    c.rotation.set(b, 0, a);
    root.add(c);
  }
  for (const [x, z, s] of [[0.36, -0.2, 0.04], [-0.3, 0.3, 0.035], [0.08, 0.38, 0.03], [-0.42, -0.05, 0.03]]) {
    root.add(rot(scl(mesh(octa(s), M.aether(), x, s, z), 1, 1.8, 1), 0.2, x * 4, z * 3));
  }
  return { root, parts: {}, height: 1.1 };
}

export function aetherModel(): Model {
  return cached('aether', makeAether);
}

/** Aether dropped by a fallen carrier: a few loose glowing shards on the ground. */
function makeShard(): Model {
  const root = new THREE.Group();
  for (const [x, z, h, a] of [[0, 0, 0.22, 0.2], [0.09, 0.06, 0.15, -0.5], [-0.08, 0.05, 0.13, 0.6], [0.02, -0.09, 0.11, -0.3]]) {
    const c = mesh(octa(0.05), M.aether(), x, h * 0.35, z);
    c.scale.set(0.8, h * 7, 0.8);
    c.rotation.z = a;
    root.add(c);
  }
  return { root, parts: {}, height: 0.3 };
}

export function shardModel(): Model {
  return cached('shard', makeShard);
}
