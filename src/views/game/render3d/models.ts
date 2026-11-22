// Procedural 3D models for every unit, building and ore rock. Units face +x; buildings face +z
// (doors toward the default camera). Sizes are in tiles. Named parts are animated by entities3d.ts.
import * as THREE from 'three';
import type { UnitType } from '../../../data/unit.ts';
import type { BldType } from '../../../data/building.ts';
import { M, box, cone, cyl, dodeca, dome, mat, octa, sph, teamMat } from './materials.ts';

export interface Model {
  root: THREE.Group;
  parts: Record<string, THREE.Object3D>;
  /** height of the model's top (for health bars), tiles */
  height: number;
}

type Mat = THREE.Material;

function mesh(g: THREE.BufferGeometry, m: Mat, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

function group(x = 0, y = 0, z = 0, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (children.length) g.add(...children);
  return g;
}

/** A limb hanging from a pivot (so it can swing). */
function limb(x: number, y: number, z: number, len: number, thick: number, m: Mat): THREE.Group {
  return group(x, y, z, mesh(box(thick, len, thick), m, 0, -len / 2, 0));
}

const along = (o: THREE.Object3D) => { o.rotation.z = -Math.PI / 2; return o; }; // cylinder axis → +x
const across = (o: THREE.Object3D) => { o.rotation.x = Math.PI / 2; return o; }; // cylinder axis → z

// ---------------------------------------------------------------- infantry

interface SoldierLook { torso: Mat; legs: Mat; arms: Mat; boots: Mat }

function soldier(look: SoldierLook): Model {
  const root = new THREE.Group(), parts: Record<string, THREE.Object3D> = {};
  for (const [name, side] of [['legL', -1], ['legR', 1]] as const) {
    const leg = limb(0, 0.21, side * 0.05, 0.19, 0.07, look.legs);
    leg.add(mesh(box(0.1, 0.045, 0.08), look.boots, 0.015, -0.2, 0));
    parts[name] = leg;
    root.add(leg);
  }
  root.add(mesh(box(0.13, 0.2, 0.19), look.torso, 0, 0.31, 0));
  root.add(mesh(sph(0.062), M.skin(), 0, 0.47, 0));
  for (const [name, side] of [['armL', -1], ['armR', 1]] as const) {
    parts[name] = limb(0, 0.39, side * 0.12, 0.16, 0.055, look.arms);
    root.add(parts[name]);
  }
  return { root, parts, height: 0.62 };
}

function rifleman(team: number): Model {
  const m = soldier({ torso: M.olive(), legs: M.olive(), arms: M.olive(), boots: M.rubber() });
  m.root.add(mesh(box(0.135, 0.09, 0.2), teamMat(team), 0, 0.34, 0));
  m.root.add(mesh(dome(0.075), teamMat(team, 'd'), 0, 0.49, 0));
  m.parts.armL.rotation.z = m.parts.armR.rotation.z = 1.25; // both hands on the rifle
  m.parts.gun = mesh(box(0.36, 0.035, 0.035), M.gun(), 0.17, 0.35, 0.05);
  m.root.add(m.parts.gun);
  return m;
}

function rocketeer(team: number): Model {
  const m = soldier({ torso: M.olive(), legs: M.olive(), arms: M.olive(), boots: M.rubber() });
  m.root.add(mesh(box(0.135, 0.09, 0.2), teamMat(team), 0, 0.34, 0));
  m.root.add(mesh(dome(0.075), teamMat(team, 'd'), 0, 0.49, 0));
  m.root.add(mesh(box(0.08, 0.16, 0.15), M.leather(), -0.1, 0.33, 0));
  m.parts.armR.rotation.z = 2.2;
  m.parts.gun = along(mesh(cyl(0.045, 0.045, 0.44, 10), mat('#5a6232'), 0.04, 0.47, 0.11));
  m.root.add(m.parts.gun);
  return m;
}

function swordsman(team: number): Model {
  const m = soldier({ torso: M.steel(), legs: M.darkSteel(), arms: M.steel(), boots: M.darkSteel() });
  m.root.add(mesh(box(0.14, 0.17, 0.14), teamMat(team), 0.005, 0.3, 0));
  m.root.add(mesh(sph(0.072), M.steel(), 0, 0.48, 0));
  m.root.add(mesh(box(0.02, 0.018, 0.09), M.gun(), 0.068, 0.48, 0));
  m.root.add(mesh(cone(0.028, 0.12, 6), teamMat(team), 0, 0.58, 0));
  // kite shield on the left arm
  const shield = group(0.07, -0.1, -0.02,
    mesh(box(0.03, 0.25, 0.19), M.gold(), -0.005, 0, 0),
    mesh(box(0.032, 0.23, 0.17), teamMat(team), 0, 0, 0),
    mesh(box(0.035, 0.18, 0.025), M.white(), 0.001, 0, 0),
    mesh(box(0.035, 0.025, 0.11), M.white(), 0.001, 0.03, 0));
  m.parts.armL.add(shield);
  m.parts.armL.rotation.z = 0.9;
  // sword in the right hand
  const sword = group(0, -0.16, 0,
    mesh(box(0.03, 0.06, 0.03), M.leather(), 0, 0, 0),
    mesh(box(0.025, 0.02, 0.11), M.gold(), 0, -0.035, 0),
    mesh(box(0.02, 0.34, 0.012), M.steel(), 0, -0.21, 0));
  m.parts.armR.add(sword);
  return m;
}

function crossbowman(team: number): Model {
  const m = soldier({ torso: M.khaki(), legs: M.leather(), arms: M.khaki(), boots: M.rubber() });
  m.root.add(mesh(box(0.14, 0.05, 0.2), teamMat(team), 0, 0.37, 0));
  m.root.add(mesh(cyl(0.11, 0.11, 0.012, 14), M.darkSteel(), 0, 0.5, 0));
  m.root.add(mesh(dome(0.07), M.steel(), 0, 0.5, 0));
  m.root.add(mesh(box(0.06, 0.2, 0.06), M.leather(), -0.09, 0.36, -0.05)); // quiver
  m.parts.armL.rotation.z = m.parts.armR.rotation.z = 1.35;
  const bow = group(0.17, 0.36, 0.03,
    mesh(box(0.28, 0.035, 0.04), M.wood(), 0, 0, 0),
    mesh(box(0.025, 0.025, 0.3), M.darkWood(), 0.11, 0, 0));
  m.parts.gun = bow;
  m.root.add(bow);
  return m;
}

function knight(team: number): Model {
  const root = new THREE.Group(), parts: Record<string, THREE.Object3D> = {};
  // barded horse
  root.add(mesh(box(0.62, 0.24, 0.24), M.horse(), 0, 0.46, 0));
  root.add(mesh(box(0.52, 0.17, 0.27), teamMat(team), -0.02, 0.43, 0));
  root.add(mesh(box(0.54, 0.03, 0.28), M.gold(), -0.02, 0.35, 0));
  const neck = mesh(box(0.13, 0.3, 0.12), M.horse(), 0.3, 0.62, 0);
  neck.rotation.z = -0.55;
  root.add(neck);
  root.add(mesh(box(0.24, 0.1, 0.1), M.horse(), 0.44, 0.74, 0));
  root.add(mesh(box(0.16, 0.08, 0.11), M.steel(), 0.46, 0.76, 0)); // chanfron
  const tail = mesh(box(0.05, 0.22, 0.05), M.darkWood(), -0.34, 0.45, 0);
  tail.rotation.z = 0.5;
  root.add(tail);
  for (const [name, x, z] of [['legFL', 0.22, 0.08], ['legFR', 0.22, -0.08], ['legBL', -0.22, 0.08], ['legBR', -0.22, -0.08]] as const) {
    parts[name] = limb(x, 0.36, z, 0.36, 0.06, M.horse());
    root.add(parts[name]);
  }
  // rider in plate
  root.add(mesh(box(0.13, 0.22, 0.18), M.steel(), -0.03, 0.72, 0));
  root.add(mesh(box(0.14, 0.17, 0.12), teamMat(team), -0.025, 0.71, 0));
  root.add(mesh(sph(0.07), M.steel(), -0.03, 0.89, 0));
  root.add(mesh(cone(0.03, 0.13, 6), teamMat(team), -0.03, 0.99, 0));
  root.add(mesh(box(0.03, 0.2, 0.15), teamMat(team), -0.02, 0.7, -0.14)); // shield
  const lance = group(0.05, 0.78, 0.12,
    along(mesh(cyl(0.018, 0.024, 1.05, 8), M.wood(), 0.45, 0, 0)),
    mesh(box(0.1, 0.07, 0.01), teamMat(team), 0.78, 0.05, 0));
  parts.lance = lance;
  root.add(lance);
  return { root, parts, height: 1.05 };
}

// ---------------------------------------------------------------- vehicles

function wheel(x: number, z: number, r: number, w: number, m: Mat): THREE.Mesh {
  return across(mesh(cyl(r, r, w, 14), m, x, r, z)) as THREE.Mesh;
}

function jeep(team: number): Model {
  const root = new THREE.Group(), parts: Record<string, THREE.Object3D> = {};
  for (const [x, z] of [[0.2, 0.17], [0.2, -0.17], [-0.2, 0.17], [-0.2, -0.17]]) root.add(wheel(x, z, 0.1, 0.07, M.rubber()));
  root.add(mesh(box(0.62, 0.12, 0.32), teamMat(team), 0, 0.2, 0));
  root.add(mesh(box(0.2, 0.06, 0.3), teamMat(team, 'd'), 0.21, 0.28, 0));
  root.add(mesh(box(0.02, 0.11, 0.28), M.glass(), 0.09, 0.32, 0));
  root.add(mesh(box(0.14, 0.05, 0.26), M.leather(), -0.02, 0.28, 0));
  const turret = group(-0.14, 0.27, 0,
    mesh(cyl(0.03, 0.03, 0.14, 8), M.gun(), 0, 0.07, 0),
    group(0, 0.15, 0, mesh(box(0.32, 0.04, 0.04), M.gun(), 0.12, 0, 0), mesh(box(0.08, 0.08, 0.06), M.darkSteel(), 0, 0, 0)));
  parts.turret = turret;
  parts.barrel = turret.children[1];
  root.add(turret);
  return { root, parts, height: 0.6 };
}

function tank(team: number, heavy: boolean): Model {
  const k = heavy ? 1.22 : 1, root = new THREE.Group(), parts: Record<string, THREE.Object3D> = {};
  for (const side of [-1, 1]) {
    root.add(mesh(box(0.88 * k, 0.17 * k, 0.14 * k), M.rubber(), 0, 0.09 * k, side * 0.19 * k));
    for (let i = -3; i <= 3; i++) root.add(across(mesh(cyl(0.055 * k, 0.055 * k, 0.15 * k, 10), M.darkSteel(), i * 0.12 * k, 0.07 * k, side * 0.19 * k)));
  }
  root.add(mesh(box(0.74 * k, 0.15 * k, 0.34 * k), teamMat(team), 0, 0.23 * k, 0));
  const glacis = mesh(box(0.16 * k, 0.1 * k, 0.33 * k), teamMat(team, 'd'), 0.36 * k, 0.21 * k, 0);
  glacis.rotation.z = -0.5;
  root.add(glacis);
  const turret = group(-0.04 * k, 0.33 * k, 0, mesh(cyl(0.17 * k, 0.19 * k, 0.12 * k, 16), teamMat(team, 'l'), 0, 0, 0));
  turret.add(mesh(box(0.09 * k, 0.04 * k, 0.09 * k), M.darkSteel(), -0.05 * k, 0.08 * k, 0.06 * k)); // hatch
  const barrel = group(0.12 * k, 0.01 * k, 0);
  for (const z of heavy ? [-0.07, 0.07] : [0]) {
    barrel.add(along(mesh(cyl(0.028 * k, 0.03 * k, 0.5 * k, 10), M.gun(), 0.25 * k, 0, z * k)));
    barrel.add(along(mesh(cyl(0.042 * k, 0.042 * k, 0.07 * k, 10), M.gun(), 0.5 * k, 0, z * k)));
  }
  turret.add(barrel);
  parts.turret = turret;
  parts.barrel = barrel;
  root.add(turret);
  return { root, parts, height: 0.5 * k };
}

function harvester(team: number): Model {
  const root = new THREE.Group(), parts: Record<string, THREE.Object3D> = {};
  for (const side of [-1, 1]) root.add(mesh(box(0.92, 0.17, 0.14), M.rubber(), 0, 0.09, side * 0.22));
  root.add(mesh(box(0.86, 0.12, 0.42), M.darkSteel(), 0, 0.21, 0));
  root.add(mesh(box(0.25, 0.24, 0.38), teamMat(team), 0.28, 0.39, 0));
  root.add(mesh(box(0.02, 0.1, 0.32), M.glass(), 0.41, 0.44, 0));
  root.add(mesh(box(0.5, 0.2, 0.4), M.metalRoof(), -0.15, 0.37, 0)); // ore bin
  const heap = mesh(sph(0.21, 12, 6), M.ore(), -0.15, 0.47, 0);
  heap.scale.set(1.05, 0.5, 0.85);
  parts.heap = heap;
  root.add(heap);
  const scoop = group(0.47, 0.13, 0, mesh(box(0.06, 0.14, 0.44), M.darkSteel(), 0, 0, 0));
  for (let z = -0.18; z <= 0.18; z += 0.09) scoop.add(mesh(box(0.06, 0.03, 0.03), M.steel(), 0.05, -0.05, z));
  parts.scoop = scoop;
  root.add(scoop);
  root.add(mesh(box(0.86, 0.04, 0.43), teamMat(team, 'd'), 0, 0.28, 0));
  return { root, parts, height: 0.6 };
}

function catapult(team: number): Model {
  const root = new THREE.Group(), parts: Record<string, THREE.Object3D> = {};
  for (const [x, z] of [[0.24, 0.22], [0.24, -0.22], [-0.24, 0.22], [-0.24, -0.22]]) root.add(wheel(x, z, 0.12, 0.05, M.darkWood()));
  for (const z of [-0.18, 0.18]) {
    root.add(mesh(box(0.72, 0.07, 0.06), M.wood(), 0, 0.2, z));
    root.add(mesh(box(0.06, 0.34, 0.06), M.wood(), 0, 0.38, z));
  }
  for (const x of [-0.3, 0.3]) root.add(mesh(box(0.06, 0.06, 0.42), M.wood(), x, 0.2, 0));
  root.add(across(mesh(cyl(0.025, 0.025, 0.42, 8), M.darkSteel(), 0, 0.52, 0)));
  root.add(mesh(box(0.2, 0.12, 0.02), teamMat(team), -0.22, 0.32, 0.21));
  root.add(mesh(box(0.2, 0.12, 0.02), teamMat(team), -0.22, 0.32, -0.21));
  // throwing arm on the axle: the bucket end rests low at the back and whips forward to fire
  const arm = group(0, 0.52, 0,
    mesh(box(0.72, 0.05, 0.05), M.wood(), -0.26, 0, 0),
    mesh(box(0.12, 0.05, 0.12), M.darkWood(), -0.6, 0.03, 0),
    mesh(box(0.12, 0.14, 0.14), M.darkSteel(), 0.12, -0.07, 0));
  parts.stone = mesh(dodeca(0.06), M.rock(), -0.6, 0.09, 0);
  arm.add(parts.stone);
  parts.arm = arm;
  root.add(arm);
  return { root, parts, height: 0.75 };
}

export function unitModel(type: UnitType, team: number): Model {
  switch (type) {
    case 'rifleman': return rifleman(team);
    case 'rocket': return rocketeer(team);
    case 'swordsman': return swordsman(team);
    case 'crossbowman': return crossbowman(team);
    case 'knight': return knight(team);
    case 'jeep': return jeep(team);
    case 'tank': return tank(team, false);
    case 'heavy': return tank(team, true);
    case 'harvester': return harvester(team);
    case 'catapult': return catapult(team);
  }
}

// ---------------------------------------------------------------- buildings

function pad(s: number): THREE.Mesh {
  return mesh(box(s - 0.06, 0.06, s - 0.06), M.concrete(), 0, 0.03, 0);
}

function yard(team: number): Model {
  const root = new THREE.Group(), parts: Record<string, THREE.Object3D> = {};
  root.add(pad(3));
  root.add(mesh(box(1.9, 0.9, 1.5), M.lightConcrete(), -0.35, 0.51, -0.3));
  root.add(mesh(box(1.96, 0.06, 1.56), M.metalRoof(), -0.35, 0.99, -0.3));
  root.add(mesh(box(1.92, 0.1, 1.52), teamMat(team), -0.35, 0.82, -0.3));
  root.add(mesh(box(1.5, 0.12, 0.02), M.window(), -0.35, 0.62, 0.46));
  root.add(mesh(box(0.6, 0.42, 0.02), M.darkSteel(), -0.35, 0.27, 0.46));
  // crane
  root.add(mesh(box(0.12, 2.1, 0.12), M.hazard(), 1.05, 1.1, 0.85));
  const crane = group(1.05, 2.18, 0.85,
    mesh(box(2.1, 0.09, 0.09), M.hazard(), -0.65, 0, 0),
    mesh(box(0.3, 0.22, 0.22), M.darkSteel(), 0.4, -0.05, 0),
    mesh(cyl(0.01, 0.01, 0.7, 4), M.gun(), -1.4, -0.35, 0),
    mesh(box(0.12, 0.08, 0.12), M.darkSteel(), -1.4, -0.72, 0));
  parts.crane = crane;
  root.add(crane);
  // radar dish
  root.add(mesh(cyl(0.03, 0.03, 0.4, 6), M.gun(), -1.0, 1.2, -0.75));
  const radar = group(-1.0, 1.42, -0.75, mesh(cyl(0.28, 0.06, 0.1, 16), M.white(), 0.06, 0, 0));
  radar.children[0].rotation.z = 1.1;
  parts.radar = radar;
  root.add(radar);
  return { root, parts, height: 2.3 };
}

function powerPlant(team: number): Model {
  const root = new THREE.Group();
  root.add(pad(2));
  for (const x of [-0.45, 0.45]) {
    root.add(mesh(cyl(0.3, 0.42, 1.3, 18), M.lightConcrete(), x, 0.71, -0.2));
    root.add(mesh(cyl(0.31, 0.31, 0.05, 18), M.darkSteel(), x, 1.36, -0.2));
    root.add(mesh(box(0.86, 0.04, 0.04), teamMat(team), x, 0.4, 0.2)); // painted band
  }
  root.add(mesh(box(0.8, 0.36, 0.42), M.concrete(), 0, 0.24, 0.5));
  root.add(mesh(box(0.82, 0.08, 0.44), teamMat(team), 0, 0.38, 0.5));
  root.add(mesh(box(0.5, 0.08, 0.02), M.window(), 0, 0.22, 0.72));
  return { root, parts: {}, height: 1.45 };
}

function refinery(team: number): Model {
  const root = new THREE.Group();
  root.add(pad(3));
  root.add(mesh(box(1.6, 0.03, 0.78), M.hazard(), 0, 0.075, 1.05));
  root.add(mesh(box(1.2, 0.04, 0.5), M.darkSteel(), 0, 0.1, 1.05));
  root.add(mesh(box(1.5, 0.8, 1.3), M.concrete(), -0.6, 0.47, -0.5));
  root.add(mesh(box(1.54, 0.05, 1.34), M.metalRoof(), -0.6, 0.89, -0.5));
  root.add(mesh(box(1.52, 0.1, 1.32), teamMat(team), -0.6, 0.75, -0.5));
  root.add(mesh(box(1.1, 0.12, 0.02), M.window(), -0.6, 0.55, 0.16));
  root.add(mesh(cyl(0.33, 0.33, 1.15, 18), M.white(), 0.85, 0.64, -0.8));
  root.add(mesh(dome(0.33), M.white(), 0.85, 1.21, -0.8));
  root.add(mesh(cyl(0.28, 0.28, 0.85, 18), M.white(), 0.85, 0.49, 0.1));
  root.add(mesh(cyl(0.29, 0.29, 0.06, 18), teamMat(team), 0.85, 0.8, 0.1));
  root.add(along(mesh(cyl(0.05, 0.05, 0.6, 8), M.darkSteel(), 0.4, 0.6, -0.6)));
  return { root, parts: {}, height: 1.5 };
}

function barracks(team: number): Model {
  const root = new THREE.Group(), parts: Record<string, THREE.Object3D> = {};
  root.add(pad(2));
  const hut = mesh(new THREE.CylinderGeometry(0.58, 0.58, 1.4, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), M.olive(), 0, 0.06, -0.12);
  root.add(hut);
  const end = mesh(new THREE.CircleGeometry(0.58, 16, 0, Math.PI), M.olive(), 0, 0.06, 0.58);
  root.add(end);
  root.add(mesh(box(0.3, 0.38, 0.03), M.darkWood(), 0, 0.25, 0.6));
  root.add(mesh(box(1.18, 0.05, 0.03), teamMat(team), 0, 0.5, 0.59));
  for (let i = 0; i < 7; i++) {
    root.add(mesh(box(0.16, 0.08, 0.1), M.sandbag(), -0.75 + i * 0.25, 0.1, 0.86));
    root.add(mesh(box(0.16, 0.08, 0.1), M.sandbag(), -0.75 + i * 0.25, 0.1, -0.88));
  }
  root.add(mesh(cyl(0.015, 0.015, 1.3, 6), M.gun(), 0.85, 0.65, 0.75));
  const flag = mesh(box(0.32, 0.18, 0.01), teamMat(team), 1.01, 1.18, 0.75);
  parts.flag = flag;
  root.add(flag);
  return { root, parts, height: 1.3 };
}

function factory(team: number): Model {
  const root = new THREE.Group();
  root.add(pad(3));
  root.add(mesh(box(2.7, 1.0, 2.1), M.concrete(), 0, 0.56, -0.3));
  root.add(mesh(box(2.78, 0.08, 2.18), M.metalRoof(), 0, 1.1, -0.3));
  root.add(mesh(box(2.72, 0.14, 2.12), teamMat(team), 0, 0.92, -0.3));
  root.add(mesh(box(1.3, 0.72, 0.03), M.darkSteel(), 0, 0.42, 0.76));
  root.add(mesh(box(1.3, 0.06, 0.04), M.hazard(), 0, 0.81, 0.76));
  for (const x of [-1.05, 1.05]) {
    root.add(mesh(box(0.4, 0.12, 0.02), M.window(), x, 0.62, 0.76));
    root.add(mesh(sph(0.04), M.window(), x * 0.75, 0.88, 0.78));
  }
  root.add(mesh(box(1.3, 0.02, 0.9), M.hazard(), 0, 0.065, 1.15));
  return { root, parts: {}, height: 1.2 };
}

function turret(team: number): Model {
  const root = new THREE.Group(), parts: Record<string, THREE.Object3D> = {};
  root.add(mesh(cyl(0.4, 0.46, 0.22, 8), M.concrete(), 0, 0.11, 0));
  root.add(mesh(cyl(0.3, 0.3, 0.04, 16), M.darkSteel(), 0, 0.24, 0));
  const head = group(0, 0.33, 0, mesh(cyl(0.22, 0.25, 0.16, 16), teamMat(team, 'l'), 0, 0, 0));
  const barrel = group(0.14, 0.01, 0, along(mesh(cyl(0.035, 0.04, 0.55, 10), M.gun(), 0.27, 0, 0)));
  head.add(barrel);
  parts.turret = head;
  parts.barrel = barrel;
  root.add(head);
  return { root, parts, height: 0.6 };
}

export function buildingModel(type: BldType, team: number): Model {
  switch (type) {
    case 'yard': return yard(team);
    case 'power': return powerPlant(team);
    case 'refinery': return refinery(team);
    case 'barracks': return barracks(team);
    case 'factory': return factory(team);
    case 'turret': return turret(team);
  }
}

/** A dark rock studded with ore crystals. */
export function sourceModel(): Model {
  const root = new THREE.Group();
  const rock = mesh(dodeca(0.3), M.rock(), 0, 0.18, 0);
  rock.scale.set(1.2, 0.8, 1);
  root.add(rock);
  for (const [x, z, h, a] of [[0.05, 0, 0.5, 0], [-0.18, 0.1, 0.36, 0.4], [0.2, 0.12, 0.32, -0.4], [0.02, -0.2, 0.3, 0.3], [-0.12, -0.12, 0.28, -0.3]]) {
    const c = mesh(octa(0.1), M.ore(), x, 0.35 + h * 0.3, z);
    c.scale.set(0.8, h * 4, 0.8);
    c.rotation.z = a;
    root.add(c);
  }
  return { root, parts: {}, height: 0.9 };
}
