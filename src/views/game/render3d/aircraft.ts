// Procedural 3D models for aircraft and the air war's structures: the War Balloon, Biplane and
// Attack Helicopter, the Airfield that builds them, and the Flak Cannon that shoots them down.
// Aircraft face +x and are modelled from the bottom of the craft (entities3d lifts them to their
// flying height); structures face +z, like the rest. Named parts are animated by entities3d.ts.
import * as THREE from 'three';
import { across, along, group, mesh, rod, rot, scl, type Model, type Parts } from './model_kit.ts';
import { M, box, cone, cyl, mat, prism, teamMat, torus } from './materials.ts';
import { ball } from './shapes.ts';

// ---------------------------------------------------------------- aircraft

/** Modern age: a quadcopter with a sensor ball, a light gun under the body and four spinning props. */
export function drone(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team, 'm', 0.3), td = teamMat(team, 'd', 0.3);
  root.add(scl(mesh(ball(0.08), tm, 0, 0.1, 0), 1.4, 0.55, 1));
  root.add(mesh(box(0.12, 0.02, 0.08), td, 0, 0.13, 0));
  root.add(mesh(ball(0.03), M.glass(), 0.1, 0.08, 0)); // sensor ball
  for (const z of [-0.035, 0.035]) root.add(rod([-0.02, 0.06, z], [-0.02, 0.0, z * 1.6], 0.005, M.darkSteel(), 4)); // landing legs
  for (const [i, [x, z]] of ([[0.13, 0.13], [0.13, -0.13], [-0.13, 0.13], [-0.13, -0.13]] as const).entries()) {
    root.add(rod([0, 0.11, 0], [x, 0.12, z], 0.009, M.dark(), 4)); // arm
    root.add(mesh(cyl(0.022, 0.022, 0.03, 8), M.darkSteel(), x, 0.13, z)); // motor
    const prop = group(x, 0.15, z,
      mesh(box(0.16, 0.004, 0.02), M.dark(), 0, 0, 0),
      mesh(box(0.02, 0.004, 0.16), M.dark(), 0, 0, 0));
    parts[`prop${i}`] = prop;
    root.add(prop);
  }
  const gun = group(0.04, 0.05, 0, along(mesh(cyl(0.007, 0.007, 0.1, 6), M.gun(), 0.05, 0, 0)), mesh(box(0.04, 0.025, 0.03), M.gun(), 0, 0, 0));
  parts.barrel = gun;
  root.add(gun);
  return { root, parts, height: 0.2 };
}

/** Industrial: a silk envelope in team stripes over a wicker basket, with a burner and bombs. */
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
  for (const [x, z] of [[0.1, 0.05], [0.1, -0.05], [-0.1, 0.05], [-0.05, 0.1]]) root.add(scl(mesh(ball(0.025), M.sandbag(), x, 0.09, z), 1, 1.4, 1));
  root.add(mesh(cyl(0.025, 0.03, 0.08, 8), M.khaki(), 0.03, 0.18, 0.03));
  root.add(mesh(ball(0.022), M.skin(), 0.03, 0.235, 0.03));
  root.add(mesh(cyl(0.026, 0.026, 0.015, 8), M.leather(), 0.03, 0.255, 0.03));
  // burner glowing under the mouth, and a bomb hanging off the side
  root.add(mesh(cyl(0.03, 0.02, 0.05, 8), M.iron(), 0, 0.3, 0));
  root.add(mesh(ball(0.02), M.ember(), 0, 0.33, 0));
  root.add(mesh(ball(0.03), M.iron(), -0.06, -0.02, 0.06));
  root.add(mesh(cyl(0.006, 0.006, 0.04, 4), M.rope(), -0.06, 0.02, 0.06));
  return { root, parts, height: 1.2 };
}

/** Industrial: a wood-and-canvas biplane with a radial engine and a gun over the top wing. */
export function biplane(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team), td = teamMat(team, 'd'), canvas = mat('#d8cfae', { rough: 0.95 });
  // fuselage tapering to the tail, with a cockpit, pilot and goggles
  root.add(along(mesh(cyl(0.07, 0.03, 0.52, 10), tm, -0.06, 0.14, 0)));
  root.add(along(mesh(cyl(0.075, 0.07, 0.12, 10), td, 0.24, 0.14, 0)));
  root.add(mesh(box(0.1, 0.03, 0.1), M.dark(), 0.06, 0.2, 0));
  root.add(mesh(ball(0.03), M.leather(), 0.05, 0.235, 0));
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
  root.add(scl(mesh(ball(0.15), tm, 0.02, 0.2, 0), 1.6, 0.85, 0.75));
  root.add(scl(mesh(ball(0.1), M.glass(), 0.15, 0.25, 0), 1.3, 0.8, 0.8));
  root.add(mesh(box(0.02, 0.06, 0.15), td, 0.1, 0.27, 0));
  root.add(along(mesh(cone(0.05, 0.1, 10), td, 0.3, 0.17, 0)));
  // chin gun under the nose
  const chin = group(0.25, 0.1, 0, mesh(ball(0.03), M.darkSteel(), 0, 0, 0), along(mesh(cyl(0.008, 0.008, 0.12, 6), M.gun(), 0.07, -0.01, 0)));
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

/** A flat plate cut to an outline drawn from above (x forward, y out to the left), `t` thick. */
function plate(pts: [number, number][], t: number, m: THREE.Material, y = 0): THREE.Mesh {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false }).rotateX(Math.PI / 2);
  return mesh(g, m, 0, y + t / 2, 0);
}

/** Both halves of a wing or tailplane: the outline is the left half, mirrored for the right. */
function pair(pts: [number, number][], t: number, m: THREE.Material, y = 0): THREE.Object3D {
  return group(0, 0, 0, plate(pts, t, m, y), plate(pts.map(([x, z]) => [x, -z]), t, m, y));
}

/** An afterburner: a dark nozzle with a glowing core that flickers in flight (part `burner`). */
function nozzle(x: number, y: number, z: number, r: number, parts: Parts, key: string): THREE.Object3D {
  const n = group(x, y, z, along(mesh(cyl(r * 0.9, r, r * 1.4, 12), M.darkSteel(), 0, 0, 0)));
  const flame = group(-r * 0.7, 0, 0,
    along(mesh(cone(r * 0.8, r * 4, 10), mat('#ffb347', { emissive: '#ff7a1a' }), -r * 2, 0, 0)).rotateZ(Math.PI),
    along(mesh(cone(r * 0.45, r * 2.4, 10), mat('#fff1c0', { emissive: '#ffd27a' }), -r * 1.3, 0, 0)).rotateZ(Math.PI));
  parts[key] = flame;
  n.add(flame);
  return n;
}

/** Modern age: a single-seat jet fighter with a bubble canopy, swept wings, twin fins and wingtip missiles. */
export function fighter(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team, 'm', 0.45), td = teamMat(team, 'd', 0.45), grey = mat('#8a929c', { rough: 0.4, metal: 0.6 });
  // fuselage: a slim body with a pointed radome and intakes either side of the cockpit
  root.add(scl(mesh(ball(0.1), grey, 0, 0.14, 0), 4.2, 0.75, 0.85));
  root.add(along(mesh(cone(0.06, 0.24, 12), M.darkSteel(), 0.52, 0.14, 0)));
  root.add(scl(mesh(ball(0.06), M.glass(), 0.2, 0.2, 0), 2.2, 0.9, 0.85));
  for (const z of [-0.075, 0.075]) root.add(mesh(box(0.22, 0.07, 0.05), td, 0.05, 0.13, z));
  // swept wings in team colour, with a darker leading edge
  root.add(pair([[0.12, 0.04], [-0.18, 0.46], [-0.27, 0.46], [-0.26, 0.04]], 0.018, tm, 0.12));
  root.add(pair([[0.12, 0.04], [0.06, 0.12], [-0.17, 0.44], [-0.18, 0.46]], 0.022, td, 0.12));
  // tailplanes and twin canted fins
  root.add(pair([[-0.3, 0.05], [-0.42, 0.2], [-0.47, 0.2], [-0.46, 0.05]], 0.014, td, 0.13));
  for (const z of [-0.07, 0.07]) root.add(rot(group(0, 0.17, z, plate([[-0.26, 0], [-0.44, 0.2], [-0.5, 0.2], [-0.47, 0]], 0.012, tm).rotateX(-Math.PI / 2)), Math.sign(z) * -0.25, 0, 0));
  // twin missiles on the wingtips, and a gun port by the nose
  for (const z of [-0.47, 0.47]) {
    root.add(along(mesh(cyl(0.014, 0.014, 0.2, 8), M.white(), -0.18, 0.11, z)));
    root.add(along(mesh(cone(0.014, 0.04, 8), M.redLamp(), -0.06, 0.11, z)));
  }
  const gun = group(0.3, 0.16, 0.06, along(mesh(cyl(0.006, 0.006, 0.06, 6), M.gun(), 0, 0, 0)));
  parts.barrel = gun;
  root.add(gun);
  root.add(nozzle(-0.44, 0.14, 0, 0.06, parts, 'burner'));
  return { root, parts, height: 0.4 };
}

/**
 * Modern age: a ground-attack jet, built nothing like the fighter: a blunt olive-drab body on long
 * straight wings, two big engines in pods high on the tail, twin square fins in team colour, a
 * cannon jutting from the nose and a row of bombs slung under the wings.
 */
export function striker(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team, 'm', 0.2), td = teamMat(team, 'd', 0.2);
  const drab = mat('#8a9a62', { rough: 0.75, metal: 0.1 }), drabDark = mat('#5e6b45', { rough: 0.8, metal: 0.1 });
  // a long boxy body with a blunt nose, the cockpit bubble well forward
  root.add(scl(mesh(ball(0.1), drab, 0.02, 0.14, 0), 5.2, 0.85, 0.85));
  root.add(along(mesh(cyl(0.05, 0.075, 0.12, 12), drabDark, 0.52, 0.13, 0)));
  root.add(scl(mesh(ball(0.055), M.glass(), 0.36, 0.21, 0), 1.6, 1, 0.9));
  root.add(mesh(box(0.2, 0.012, 0.13), tm, 0.0, 0.215, 0)); // team stripe along the spine
  // the nose cannon: a long seven-barrel gun
  const gun = group(0.6, 0.11, 0, along(mesh(cyl(0.014, 0.014, 0.14, 8), M.gun(), 0.06, 0, 0)));
  parts.barrel = gun;
  root.add(gun);
  // long straight wings with a slight taper, drab on top, team-coloured tips
  root.add(pair([[0.12, 0.06], [0.08, 0.62], [-0.06, 0.62], [-0.1, 0.06]], 0.024, drab, 0.1));
  for (const z of [-0.6, 0.6]) root.add(mesh(box(0.15, 0.03, 0.05), tm, 0.01, 0.112, z));
  // two fat engine pods high on the rear body, side by side
  for (const z of [-0.12, 0.12]) {
    root.add(rod([-0.22, 0.17, z * 0.4], [-0.26, 0.24, z], 0.02, drabDark, 4));
    root.add(along(mesh(cyl(0.065, 0.065, 0.24, 14), drabDark, -0.3, 0.27, z)));
    root.add(along(mesh(cyl(0.05, 0.05, 0.01, 14), M.dark(), -0.18, 0.27, z)));
    root.add(nozzle(-0.44, 0.27, z, 0.05, parts, z < 0 ? 'burner' : 'burner2'));
  }
  // a straight tailplane with a square team-coloured fin at each end
  root.add(mesh(box(0.14, 0.018, 0.46), drab, -0.52, 0.16, 0));
  for (const z of [-0.23, 0.23]) root.add(mesh(box(0.13, 0.17, 0.016), tm, -0.53, 0.24, z));
  for (const z of [-0.23, 0.23]) root.add(mesh(box(0.13, 0.03, 0.02), td, -0.53, 0.32, z));
  // bombs on pylons under each wing
  const bombs = new THREE.Group();
  for (const z of [-0.2, 0.2, -0.33, 0.33, -0.46, 0.46]) {
    bombs.add(mesh(box(0.06, 0.04, 0.01), M.darkSteel(), 0.02, 0.08, z));
    bombs.add(scl(mesh(ball(0.032), M.darkSteel(), 0.02, 0.045, z), 2.4, 1, 1));
    bombs.add(mesh(box(0.025, 0.04, 0.004), M.darkSteel(), -0.06, 0.045, z));
  }
  parts.bombs = bombs;
  root.add(bombs);
  return { root, parts, height: 0.45 };
}

/** A Hornet, the little jet a Sky Carrier flies: a Jet Fighter in miniature. */
export function hornet(team: number, k = 0.55): Model {
  const f = fighter(team), root = new THREE.Group();
  f.root.scale.setScalar(k);
  root.add(f.root);
  return { root, parts: f.parts, height: f.height * k };
}

/**
 * Modern age: the Sky Carrier, a huge flying hangar. A fat grey body on long high wings with four
 * propeller engines, a flat flight deck along its back where its Hornets sit (parts `dock0`..), a
 * team-coloured twin tail, and launch doors in its belly. Props are parts `cprop0`..`cprop3`.
 */
export function carrier(team: number): Model {
  const root = new THREE.Group(), parts: Parts = {};
  const tm = teamMat(team, 'm', 0.35), td = teamMat(team, 'd', 0.35);
  const grey = mat('#9aa2aa', { rough: 0.5, metal: 0.5 }), dark = mat('#5d656e', { rough: 0.6, metal: 0.5 });
  // the body: long and deep, with a rounded nose and the cockpit glazing up front
  root.add(scl(mesh(ball(0.1), grey, 0, 0.26, 0), 11.5, 2, 2.1));
  root.add(scl(mesh(ball(0.1), M.glass(), 0.92, 0.36, 0), 1.6, 0.7, 1.4));
  root.add(mesh(box(1.5, 0.05, 0.2), dark, -0.05, 0.08, 0)); // launch doors in the belly
  for (const x of [-0.55, -0.05, 0.45]) root.add(mesh(box(0.02, 0.055, 0.21), M.hazard(), x, 0.08, 0));
  // the flight deck along the back, with a painted centre line and a team-coloured edge
  root.add(mesh(box(1.5, 0.04, 0.6), dark, -0.12, 0.45, 0));
  for (let i = 0; i < 6; i++) root.add(mesh(box(0.12, 0.005, 0.02), M.white(), -0.72 + i * 0.24, 0.473, 0));
  for (const z of [-0.3, 0.3]) root.add(mesh(box(1.5, 0.05, 0.025), tm, -0.12, 0.46, z));
  // long high wings, team-coloured tips
  root.add(pair([[0.3, 0.1], [0.12, 1.35], [-0.12, 1.35], [-0.28, 0.1]], 0.04, grey, 0.34));
  root.add(pair([[0.14, 1.12], [0.12, 1.35], [-0.12, 1.35], [-0.1, 1.12]], 0.045, tm, 0.34));
  // four engines under the wings, each with a big four-bladed prop
  let n = 0;
  for (const z of [-0.95, -0.5, 0.5, 0.95]) {
    root.add(along(mesh(cyl(0.075, 0.06, 0.42, 12), dark, 0.12, 0.3, z)));
    root.add(along(mesh(cone(0.06, 0.1, 10), M.darkSteel(), 0.38, 0.3, z)));
    const prop = group(0.36, 0.3, z,
      mesh(box(0.012, 0.42, 0.04), M.dark(), 0, 0, 0),
      mesh(box(0.012, 0.04, 0.42), M.dark(), 0, 0, 0));
    parts[`cprop${n++}`] = prop;
    root.add(prop);
  }
  // twin tail: a broad tailplane and two big fins in team colour
  root.add(pair([[-0.9, 0.05], [-1.05, 0.55], [-1.2, 0.55], [-1.18, 0.05]], 0.03, grey, 0.32));
  for (const z of [-0.5, 0.5]) {
    root.add(mesh(box(0.28, 0.4, 0.03), tm, -1.12, 0.55, z));
    root.add(mesh(box(0.28, 0.06, 0.035), td, -1.12, 0.76, z));
  }
  // a gun turret either side of the cockpit (part `barrel` recoils)
  const gun = group(0.6, 0.48, 0, mesh(ball(0.05), dark, 0, 0, 0), along(mesh(cyl(0.01, 0.01, 0.14, 6), M.gun(), 0.08, 0.01, 0)));
  parts.turret = gun;
  parts.barrel = gun.children[1];
  root.add(gun);
  // the Hornets aboard, two by two on the deck
  let d = 0;
  for (const x of [0.32, -0.12, -0.56]) for (const z of [-0.15, 0.15]) {
    if (d >= 4) break;
    const h = hornet(team, 0.3).root;
    h.position.set(x, 0.47, z);
    parts[`dock${d++}`] = h;
    root.add(h);
  }
  return { root, parts, height: 0.85 };
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
    root.add(mesh(ball(0.04), M.ember(), 0.9, 0.06, -0.06));
    // a small tethered balloon in team colors, and a flag
    const tether = group(0.85, 0, 0.75);
    tether.add(rod([0, 0.02, 0], [0.05, 1.2, -0.05], 0.004, M.rope(), 3));
    tether.add(scl(mesh(ball(0.2), teamMat(team, 'm', 0), 0.05, 1.42, -0.05), 1, 1.15, 1));
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
  root.add(mesh(ball(0.03), M.redLamp(), 0.95, 1.12, -0.85));
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
    root.add(rot(scl(mesh(ball(0.07), M.sandbag(), Math.cos(a) * 0.4, 0.18, Math.sin(a) * 0.4), 1.5, 0.7, 1), 0, -a, 0));
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
