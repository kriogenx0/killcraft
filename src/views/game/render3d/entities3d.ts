// Keeps a 3D model for every entity the player can see, animates them, and draws the selection
// rings, order markers, rally flags and building ghost. Also answers "what's under the cursor?".
import * as THREE from 'three';
import { G, allied, haulOf, valid, type Ent } from '../../../game/state.ts';
import { MH, MW, TS } from '../../../game/const.ts';
import { BUILDING, isWall, type BldType } from '../../../data/building.ts';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { HARVESTER_CAPACITY } from '../../../data/ore.ts';
import { inReach, nearBase, onWell, tileFree, wallLine } from '../../../game/building.ts';
import { nearPortal } from '../../../game/map.ts';
import { lerp } from '../../../util/math.ts';
import { shownToPlayer } from '../render/minimap.ts';
import { MARKER_LIFE, V } from '../view_state.ts';
import { eraOf } from '../../../game/production.ts';
import { S, onBeforeDraw, raycastObjects, worldToScreen } from './scene.ts';
import { borrowMaterial, instanceModels, resetInstances, returnMaterial, SHADOW_ONLY_LAYER } from './instancer.ts';
import { waygateLinked } from '../../../game/aether.ts';
import { shardModel, aetherModel, bldLook, buildingModel, sourceModel, unitModel, type Model } from './models.ts';
import { M, teamMat } from './materials.ts';
import { animateCreature } from './creatures3d.ts';
import { animateArcane } from './arcane3d.ts';
import { animateGiant } from './giant3d.ts';
import { statusFx, statusTint } from './status3d.ts';
import { WALL_DIRS } from './defenses.ts';
import { MELEE_LAND } from '../../../game/combat.ts';
import { armorKit, armorLevel } from './armor3d.ts';
import { footprintRange, footprintY, heightAt, slopeAt, surfaceY } from './heights.ts';

interface Obj { model: Model; key: string }

/** Units are drawn larger than life so they read clearly next to buildings. */
const UNIT_SCALE = 1.4;
/** creatures of myth stand half as big again as everyone else, so they read as monsters on the field */
const CREATURE_SCALE = 1.5;

const holder = new THREE.Group();
const overlays = new THREE.Group();
/** the instanced copies of everything in `holder` (instancer.ts) */
const batched = new THREE.Group();
const objs = new Map<number, Obj>();

// picking still hits the models' own meshes, which the batches stand in for on screen
S.raycaster.layers.enableAll();
S.sun.shadow.camera.layers.enable(SHADOW_ONLY_LAYER);
onBeforeDraw(() => {
  S.sun.target.updateMatrixWorld();
  S.sun.shadow.updateMatrices(S.sun);
  instanceModels(holder, batched, S.camera, S.sun.castShadow ? S.sun.shadow.camera : null, (r) => (r.userData.reach as number | undefined) ?? 3);
});

export function resetEntities3d(): void {
  holder.clear();
  resetInstances(batched);
  for (const f of fallen) for (const m of f.mats) returnMaterial(m);
  fallen.length = 0;
  overlays.clear();
  objs.clear();
  ringPool.length = 0;
  markerPool.length = 0;
  ghost = null;
  rally = null;
  S.scene.add(holder, overlays, batched);
}

/** How far a foundation reaches below the lowest ground under it, so no gap shows at its foot. */
const FOOT_SINK = 0.15;
/** Drops (tiles) smaller than this get no foundation: the building's own pad covers them. */
const FOOT_MIN = 0.04;
const footGeos = new Map<string, THREE.BoxGeometry>();

/**
 * A box w by d tiles and `tall` deep with its top at y = 0, its texture repeating once a tile
 * on every face instead of stretching.
 */
function footGeometry(w: number, d: number, tall: number): THREE.BoxGeometry {
  const key = `${w}|${d}|${tall.toFixed(2)}`;
  let g = footGeos.get(key);
  if (g) return g;
  g = new THREE.BoxGeometry(w, tall, d).translate(0, -tall / 2, 0);
  // faces come in the order +x, -x, +y, -y, +z, -z, four vertices each
  const uv = g.attributes.uv as THREE.BufferAttribute, size: [number, number][] = [[d, tall], [d, tall], [w, d], [w, d], [w, tall], [w, tall]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * size[f][0], uv.getY(i) * size[f][1]); }
  footGeos.set(key, g);
  return g;
}

/**
 * A structure on a slope stands level with the highest ground under it (`footprintY`); this
 * fills the gap beneath it down to the lowest: stone in the Medieval age, concrete after.
 */
function foundation(e: Ent): THREE.Mesh | null {
  const lo = footprintRange(e.tx, e.ty, e.w, e.h)[0], top = footprintY(e.tx, e.ty, e.w, e.h);
  if (top - lo < FOOT_MIN) return null;
  const m = new THREE.Mesh(footGeometry(e.w, e.h, top - lo + FOOT_SINK), (e.lvl ?? 0) > 0 ? M.concrete() : M.darkStone());
  m.position.y = -0.005; // just under the building's own pad, so the two don't flicker
  m.castShadow = m.receiveShadow = true;
  m.name = 'foundation';
  return m;
}

function create(e: Ent, wallMask: number): Model {
  const m = e.kind === 'unit' ? unitModel(e.type as UnitType, e.team) : e.type === 'aether' ? aetherModel() : e.type === 'shard' ? shardModel() : e.kind === 'source' ? sourceModel() : buildingModel(e.type as BldType, e.team, e.lvl ?? 0, wallMask);
  m.root.userData.id = e.id;
  if (e.kind === 'unit') {
    const kit = armorKit(e.type as UnitType, e.team, armorLevel(e.type as UnitType, e.team));
    if (kit) { m.root.add(kit.root); if (kit.turret) (m.parts.turret ?? m.root).add(kit.turret); }
  }
  if (e.kind === 'unit') { const k = UNIT_SCALE * (UNIT[e.type as UnitType]?.beast ? CREATURE_SCALE : 1); m.root.scale.setScalar(k); m.height *= k; }
  for (const p of Object.values(m.parts)) p.userData.rest = p.position.clone();
  const foot = e.kind === 'bld' ? foundation(e) : null;
  if (foot) { m.root.add(foot); m.parts.foundation = foot; }
  // how far the model reaches from its origin, to tell when it's out of view (instancer.ts)
  m.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m.root);
  m.root.userData.reach = Math.max(box.min.length(), box.max.length()) + 0.5;
  holder.add(m.root);
  return m;
}

/** Recoil: slide a part back along its local x from its rest position. */
function recoil(p: THREE.Object3D | undefined, amount: number): void {
  const rest = p?.userData.rest as THREE.Vector3 | undefined;
  if (p && rest) p.position.x = rest.x - amount;
}

/** how far through a melee swing (0..1) the blow lands: MELEE_LAND of the 0.25 s attack */
const STRIKE = MELEE_LAND / 0.25;

/** Worker's pick-axe cycle (arm angle): raised, a quick blow down, a pause at impact, then a slow lift. */
const PICK_CYCLE = 0.9, PICK_UP = 2.3, PICK_DOWN = 0.15;
export function pickSwing(t: number): number {
  const p = (t / PICK_CYCLE) % 1;
  if (p < 0.14) return lerp(PICK_UP, PICK_DOWN, (p / 0.14) ** 2); // strike, speeding up into the blow
  if (p < 0.34) return PICK_DOWN; // stuck in for a moment
  const r = (p - 0.34) / 0.66;
  return lerp(PICK_DOWN, PICK_UP, r * r * (3 - 2 * r)); // pull back, easing in and out
}

function animateUnit(m: Model, e: Ent): void {
  const P = m.parts, w = e.walk * Math.PI * 2, swing = e.moving ? Math.sin(w) * 0.6 : 0;
  const atk = e.atkT > 0 ? 1 - e.atkT / 0.25 : 0;
  if (P.legL && P.legR) { P.legL.rotation.z = swing; P.legR.rotation.z = -swing; }
  const look = UNIT[e.type as UnitType]?.look ?? e.type; // hidden units move like their regular unit
  if (UNIT[e.type as UnitType]?.cls === 'infantry' && look !== 'knight') m.root.position.y = e.moving ? Math.abs(Math.sin(w)) * 0.025 : 0;
  switch (look) {
    case 'swordsman':
      // overhead cut when striking, sword lowered and swaying when not
      // the blade comes down just as the blow lands (MELEE_LAND), then rests
      P.armR.rotation.z = atk > 0 ? (atk < STRIKE ? lerp(2.8, 0.2, (atk / STRIKE) ** 2) : 0.2) : 0.35 + swing * 0.3;
      P.armL.rotation.z = 0.9 - swing * 0.2;
      break;
    case 'knight':
      for (const [k, s] of [['legFL', 1], ['legBR', 1], ['legFR', -1], ['legBL', -1]] as const) P[k].rotation.z = (e.moving ? Math.sin(w * 1.3) * 0.7 : 0) * s;
      m.root.position.y = e.moving ? Math.abs(Math.sin(w * 1.3)) * 0.04 : 0;
      if (atk > 0) {
        // charge: the horse rears back, then lunges as the lance drives home at the moment the blow lands
        const drive = atk < STRIKE ? (atk / STRIKE) ** 2 : 1 - (atk - STRIKE) / (1 - STRIKE), rear = atk < STRIKE ? Math.sin((atk / STRIKE) * Math.PI) : 0;
        recoil(P.lance, -drive * 0.4);
        m.root.position.x += Math.cos(e.face) * drive * 0.14;
        m.root.position.z += Math.sin(e.face) * drive * 0.14;
        m.root.rotation.z = rear * 0.22 - drive * 0.08;
        P.legFL.rotation.z = P.legFR.rotation.z = -rear * 0.9;
      } else recoil(P.lance, 0);
      break;
    case 'medic':
      // reaches out to bandage while tending someone
      P.armR.rotation.z = P.armL.rotation.z = atk > 0 ? 1.1 + Math.sin(G.gameT * 10) * 0.15 : swing * 0.4;
      break;
    case 'rifleman':
    case 'gunner':
    case 'rocket':
    case 'crossbowman':
      recoil(P.gun, atk > 0 ? (1 - atk) * 0.08 : 0);
      break;
    case 'worker': {
      const load = Math.min(1, e.carry / haulOf(e));
      P.heap.visible = load > 0.02;
      P.heap.scale.y = 0.2 + load * 0.8;
      // the pick: a fast strike, a moment's pause in the ground, then a slower pull back up
      // walking, the pick hangs low at its side, head down and forward
      const working = !e.moving && e.atkT > 0;
      if (P.armR) P.armR.rotation.z = working ? pickSwing(G.gameT + e.id * 0.37) : e.moving ? 0.15 - swing * 0.35 : 1.0;
      if (P.gun) P.gun.rotation.z = e.moving && !working ? -1.0 : 0;
      break;
    }
    case 'harvester': {
      const load = Math.min(1, e.carry / HARVESTER_CAPACITY);
      P.heap.visible = load > 0.02;
      P.heap.scale.y = 0.08 + load * 0.55;
      P.scoop.rotation.z = !e.moving && e.atkT > 0 ? Math.sin(G.gameT * 9) * 0.25 : 0;
      break;
    }
    case 'catapult':
      P.arm.rotation.z = e.atkT > 0 ? lerp(0.35, -1.9, Math.min(1, atk * 1.6)) : 0.35;
      P.stone.visible = e.atkT <= 0;
      break;
  }
  const alt = UNIT[e.type as UnitType]?.alt;
  if (alt) {
    // aircraft hover at their height with a gentle bob; rotors and propellers spin
    const t = performance.now() / 1000;
    m.root.position.y = alt + Math.sin(t * 1.6 + e.id) * 0.04;
    if (P.rotor) P.rotor.rotation.y = t * 22;
    if (P.tailRotor) P.tailRotor.rotation.z = t * 30;
    if (P.prop) P.prop.rotation.x = t * 40;
    for (let i = 0; i < 4; i++) { const q = P[`prop${i}`]; if (q) q.rotation.y = t * (i % 2 ? -45 : 45); }
    if (P.envelope) P.envelope.rotation.z = Math.sin(t * 0.9 + e.id) * 0.04;
    // a biplane banks into its turns
    if (e.type === 'biplane') m.root.rotation.order = 'YXZ';
    if (e.type === 'biplane') m.root.rotation.x = e.moving ? Math.sin(t * 0.7 + e.id) * 0.15 : 0;
  }
  if (P.turret) P.turret.rotation.y = -(e.tface - e.face);
  if (P.barrel) recoil(P.barrel, atk > 0 ? (1 - atk) * 0.1 : 0);
  if (UNIT[e.type as UnitType]?.beast) animateCreature(m, e, w, atk);
  if (UNIT[e.type as UnitType]?.magic || UNIT[e.type as UnitType]?.cyborg) animateArcane(m, e, w, atk);
  if (UNIT[e.type as UnitType]?.giant) animateGiant(m, e, w, atk);
}

function animateBuilding(m: Model, e: Ent, dt: number): void {
  const P = m.parts, atk = e.atkT > 0 ? 1 - e.atkT / 0.25 : 0;
  m.root.scale.y = Math.max(0.02, e.prog);
  // a site's foundation is laid first: it stands full height while the building rises on it
  if (P.foundation) P.foundation.scale.y = 1 / m.root.scale.y;
  if (P.turret) P.turret.rotation.y = -e.tface;
  if (P.barrel) recoil(P.barrel, atk > 0 ? (1 - atk) * 0.12 : 0);
  if (P.crane) P.crane.rotation.y = Math.sin(G.gameT * 0.25 + e.id) * 0.7;
  if (P.radar) P.radar.rotation.y += dt * 1.3;
  if (P.flag) P.flag.rotation.y = Math.sin(G.gameT * 3 + e.id) * 0.25;
  if (P.balloon) P.balloon.rotation.z = Math.sin(G.gameT * 0.8 + e.id) * 0.06;
  if (P.sails && e.done) P.sails.rotation.z -= dt * 1.1;
  if (P.pump && e.done) P.pump.rotation.z = Math.sin(G.gameT * 2.2 + e.id) * 0.22;
  // Aether structures: the shrine's star turns and bobs, the ward's eye pulses, a linked waygate's veil swirls
  if (P.star && e.done) { P.star.rotation.y += dt * 0.8; P.star.position.y = 0.72 + Math.sin(G.gameT * 1.6 + e.id) * 0.04; }
  if (P.eye && e.done) P.eye.scale.setScalar(1 + Math.sin(G.gameT * 3 + e.id) * 0.15);
  if (P.veil) { P.veil.visible = e.done && waygateLinked(e); P.veil.rotation.z += dt * 1.2; }
}

/** Lean a vehicle with the slope it's on: nose up or down hills, and rolling across them. */
function tilt(r: THREE.Object3D, x: number, z: number, face: number): void {
  const [sx, sz] = slopeAt(x, z), c = Math.cos(face), s = Math.sin(face);
  const along = sx * c + sz * s, across = -sx * s + sz * c;
  r.rotation.z = Math.atan(along);
  r.rotation.x = -Math.atan(across);
}

/** Place a flat marker on the ground (or the water) at a point in tile coordinates. */
function onGround(o: THREE.Object3D, x: number, z: number, lift: number): void {
  o.position.set(x, surfaceY(x, z) + lift, z);
}

// ---- selection rings, markers, rally flag, building ghost ----

const ringPool: THREE.Mesh[] = [];
const markerPool: THREE.Mesh[] = [];
const ringMats = { own: basic('#5f5'), enemy: basic('#f55'), neutral: basic('#ff5'), ally: basic('#5cf') };
let rally: THREE.Group | null = null;
let ghost: { type: BldType; look: number; group: THREE.Group; tiles: THREE.Mesh[]; foot: THREE.Mesh } | null = null;

function basic(color: string, opacity = 0.9): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, side: THREE.DoubleSide });
}

const ringGeo = new THREE.RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2);
const squareGeo = new THREE.RingGeometry(0.9, 1, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2);

function updateRings(): void {
  let n = 0;
  for (const e of V.sel) {
    if (e.dead || !objs.get(e.id)?.model.root.visible) continue;
    let r = ringPool[n];
    if (!r) { r = new THREE.Mesh(ringGeo, ringMats.own); r.renderOrder = 3; ringPool.push(r); overlays.add(r); }
    n++;
    r.visible = true;
    r.material = e.team === V.team ? ringMats.own : e.team < 0 ? ringMats.neutral : allied(e.team, V.team) ? ringMats.ally : ringMats.enemy;
    r.geometry = e.w ? squareGeo : ringGeo;
    const size = e.w ? e.w * 0.72 : UNIT[e.type as UnitType].radius / TS + 0.16;
    r.scale.setScalar(size);
    onGround(r, e.x / TS, e.y / TS, 0.08);
  }
  for (let i = n; i < ringPool.length; i++) ringPool[i].visible = false;
}

function updateMarkers(): void {
  V.markers.forEach((mk, i) => {
    let r = markerPool[i];
    if (!r) { r = new THREE.Mesh(ringGeo, basic('#fff')); r.renderOrder = 3; markerPool.push(r); overlays.add(r); }
    const k = mk.t / MARKER_LIFE, m = r.material as THREE.MeshBasicMaterial;
    r.visible = true;
    m.color.set(mk.color);
    m.opacity = 1 - k;
    r.scale.setScalar(0.45 * (1 - k * 0.6));
    onGround(r, mk.x / TS, mk.y / TS, 0.09);
  });
  for (let i = V.markers.length; i < markerPool.length; i++) markerPool[i].visible = false;
}

function updateRally(): void {
  const b = V.sel.find((e) => !e.dead && e.kind === 'bld' && e.team === V.team && e.rally);
  if (!rally) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#fff', dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.7 }));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6).translate(0, 0.35, 0), basic('#444', 1));
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.01).translate(0.16, 0.6, 0), teamMat(V.team));
    rally = new THREE.Group();
    rally.add(line, new THREE.Group().add(pole, flag));
    overlays.add(rally);
  }
  rally.visible = !!b?.rally;
  if (!b?.rally) return;
  const line = rally.children[0] as THREE.Line, flag = rally.children[1];
  const ax = b.x / TS, az = b.y / TS, bx = b.rally.x / TS, bz = b.rally.y / TS, pts: THREE.Vector3[] = [];
  // the dashed line follows the ground over hills
  for (let k = 0, n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) * 2)); k <= n; k++) {
    const px = ax + ((bx - ax) * k) / n, pz = az + ((bz - az) * k) / n;
    pts.push(new THREE.Vector3(px, surfaceY(px, pz) + 0.1, pz));
  }
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  line.computeLineDistances();
  onGround(flag, bx, bz, 0);
}

function ghostFor(type: BldType): NonNullable<typeof ghost> {
  const look = bldLook(type, eraOf(V.team));
  if (ghost?.type === type && ghost.look === look) return ghost;
  if (ghost) overlays.remove(ghost.group);
  const model = buildingModel(type, V.team, eraOf(V.team)), see = basic('#9cf', 0.45);
  model.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.material = see; o.castShadow = false; } });
  const group = new THREE.Group(), tiles: THREE.Mesh[] = [];
  group.add(model.root);
  const s = BUILDING[type].size, tileGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
  for (let i = 0; i < s * s; i++) {
    const t = new THREE.Mesh(tileGeo, basic('#4f4', 0.4));
    t.position.set((i % s) - s / 2 + 0.5, 0.1, Math.floor(i / s) - s / 2 + 0.5);
    t.renderOrder = 3;
    tiles.push(t);
    group.add(t);
  }
  // the foundation it would stand on, sized each frame to the slope under the cursor
  const foot = new THREE.Mesh(new THREE.BoxGeometry(s, 1, s).translate(0, -0.5, 0), see);
  group.add(foot);
  ghost = { type, look, group, tiles, foot };
  overlays.add(group);
  return ghost;
}

/** Tile markers along a wall line being dragged out. */
const linePool: THREE.Mesh[] = [];
const lineGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);

function updateWallLine(): void {
  const m = V.mode, line = m?.t === 'place' && m.ax != null && m.ay != null ? wallLine(m.ax, m.ay, m.tx, m.ty) : [];
  line.forEach(([x, y], i) => {
    let t = linePool[i];
    if (!t) { t = new THREE.Mesh(lineGeo, basic('#4f4', 0.45)); t.renderOrder = 3; linePool.push(t); overlays.add(t); }
    t.visible = true;
    t.position.set(x + 0.5, 0.1, y + 0.5);
    const ok = nearBase(x, y, 1, V.team, true) && tileFree(x, y, V.team) && !nearPortal(x, y);
    (t.material as THREE.MeshBasicMaterial).color.set(ok ? '#4f4' : '#f33');
  });
  for (let i = line.length; i < linePool.length; i++) linePool[i].visible = false;
}

function updateGhost(): void {
  const m = V.mode;
  updateWallLine();
  if (m?.t !== 'place') { if (ghost) ghost.group.visible = false; return; }
  const g = ghostFor(m.type), s = BUILDING[m.type].size, near = inReach(m.tx, m.ty, s, V.team, isWall(m.type), onWell(m.type));
  g.group.visible = true;
  const base = footprintY(m.tx, m.ty, s, s), drop = base - footprintRange(m.tx, m.ty, s, s)[0];
  g.group.position.set(m.tx + s / 2, base, m.ty + s / 2);
  g.foot.visible = drop >= FOOT_MIN;
  g.foot.scale.y = drop + FOOT_SINK;
  g.tiles.forEach((t, i) => {
    const x = m.tx + (i % s), y = m.ty + Math.floor(i / s);
    t.position.y = surfaceY(x + 0.5, y + 0.5) - base + 0.1;
    const ok = near && tileFree(x, y, V.team) && !nearPortal(x, y);
    (t.material as THREE.MeshBasicMaterial).color.set(ok ? '#4f4' : '#f33');
  });
}

/**
 * Which neighbours a wall joins (bits follow WALL_DIRS): any of its team's walls next to it. A
 * diagonal join is left out when a straight neighbour already closes that corner.
 */
function wallMask(e: Ent, walls: Map<number, number>): number {
  const at = (dx: number, dy: number) => {
    const x = e.tx + dx, y = e.ty + dy;
    return x >= 0 && y >= 0 && x < MW && y < MH && walls.get(y * MW + x) === e.team;
  };
  let mask = 0;
  WALL_DIRS.forEach(([dx, dy], i) => {
    if (!at(dx, dy)) return;
    if (dx && dy && (at(dx, 0) || at(0, dy))) return;
    mask |= 1 << i;
  });
  return mask;
}

/** Create, move, animate and remove models to match the world. Call once per frame. */
export function syncEntities(dt: number): void {
  const seen = new Set<number>();
  // which team's wall stands on each tile, so segments join up with their neighbours
  const walls = new Map<number, number>();
  for (const e of G.ents) if (!e.dead && e.kind === 'bld' && isWall(e.type)) walls.set(e.ty * MW + e.tx, e.team);
  for (const e of G.ents) {
    if (e.dead) continue;
    seen.add(e.id);
    let o = objs.get(e.id);
    const mask = walls.size && e.kind === 'bld' && isWall(e.type) ? wallMask(e, walls) : 0;
    // each structure takes on a newer age's look once it's upgraded (game/refit.ts)
    const key = e.kind === 'bld' ? `${e.type}|${e.team}|${bldLook(e.type as BldType, e.lvl ?? 0)}|${mask}` : `${e.type}|${e.team}|a${e.kind === 'unit' ? armorLevel(e.type as UnitType, e.team) : 0}`;
    if (o && o.key !== key) { holder.remove(o.model.root); dropHit(o.model); o = undefined; }
    if (!o) { o = { model: create(e, mask), key }; objs.set(e.id, o); }
    const r = o.model.root;
    r.visible = shownToPlayer(e);
    if (!r.visible) continue;
    const x = e.x / TS, z = e.y / TS;
    if (e.kind === 'unit') {
      r.position.set(x, 0, z);
      r.rotation.set(0, -e.face, 0, 'YXZ');
      animateUnit(o.model, e);
      hitFlash(o.model, e);
      statusFx(o.model, e, dt);
      stoneLook(o.model, e);
      const air = !!UNIT[e.type as UnitType]?.alt;
      // ground units stand on the ground (wading in shallows); aircraft keep their height over water
      r.position.y += air ? surfaceY(x, z) : heightAt(x, z);
      if (!air && UNIT[e.type as UnitType]?.cls === 'vehicle') tilt(r, x, z, e.face);
    } else if (e.kind === 'bld') {
      r.position.set(x, footprintY(e.tx, e.ty, e.w, e.h), z);
      animateBuilding(o.model, e, dt);
    } else r.position.set(x, heightAt(x, z), z);
  }
  let killed: Map<number, string> | null = null;
  for (const [id, o] of objs) {
    if (seen.has(id)) continue;
    objs.delete(id);
    const ice = o.model.root.userData.ice as THREE.Object3D | undefined;
    if (ice) { o.model.root.remove(ice); o.model.root.userData.ice = undefined; }
    // a unit that just died leaves its body (or wreck) behind; anything else simply goes
    killed ??= new Map(G.decals.filter((d) => d.kind === 'corpse' || d.kind === 'wreck').map((d) => [d.seed, d.kind]));
    const kind = killed.get(id);
    if (kind && o.model.root.visible) fall(o.model, kind === 'wreck');
    else { holder.remove(o.model.root); dropHit(o.model); }
  }
  updateFallen();
  updateRings();
  updateMarkers();
  updateRally();
  updateGhost();
}

// ---- a subtle red flash on a unit when it's struck ----

const HIT_RED = new THREE.Color('#ff2010'), HIT_GLOW = 0.3, HIT_FADE = 280; // peak share of red; fade in ms
type Lit = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number };
interface HitState { mats: { m: Lit; e: THREE.Color; i: number }[]; at: number; on: boolean; orig: [THREE.Mesh, THREE.Material | THREE.Material[]][] }

/** The model's own copies of its lit materials, made the first time it's hit (the originals are shared). */
function hitState(m: Model): HitState {
  let h = m.root.userData.hit as HitState | undefined;
  if (h) return h;
  h = { mats: [], at: -1e9, on: false, orig: [] };
  const st = h;
  m.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    st.orig.push([o, o.material]);
    const own = (mt: THREE.Material): THREE.Material => {
      if (!('emissive' in mt)) return mt;
      const c = borrowMaterial(mt) as Lit;
      st.mats.push({ m: c, e: c.emissive.clone(), i: c.emissiveIntensity });
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
  });
  m.root.userData.hit = h;
  return h;
}

function hitFlash(m: Model, e: Ent): void {
  let h = m.root.userData.hit as HitState | undefined;
  const now = performance.now();
  // any drop in health is a hit (works the same online, where health arrives in snapshots)
  if (e.hp < (m.root.userData.hp ?? e.hp)) { h = hitState(m); h.at = now; }
  m.root.userData.hp = e.hp;
  // a spell or element on the unit tints it too (frozen, burning, poisoned...: status3d.ts)
  const tint = statusTint(e);
  if (tint) h = hitState(m);
  if (!h) return;
  const k = Math.max(0, 1 - (now - h.at) / HIT_FADE);
  if (k <= 0 && !h.on && !tint) {
    // the flash is over: back to the shared materials, so it's drawn with the rest of its kind again
    if (!m.root.userData.stone) dropHit(m);
    return;
  }
  for (const { m: mt, e: e0, i } of h.mats) {
    mt.emissive.copy(e0);
    if (tint) mt.emissive.lerp(tint[0], tint[1]);
    mt.emissive.lerp(HIT_RED, HIT_GLOW * k);
    mt.emissiveIntensity = lerp(i, Math.max(i, 1), Math.max(k, tint ? tint[1] : 0));
  }
  h.on = k > 0 || !!tint;
}

// ---- turned to stone by a Medusa's gaze: grey and lifeless until it wears off ----

const STONE_GREY = new THREE.Color('#9a958a');
/** each stoned material's own colour, to give back when the spell wears off */
const stoneCol = new WeakMap<THREE.Material, THREE.Color>();

function stoneLook(m: Model, e: Ent): void {
  const on = (e.stoneT ?? 0) > G.gameT, was = !!m.root.userData.stone;
  if (!on && !was) return;
  const h = hitState(m);
  for (const { m: mt, e: e0, i } of h.mats) {
    const col = (mt as Lit & { color?: THREE.Color }).color;
    if (on) {
      if (col && !stoneCol.has(mt)) stoneCol.set(mt, col.clone());
      col?.copy(STONE_GREY);
      mt.emissive.copy(STONE_GREY); mt.emissiveIntensity = 0.35;
    } else {
      const c0 = stoneCol.get(mt);
      if (col && c0) col.copy(c0);
      stoneCol.delete(mt);
      mt.emissive.copy(e0); mt.emissiveIntensity = i;
    }
  }
  m.root.userData.stone = on;
  if (on) for (const k of ['legL', 'legR', 'legFL', 'legFR', 'legBL', 'legBR', 'wingL', 'wingR']) if (m.parts[k]) m.parts[k].rotation.set(0, 0, 0);
}

/** Give a model back its shared materials, and hand its flash copies back. */
function dropHit(m: Model): void {
  const h = m.root.userData.hit as HitState | undefined;
  if (h) {
    for (const [o, mt] of h.orig) o.material = mt;
    for (const { m: mt } of h.mats) returnMaterial(mt);
  }
  m.root.userData.hit = undefined;
}

// ---- the fallen: dead units lie on the ground in dark grey, then sink out of sight ----

/** Seconds a body lies on the ground before it starts to sink, and how long sinking takes. */
const LIE = 3, SINK = 5, TOPPLE = 0.35;
/** Dead units turn grey: black and white, and darker (their shading still shows the detail). */
const DEAD_DARK = 0.45;
interface Fallen { model: Model; t0: number; wreck: boolean; sinkT: number; y0: number; fly: number; tip: number; mats: THREE.Material[] }
const fallen: Fallen[] = [];

function fall(m: Model, wreck: boolean): void {
  const r = m.root, mats: THREE.Material[] = [];
  dropHit(m);
  // grey, on its own copies of the materials (the originals are shared by every model of its kind)
  r.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const tint = (mt: THREE.Material): THREE.Material => {
      const c = borrowMaterial(mt) as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number };
      if (c.color) { const g = (0.3 * c.color.r + 0.59 * c.color.g + 0.11 * c.color.b) * DEAD_DARK; c.color.setRGB(g, g, g); }
      if (c.emissive) c.emissiveIntensity = 0;
      mats.push(c);
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material);
  });
  const x = r.position.x, z = r.position.z;
  fallen.push({ model: m, t0: G.gameT, wreck, sinkT: wreck ? Infinity : G.gameT + LIE, y0: heightAt(x, z), fly: r.position.y - heightAt(x, z), tip: wreck ? 0 : (r.rotation.z || 0), mats });
}

/** Scrap (ore) still lying where a wreck stands: the wreck stays until it has been carried off. */
function scrapLeft(x: number, z: number): boolean {
  const cx = Math.floor(x), cz = Math.floor(z);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const tx = cx + dx, tz = cz + dz;
    if (tx >= 0 && tz >= 0 && tx < MW && tz < MH && G.ore[tz * MW + tx] > 0) return true;
  }
  return false;
}

function updateFallen(): void {
  const now = G.gameT;
  for (let i = fallen.length - 1; i >= 0; i--) {
    const f = fallen[i], r = f.model.root, x = r.position.x, z = r.position.z, age = now - f.t0;
    if (f.wreck && f.sinkT === Infinity && age > LIE && !scrapLeft(x, z)) f.sinkT = now;
    const sink = Math.max(0, (now - f.sinkT) / SINK);
    if (sink >= 1 || now < f.t0) {
      holder.remove(r);
      for (const m of f.mats) returnMaterial(m);
      fallen.splice(i, 1);
      continue;
    }
    // infantry topple onto their backs; anything in the air drops to the ground
    const k = Math.min(1, age / TOPPLE);
    if (!f.wreck) r.rotation.z = lerp(f.tip, Math.PI / 2, k * k);
    const lie = f.wreck ? 0 : 0.06 * UNIT_SCALE * k;
    r.position.y = f.y0 + f.fly * (1 - k) ** 2 + lie - sink * (f.model.height + 0.2);
    r.visible = !!G.vis[Math.floor(z) * MW + Math.floor(x)];
  }
}

/** How high an aircraft flies (tiles). */
const altTiles = (e: Ent): number => (e.kind === 'unit' ? UNIT[e.type as UnitType].alt ?? 0 : 0);

/** How high the top of an entity's model is (tiles), for placing health bars. */
export const modelHeight = (e: Ent): number => (objs.get(e.id)?.model.height ?? 0.6) + altTiles(e);

/** Cooling towers (parts named vent0, vent1... give off steam) and chimneys (flue0... give off smoke) on a model. */
export const ventsOf = (e: Ent): { at: THREE.Object3D; smoke: boolean }[] => {
  const P = objs.get(e.id)?.model.parts;
  return P ? Object.keys(P).filter((k) => k.startsWith('vent') || k.startsWith('flue')).map((k) => ({ at: P[k], smoke: k.startsWith('flue') })) : [];
};

/** A point partway up an entity's model (tiles), for picking and box selection. */
export const midHeight = (e: Ent): number => altTiles(e) + (objs.get(e.id)?.model.height ?? 0.6) * 0.4;

/** The entity under a screen point: models first, then the nearest small unit within reach. */
export function pickEntity(sx: number, sy: number): Ent | null {
  const roots: THREE.Object3D[] = [];
  for (const o of objs.values()) if (o.model.root.visible) roots.push(o.model.root);
  for (const h of raycastObjects(sx, sy, roots)) {
    let o: THREE.Object3D | null = h.object;
    while (o && o.userData.id === undefined) o = o.parent;
    const e = o ? valid(o.userData.id as number) : null;
    if (e) return e;
  }
  let best: Ent | null = null, bd = 24;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || !objs.get(e.id)?.model.root.visible) continue;
    const p = worldToScreen(e.x, e.y, midHeight(e)), d = Math.hypot(p.sx - sx, p.sy - sy);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
