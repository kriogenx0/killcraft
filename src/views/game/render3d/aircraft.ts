// Procedural 3D models for aircraft and the air war's structures: the War Balloon, Biplane and
// Attack Helicopter, the Airfield that builds them, and the Flak Cannon that shoots them down.
// Aircraft face +x and are modelled from the bottom of the craft (entities3d lifts them to their
// flying height); structures face +z, like the rest. Named parts are animated by entities3d.ts.
import * as THREE from 'three';
import { across, along, group, mesh, rod, rot, scl, type Model, type Parts } from './model_kit.ts';
import { M, box, cone, cyl, mat, prism, sph, teamMat, torus } from './materials.ts';

// ---------------------------------------------------------------- aircraft

/** World War: a silk envelope in team stripes over a wicker basket, with a burner and bombs. */
export function balloon(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team, 'm', 0), silk = M.cloth();
  // envelope: a teardrop of alternating gores, narrowing to a mouth above the basket
  const env = group(0, 0.36, 0);
  const shape: [number, number][] = [[0.04, 0], [0.1, 0.06], [0.22, 0.2], [0.3, 0.38], [0.32, 0.52], [0.28, 0.66], [0.18, 0.76], [0.06, 0.8], [0, 0.81]];
  for (let i = 0; i < 8; i++) {
    const gore = new THREE.LatheGeometry(shape.map(([r, h]) => new THREE.Vector2(r, h)), 2, (i / 8) * Math.PI * 2, Math.PI / 4);
    env.add(mesh(gore, i % 2 ? silk : tm));
  }
  env.add(mesh(torus(0.315, 0.012, Math.PI * 2, 4, 24), M.rope(), 0, 0.46, 0).rotateX(Math.PI / 2));
  env.add(mesh(cyl(0.05, 0.05, 0.02, 10), M.rope(), 0, 0.81, 0));
  root.add(env);
  parts.envelope = env;
  // load ring and rigging down to the basket
  root.add(rot(mesh(torus(0.05, 0.008, Math.PI * 2, 4, 12), M.rope(), 0, 0.36, 0), Math.PI / 2, 0, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    root.add(rod([Math.cos(a) * 0.3, 0.82, Math.sin(a) * 0.3], [Math.cos(a) * 0.045, 0.36, Math.sin(a) * 0.045], 0.003, M.rope(), 3));
  }
  for (const [x, z] of [[0.08, 0.08], [0.08, -0.08], [-0.08, 0.08], [-0.08, -0.08]]) root.add(rod([x, 0.15, z], [x * 0.5, 0.36, z * 0.5], 0.004, M.rope(), 3));
  // wicker basket with a rim, sandbags and a crewman
  root.add(mesh(box(0.18, 0.13, 0.18), M.wattle(), 0, 0.065, 0));
  root.add(mesh(box(0.2, 0.02, 0.2), M.leather(), 0, 0.14, 0));
  for (const [x, z] of [[0.1, 0.05], [0.1, -0.05], [-0.1, 0.05], [-0.05, 0.1]]) root.add(scl(mesh(sph(0.025, 6, 4), M.sandbag(), x, 0.09, z), 1, 1.4, 1));
  root.add(mesh(cyl(0.025, 0.03, 0.08, 8), M.khaki(), 0.03, 0.18, 0.03));
  root.add(mesh(sph(0.022, 8, 6), M.skin(), 0.03, 0.235, 0.03));
  root.add(mesh(cyl(0.026, 0.026, 0.015, 8), M.leather(), 0.03, 0.255, 0.03));
  // burner glowing under the mouth, and a bomb hanging off the side
  root.add(mesh(cyl(0.03, 0.02, 0.05, 8), M.iron(), 0, 0.3, 0));
  root.add(mesh(sph(0.02, 8, 6), M.ember(), 0, 0.33, 0));
  root.add(mesh(sph(0.03, 8, 6), M.iron(), -0.06, -0.02, 0.06));
  root.add(mesh(cyl(0.006, 0.006, 0.04, 4), M.rope(), -0.06, 0.02, 0.06));
  return { root, parts, height: 1.2 };
}

/** World War: a wood-and-canvas biplane with a radial engine and a gun over the top wing. */
export function biplane(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team), td = teamMat(team, 'd'), canvas = mat('#d8cfae', { rough: 0.95 });
  // fuselage tapering to the tail, with a cockpit, pilot and goggles
  root.add(along(mesh(cyl(0.07, 0.03, 0.52, 10), tm, -0.06, 0.14, 0)));
  root.add(along(mesh(cyl(0.075, 0.07, 0.12, 10), td, 0.24, 0.14, 0)));
  root.add(mesh(box(0.1, 0.03, 0.1), M.dark(), 0.06, 0.2, 0));
  root.add(mesh(sph(0.03, 8, 6), M.leather(), 0.05, 0.235, 0));
  root.add(mesh(box(0.01, 0.012, 0.05), M.glass(), 0.075, 0.24, 0));
  // radial engine cowling and spinning propeller
  root.add(along(mesh(cyl(0.08, 0.08, 0.05, 12), M.darkSteel(), 0.32, 0.14, 0)));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    root.add(along(mesh(cyl(0.016, 0.016, 0.04, 6), M.iron(), 0.34, 0.14 + Math.sin(a) * 0.07, Math.cos(a) * 0.07)));
  }
  const prop = group(0.37, 0.14, 0,
    mesh(box(0.02, 0.36, 0.035), M.darkWood(), 0, 0, 0),
    along(mesh(cone(0.03, 0.05, 8), M.steel(), 0.03, 0, 0)));
  parts.prop = prop;
  root.add(prop);
  // two wings, struts and bracing wires, team roundels on top
  for (const [y, w] of [[0.07, 0.86], [0.27, 0.96]] as const) {
    root.add(mesh(box(0.17, 0.016, w), canvas, 0.13, y, 0));
    root.add(mesh(box(0.02, 0.018, w), td, 0.215, y, 0));
    for (const z of [-0.36, 0.36]) root.add(mesh(cyl(0.045, 0.045, 0.004, 12), tm, 0.13, y + 0.01, z));
  }
  for (const z of [-0.3, 0.3]) for (const x of [0.08, 0.18]) root.add(mesh(box(0.012, 0.2, 0.012), M.darkWood(), x, 0.17, z));
  for (const z of [-0.3, 0.3]) root.add(rod([0.08, 0.07, z], [0.18, 0.27, z], 0.002, M.iron(), 3));
  for (const z of [-0.05, 0.05]) root.add(rod([0.13, 0.27, z], [0.16, 0.14, z * 2], 0.006, M.darkWood(), 4));
  // tail: fin, rudder and tailplane
  root.add(mesh(box(0.12, 0.01, 0.3), canvas, -0.3, 0.15, 0));
  root.add(mesh(box(0.1, 0.13, 0.01), tm, -0.31, 0.22, 0));
  root.add(mesh(box(0.03, 0.13, 0.012), M.white(), -0.36, 0.22, 0));
  // landing gear
  for (const z of [-0.09, 0.09]) {
    root.add(rod([0.14, 0.1, z * 0.5], [0.14, 0.02, z], 0.006, M.darkSteel(), 4));
    root.add(across(mesh(cyl(0.035, 0.035, 0.02, 10), M.rubber(), 0.14, 0.02, z)));
  }
  root.add(rod([-0.3, 0.12, 0], [-0.34, 0.06, 0], 0.005, M.darkSteel(), 4));
  // twin machine guns above the engine
  const guns = group(0.14, 0.21, 0);
  for (const z of [-0.025, 0.025]) guns.add(along(mesh(cyl(0.008, 0.008, 0.16, 6), M.gun(), 0.08, 0, z)));
  parts.barrel = guns;
  root.add(guns);
  return { root, parts, height: 0.45 };
}

/** Modern age: a steel gunship with a glass canopy, missile pods on stub wings and spinning rotors. */
export function helicopter(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team, 'm', 0.4), td = teamMat(team, 'd', 0.4);
  // fuselage, nose and stepped tandem canopy
  root.add(scl(mesh(sph(0.15, 14, 10), tm, 0.02, 0.2, 0), 1.6, 0.85, 0.75));
  root.add(scl(mesh(sph(0.1, 12, 8), M.glass(), 0.15, 0.25, 0), 1.3, 0.8, 0.8));
  root.add(mesh(box(0.02, 0.06, 0.15), td, 0.1, 0.27, 0));
  root.add(along(mesh(cone(0.05, 0.1, 10), td, 0.3, 0.17, 0)));
  // chin gun under the nose
  const chin = group(0.25, 0.1, 0, mesh(sph(0.03, 8, 6), M.darkSteel(), 0, 0, 0), along(mesh(cyl(0.008, 0.008, 0.12, 6), M.gun(), 0.07, -0.01, 0)));
  parts.barrel = chin;
  root.add(chin);
  // engines either side of the rotor mast with exhausts
  for (const z of [-0.08, 0.08]) {
    root.add(along(mesh(cyl(0.04, 0.04, 0.2, 10), M.darkSteel(), -0.04, 0.32, z)));
    root.add(along(mesh(cyl(0.03, 0.035, 0.03, 10), M.dark(), -0.15, 0.32, z)));
  }
  // tail boom, fin and tailplane
  root.add(along(mesh(cyl(0.035, 0.06, 0.5, 10), tm, -0.4, 0.24, 0)));
  root.add(rot(mesh(box(0.12, 0.16, 0.012), td, -0.64, 0.32, 0), 0, 0, -0.35));
  root.add(mesh(box(0.08, 0.01, 0.2), td, -0.56, 0.24, 0));
  const tailRotor = group(-0.66, 0.34, 0.025,
    mesh(box(0.012, 0.16, 0.02), M.dark(), 0, 0, 0),
    mesh(box(0.16, 0.012, 0.02), M.dark(), 0, 0, 0));
  parts.tailRotor = tailRotor;
  root.add(tailRotor);
  // stub wings with missile pods
  root.add(mesh(box(0.08, 0.015, 0.42), td, -0.02, 0.18, 0));
  for (const z of [-0.18, 0.18]) {
    root.add(along(mesh(cyl(0.03, 0.03, 0.14, 8), M.olive(), 0, 0.15, z)));
    root.add(along(mesh(cyl(0.022, 0.022, 0.01, 8), M.dark(), 0.075, 0.15, z)));
    for (const dz of [-0.04, 0.04]) root.add(along(mesh(cyl(0.012, 0.012, 0.12, 6), M.white(), 0.02, 0.15, z + dz)));
  }
  // skids
  for (const z of [-0.1, 0.1]) {
    root.add(along(mesh(cyl(0.008, 0.008, 0.36, 6), M.darkSteel(), 0.02, 0.01, z)));
    for (const x of [-0.06, 0.1]) root.add(rod([x, 0.01, z], [x, 0.12, z * 0.6], 0.007, M.darkSteel(), 4));
  }
  // mast and main rotor
  root.add(mesh(cyl(0.025, 0.03, 0.1, 8), M.darkSteel(), 0, 0.4, 0));
  const rotor = group(0, 0.46, 0, mesh(cyl(0.04, 0.04, 0.03, 10), M.darkSteel(), 0, 0, 0));
  // four blades radiating from the hub
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2, b = mesh(box(0.6, 0.008, 0.045), M.dark(), Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
    b.rotation.y = a;
    rotor.add(b);
  }
  parts.rotor = rotor;
  root.add(rotor);
  return { root, parts, height: 0.5 };
}

// ---------------------------------------------------------------- structures

/**
 * The Airfield. In the Gunpowder age it's a balloon field: a canvas shed, a gas works and a
 * tethered balloon. From the Industrial age on it's a hangar, a strip and a control tower.
 */
export function airfield(team: number, stage: 'field' | 'hangar'): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team);
  if (stage === 'field') {
    root.add(mesh(box(2.94, 0.04, 2.94), M.dirt(), 0, 0.02, 0));
    // timber-framed canvas balloon shed opening toward the camera
    root.add(mesh(prism(1.6, 1.5, 0.95), M.cloth(), -0.4, 0.04, -0.45).rotateY(Math.PI / 2));
    for (const z of [-1.2, -0.45, 0.3]) for (const x of [-1.12, 0.32]) root.add(mesh(box(0.06, 0.5, 0.06), M.timber(), x, 0.29, z));
    root.add(mesh(box(1.5, 0.04, 0.04), M.timber(), -0.4, 0.54, 0.32));
    root.add(mesh(prism(0.02, 1.2, 0.76), M.dark(), -0.4, 0.04, 0.36).rotateY(Math.PI / 2)); // open front
    // gas works: barrels, a retort and a hose
    for (const [x, z] of [[0.75, -0.9], [0.95, -0.9], [0.85, -0.7], [1.05, -0.7]]) root.add(mesh(cyl(0.08, 0.08, 0.2, 10), M.wood(), x, 0.14, z));
    root.add(mesh(cyl(0.16, 0.18, 0.4, 12), M.iron(), 0.9, 0.24, -0.25));
    root.add(mesh(cyl(0.04, 0.04, 0.3, 8), M.iron(), 0.9, 0.55, -0.25));
    root.add(mesh(sph(0.04, 8, 6), M.ember(), 0.9, 0.06, -0.06));
    // a small tethered balloon in team colors, and a flag
    const tether = group(0.85, 0, 0.75);
    tether.add(rod([0, 0.02, 0], [0.05, 1.2, -0.05], 0.004, M.rope(), 3));
    tether.add(scl(mesh(sph(0.2, 12, 10), teamMat(team, 'm', 0), 0.05, 1.42, -0.05), 1, 1.15, 1));
    tether.add(mesh(box(0.08, 0.06, 0.08), M.wattle(), 0.05, 1.13, -0.05));
    tether.add(mesh(cyl(0.05, 0.06, 0.06, 8), M.timber(), 0, 0.03, 0));
    parts.balloon = tether;
    root.add(tether);
    root.add(mesh(cyl(0.015, 0.015, 0.9, 6), M.timber(), -1.25, 0.45, 1.2));
    const flag = group(-1.25, 0.8, 1.2, mesh(box(0.28, 0.16, 0.01), tm, 0.14, 0, 0));
    parts.flag = flag;
    root.add(flag);
    return { root, parts, height: 1.3 };
  }
  // concrete apron with a painted strip running across the front
  const p = mesh(box(2.94, 0.06, 2.94), M.concrete(), 0, 0.03, 0);
  p.name = 'pad';
  root.add(p);
  root.add(mesh(box(2.8, 0.01, 0.5), M.dark(), 0, 0.065, 1.05));
  for (let i = 0; i < 6; i++) root.add(mesh(box(0.22, 0.012, 0.04), M.white(), -1.15 + i * 0.46, 0.07, 1.05));
  // curved hangar with a team-coloured door band
  // half cylinders lying along z: the shell, and a wall at each end
  const arch = (r: number, len: number, open: boolean) => new THREE.CylinderGeometry(r, r, len, 20, 1, open, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
  root.add(mesh(arch(0.75, 1.7, true), M.metalRoof(), -0.35, 0.06, -0.45));
  for (const z of [-1.3, 0.4]) root.add(mesh(arch(0.745, 0.02, false), M.darkSteel(), -0.35, 0.06, z));
  root.add(mesh(box(0.9, 0.5, 0.02), M.dark(), -0.35, 0.31, 0.41));
  root.add(mesh(box(1.4, 0.08, 0.03), tm, -0.35, 0.63, 0.41));
  for (let i = 0; i < 8; i++) root.add(mesh(torus(0.755, 0.01, Math.PI, 4, 20), M.darkSteel(), -0.35, 0.06, -1.25 + i * 0.23));
  // control tower with a glass cab and a radar
  root.add(mesh(box(0.4, 0.8, 0.4), M.lightConcrete(), 0.95, 0.46, -0.85));
  root.add(mesh(box(0.5, 0.18, 0.5), M.glass(), 0.95, 0.95, -0.85));
  root.add(mesh(box(0.54, 0.04, 0.54), tm, 0.95, 1.06, -0.85));
  root.add(mesh(sph(0.03), M.redLamp(), 0.95, 1.12, -0.85));
  const radar = group(0.95, 1.12, -0.85, mesh(box(0.04, 0.12, 0.3), M.white(), 0.04, 0.08, 0), mesh(cyl(0.02, 0.02, 0.1, 6), M.darkSteel(), 0, 0.02, 0));
  parts.radar = radar;
  root.add(radar);
  // helipad and a windsock
  root.add(mesh(cyl(0.34, 0.34, 0.012, 20), M.dark(), 0.85, 0.07, 0.15));
  root.add(mesh(box(0.05, 0.014, 0.26), M.hazard(), 0.77, 0.075, 0.15));
  root.add(mesh(box(0.05, 0.014, 0.26), M.hazard(), 0.93, 0.075, 0.15));
  root.add(mesh(box(0.16, 0.014, 0.05), M.hazard(), 0.85, 0.075, 0.15));
  root.add(mesh(cyl(0.012, 0.012, 0.6, 6), M.darkSteel(), -1.3, 0.36, 0.55));
  const flag = group(-1.3, 0.64, 0.55, along(mesh(cone(0.04, 0.22, 8), M.hazard(), 0.12, 0, 0)));
  parts.flag = flag;
  root.add(flag);
  return { root, parts, height: 1.25 };
}

/** The Flak Cannon: a sandbagged emplacement with twin long barrels pointing at the sky. */
export function flak(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team), tl = teamMat(team, 'l');
  root.add(mesh(cyl(0.42, 0.46, 0.14, 12), M.concrete(), 0, 0.07, 0));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    root.add(rot(scl(mesh(sph(0.07, 6, 4), M.sandbag(), Math.cos(a) * 0.4, 0.18, Math.sin(a) * 0.4), 1.5, 0.7, 1), 0, -a, 0));
  }
  for (const [x, z] of [[-0.25, 0.25], [-0.3, 0.15]]) root.add(mesh(box(0.1, 0.06, 0.06), mat('#4a5a2a'), x, 0.2, z));
  const head = group(0, 0.2, 0,
    mesh(cyl(0.18, 0.22, 0.08, 14), M.darkSteel(), 0, 0, 0),
    mesh(box(0.22, 0.16, 0.26), tm, 0, 0.1, 0),
    mesh(box(0.02, 0.18, 0.3), tl, 0.12, 0.12, 0),
    mesh(box(0.08, 0.03, 0.08), M.darkSteel(), -0.06, 0.2, 0.08));
  // the barrels pitch up; recoil slides them back along their own axis
  const pitch = group(0.06, 0.14, 0);
  pitch.rotation.z = 1.0;
  const barrel = group(0, 0, 0);
  for (const z of [-0.06, 0.06]) {
    barrel.add(along(mesh(cyl(0.025, 0.03, 0.6, 8), M.gun(), 0.3, 0, z)));
    barrel.add(along(mesh(cyl(0.035, 0.035, 0.08, 8), M.gun(), 0.6, 0, z)));
  }
  pitch.add(barrel);
  head.add(pitch);
  parts.turret = head;
  parts.barrel = barrel;
  root.add(head);
  return { root, parts, height: 0.75 };
}
