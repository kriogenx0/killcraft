// Spikes and armour layers on units. Armoured units (swordsmen, knights, tanks, jeeps, catapults,
// harvesters) always bristle with spikes; every other foot soldier grows them from the first armour
// upgrade, except Workers and Medics, who get the plates but never spikes. Each upgrade makes
// every spike longer and adds more, in the style of the unit's age:
// round iron spikes (Medieval), riveted steel ones and a spiked helmet (World War), and squat
// faceted black blades (Modern). Each Armory armour upgrade also bolts on another visible
// layer: infantry get pauldrons, then breast and back plates, then tassets and a collar; knights'
// horses get a chest plate, then flank plates, then a rump plate and a horned helm; vehicles get
// side skirts, then a spiked ram, then plated and spiked turrets. Built once per look and level,
// merged into one mesh per material, and shared by every unit that wears it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { G } from '../../../game/state.ts';
import { M, box, dome, teamMat } from './materials.ts';

type V3 = [number, number, number];
type Mat = THREE.Material;
interface Piece { g: THREE.BufferGeometry; m: Mat; at: V3; rot?: V3; scale?: V3 }

const up = new THREE.Vector3(0, 1, 0);

/** How spikes look on the kit being built: set per unit by armorKit from its age and armour level. */
interface SpikeStyle { grow: number; sides: number; fat: number; m: () => Mat }
const ERA_SPIKE: SpikeStyle[] = [
  { grow: 1, sides: 12, fat: 1, m: () => M.darkSteel() }, // Medieval: forged iron spikes
  { grow: 1, sides: 8, fat: 1.15, m: () => M.iron() }, // World War: riveted steel
  { grow: 1, sides: 4, fat: 1.35, m: () => M.gun() }, // Modern: squat faceted blades
];
let style: SpikeStyle = ERA_SPIKE[0];

/** Each armour upgrade makes every spike this much longer (level 0: 1x, level 3: 1.6x). */
export const SPIKE_GROW = 0.2;

/** A cone of length `len` and base radius `r`, its base at `at`, pointing along `dir`. */
function spike(at: V3, dir: V3, len = 0.06, r = len * 0.22): Piece {
  const d = new THREE.Vector3(...dir).normalize(), q = new THREE.Quaternion().setFromUnitVectors(up, d);
  const l = len * style.grow, rr = r * Math.sqrt(style.grow) * style.fat;
  const g = new THREE.ConeGeometry(rr, l, style.sides).translate(0, l / 2, 0).applyQuaternion(q);
  return { g, m: style.m(), at };
}

const plate = (w: number, h: number, d: number, m: Mat, at: V3, rot?: V3): Piece => ({ g: box(w, h, d), m, at, rot });

/** Merge pieces into one mesh per material. */
function build(pieces: Piece[]): THREE.Group {
  const out = new THREE.Group(), byMat = new Map<Mat, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const p of pieces) {
    q.setFromEuler(e.set(...(p.rot ?? [0, 0, 0])));
    const g = (p.g.index ? p.g.toNonIndexed() : p.g.clone()).applyMatrix4(m4.compose(new THREE.Vector3(...p.at), q, new THREE.Vector3(...(p.scale ?? [1, 1, 1]))));
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') g.deleteAttribute(a);
    const list = byMat.get(p.m) ?? [];
    list.push(g);
    byMat.set(p.m, list);
  }
  for (const [m, list] of byMat) {
    const g = mergeGeometries(list);
    if (!g) continue;
    const me = new THREE.Mesh(g, m);
    me.castShadow = me.receiveShadow = true;
    out.add(me);
  }
  return out;
}

const both = (f: (side: number) => Piece[]): Piece[] => [...f(-1), ...f(1)];

/**
 * A foot soldier (about 0.62 tall, facing +x). `spiky` soldiers wear spikes from the start; the
 * rest grow them with the first upgrade. `helmTop` is the crown of an army helmet, which gets a
 * spike of its own on the first upgrade. `spiky` null means never: plates only (Workers, Medics).
 */
function soldier(level: number, spiky: boolean | null, helmTop = 0, crest = helmTop || 0.575): Piece[] {
  const p: Piece[] = [], steel = M.steel(), dark = M.darkSteel();
  const never = spiky === null;
  spiky = !never && (spiky || level >= 1);
  if (spiky) p.push(...both((s) => [spike([0, 0.43, s * 0.14], [0, 0.7, s], 0.07), spike([-0.035, 0.41, s * 0.15], [-0.4, 0.4, s], 0.05)]));
  if (level >= 1) p.push(...both((s) => [
    { g: dome(0.07), m: steel, at: [0, 0.405, s * 0.12], scale: [1.05, 0.75, 1.2] }, // pauldron
    { g: dome(0.05), m: dark, at: [0, 0.395, s * 0.15], scale: [1, 0.6, 1], rot: [s * 0.6, 0, 0] }, // lower lame
    ...(spiky ? [spike([0.01, 0.45, s * 0.12], [0.2, 1, s * 0.3], 0.06)] : []),
  ]));
  if (level >= 1 && helmTop) p.push({ g: dome(0.018), m: M.brass(), at: [0, helmTop - 0.004, 0] }, spike([0, helmTop, 0], [0.1, 1, 0], 0.06, 0.012)); // spiked helmet
  if (level >= 2) {
    p.push(plate(0.018, 0.15, 0.16, steel, [0.074, 0.32, 0]), plate(0.016, 0.15, 0.16, steel, [-0.074, 0.32, 0])); // breast and back plates
    p.push(plate(0.022, 0.13, 0.02, dark, [0.083, 0.325, 0])); // ridge down the breastplate
    if (spiky) for (const y of [0.29, 0.35]) for (const z of [-0.04, 0.04]) p.push(spike([-0.082, y, z], [-1, 0.5, z * 4], 0.05));
  }
  if (level >= 3) {
    p.push(...both((s) => [plate(0.11, 0.06, 0.012, steel, [0.005, 0.2, s * 0.088], [0, 0, 0])])); // tassets over the hips
    p.push(plate(0.11, 0.035, 0.2, dark, [0, 0.415, 0])); // collar
    if (spiky) for (const x of helmTop ? [-0.04, 0.04] : [-0.03, 0, 0.03]) p.push(spike([x, crest, 0], [x * 6, 1, 0], 0.06)); // a crest of spikes on the helm
    if (spiky) p.push(...both((s) => [spike([0.06, 0.27, s * 0.06], [1, 0.3, s * 0.5], 0.045)])); // studs on the breastplate
  }
  return p;
}

/** A knight on horseback (rider's shoulders at 0.83, horse's chest at x 0.3). */
function knight(level: number): Piece[] {
  const p: Piece[] = [], steel = M.steel(), dark = M.darkSteel();
  p.push(...both((s) => [spike([-0.03, 0.86, s * 0.13], [0, 0.6, s], 0.07), spike([-0.06, 0.84, s * 0.13], [-0.5, 0.4, s], 0.05)]));
  for (const t of [0.2, 0.45, 0.7]) p.push(spike([0.18 + t * 0.22, 0.76 + t * 0.12, 0], [-0.25, 1, 0], 0.05)); // along the crest of the neck
  if (level >= 1) {
    p.push(plate(0.05, 0.17, 0.28, steel, [0.33, 0.5, 0], [0, 0, -0.25])); // peytral over the chest
    for (const z of [-0.08, 0, 0.08]) p.push(spike([0.37, 0.5, z], [1, 0.15, z * 2], 0.09));
  }
  if (level >= 2) p.push(...both((s) => [
    plate(0.36, 0.13, 0.014, steel, [-0.04, 0.5, s * 0.15]), plate(0.36, 0.02, 0.016, dark, [-0.04, 0.565, s * 0.15]), // flank plates
    ...[-0.16, -0.04, 0.08].map((x) => spike([x, 0.5, s * 0.158], [0, 0.2, s], 0.06)),
  ]));
  if (level >= 3) {
    p.push(plate(0.16, 0.035, 0.26, steel, [-0.27, 0.6, 0])); // crupper over the rump
    for (const z of [-0.07, 0.07]) p.push(spike([-0.28, 0.62, z], [-0.3, 1, z * 3], 0.07));
    p.push(...both((s) => [spike([-0.03, 0.97, s * 0.06], [0, 1, s * 0.8], 0.1, 0.018)])); // horns on the helm
  }
  return p;
}

/** A tank hull (before the heavy tank's 1.22 scale) and, separately, its turret. */
function tank(level: number, team: number): { hull: Piece[]; turret: Piece[] } {
  const hull: Piece[] = [], turret: Piece[] = [], td = teamMat(team, 'd'), steel = M.darkSteel();
  for (const z of [-0.12, 0, 0.12]) hull.push(spike([0.42, 0.2, z], [1, 0.1, 0], 0.09));
  hull.push(...both((s) => [-0.25, 0, 0.25].map((x) => spike([x, 0.25, s * 0.26], [0, 0.8, s], 0.06))));
  if (level >= 1) hull.push(...both((s) => [
    plate(0.84, 0.09, 0.015, td, [0, 0.15, s * 0.29]), // side skirts
    ...[-0.3, -0.1, 0.1, 0.3].map((x) => spike([x, 0.15, s * 0.298], [0, 0, s], 0.05)),
  ]));
  if (level >= 2) {
    hull.push(plate(0.04, 0.13, 0.42, steel, [0.47, 0.16, 0], [0, 0, -0.35])); // ram
    for (const z of [-0.15, -0.05, 0.05, 0.15]) hull.push(spike([0.5, 0.14, z], [1, -0.1, 0], 0.13, 0.024));
  }
  if (level >= 3) {
    turret.push(...both((s) => [plate(0.17, 0.08, 0.015, td, [0.01, 0, s * 0.2])])); // turret cheek plates
    for (let a = 0; a < 8; a++) {
      const c = Math.cos((a / 8) * Math.PI * 2), sn = Math.sin((a / 8) * Math.PI * 2);
      turret.push(spike([c * 0.15 - 0.03, 0.06, sn * 0.15], [c, 1.2, sn], 0.06));
    }
  }
  return { hull, turret };
}

function jeep(level: number, team: number): Piece[] {
  const p: Piece[] = [], td = teamMat(team, 'd'), steel = M.darkSteel();
  for (const z of [-0.12, -0.04, 0.04, 0.12]) p.push(spike([0.36, 0.14, z], [1, 0.1, 0], 0.07));
  if (level >= 1) p.push(...both((s) => [plate(0.4, 0.07, 0.012, td, [-0.04, 0.2, s * 0.158]), spike([-0.2, 0.2, s * 0.165], [0, 0.3, s], 0.05), spike([0.1, 0.2, s * 0.165], [0, 0.3, s], 0.05)]));
  if (level >= 2) {
    p.push(plate(0.2, 0.014, 0.26, steel, [0.21, 0.318, 0])); // hood plate
    for (const z of [-0.1, -0.035, 0.035, 0.1]) p.push(plate(0.01, 0.1, 0.012, steel, [0.105, 0.32, z])); // windscreen bars
    for (const z of [-0.09, 0, 0.09]) p.push(spike([0.3, 0.325, z], [1, 0.6, z * 3], 0.06)); // spikes on the hood
  }
  if (level >= 3) p.push(...both((s) => [plate(0.18, 0.08, 0.012, td, [-0.2, 0.3, s * 0.15]), spike([-0.2, 0.35, s * 0.155], [0, 1, s], 0.06), spike([-0.3, 0.35, s * 0.155], [0, 1, s], 0.06)]));
  return p;
}

function harvester(level: number, team: number): Piece[] {
  const p: Piece[] = [], td = teamMat(team, 'd'), steel = M.darkSteel();
  for (const z of [-0.15, -0.05, 0.05, 0.15]) p.push(spike([0.44, 0.24, z], [1, 0, 0], 0.08));
  if (level >= 1) p.push(...both((s) => [plate(0.8, 0.1, 0.014, td, [0, 0.21, s * 0.222]), ...[-0.3, 0, 0.3].map((x) => spike([x, 0.21, s * 0.23], [0, 0, s], 0.05))]));
  if (level >= 2) {
    p.push(plate(0.016, 0.16, 0.36, steel, [0.418, 0.42, 0])); // cab shutter
    for (const y of [0.38, 0.42, 0.46]) p.push(plate(0.02, 0.012, 0.3, M.dark(), [0.427, y, 0]));
    for (const z of [-0.12, 0, 0.12]) p.push(spike([0.426, 0.5, z], [1, 0.5, 0], 0.07)); // along the shutter's top
  }
  if (level >= 3) for (const x of [-0.35, -0.2, -0.05]) p.push(...both((s) => [spike([x, 0.47, s * 0.19], [0, 1, s * 0.6], 0.06)]));
  return p;
}

function catapult(level: number): Piece[] {
  const p: Piece[] = [], iron = M.iron(), wood = M.darkWood();
  p.push(...both((s) => [spike([0.38, 0.2, s * 0.2], [1, 0.2, s * 0.3], 0.08), spike([-0.38, 0.2, s * 0.2], [-1, 0.2, s * 0.3], 0.06)]));
  if (level >= 1) p.push(...both((s) => [
    plate(0.7, 0.04, 0.012, iron, [0, 0.235, s * 0.245]), plate(0.7, 0.04, 0.012, iron, [0, 0.165, s * 0.245]), // iron bands
    ...[-0.2, 0.05, 0.3].map((x) => spike([x, 0.235, s * 0.25], [0, 0.2, s], 0.05)),
  ]));
  if (level >= 2) {
    p.push(plate(0.03, 0.2, 0.4, wood, [0.44, 0.3, 0])); // a mantlet to hide behind
    p.push(plate(0.034, 0.03, 0.41, iron, [0.44, 0.38, 0]), plate(0.034, 0.03, 0.41, iron, [0.44, 0.24, 0]));
    for (const z of [-0.12, 0, 0.12]) p.push(spike([0.455, 0.31, z], [1, 0, 0], 0.08)); // spikes through the mantlet
  }
  if (level >= 3) for (const z of [-0.15, -0.05, 0.05, 0.15]) p.push(spike([0.44, 0.4, z], [0.3, 1, 0], 0.08));
  return p;
}

export interface ArmorKit { root: THREE.Group; turret: THREE.Group | null }

const cache = new Map<string, { root: THREE.Group; turret: THREE.Group | null }>();

/** The upgrade level that shows on a unit (0-3). */
export function armorLevel(type: UnitType, team: number): number {
  const d = UNIT[type];
  if (!d || d.cls === 'air') return 0;
  return G.upg[team]?.[d.cls === 'vehicle' ? 'vehArmor' : 'infArmor'] ?? 0;
}

/** Spikes and armour for a unit at an upgrade level, or null if it wears none. */
export function armorKit(type: UnitType, team: number, level: number): ArmorKit | null {
  const look = (UNIT[type]?.look ?? type) as UnitType, key = `${look}|${team}|${level}`;
  let t = cache.get(key);
  if (!t) {
    let pieces: Piece[] = [], turret: Piece[] = [], scale = 1;
    style = { ...ERA_SPIKE[Math.min(ERA_SPIKE.length - 1, UNIT[look]?.era ?? 0)] };
    style.grow = 1 + SPIKE_GROW * level;
    switch (look) {
      case 'swordsman': pieces = soldier(level, true); break;
      case 'rifleman': case 'gunner': case 'rocket': pieces = soldier(level, false, 0.565); break;
      case 'crossbowman': pieces = soldier(level, false); break;
      case 'medic': pieces = soldier(level, null, 0, 0.53); break;
      case 'worker': pieces = soldier(level, null, 0, 0.555); break;
      case 'knight': pieces = knight(level); break;
      case 'tank': case 'heavy': ({ hull: pieces, turret } = tank(level, team)); scale = look === 'heavy' ? 1.22 : 1; break;
      case 'artillery': pieces = tank(level, team).hull; break; // the same tracks and hull; its gun house wears none
      case 'jeep': pieces = jeep(level, team); break;
      case 'harvester': pieces = harvester(level, team); break;
      case 'catapult': pieces = catapult(level); break;
    }
    if (!pieces.length && !turret.length) { cache.set(key, { root: new THREE.Group(), turret: null }); return null; }
    const root = build(pieces), tg = turret.length ? build(turret) : null;
    root.scale.setScalar(scale);
    tg?.scale.setScalar(scale);
    t = { root, turret: tg };
    cache.set(key, t);
  }
  if (!t.root.children.length && !t.turret) return null;
  return { root: t.root.clone(), turret: t.turret?.clone() ?? null };
}
