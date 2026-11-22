// 3D models for the Aether structures: the Star Shrine, the Ward Stone and the Waygate. Old stone
// touched by violet fallen-star shards, so they read as supernatural in any age. Footprints face +z.
import * as THREE from 'three';
import type { AetherBld } from '../../../data/building.ts';
import { mesh, rot, scl, type Model, type Parts } from './model_kit.ts';
import { M, box, cyl, dodeca, octa, teamMat, torus } from './materials.ts';

function base(s: number): THREE.Mesh {
  const p = mesh(box(s - 0.1, 0.06, s - 0.1), M.darkStone(), 0, 0.03, 0);
  p.name = 'pad';
  return p;
}

/** A tall glowing shard. */
function shard(root: THREE.Object3D, x: number, y: number, z: number, h: number, tilt = 0): THREE.Mesh {
  const c = mesh(octa(0.1), M.aether(), x, y, z);
  c.scale.set(0.8, h * 4, 0.8);
  c.rotation.z = tilt;
  root.add(c);
  return c;
}

/** Star Shrine (2×2): a ring of standing stones around a floating shard. */
function shrine(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  root.add(base(2));
  root.add(mesh(cyl(0.62, 0.7, 0.08, 16), M.stone(), 0, 0.1, 0));
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2, x = Math.cos(a) * 0.72, z = Math.sin(a) * 0.72, h = 0.5 + (k % 3) * 0.08;
    root.add(rot(mesh(box(0.14, h, 0.1), M.stone(), x, 0.1 + h / 2, z), 0, -a, (k % 2 ? 0.05 : -0.04)));
  }
  // team banners on two of the stones
  root.add(mesh(box(0.1, 0.16, 0.02), teamMat(team), 0.72, 0.5, 0.06));
  root.add(mesh(box(0.1, 0.16, 0.02), teamMat(team), -0.72, 0.5, -0.06));
  root.add(mesh(cyl(0.12, 0.16, 0.16, 8), M.darkStone(), 0, 0.22, 0));
  const star = new THREE.Group();
  star.position.y = 0.72;
  const core = mesh(octa(0.14), M.aether(), 0, 0, 0);
  core.scale.set(1, 1.8, 1);
  star.add(core, rot(mesh(torus(0.26, 0.015, Math.PI * 2, 4, 24), M.aether(), 0, 0, 0), Math.PI / 2, 0, 0));
  parts.star = star;
  root.add(star);
  return { root, parts, height: 1.1 };
}

/** Ward Stone (1×1): an obelisk with an Aether eye. */
function wardstone(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  root.add(base(1));
  root.add(mesh(box(0.42, 0.12, 0.42), M.stone(), 0, 0.12, 0));
  const ob = mesh(cyl(0.08, 0.15, 0.95, 4), M.darkStone(), 0, 0.65, 0);
  ob.rotation.y = Math.PI / 4;
  root.add(ob);
  root.add(rot(mesh(cyl(0, 0.08, 0.14, 4), M.stone(), 0, 1.19, 0), 0, Math.PI / 4, 0));
  root.add(mesh(box(0.2, 0.06, 0.02), teamMat(team), 0, 0.3, 0.16));
  const eye = scl(mesh(octa(0.07), M.aether(), 0, 0.9, 0.1), 1, 1.3, 0.6);
  parts.eye = eye;
  root.add(eye);
  for (const [x, z] of [[0.3, 0.2], [-0.28, -0.24], [0.22, -0.3]]) shard(root, x, 0.08, z, 0.12, x);
  return { root, parts, height: 1.3 };
}

/** Waygate (2×2): a stone arch over a swirling violet veil, opening toward +z. */
function waygate(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  root.add(base(2));
  root.add(mesh(box(1.5, 0.1, 0.6), M.stone(), 0, 0.1, 0.1));
  for (const x of [-0.6, 0.6]) {
    root.add(mesh(box(0.22, 1.0, 0.3), M.dressedStone(), x, 0.65, 0.1));
    root.add(mesh(box(0.26, 0.08, 0.34), M.stone(), x, 0.18, 0.1));
  }
  root.add(rot(mesh(torus(0.6, 0.12, Math.PI, 5, 16), M.dressedStone(), 0, 1.15, 0.1), 0, 0, 0));
  root.add(mesh(box(0.18, 0.18, 0.32), teamMat(team), 0, 1.78, 0.1));
  const veil = new THREE.Group();
  veil.position.set(0, 0.85, 0.1);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.52, 24), new THREE.MeshBasicMaterial({ color: '#b070ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  disc.scale.set(0.95, 1.4, 1);
  veil.add(disc);
  veil.add(scl(mesh(torus(0.32, 0.03, Math.PI * 1.6, 4, 20), M.aether(), 0, 0, 0.01), 1, 1.4, 1));
  parts.veil = veil;
  root.add(veil);
  for (const [x, z] of [[0.75, 0.6], [-0.78, 0.55]]) shard(root, x, 0.12, z, 0.16, -x * 0.3);
  root.add(rot(scl(mesh(dodeca(0.12), M.darkStone(), 0.8, 0.08, -0.6), 1, 0.6, 1), 0, 0.4, 0));
  return { root, parts, height: 1.9 };
}

export function aetherBuilding(type: AetherBld, team: number): Model {
  return type === 'shrine' ? shrine(team) : type === 'wardstone' ? wardstone(team) : waygate(team);
}
