// Walls and the newer defenses: Pillbox, Missile Turret and Big Bertha.
// A wall segment is drawn as a post with an arm toward each neighbouring wall of its team, so a
// line of segments reads as one continuous wall (see wallMask in entities3d.ts).
import * as THREE from 'three';
import type { BldType } from '../../../data/building.ts';
import { across, along, group, mesh, rod, rot, type Model, type Parts } from './model_kit.ts';
import { M, box, cone, cyl, dome, sph, teamMat } from './materials.ts';

/** The eight neighbours, in the order of a wall's mask bits: E, SE, S, SW, W, NW, N, NE. */
export const WALL_DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

type Arm = (root: THREE.Group, len: number, team: number) => void;

/** Sharpened logs lashed side by side. */
const palisadeArm: Arm = (root, len) => {
  const n = Math.max(1, Math.round(len / 0.12));
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * len, h = 0.5 + ((i * 37) % 7) * 0.012;
    root.add(mesh(cyl(0.055, 0.06, h, 7), i % 2 ? M.log() : M.wood(), x, h / 2, 0));
    root.add(mesh(cone(0.055, 0.1, 7), M.log(), x, h + 0.05, 0));
  }
  root.add(mesh(box(len, 0.04, 0.03), M.timber(), len / 2, 0.32, 0.06)); // cross rail
};

/** Coursed masonry with a walkway and merlons. */
const stoneArm: Arm = (root, len) => {
  root.add(mesh(box(len, 0.5, 0.3), M.stone(), len / 2, 0.25, 0));
  root.add(mesh(box(len, 0.03, 0.32), M.darkStone(), len / 2, 0.14, 0));
  root.add(mesh(box(len, 0.03, 0.32), M.darkStone(), len / 2, 0.36, 0));
  const n = Math.max(1, Math.round(len / 0.2));
  for (let i = 0; i < n; i++) root.add(mesh(box(0.1, 0.1, 0.08), M.dressedStone(), ((i + 0.5) / n) * len, 0.55, 0.11));
};

/** Precast concrete barrier panels with a team stripe. */
const concreteArm: Arm = (root, len, team) => {
  root.add(mesh(box(len, 0.12, 0.34), M.concrete(), len / 2, 0.06, 0));
  root.add(mesh(box(len, 0.36, 0.2), M.lightConcrete(), len / 2, 0.3, 0));
  root.add(mesh(box(len, 0.05, 0.205), teamMat(team), len / 2, 0.36, 0));
  root.add(mesh(box(len, 0.04, 0.24), M.concrete(), len / 2, 0.5, 0));
};

function post(type: BldType, team: number): THREE.Object3D[] {
  if (type === 'palisade') return [mesh(cyl(0.08, 0.09, 0.62, 8), M.log(), 0, 0.31, 0), mesh(cone(0.08, 0.14, 8), M.log(), 0, 0.69, 0), mesh(cyl(0.092, 0.092, 0.06, 8), teamMat(team), 0, 0.42, 0)];
  if (type === 'stonewall') return [mesh(box(0.38, 0.62, 0.38), M.dressedStone(), 0, 0.31, 0), mesh(box(0.39, 0.04, 0.39), teamMat(team), 0, 0.5, 0)];
  return [mesh(box(0.3, 0.56, 0.3), M.concrete(), 0, 0.28, 0), mesh(box(0.31, 0.06, 0.31), M.hazard(), 0, 0.5, 0)];
}

/** A wall segment joined toward each neighbour in `mask` (bits follow WALL_DIRS). */
export function wallModel(type: BldType, team: number, mask: number): Model {
  const root = new THREE.Group(), arm = type === 'palisade' ? palisadeArm : type === 'stonewall' ? stoneArm : concreteArm;
  root.add(...post(type, team));
  // a lone segment still shows a short stretch of wall
  const dirs = mask ? WALL_DIRS.filter((_, i) => mask & (1 << i)) : [[1, 0], [-1, 0]] as [number, number][];
  for (const [dx, dz] of dirs) {
    const len = Math.hypot(dx, dz) * (mask ? 0.5 : 0.35), g = new THREE.Group();
    arm(g, len, team);
    g.rotation.y = -Math.atan2(dz, dx);
    root.add(g);
  }
  return { root, parts: {}, height: type === 'stonewall' ? 0.7 : 0.65 };
}

/** Pillbox: a squat hexagonal concrete bunker with a firing slit and a machine gun that swivels. */
export function pillbox(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  root.add(mesh(cyl(0.44, 0.48, 0.08, 6), M.concrete(), 0, 0.04, 0));
  root.add(mesh(cyl(0.38, 0.43, 0.3, 6), M.lightConcrete(), 0, 0.23, 0));
  root.add(mesh(cyl(0.4, 0.38, 0.07, 6), M.concrete(), 0, 0.41, 0));
  root.add(mesh(cyl(0.39, 0.39, 0.04, 6), teamMat(team), 0, 0.33, 0));
  // sandbags around the foot
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    root.add(rot(mesh(box(0.14, 0.07, 0.08), M.sandbag(), Math.cos(a) * 0.47, 0.05, Math.sin(a) * 0.47), 0, -a, 0));
  }
  // the gun sits in a rotating slit collar
  const head = group(0, 0.27, 0,
    mesh(cyl(0.3, 0.3, 0.07, 12), M.dark(), 0, 0, 0),
    mesh(box(0.12, 0.08, 0.1), M.gun(), 0.22, 0, 0));
  const barrel = group(0.28, 0, 0,
    along(mesh(cyl(0.018, 0.022, 0.32, 8), M.gun(), 0.16, 0, 0)),
    along(mesh(cyl(0.03, 0.03, 0.12, 8), M.darkSteel(), 0.06, 0, 0)));
  head.add(barrel);
  parts.turret = head;
  parts.barrel = barrel;
  root.add(head);
  return { root, parts, height: 0.5 };
}

/** Missile Turret: a radar-guided twin launcher on an armoured mount. */
export function missileTurret(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, tm = teamMat(team), tl = teamMat(team, 'l');
  root.add(mesh(box(0.86, 0.08, 0.86), M.concrete(), 0, 0.04, 0));
  root.add(mesh(cyl(0.26, 0.32, 0.22, 12), M.darkSteel(), 0, 0.19, 0));
  root.add(mesh(cyl(0.27, 0.27, 0.04, 12), tm, 0, 0.27, 0));
  const head = group(0, 0.38, 0,
    mesh(box(0.3, 0.16, 0.24), tl, 0, 0, 0),
    mesh(box(0.1, 0.1, 0.1), M.darkSteel(), -0.14, 0.12, 0),
    mesh(cyl(0.07, 0.07, 0.015, 12), M.white(), -0.14, 0.2, 0));
  const barrel = group(0.04, 0.04, 0);
  for (const z of [-0.18, 0.18]) {
    barrel.add(mesh(box(0.46, 0.13, 0.13), M.olive(), 0.08, 0, z));
    for (const [y, zz] of [[0.03, 0.03], [0.03, -0.03], [-0.03, 0.03], [-0.03, -0.03]]) barrel.add(along(mesh(cyl(0.022, 0.022, 0.02, 8), M.dark(), 0.31, y, z + zz)));
    barrel.add(mesh(box(0.47, 0.02, 0.135), tm, 0.08, 0.07, z));
  }
  head.add(barrel);
  parts.turret = head;
  parts.barrel = barrel;
  root.add(head);
  // a mast with the guidance radar
  root.add(rod([0.3, 0.08, 0.3], [0.3, 0.7, 0.3], 0.015, M.darkSteel()));
  const radar = group(0.3, 0.72, 0.3, mesh(box(0.03, 0.12, 0.2), M.steel(), 0, 0, 0));
  parts.radar = radar;
  root.add(radar);
  return { root, parts, height: 0.75 };
}

/** Big Bertha: a huge wheeled siege howitzer behind an earth berm, its long barrel raised high. */
export function bertha(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {}, tm = teamMat(team);
  // emplacement: a timber platform in a ring of earth and sandbags
  root.add(mesh(cyl(0.98, 1.0, 0.06, 20), M.dirt(), 0, 0.03, 0));
  root.add(mesh(box(1.3, 0.06, 1.3), M.timber(), 0, 0.08, 0));
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    if (Math.cos(a) > 0.7) continue; // open toward the muzzle
    root.add(rot(mesh(box(0.26, 0.12, 0.14), M.sandbag(), Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.9), 0, -a, 0));
  }
  for (const [x, z] of [[-0.7, 0.55], [-0.55, 0.7]]) root.add(along(mesh(cyl(0.07, 0.07, 0.24, 10), M.brass(), x, 0.15, z))); // spare shells
  // the gun turns as a whole on the platform
  const head = group(0, 0.11, 0);
  // carriage, spoked wheels and the trail spade
  head.add(mesh(box(0.9, 0.16, 0.36), M.olive(), -0.1, 0.18, 0));
  head.add(mesh(box(0.6, 0.06, 0.1), M.olive(), -0.65, 0.1, 0));
  for (const z of [-0.3, 0.3]) {
    head.add(across(mesh(cyl(0.28, 0.28, 0.08, 18), M.darkWood(), 0.05, 0.28, z)));
    head.add(across(mesh(cyl(0.29, 0.29, 0.05, 18), M.iron(), 0.05, 0.28, z)));
    head.add(across(mesh(cyl(0.06, 0.06, 0.12, 8), M.iron(), 0.05, 0.28, z)));
  }
  head.add(mesh(box(0.08, 0.16, 0.36), M.iron(), -0.95, 0.1, 0));
  head.add(mesh(box(0.3, 0.2, 0.42), tm, -0.05, 0.36, 0)); // gun shield in team colours
  // the barrel: a fat breech and a long tapering tube, raised for a high lob
  const barrel = group(0.0, 0.48, 0,
    mesh(box(0.34, 0.24, 0.26), M.gun(), -0.1, 0, 0),
    along(mesh(cyl(0.1, 0.14, 1.2, 16), M.gun(), 0.6, 0, 0)),
    along(mesh(cyl(0.12, 0.12, 0.1, 16), M.darkSteel(), 1.18, 0, 0)),
    along(mesh(cyl(0.15, 0.15, 0.06, 16), tm, 0.12, 0, 0)));
  const elevate = group(0, 0, 0, barrel);
  elevate.rotation.z = 0.6;
  head.add(elevate);
  head.add(mesh(sph(0.05), M.brass(), -0.25, 0.55, 0.16));
  parts.turret = head;
  parts.barrel = barrel;
  root.add(head);
  root.add(mesh(dome(0.06), M.lamp(), 0.8, 0.12, -0.6));
  return { root, parts, height: 1.3 };
}
