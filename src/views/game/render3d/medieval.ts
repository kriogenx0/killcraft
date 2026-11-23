// Medieval looks for the structures, used while a side is in the Medieval and Gunpowder ages (see
// data/era.ts). The Gunpowder look is the same town grown up: dressed stone instead of rubble,
// slate and tile instead of thatch, lit windows, brick chimneys and cannon. Footprints, door sides
// and named parts match the modern models in models.ts, so the animation code treats both alike.
import * as THREE from 'three';
import type { AetherBld, BldType } from '../../../data/building.ts';
import { across, along, group, mesh, rod, rot, scl, type Mat, type Model, type Parts } from './model_kit.ts';
import { M, box, cone, cyl, dome, lathe, prism, sph, teamMat, torus } from './materials.ts';

/** The look of one age: `gun` is the Gunpowder age. */
interface Look { gun: boolean; team: number; wall: Mat; roof: Mat; thatch: Mat }

const look = (team: number, gun: boolean): Look => ({
  gun, team,
  wall: gun ? M.dressedStone() : M.stone(),
  roof: gun ? M.slate() : M.shingle(),
  thatch: gun ? M.shingle() : M.thatch(),
});

/** A small deterministic random sequence, so every copy of a model is laid out the same. */
function rng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** Packed earth with a ring of kerb stones. */
function ground(root: THREE.Object3D, s: number, seed: number): void {
  root.add(mesh(box(s - 0.06, 0.05, s - 0.06), M.dirt(), 0, 0.025, 0));
  const r = rng(seed), e = s / 2 - 0.07;
  for (let i = 0; i < s * 7; i++) {
    const t = (i / (s * 7)) * 4, side = Math.floor(t), f = (t - side) * 2 * e - e;
    const [x, z] = [[f, e], [e, -f], [-f, -e], [-e, f]][side];
    root.add(rot(mesh(box(0.12 + r() * 0.06, 0.05 + r() * 0.03, 0.09), M.darkStone(), x, 0.05, z), 0, side % 2 ? Math.PI / 2 : 0, 0));
  }
}

/** Merlons around the top of a rectangular wall (centered at cx, cz). */
function merlons(root: THREE.Object3D, cx: number, cz: number, w: number, d: number, y: number, m: Mat, size = 0.09): void {
  const nx = Math.max(2, Math.round(w / (size * 2))), nz = Math.max(2, Math.round(d / (size * 2)));
  for (let i = 0; i < nx; i++) for (const s of [-1, 1]) {
    root.add(mesh(box(size, size * 1.2, size), m, cx - w / 2 + size / 2 + (i * (w - size)) / (nx - 1), y + size * 0.6, cz + s * (d / 2 - size / 2)));
  }
  for (let i = 1; i < nz - 1; i++) for (const s of [-1, 1]) {
    root.add(mesh(box(size, size * 1.2, size), m, cx + s * (w / 2 - size / 2), y + size * 0.6, cz - d / 2 + size / 2 + (i * (d - size)) / (nz - 1)));
  }
}

/** Merlons around a round tower top. */
function ringMerlons(root: THREE.Object3D, cx: number, cz: number, r: number, y: number, n: number, m: Mat, size = 0.08): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    root.add(rot(mesh(box(size, size * 1.3, size * 0.8), m, cx + Math.cos(a) * r, y + size * 0.65, cz + Math.sin(a) * r), 0, -a, 0));
  }
}

/** A plastered, timber-framed box (half-timbering) standing on y0. */
function timberFrame(root: THREE.Object3D, x: number, y0: number, z: number, w: number, h: number, d: number): void {
  const T = M.timber(), b = 0.035;
  root.add(mesh(box(w, h, d), M.plaster(), x, y0 + h / 2, z));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) root.add(mesh(box(b, h, b), T, x + sx * w / 2, y0 + h / 2, z + sz * d / 2));
  for (const y of [y0 + b / 2, y0 + h * 0.5, y0 + h - b / 2]) {
    for (const sz of [-1, 1]) root.add(mesh(box(w + 0.01, b, b), T, x, y, z + sz * d / 2));
    for (const sx of [-1, 1]) root.add(mesh(box(b, b, d + 0.01), T, x + sx * w / 2, y, z));
  }
  // studs and braces on the long faces
  const n = Math.max(1, Math.round(w / 0.4));
  for (let i = 1; i < n; i++) for (const sz of [-1, 1]) root.add(mesh(box(b, h, b), T, x - w / 2 + (i * w) / n, y0 + h / 2, z + sz * d / 2));
  const bay = w / n, ang = Math.atan2(h * 0.5, bay);
  for (let i = 0; i < n; i += 2) for (const sz of [-1, 1]) {
    root.add(rot(mesh(box(Math.hypot(bay, h * 0.5), b * 0.8, b * 0.8), T, x - w / 2 + bay * (i + 0.5), y0 + h * 0.25, z + sz * d / 2), 0, 0, ang));
  }
}

/** A pitched roof with its ridge along x, plastered gable ends and a ridge beam. */
function gable(root: THREE.Object3D, x: number, y: number, z: number, len: number, w: number, h: number, roof: Mat, ends: Mat = M.plaster()): void {
  const slope = Math.hypot(w / 2, h), ang = Math.atan2(h, w / 2);
  for (const s of [-1, 1]) root.add(rot(mesh(box(len + 0.12, 0.04, slope + 0.1), roof, x, y + h / 2, z + s * w / 4), s * ang, 0, 0));
  for (const s of [-1, 1]) root.add(mesh(prism(0.02, w, h), ends, x + s * (len / 2), y, z));
  root.add(mesh(box(len + 0.16, 0.04, 0.04), M.timber(), x, y + h + 0.01, z));
}

/** A team banner hanging flat against a wall facing +z. */
function banner(root: THREE.Object3D, team: number, x: number, y: number, z: number, w = 0.2, h = 0.34): void {
  root.add(mesh(box(w + 0.06, 0.025, 0.025), M.timber(), x, y + h / 2 + 0.01, z + 0.015));
  root.add(mesh(box(w, h, 0.01), teamMat(team), x, y, z + 0.02));
  root.add(rot(mesh(box(w * 0.72, w * 0.72, 0.01), teamMat(team), x, y - h / 2, z + 0.02), 0, 0, Math.PI / 4));
  root.add(mesh(box(w * 0.5, 0.025, 0.012), M.gold(), x, y + 0.03, z + 0.022));
  root.add(mesh(box(0.025, w * 0.5, 0.012), M.gold(), x, y + 0.03, z + 0.022));
}

/** An arched doorway on a wall facing +z. */
function door(root: THREE.Object3D, x: number, y0: number, z: number, w: number, h: number): void {
  root.add(mesh(box(w, h - w / 2, 0.03), M.darkWood(), x, y0 + (h - w / 2) / 2, z));
  root.add(mesh(new THREE.CircleGeometry(w / 2, 10, 0, Math.PI), M.darkWood(), x, y0 + h - w / 2, z + 0.016));
  root.add(mesh(torus(w / 2 + 0.02, 0.025, Math.PI, 3, 10), M.darkStone(), x, y0 + h - w / 2, z + 0.01));
  for (const y of [0.3, 0.7]) root.add(mesh(box(w * 0.9, 0.02, 0.01), M.iron(), x, y0 + (h - w / 2) * y, z + 0.02));
}

/** A window on a wall facing +z: an arrow slit, or a lit window in the Gunpowder age. */
function win(root: THREE.Object3D, L: Look, x: number, y: number, z: number): void {
  if (L.gun) {
    root.add(mesh(box(0.1, 0.14, 0.02), M.window(), x, y, z));
    root.add(mesh(box(0.012, 0.14, 0.026), M.timber(), x, y, z));
    root.add(mesh(box(0.14, 0.025, 0.04), M.dressedStone(), x, y - 0.08, z));
  } else {
    root.add(mesh(box(0.035, 0.14, 0.02), M.dark(), x, y, z));
  }
}

/** A flagpole with a waving team flag (the `flag` part). */
function flagpole(root: THREE.Object3D, parts: Parts, team: number, x: number, y: number, z: number, h: number): void {
  root.add(mesh(cyl(0.012, 0.015, h, 6), M.timber(), x, y + h / 2, z));
  root.add(mesh(sph(0.022, 8, 6), M.gold(), x, y + h + 0.01, z));
  const flag = group(x, y + h - 0.1, z,
    mesh(box(0.3, 0.16, 0.01), teamMat(team), 0.15, 0, 0),
    mesh(box(0.1, 0.16, 0.012), teamMat(team, 'd'), 0.27, 0, 0));
  parts.flag = flag;
  root.add(flag);
}

/** Some barrels, crates and sacks. */
function clutter(root: THREE.Object3D, x: number, z: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < 3; i++) {
    const bx = x + (r() - 0.5) * 0.3, bz = z + (r() - 0.5) * 0.3;
    root.add(lathe1(bx, bz));
  }
  root.add(mesh(box(0.13, 0.13, 0.13), M.wood(), x + 0.22, 0.115, z));
  root.add(mesh(box(0.135, 0.02, 0.135), M.darkWood(), x + 0.22, 0.115, z));
  root.add(scl(mesh(sph(0.06, 8, 6), M.cloth(), x + 0.05, 0.09, z + 0.2), 1, 0.8, 1));
}

const BARREL: [number, number][] = [[0, 0], [0.05, 0], [0.06, 0.06], [0.05, 0.12], [0, 0.12]];
function lathe1(x: number, z: number): THREE.Mesh {
  return mesh(lathe(BARREL, 10), M.wood(), x, 0.05, z);
}

/** A cannon on a wooden carriage, barrel along +x (for walls and the bastion). */
function cannon(x: number, y: number, z: number, scale = 1): THREE.Group {
  const g = group(x, y, z,
    along(mesh(cyl(0.035, 0.05, 0.36, 10), M.bronze(), 0.1, 0.07, 0)),
    along(mesh(cyl(0.045, 0.045, 0.03, 10), M.bronze(), 0.27, 0.07, 0)),
    mesh(sph(0.04, 8, 6), M.bronze(), -0.08, 0.07, 0),
    mesh(box(0.26, 0.06, 0.1), M.darkWood(), 0, 0.02, 0));
  for (const s of [-1, 1]) g.add(mesh(torus(0.045, 0.01, Math.PI * 2, 3, 10), M.iron(), 0.03, 0.02, s * 0.065));
  g.scale.setScalar(scale);
  return g;
}

// ---------------------------------------------------------------- structures

/** Town Hall: a stone keep with team-roofed corner towers and a treadwheel crane. */
function keep(L: Look): Model {
  const root = new THREE.Group(), parts: Parts = {}, W = L.wall, team = L.team;
  ground(root, 3, 11);
  const kx = -0.45, kz = -0.45, ks = 1.3, kh = 1.35;
  root.add(mesh(box(ks + 0.12, 0.22, ks + 0.12), M.darkStone(), kx, 0.16, kz)); // battered plinth
  root.add(mesh(box(ks, kh, ks), W, kx, 0.05 + kh / 2, kz));
  root.add(mesh(box(ks + 0.06, 0.06, ks + 0.06), M.darkStone(), kx, 0.05 + kh, kz)); // string course
  merlons(root, kx, kz, ks + 0.06, ks + 0.06, 0.08 + kh, W);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = kx + sx * ks / 2, z = kz + sz * ks / 2;
    root.add(mesh(cyl(0.2, 0.23, 1.75, 12), W, x, 0.9, z));
    root.add(mesh(cyl(0.23, 0.23, 0.06, 12), M.darkStone(), x, 1.78, z));
    root.add(mesh(cone(0.27, 0.5, 12), teamMat(team), x, 2.06, z));
    root.add(mesh(sph(0.025, 6, 4), M.gold(), x, 2.32, z));
    win(root, L, x, 1.3, z + 0.21);
  }
  const front = kz + ks / 2 + 0.005;
  door(root, kx, 0.05, front, 0.3, 0.5);
  for (const x of [-0.35, 0.35]) win(root, L, kx + x, 0.95, front);
  banner(root, team, kx, 1.05, front, 0.22, 0.3);
  // steps up to the door
  for (let i = 0; i < 3; i++) root.add(mesh(box(0.4, 0.04, 0.08), M.darkStone(), kx, 0.07 + i * 0.04, front + 0.2 - i * 0.07));
  if (L.gun) {
    // cannon on the walls, a brick chimney and a clock face
    for (const x of [-0.3, 0.3]) root.add(cannon(kx + x, 1.43, front - 0.1, 0.8).rotateY(-Math.PI / 2));
    root.add(mesh(box(0.14, 0.4, 0.14), M.brick(), kx + 0.3, 1.55, kz - 0.3));
    root.add(mesh(cyl(0.1, 0.1, 0.02, 14).rotateX(Math.PI / 2), M.white(), kx, 1.25, front + 0.01));
    root.add(mesh(box(0.008, 0.07, 0.006), M.dark(), kx, 1.27, front + 0.025));
  }
  // treadwheel crane: wheel at the foot, post, swinging jib (the `crane` part) with a stone
  root.add(mesh(torus(0.26, 0.025, Math.PI * 2, 4, 16), M.wood(), 1.0, 0.33, 0.85));
  for (let i = 0; i < 4; i++) root.add(rot(mesh(box(0.025, 0.5, 0.025), M.darkWood(), 1.0, 0.33, 0.85), 0, 0, (i * Math.PI) / 4));
  root.add(across(mesh(cyl(0.03, 0.03, 0.2, 6), M.darkWood(), 1.0, 0.33, 0.85)));
  for (const s of [-1, 1]) root.add(rod([1.0, 0.05, 0.85 + s * 0.12], [1.0, 0.36, 0.85], 0.02, M.darkWood()));
  root.add(mesh(box(0.1, 1.7, 0.1), M.wood(), 1.05, 0.9, 0.55));
  for (const s of [-1, 1]) root.add(rod([1.05 + s * 0.3, 0.05, 0.55], [1.05, 0.7, 0.55], 0.02, M.darkWood()));
  const crane = group(1.05, 1.72, 0.55,
    mesh(box(1.2, 0.07, 0.07), M.wood(), -0.45, 0, 0),
    rod([0, 0, 0], [-0.9, 0.0, 0], 0.01, M.rope(), 3),
    mesh(box(0.2, 0.15, 0.15), M.darkStone(), 0.2, -0.02, 0),
    rod([-0.95, 0, 0], [-0.95, -0.7, 0], 0.006, M.rope(), 3),
    mesh(box(0.14, 0.1, 0.12), M.dressedStone(), -0.95, -0.76, 0));
  parts.crane = crane;
  root.add(crane);
  // scaffolding against the keep and a pile of cut stone
  for (const x of [0.35, 0.6]) root.add(mesh(box(0.03, 1.1, 0.03), M.wood(), x - 0.15, 0.6, 0.3));
  for (const y of [0.45, 0.9]) root.add(mesh(box(0.35, 0.025, 0.12), M.wood(), 0.32, y, 0.3));
  for (const [x, z, y] of [[0.5, 1.1, 0], [0.66, 1.1, 0], [0.58, 1.12, 0.1]]) root.add(mesh(box(0.15, 0.1, 0.12), M.dressedStone(), x, 0.1 + y, z));
  clutter(root, -1.15, 1.0, 5);
  flagpole(root, parts, team, kx - 0.3, 0.08 + kh + 0.1, kz - 0.3, 0.7);
  return { root, parts, height: 2.35 };
}

/** Power: a windmill with turning sails (the `sails` part). */
function windmill(L: Look): Model {
  const root = new THREE.Group(), parts: Parts = {}, team = L.team;
  ground(root, 2, 21);
  const z0 = -0.15;
  const body = L.gun ? L.wall : M.plaster();
  root.add(mesh(lathe([[0.46, 0], [0.42, 0.5], [0.36, 1.0], [0.33, 1.15]], 14), body, 0, 0.05, z0));
  root.add(mesh(cyl(0.5, 0.5, 0.12, 14), M.darkStone(), 0, 0.1, z0));
  for (const y of [0.4, 0.8]) root.add(mesh(lathe([[0.445 - y * 0.08, 0], [0.44 - y * 0.08, 0.03]], 14), M.timber(), 0, 0.05 + y, z0));
  // cap with a ridge, and a tail pole for turning it into the wind
  root.add(scl(mesh(dome(0.38), L.thatch, 0, 1.2, z0), 1, 0.9, 1));
  root.add(mesh(cyl(0.37, 0.37, 0.05, 14), M.timber(), 0, 1.22, z0));
  root.add(rod([0, 1.25, z0 - 0.2], [0, 0.35, z0 - 0.8], 0.02, M.darkWood()));
  root.add(mesh(box(0.08, 0.08, 0.08), M.darkWood(), 0, 0.33, z0 - 0.82));
  // door, windows, team band
  door(root, 0, 0.1, z0 + 0.45, 0.2, 0.36);
  win(root, L, 0, 0.75, z0 + 0.39);
  win(root, L, 0.2, 0.55, z0 + 0.36);
  root.add(mesh(lathe([[0.405, 0], [0.4, 0.06]], 14), teamMat(team), 0, 1.0, z0));
  // sails on a hub facing +z
  const sails = group(0, 1.15, z0 + 0.45, across(mesh(cyl(0.06, 0.06, 0.12, 8), M.darkWood(), 0, 0, -0.04)));
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    arm.add(mesh(box(0.035, 0.85, 0.03), M.darkWood(), 0, 0.45, 0));
    arm.add(mesh(box(0.18, 0.6, 0.01), i % 2 ? M.cloth() : teamMat(team, 'l'), 0.11, 0.55, 0.012));
    for (let k = 0; k < 5; k++) arm.add(mesh(box(0.22, 0.012, 0.016), M.darkWood(), 0.1, 0.28 + k * 0.13, 0.02));
    sails.add(arm);
  }
  parts.sails = sails;
  root.add(sails);
  // grain sacks and a hand cart
  for (const [x, z] of [[0.55, 0.55], [0.65, 0.4], [0.58, 0.47]]) root.add(scl(mesh(sph(0.07, 8, 6), M.cloth(), x, 0.11, z), 1, 0.9, 1.1));
  root.add(mesh(box(0.3, 0.04, 0.2), M.wood(), -0.55, 0.15, 0.55));
  for (const s of [-1, 1]) root.add(mesh(torus(0.08, 0.012, Math.PI * 2, 3, 10), M.darkWood(), -0.55, 0.13, 0.55 + s * 0.11));
  root.add(rod([-0.4, 0.17, 0.5], [-0.15, 0.1, 0.45], 0.012, M.wood()));
  if (L.gun) root.add(mesh(box(0.1, 0.35, 0.1), M.brick(), -0.6, 0.22, -0.55));
  return { root, parts, height: 1.75 };
}

/** Refinery: a smeltery with a glowing furnace, workshop and ore landing. */
function smeltery(L: Look): Model {
  const root = new THREE.Group(), parts: Parts = {}, team = L.team;
  ground(root, 3, 31);
  // ore landing where harvesters unload: plank deck on posts, ore heap
  root.add(mesh(box(1.4, 0.05, 0.7), M.wood(), 0, 0.09, 1.05));
  for (let i = 0; i < 9; i++) root.add(mesh(box(0.012, 0.052, 0.7), M.darkWood(), -0.64 + i * 0.16, 0.09, 1.05));
  for (const x of [-0.72, 0.72]) for (const z of [0.72, 1.38]) root.add(mesh(box(0.06, 0.24, 0.06), M.timber(), x, 0.17, z));
  root.add(scl(mesh(sph(0.22, 10, 6), M.ore(), -0.75, 0.1, 0.25), 1.3, 0.5, 1));
  // furnace: a tapering stone stack with a glowing mouth
  const fx = 0.75, fz = -0.6, F = L.gun ? M.brick() : L.wall;
  root.add(mesh(lathe([[0.5, 0], [0.46, 0.4], [0.32, 0.9], [0.2, 1.4]], 12), F, fx, 0.05, fz));
  root.add(mesh(cyl(0.22, 0.22, 0.08, 12), M.darkStone(), fx, 1.47, fz));
  root.add(mesh(cyl(0.17, 0.17, 0.02, 12), M.dark(), fx, 1.51, fz));
  if (L.gun) {
    root.add(mesh(cyl(0.12, 0.14, 0.6, 10), M.brick(), fx, 1.8, fz));
    root.add(mesh(cyl(0.14, 0.14, 0.05, 10), M.dark(), fx, 2.1, fz));
  }
  root.add(mesh(box(0.26, 0.24, 0.1), M.ember(), fx, 0.22, fz + 0.43));
  root.add(mesh(torus(0.15, 0.04, Math.PI, 3, 10), M.darkStone(), fx, 0.34, fz + 0.45));
  for (const s of [-1, 1]) root.add(mesh(box(0.06, 0.3, 0.08), M.darkStone(), fx + s * 0.16, 0.2, fz + 0.46));
  root.add(mesh(lathe([[0.4, 0], [0.39, 0.06]], 12), teamMat(team), fx, 0.95, fz));
  // bellows beside the furnace
  root.add(rot(mesh(box(0.26, 0.06, 0.16), M.leather(), fx - 0.5, 0.25, fz + 0.15), 0, 0.4, 0.2));
  root.add(rod([fx - 0.38, 0.24, fz + 0.13], [fx - 0.2, 0.2, fz + 0.2], 0.02, M.iron()));
  // timber workshop with a pitched roof
  timberFrame(root, -0.55, 0.05, -0.65, 1.4, 0.6, 0.95);
  gable(root, -0.55, 0.65, -0.65, 1.4, 1.1, 0.45, L.roof);
  door(root, -0.55, 0.05, -0.17, 0.26, 0.42);
  for (const x of [-1.0, -0.1]) win(root, L, x, 0.42, -0.165);
  banner(root, team, -0.55, 0.85, -0.13, 0.16, 0.22);
  root.add(mesh(box(0.1, 0.4, 0.1), M.brick(), -1.0, 1.0, -0.9)); // forge chimney
  // anvil, quench trough and stacked ingots out front
  root.add(mesh(box(0.08, 0.1, 0.06), M.timber(), 0.15, 0.1, 0.15));
  root.add(mesh(box(0.14, 0.05, 0.07), M.iron(), 0.15, 0.17, 0.15));
  root.add(mesh(box(0.3, 0.1, 0.12), M.darkWood(), 0.45, 0.1, 0.25));
  root.add(mesh(box(0.27, 0.01, 0.09), M.glass(), 0.45, 0.15, 0.25)); // water
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) root.add(mesh(box(0.1, 0.035, 0.05), M.gold(), 1.05 + j * 0.06 + i * 0.03, 0.07 + i * 0.035, 0.3));
  clutter(root, -1.1, 0.35, 7);
  return { root, parts, height: L.gun ? 2.1 : 1.6 };
}

/** Barracks: a timber hall with a training yard. */
function hall(L: Look): Model {
  const root = new THREE.Group(), parts: Parts = {}, team = L.team;
  ground(root, 2, 41);
  const hz = -0.3;
  if (L.gun) {
    root.add(mesh(box(1.45, 0.25, 0.75), L.wall, 0, 0.175, hz));
    timberFrame(root, 0, 0.3, hz, 1.4, 0.35, 0.7);
  } else {
    root.add(mesh(box(1.48, 0.08, 0.78), M.darkStone(), 0, 0.09, hz));
    timberFrame(root, 0, 0.12, hz, 1.4, 0.53, 0.7);
  }
  gable(root, 0, 0.65, hz, 1.4, 0.9, 0.42, L.thatch);
  door(root, 0, 0.12, hz + 0.355, 0.22, 0.4);
  for (const x of [-0.45, 0.45]) win(root, L, x, 0.45, hz + 0.355);
  banner(root, team, -0.2, 0.5, hz + 0.355, 0.12, 0.18);
  banner(root, team, 0.2, 0.5, hz + 0.355, 0.12, 0.18);
  if (L.gun) root.add(mesh(box(0.12, 0.45, 0.12), M.brick(), 0.55, 1.0, hz - 0.15));
  // training yard: a dummy, an archery butt and a spear rack, behind a rail fence
  root.add(mesh(cyl(0.02, 0.02, 0.45, 6), M.timber(), -0.55, 0.27, 0.45));
  root.add(mesh(box(0.03, 0.03, 0.3), M.timber(), -0.55, 0.4, 0.45));
  root.add(scl(mesh(sph(0.08, 8, 6), M.straw(), -0.55, 0.33, 0.45), 1, 1.4, 1));
  root.add(mesh(sph(0.05, 8, 6), M.straw(), -0.55, 0.52, 0.45));
  root.add(rot(mesh(cyl(0.14, 0.14, 0.05, 14), M.straw(), 0.05, 0.25, 0.55), Math.PI / 2 - 0.2, 0, 0));
  for (const [r, m] of [[0.1, M.white()], [0.06, teamMat(team)], [0.025, M.gold()]] as const) root.add(rot(mesh(cyl(r, r, 0.052 + (0.14 - r) * 0.05, 14), m, 0.05, 0.25, 0.555), Math.PI / 2 - 0.2, 0, 0));
  for (const s of [-1, 1]) root.add(rod([0.05 + s * 0.1, 0.05, 0.45], [0.05 + s * 0.04, 0.3, 0.52], 0.012, M.timber()));
  root.add(mesh(box(0.3, 0.03, 0.04), M.timber(), 0.55, 0.3, 0.3));
  for (let i = 0; i < 4; i++) {
    root.add(rot(mesh(cyl(0.008, 0.008, 0.55, 4), M.wood(), 0.44 + i * 0.075, 0.33, 0.33), 0.15, 0, 0));
    root.add(rot(mesh(cone(0.016, 0.06, 4), M.steel(), 0.44 + i * 0.075, 0.62, 0.37), 0.15, 0, 0));
  }
  for (let i = 0; i < 7; i++) root.add(mesh(box(0.04, 0.2, 0.04), M.timber(), -0.85 + i * 0.28, 0.15, 0.85));
  for (const y of [0.12, 0.22]) root.add(mesh(box(1.72, 0.025, 0.025), M.wood(), 0, y, 0.85));
  flagpole(root, parts, team, 0.85, 0.05, -0.75, 1.15);
  return { root, parts, height: 1.3 };
}

/** War Factory: a siege workshop, a great open-fronted barn with an engine on the stocks. */
function workshop(L: Look): Model {
  const root = new THREE.Group(), parts: Parts = {}, team = L.team;
  ground(root, 3, 51);
  const bz = -0.45, bw = 2.4, bd = 1.5, bh = 0.85;
  // back and side walls (timber over a stone footing, or all stone with gunpowder)
  for (const [x, z, w, d] of [[0, bz - bd / 2, bw, 0.08], [-bw / 2, bz, 0.08, bd], [bw / 2, bz, 0.08, bd]] as const) {
    root.add(mesh(box(w + 0.04, 0.2, d + 0.04), M.darkStone(), x, 0.15, z));
    root.add(mesh(box(w, bh - 0.2, d), L.gun ? L.wall : M.plaster(), x, 0.25 + (bh - 0.2) / 2, z));
  }
  root.add(mesh(box(bw - 0.1, 0.02, bd - 0.1), M.darkWood(), 0, 0.06, bz)); // plank floor
  // posts and lintel across the open front, braces, and the roof
  for (let i = 0; i <= 4; i++) {
    const x = -bw / 2 + (i * bw) / 4;
    root.add(mesh(box(0.08, bh + 0.1, 0.08), M.timber(), x, 0.05 + (bh + 0.1) / 2, bz + bd / 2));
    root.add(mesh(box(0.08, bh + 0.1, 0.08), M.timber(), x, 0.05 + (bh + 0.1) / 2, bz - bd / 2));
  }
  root.add(mesh(box(bw + 0.1, 0.1, 0.1), M.timber(), 0, bh + 0.1, bz + bd / 2));
  for (const s of [-1, 1]) for (const x of [-0.6, 0.6]) root.add(rod([x + s * 0.25, bh + 0.05, bz + bd / 2], [x, bh - 0.25, bz + bd / 2], 0.02, M.timber()));
  gable(root, 0, bh + 0.15, bz, bw, bd + 0.1, 0.65, L.roof, L.gun ? L.wall : M.plaster());
  banner(root, team, -0.6, bh + 0.35, bz + bd / 2 + 0.06, 0.18, 0.2);
  banner(root, team, 0.6, bh + 0.35, bz + bd / 2 + 0.06, 0.18, 0.2);
  // inside: a catapult frame on the stocks and a lit lantern
  for (const z of [-0.2, 0.2]) {
    root.add(mesh(box(0.8, 0.06, 0.06), M.wood(), -0.3, 0.2, bz + z));
    root.add(mesh(box(0.06, 0.4, 0.06), M.wood(), -0.3, 0.4, bz + z));
  }
  for (const x of [-0.65, 0.05]) root.add(mesh(box(0.06, 0.06, 0.45), M.wood(), x, 0.2, bz));
  root.add(rot(mesh(box(0.7, 0.05, 0.05), M.wood(), -0.5, 0.55, bz), 0, 0, 0.5));
  root.add(mesh(sph(0.04, 6, 4), M.lamp(), 0.6, 0.65, bz));
  if (L.gun) for (let i = 0; i < 3; i++) root.add(along(mesh(cyl(0.04, 0.055, 0.45, 10), M.bronze(), 0.65, 0.14 + i * 0.1, bz - 0.35 + (i % 2) * 0.1)));
  // yard: a log pile, a sawhorse with a log, spare wheels and a hoist
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) root.add(along(mesh(cyl(0.06, 0.06, 0.6, 8), M.wood(), -0.95, 0.11 + i * 0.1, 0.75 + j * 0.13 + i * 0.065)));
  for (const s of [-1, 1]) {
    root.add(rod([0.85 + s * 0.08, 0.05, 0.8], [0.85, 0.25, 0.8], 0.015, M.timber()));
    root.add(rod([0.85 + s * 0.08, 0.05, 1.1], [0.85, 0.25, 1.1], 0.015, M.timber()));
  }
  root.add(across(mesh(cyl(0.05, 0.05, 0.5, 8), M.wood(), 0.85, 0.29, 0.95)));
  root.add(rot(mesh(torus(0.12, 0.022, Math.PI * 2, 4, 12), M.darkWood(), 1.15, 0.08, 0.35), Math.PI / 2, 0, 0));
  root.add(rot(mesh(torus(0.12, 0.022, Math.PI * 2, 4, 12), M.darkWood(), 1.17, 0.12, 0.38), Math.PI / 2, 0, 0.2));
  for (const s of [-1, 1]) root.add(rod([1.25, 0.05, -1.2 + s * 0.12], [1.25, 1.0, -1.2], 0.025, M.timber()));
  root.add(rod([1.25, 1.0, -1.2], [1.25, 0.3, -1.2], 0.006, M.rope(), 3));
  root.add(mesh(box(0.12, 0.12, 0.12), M.wood(), 1.25, 0.24, -1.2));
  return { root, parts, height: 1.65 };
}

/** The ballista on a tower top (the `turret` part, recoiling `barrel` bolt). */
function ballista(team: number): { head: THREE.Group; bolt: THREE.Group } {
  const bolt = group(0.04, 0.13, 0,
    along(mesh(cyl(0.008, 0.008, 0.4, 4), M.wood(), 0.12, 0, 0)),
    along(mesh(cone(0.018, 0.06, 4), M.iron(), 0.34, 0, 0)),
    mesh(box(0.06, 0.03, 0.004), M.white(), -0.06, 0.01, 0));
  const head = group(0, 0, 0,
    mesh(cyl(0.035, 0.05, 0.12, 8), M.timber(), 0, 0.05, 0),
    mesh(box(0.5, 0.04, 0.06), M.wood(), 0.05, 0.11, 0),
    mesh(box(0.08, 0.1, 0.18), M.darkWood(), 0.2, 0.12, 0),
    rot(mesh(box(0.03, 0.03, 0.22), M.iron(), 0.21, 0.13, 0.15), 0, 0.5, 0),
    rot(mesh(box(0.03, 0.03, 0.22), M.iron(), 0.21, 0.13, -0.15), 0, -0.5, 0),
    rod([0.16, 0.13, 0.25], [-0.12, 0.13, 0], 0.003, M.rope(), 3),
    rod([0.16, 0.13, -0.25], [-0.12, 0.13, 0], 0.003, M.rope(), 3),
    across(mesh(cyl(0.025, 0.025, 0.16, 6), M.darkWood(), -0.18, 0.11, 0)),
    mesh(box(0.004, 0.06, 0.08), teamMat(team), 0.2, 0.2, 0),
    bolt);
  return { head, bolt };
}

/** Watchtower: a round stone tower with a ballista on its battlements. */
function watchtower(L: Look): Model {
  const root = new THREE.Group(), parts: Parts = {}, team = L.team, W = L.wall;
  root.add(mesh(cyl(0.44, 0.46, 0.05, 14), M.dirt(), 0, 0.025, 0));
  root.add(mesh(lathe([[0.4, 0], [0.36, 0.25], [0.31, 0.6], [0.3, 1.0]], 14), W, 0, 0.04, 0));
  root.add(mesh(cyl(0.36, 0.3, 0.1, 14), M.darkStone(), 0, 1.07, 0)); // corbels
  root.add(mesh(cyl(0.36, 0.36, 0.16, 14), W, 0, 1.2, 0));
  ringMerlons(root, 0, 0, 0.33, 1.28, 10, W);
  root.add(mesh(cyl(0.3, 0.3, 0.02, 14), M.darkWood(), 0, 1.285, 0));
  for (const y of [0.35, 0.75]) root.add(mesh(lathe([[0.385 - y * 0.1, 0], [0.38 - y * 0.1, 0.03]], 14), M.darkStone(), 0, 0.04 + y, 0));
  door(root, 0, 0.04, 0.395, 0.16, 0.3);
  for (const [a, y] of [[0.9, 0.6], [-0.9, 0.8], [Math.PI, 0.6], [0, 0.95]] as const) {
    const r = 0.33 - y * 0.04;
    if (L.gun) root.add(rot(mesh(box(0.02, 0.12, 0.07), M.window(), Math.cos(a) * r, y, Math.sin(a) * r), 0, -a, 0));
    else root.add(rot(mesh(box(0.02, 0.13, 0.03), M.dark(), Math.cos(a) * r, y, Math.sin(a) * r), 0, -a, 0));
  }
  // team pennants hanging from the parapet
  for (const a of [Math.PI / 2 + 0.6, Math.PI / 2 - 0.6]) {
    const x = Math.cos(a) * 0.37, z = Math.sin(a) * 0.37;
    root.add(rot(mesh(box(0.12, 0.26, 0.01), teamMat(team), x, 1.03, z), 0, -a + Math.PI / 2, 0));
    root.add(rot(mesh(box(0.08, 0.08, 0.011), teamMat(team), x, 0.9, z), 0, -a + Math.PI / 2, Math.PI / 4));
  }
  const { head, bolt } = ballista(team);
  head.position.y = 1.29;
  parts.turret = head;
  parts.barrel = bolt;
  root.add(head);
  if (L.gun) {
    root.add(mesh(cyl(0.012, 0.012, 0.5, 4), M.timber(), -0.22, 1.5, -0.22));
    root.add(mesh(box(0.2, 0.12, 0.01), teamMat(team), -0.12, 1.66, -0.22));
  }
  return { root, parts, height: 1.6 };
}

/** Gun Turret in the Gunpowder age: a round stone bastion with a cannon that swings. */
function bastion(L: Look): Model {
  const root = new THREE.Group(), parts: Parts = {}, team = L.team;
  root.add(mesh(cyl(0.46, 0.48, 0.05, 12), M.dirt(), 0, 0.025, 0));
  root.add(mesh(lathe([[0.46, 0], [0.42, 0.28], [0.42, 0.32]], 12), L.wall, 0, 0.04, 0));
  root.add(mesh(cyl(0.44, 0.44, 0.04, 12), M.darkStone(), 0, 0.36, 0));
  ringMerlons(root, 0, 0, 0.4, 0.37, 8, L.wall, 0.09);
  root.add(mesh(cyl(0.36, 0.36, 0.02, 12), M.darkWood(), 0, 0.37, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    root.add(rot(mesh(box(0.012, 0.16, 0.1), teamMat(team), Math.cos(a) * 0.45, 0.2, Math.sin(a) * 0.45), 0, -a, 0));
  }
  // powder kegs and shot
  for (const [x, z] of [[-0.2, 0.2], [-0.12, 0.26]]) root.add(mesh(lathe(BARREL, 8), M.wood(), x, 0.38, z));
  for (const [x, z, y] of [[0.15, -0.25, 0], [0.21, -0.25, 0], [0.18, -0.2, 0], [0.18, -0.23, 0.05]]) root.add(mesh(sph(0.03, 6, 4), M.iron(), x, 0.41 + y, z));
  const barrel = group(0, 0, 0,
    along(mesh(cyl(0.04, 0.06, 0.46, 10), M.bronze(), 0.2, 0.12, 0)),
    along(mesh(cyl(0.055, 0.055, 0.04, 10), M.bronze(), 0.42, 0.12, 0)),
    along(mesh(cyl(0.065, 0.065, 0.04, 10), M.bronze(), 0.0, 0.12, 0)),
    mesh(sph(0.05, 8, 6), M.bronze(), -0.03, 0.12, 0));
  const head = group(0, 0.38, 0,
    mesh(box(0.34, 0.08, 0.16), M.darkWood(), 0.05, 0.05, 0),
    barrel);
  for (const s of [-1, 1]) head.add(mesh(torus(0.06, 0.012, Math.PI * 2, 3, 10), M.iron(), 0.1, 0.05, s * 0.09));
  parts.turret = head;
  parts.barrel = barrel;
  root.add(head);
  return { root, parts, height: 0.7 };
}

// ---------------------------------------------------------------- primitive (Medieval age)
//
// Before stone: log palisades, wattle walls and thatch. Each age then rebuilds the town a step
// further (stone, then brick and iron, then concrete), so a base visibly grows up.

/** A ring of sharpened log stakes around a footprint, with a gap at the front for the gate. */
function palisade(root: THREE.Object3D, s: number, gap: number, seed: number): void {
  const r = rng(seed), e = s / 2 - 0.08, step = 0.11;
  for (let t = -e; t <= e + 0.001; t += step) {
    for (const [x, z] of [[t, -e], [-e, t], [e, t], [t, e]] as const) {
      if (z === e && Math.abs(x) < gap / 2) continue;
      const h = 0.42 + r() * 0.1;
      root.add(mesh(cyl(0.05, 0.055, h, 6), M.log(), x, h / 2, z));
      root.add(mesh(cone(0.05, 0.08, 6), M.log(), x, h + 0.04, z));
    }
  }
  for (const s2 of [-1, 1]) {
    // gate posts with a lintel and a cross rail behind the stakes
    root.add(mesh(cyl(0.06, 0.06, 0.7, 6), M.timber(), s2 * gap / 2, 0.35, e));
  }
  root.add(mesh(box(gap + 0.16, 0.07, 0.07), M.timber(), 0, 0.68, e));
  for (const z of [-e + 0.07, e - 0.07]) root.add(mesh(box(s - 0.2, 0.04, 0.03), M.timber(), 0, 0.3, z));
}

/** Walls of stacked horizontal logs around a box (a log cabin) standing on y0. */
function logWalls(root: THREE.Object3D, x: number, y0: number, z: number, w: number, h: number, d: number): void {
  root.add(mesh(box(w - 0.04, h, d - 0.04), M.wattle(), x, y0 + h / 2, z));
  const n = Math.max(2, Math.round(h / 0.08));
  for (let i = 0; i < n; i++) {
    const y = y0 + (h / n) * (i + 0.5);
    for (const s of [-1, 1]) {
      root.add(along(mesh(cyl(0.04, 0.04, w + 0.1, 6), M.log(), x, y, z + s * d / 2)));
      root.add(across(mesh(cyl(0.04, 0.04, d + 0.1, 6), M.log(), x + s * w / 2, y + 0.02, z)));
    }
  }
}

/** A plain doorway hung with a hide, on a wall facing +z. */
function hideDoor(root: THREE.Object3D, x: number, y0: number, z: number, w: number, h: number): void {
  root.add(mesh(box(w, h, 0.03), M.dark(), x, y0 + h / 2, z));
  root.add(mesh(box(w * 0.8, h * 0.85, 0.01), M.leather(), x + w * 0.08, y0 + h * 0.45, z + 0.02));
  root.add(mesh(box(w + 0.1, 0.05, 0.05), M.timber(), x, y0 + h + 0.02, z + 0.01));
}

/** A campfire: a ring of stones round glowing embers. */
function campfire(root: THREE.Object3D, x: number, z: number): void {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    root.add(mesh(dodecaRock(), M.darkStone(), x + Math.cos(a) * 0.1, 0.07, z + Math.sin(a) * 0.1));
  }
  root.add(scl(mesh(sph(0.06, 8, 4), M.ember(), x, 0.06, z), 1, 0.5, 1));
  for (let i = 0; i < 3; i++) root.add(rot(mesh(cyl(0.012, 0.012, 0.16, 4), M.timber(), x, 0.1, z), 0.5, (i * Math.PI * 2) / 3, 0));
}
const dodecaRock = () => box(0.05, 0.04, 0.05);

/** Town Hall: a log longhouse inside a stake palisade, with a wooden crane. */
function fort(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  ground(root, 3, 61);
  palisade(root, 3, 0.7, 62);
  logWalls(root, -0.2, 0.05, -0.45, 1.5, 0.5, 0.8);
  gable(root, -0.2, 0.55, -0.45, 1.5, 1.05, 0.6, M.thatch(), M.wattle());
  for (const s of [-1, 1]) root.add(rot(mesh(box(0.04, 0.3, 0.04), M.timber(), -0.2 + s * 0.8, 1.15, -0.45 + 0.0), 0, 0, s * 0.5)); // crossed gable horns
  hideDoor(root, -0.2, 0.05, -0.04, 0.24, 0.38);
  banner(root, team, -0.65, 0.4, -0.04, 0.16, 0.22);
  banner(root, team, 0.25, 0.4, -0.04, 0.16, 0.22);
  // a smoke hole and a lookout platform on posts in the corner
  root.add(mesh(box(0.14, 0.12, 0.14), M.timber(), 0.1, 1.12, -0.45));
  for (const [x, z] of [[-1.15, -1.15], [-0.85, -1.15], [-1.15, -0.85], [-0.85, -0.85]]) root.add(mesh(cyl(0.035, 0.04, 0.95, 6), M.log(), x, 0.47, z));
  root.add(mesh(box(0.42, 0.05, 0.42), M.wood(), -1.0, 0.95, -1.0));
  for (const s of [-1, 1]) {
    root.add(mesh(box(0.42, 0.03, 0.03), M.timber(), -1.0, 1.1, -1.0 + s * 0.2));
    root.add(mesh(box(0.03, 0.03, 0.42), M.timber(), -1.0 + s * 0.2, 1.1, -1.0));
  }
  // A-frame crane with a swinging jib (the `crane` part) and a log on the rope
  for (const s of [-1, 1]) root.add(rod([0.95 + s * 0.2, 0.05, 0.7], [0.95, 1.2, 0.7], 0.035, M.log()));
  const crane = group(0.95, 1.2, 0.7,
    mesh(box(1.0, 0.06, 0.06), M.log(), -0.35, 0, 0),
    mesh(box(0.18, 0.14, 0.14), M.darkStone(), 0.2, -0.04, 0),
    rod([-0.8, 0, 0], [-0.8, -0.55, 0], 0.006, M.rope(), 3),
    along(mesh(cyl(0.05, 0.05, 0.3, 6), M.log(), -0.8, -0.6, 0)));
  parts.crane = crane;
  root.add(crane);
  campfire(root, 0.5, 0.15);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) root.add(across(mesh(cyl(0.05, 0.05, 0.5, 6), M.log(), 0.8 + j * 0.11 + i * 0.055, 0.1 + i * 0.09, -0.6)));
  root.add(scl(mesh(sph(0.15, 8, 6), M.straw(), -1.0, 0.1, 0.7), 1.2, 0.7, 1));
  clutter(root, 0.55, 0.85, 63);
  flagpole(root, parts, team, -1.0, 1.0, -1.0, 0.6);
  return { root, parts, height: 1.6 };
}

/** Power: a timber post mill on a trestle, with sails (the `sails` part). */
function postMill(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  ground(root, 2, 71);
  const z0 = -0.1;
  // trestle: crossed sill beams, quarter bars and the central post
  for (const a of [0, Math.PI / 2]) root.add(rot(mesh(box(1.0, 0.07, 0.07), M.log(), 0, 0.09, z0), 0, a, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    root.add(rod([Math.cos(a) * 0.45, 0.1, z0 + Math.sin(a) * 0.45], [0, 0.55, z0], 0.025, M.log()));
  }
  root.add(mesh(cyl(0.06, 0.07, 0.7, 8), M.log(), 0, 0.42, z0));
  // the mill body: a boarded box with a gable roof, steps up the back
  root.add(mesh(box(0.55, 0.55, 0.5), M.wood(), 0, 1.0, z0));
  for (let i = 0; i < 6; i++) root.add(mesh(box(0.56, 0.012, 0.51), M.darkWood(), 0, 0.76 + i * 0.09, z0));
  gable(root, 0, 1.27, z0, 0.55, 0.6, 0.3, M.thatch(), M.wood());
  root.add(rot(mesh(box(0.2, 0.03, 0.75), M.wood(), 0, 0.5, z0 - 0.55), -0.85, 0, 0));
  for (let i = 0; i < 5; i++) root.add(mesh(box(0.2, 0.012, 0.05), M.darkWood(), 0, 0.2 + i * 0.13, z0 - 0.33 - i * 0.11));
  root.add(mesh(box(0.004, 0.08, 0.14), teamMat(team), 0.28, 1.05, z0));
  root.add(mesh(box(0.004, 0.08, 0.14), teamMat(team), -0.28, 1.05, z0));
  // sails facing +z: a cross of stocks with cloth on lattices
  const sails = group(0, 1.15, z0 + 0.3, across(mesh(cyl(0.045, 0.045, 0.14, 6), M.log(), 0, 0, -0.04)));
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    arm.add(mesh(box(0.03, 0.75, 0.03), M.log(), 0, 0.4, 0));
    arm.add(mesh(box(0.15, 0.5, 0.008), i % 2 ? M.cloth() : teamMat(team, 'l'), 0.09, 0.5, 0.012));
    for (let k = 0; k < 4; k++) arm.add(mesh(box(0.18, 0.012, 0.014), M.darkWood(), 0.08, 0.27 + k * 0.14, 0.02));
    sails.add(arm);
  }
  parts.sails = sails;
  root.add(sails);
  for (const [x, z] of [[0.55, 0.55], [0.65, 0.42]]) root.add(scl(mesh(sph(0.07, 8, 6), M.cloth(), x, 0.11, z), 1, 0.9, 1.1));
  return { root, parts, height: 1.6 };
}

/** Refinery: a clay bloomery furnace under a thatched shed, with a log landing for ore. */
function bloomery(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  ground(root, 3, 81);
  // log landing where harvesters unload
  for (let i = 0; i < 7; i++) root.add(along(mesh(cyl(0.05, 0.05, 1.3, 6), M.log(), 0, 0.08, 0.78 + i * 0.1)));
  root.add(scl(mesh(sph(0.22, 10, 6), M.ore(), -0.75, 0.1, 0.25), 1.3, 0.5, 1));
  // clay furnaces: squat cones with glowing mouths
  for (const [x, z, k] of [[0.6, -0.6, 1], [1.0, -0.15, 0.75]] as const) {
    root.add(mesh(lathe([[0.32 * k, 0], [0.3 * k, 0.25 * k], [0.18 * k, 0.6 * k], [0.1 * k, 0.75 * k]], 10), M.clay(), x, 0.05, z));
    root.add(mesh(cyl(0.08 * k, 0.08 * k, 0.02, 8), M.ember(), x, 0.05 + 0.75 * k, z));
    root.add(mesh(box(0.14 * k, 0.12 * k, 0.1), M.ember(), x, 0.1 + 0.05 * k, z + 0.27 * k));
  }
  // thatched shed on posts over the workshop
  for (const [x, z] of [[-1.15, -1.1], [-0.05, -1.1], [-1.15, -0.25], [-0.05, -0.25]]) root.add(mesh(cyl(0.04, 0.045, 0.65, 6), M.log(), x, 0.37, z));
  gable(root, -0.6, 0.68, -0.68, 1.2, 1.0, 0.4, M.thatch(), M.wattle());
  banner(root, team, -0.6, 0.55, -0.22, 0.16, 0.2);
  // charcoal heap, anvil stone, bellows, ingots
  root.add(scl(mesh(sph(0.2, 10, 6), M.dark(), -0.85, 0.05, -0.75), 1, 0.6, 1));
  root.add(mesh(box(0.16, 0.12, 0.12), M.darkStone(), -0.35, 0.11, -0.6));
  root.add(mesh(box(0.1, 0.03, 0.06), M.iron(), -0.35, 0.18, -0.6));
  root.add(rot(mesh(box(0.22, 0.05, 0.14), M.leather(), 0.25, 0.12, -0.5), 0, 0.4, 0.1));
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2 - i; j++) root.add(mesh(box(0.1, 0.035, 0.05), M.iron(), 0.2 + j * 0.06 + i * 0.03, 0.07 + i * 0.035, 0.25));
  clutter(root, -1.1, 0.4, 82);
  return { root, parts, height: 1.2 };
}

/** Barracks: a round wattle hut with a conical thatched roof and a training ground. */
function roundhouse(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  ground(root, 2, 91);
  const hz = -0.2;
  root.add(mesh(cyl(0.5, 0.52, 0.45, 14), M.wattle(), 0, 0.27, hz));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    root.add(mesh(cyl(0.02, 0.02, 0.46, 4), M.timber(), Math.cos(a) * 0.51, 0.27, hz + Math.sin(a) * 0.51));
  }
  for (const y of [0.15, 0.32]) root.add(mesh(torus(0.515, 0.015, Math.PI * 2, 3, 14), M.timber(), 0, y, hz).rotateX(Math.PI / 2));
  root.add(mesh(cone(0.68, 0.7, 14), M.thatch(), 0, 0.84, hz));
  root.add(mesh(cyl(0.03, 0.03, 0.15, 5), M.timber(), 0, 1.24, hz));
  hideDoor(root, 0, 0.05, hz + 0.5, 0.2, 0.33);
  banner(root, team, 0.28, 0.32, hz + 0.43, 0.12, 0.18);
  // training ground: a straw dummy, spears stuck in the earth, a log bench
  root.add(mesh(cyl(0.02, 0.02, 0.45, 6), M.timber(), -0.55, 0.27, 0.55));
  root.add(mesh(box(0.03, 0.03, 0.3), M.timber(), -0.55, 0.4, 0.55));
  root.add(scl(mesh(sph(0.08, 8, 6), M.straw(), -0.55, 0.33, 0.55), 1, 1.4, 1));
  root.add(mesh(sph(0.05, 8, 6), M.straw(), -0.55, 0.52, 0.55));
  for (let i = 0; i < 4; i++) {
    root.add(rot(mesh(cyl(0.008, 0.008, 0.55, 4), M.wood(), 0.5 + i * 0.07, 0.3, 0.55 + (i % 2) * 0.05), 0.1 * (i - 1.5), 0, 0.1));
    root.add(rot(mesh(cone(0.016, 0.06, 4), M.iron(), 0.5 + i * 0.07 + 0.028, 0.59, 0.55 + (i % 2) * 0.05 + 0.04 * (i - 1.5)), 0.1 * (i - 1.5), 0, 0.1));
  }
  root.add(along(mesh(cyl(0.05, 0.05, 0.5, 6), M.log(), 0.1, 0.1, 0.8)));
  campfire(root, -0.6, -0.65);
  flagpole(root, parts, team, 0.8, 0.05, -0.75, 1.0);
  return { root, parts, height: 1.3 };
}

/** War Factory: an open shelter of poles and thatch with a siege engine half built. */
function shelter(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  ground(root, 3, 101);
  const bz = -0.45, bw = 2.3, bd = 1.4;
  for (let i = 0; i <= 3; i++) for (const s of [-1, 1]) root.add(mesh(cyl(0.05, 0.055, 0.85, 6), M.log(), -bw / 2 + (i * bw) / 3, 0.45, bz + s * bd / 2));
  for (const s of [-1, 1]) root.add(along(mesh(cyl(0.05, 0.05, bw + 0.1, 6), M.log(), 0, 0.88, bz + s * bd / 2)));
  gable(root, 0, 0.9, bz, bw, bd + 0.15, 0.55, M.thatch(), M.wattle());
  // wattle screen along the back
  root.add(mesh(box(bw, 0.6, 0.05), M.wattle(), 0, 0.35, bz - bd / 2));
  banner(root, team, -0.5, 0.65, bz + bd / 2 + 0.02, 0.18, 0.22);
  banner(root, team, 0.5, 0.65, bz + bd / 2 + 0.02, 0.18, 0.22);
  // a catapult frame on the ground inside, and its arm waiting beside it
  for (const z of [-0.2, 0.2]) {
    root.add(mesh(box(0.8, 0.06, 0.06), M.wood(), -0.3, 0.1, bz + z));
    root.add(mesh(box(0.06, 0.35, 0.06), M.wood(), -0.3, 0.3, bz + z));
  }
  for (const x of [-0.65, 0.05]) root.add(mesh(box(0.06, 0.06, 0.45), M.wood(), x, 0.1, bz));
  root.add(rot(mesh(box(0.7, 0.05, 0.05), M.wood(), 0.6, 0.08, bz + 0.1), 0, 0.3, 0));
  root.add(rot(mesh(torus(0.12, 0.022, Math.PI * 2, 4, 10), M.darkWood(), 0.6, 0.06, bz - 0.35), Math.PI / 2, 0, 0));
  // logs, a sawhorse, wood chips
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) root.add(along(mesh(cyl(0.06, 0.06, 0.6, 6), M.log(), -0.95, 0.11 + i * 0.1, 0.75 + j * 0.13 + i * 0.065)));
  for (const s of [-1, 1]) {
    root.add(rod([0.85 + s * 0.08, 0.05, 0.8], [0.85, 0.25, 0.8], 0.015, M.timber()));
    root.add(rod([0.85 + s * 0.08, 0.05, 1.1], [0.85, 0.25, 1.1], 0.015, M.timber()));
  }
  root.add(across(mesh(cyl(0.05, 0.05, 0.5, 6), M.log(), 0.85, 0.29, 0.95)));
  root.add(scl(mesh(sph(0.12, 8, 4), M.straw(), 0.9, 0.05, 0.6), 1.3, 0.25, 1));
  return { root, parts, height: 1.5 };
}

/** Watchtower in the Medieval age: log stilts, a railed platform, a ballista on top. */
function woodTower(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  root.add(mesh(cyl(0.44, 0.46, 0.05, 12), M.dirt(), 0, 0.025, 0));
  const e = 0.26, top = 1.1;
  for (const [x, z] of [[-e, -e], [e, -e], [-e, e], [e, e]]) root.add(rod([x * 1.25, 0.03, z * 1.25], [x, top, z], 0.045, M.log(), 6));
  for (const y of [0.35, 0.75]) for (const [a, b] of [[[-e, -e], [e, e]], [[e, -e], [-e, e]]] as const) {
    root.add(rod([a[0] * 1.15, y - 0.2, a[1] * 1.15], [b[0], y + 0.15, b[1]], 0.02, M.timber(), 4));
  }
  for (const y of [0.4, 0.8]) for (const s of [-1, 1]) {
    root.add(mesh(box(e * 2.3, 0.04, 0.04), M.timber(), 0, y, s * e * (1.25 - (y / top) * 0.25)));
    root.add(mesh(box(0.04, 0.04, e * 2.3), M.timber(), s * e * (1.25 - (y / top) * 0.25), y, 0));
  }
  // ladder up the front
  for (const s of [-1, 1]) root.add(rod([s * 0.07, 0.03, 0.45], [s * 0.07, top, e + 0.03], 0.015, M.wood(), 4));
  for (let i = 1; i < 8; i++) { const t = i / 8; root.add(mesh(box(0.14, 0.015, 0.015), M.wood(), 0, 0.03 + t * (top - 0.03), 0.45 + t * (e + 0.03 - 0.45))); }
  // platform with a rail of stakes and hanging shields
  root.add(mesh(box(0.7, 0.05, 0.7), M.wood(), 0, top, 0));
  for (let i = 0; i < 6; i++) root.add(mesh(box(0.7, 0.012, 0.11), M.darkWood(), 0, top + 0.026, -0.29 + i * 0.116));
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
    const t = -0.32 + i * 0.16;
    root.add(mesh(cyl(0.025, 0.025, 0.22, 5), M.log(), t, top + 0.13, s * 0.33));
    root.add(mesh(cyl(0.025, 0.025, 0.22, 5), M.log(), s * 0.33, top + 0.13, t));
  }
  for (const s of [-1, 1]) {
    root.add(mesh(cyl(0.08, 0.08, 0.015, 10).rotateX(Math.PI / 2), teamMat(team), s * 0.15, top + 0.12, 0.345));
    root.add(mesh(sph(0.018, 6, 4), M.iron(), s * 0.15, top + 0.12, 0.355));
  }
  const { head, bolt } = ballista(team);
  head.position.y = top + 0.03;
  parts.turret = head;
  parts.barrel = bolt;
  root.add(head);
  root.add(mesh(cyl(0.012, 0.012, 0.55, 4), M.timber(), -0.3, top + 0.3, -0.3));
  root.add(mesh(box(0.2, 0.12, 0.01), teamMat(team), -0.2, top + 0.5, -0.3));
  return { root, parts, height: 1.5 };
}

/** A structure's look before industry: 'wood' in the Medieval age, 'stone' in the Gunpowder age. */
/** Lumber Mill: a timber sawmill with a turning saw wheel (the `sails` part), logs and planks. */
function sawmill(L: Look): Model {
  const root = new THREE.Group(), parts: Parts = {}, team = L.team;
  ground(root, 2, 41);
  // the shed
  const z0 = -0.25;
  if (L.gun) root.add(mesh(box(1.0, 0.45, 0.7), L.wall, -0.2, 0.05 + 0.225, z0));
  else timberFrame(root, -0.2, 0.05, z0, 1.0, 0.45, 0.7);
  gable(root, -0.2, 0.5, z0, 1.0, 0.7, 0.32, L.thatch);
  door(root, -0.35, 0.05, z0 + 0.36, 0.22, 0.32);
  banner(root, team, 0.08, 0.32, z0 + 0.36, 0.16, 0.24);
  // the saw wheel on an axle beside the shed
  root.add(mesh(box(0.06, 0.5, 0.06), M.darkWood(), 0.55, 0.3, z0 - 0.08));
  root.add(mesh(box(0.06, 0.5, 0.06), M.darkWood(), 0.55, 0.3, z0 + 0.2));
  const wheel = group(0.55, 0.5, z0 + 0.06, across(mesh(cyl(0.05, 0.05, 0.3, 8), M.iron())));
  wheel.add(mesh(torus(0.36, 0.03, Math.PI * 2, 4, 18), M.darkWood()));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, spoke = new THREE.Group();
    spoke.rotation.z = a;
    spoke.add(mesh(box(0.03, 0.36, 0.03), M.wood(), 0, 0.18, 0));
    spoke.add(mesh(box(0.1, 0.06, 0.12), M.timber(), 0, 0.36, 0));
    wheel.add(spoke);
  }
  wheel.add(mesh(cyl(0.12, 0.12, 0.01, 18), M.iron(), 0, 0, 0.08).rotateX(Math.PI / 2));
  parts.sails = wheel;
  root.add(wheel);
  // log pile and stacked planks out front
  for (const [x, y, z] of [[-0.55, 0.1, 0.5], [-0.35, 0.1, 0.5], [-0.15, 0.1, 0.5], [-0.45, 0.25, 0.5], [-0.25, 0.25, 0.5]]) {
    root.add(across(mesh(cyl(0.09, 0.09, 0.5, 8), M.wood(), x, y, z)));
  }
  for (let i = 0; i < 4; i++) root.add(mesh(box(0.5, 0.04, 0.16), i % 2 ? M.wood() : M.timber(), 0.45, 0.08 + i * 0.045, 0.55));
  return { root, parts, height: 1.0 };
}

export function medievalBuilding(type: Exclude<BldType, 'airfield' | 'flak' | 'hospital' | 'armory' | AetherBld | 'palisade' | 'stonewall' | 'concretewall' | 'pillbox' | 'atturret' | 'bertha'>, team: number, stage: 'wood' | 'stone'): Model {
  if (stage === 'wood') {
    switch (type) {
      case 'yard': return fort(team);
      case 'power': return postMill(team);
      case 'refinery': return bloomery(team);
      case 'barracks': return roundhouse(team);
      case 'factory': return shelter(team);
      case 'tower': return woodTower(team);
      case 'turret': break;
      case 'mill': return sawmill(look(team, false));
      case 'derrick': case 'works': break;
    }
  }
  const L = look(team, true);
  switch (type) {
    case 'yard': return keep(L);
    case 'power': return windmill(L);
    case 'refinery': return smeltery(L);
    case 'barracks': return hall(L);
    case 'factory': return workshop(L);
    case 'turret': return bastion(L);
    case 'tower': return watchtower(L);
    case 'mill': return sawmill(L);
    case 'derrick': case 'works': throw new Error(`${type} has no medieval look`);
  }
}
