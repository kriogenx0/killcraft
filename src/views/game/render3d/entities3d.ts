// Keeps a 3D model for every entity the player can see, animates them, and draws the selection
// rings, order markers, rally flags and building ghost. Also answers "what's under the cursor?".
import * as THREE from 'three';
import { G, haulOf, valid, type Ent } from '../../../game/state.ts';
import { TS } from '../../../game/const.ts';
import { BUILDING, type BldType } from '../../../data/building.ts';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { HARVESTER_CAPACITY } from '../../../data/ore.ts';
import { nearBase, tileFree } from '../../../game/building.ts';
import { nearPortal } from '../../../game/map.ts';
import { lerp } from '../../../util/math.ts';
import { shownToPlayer } from '../render/minimap.ts';
import { MARKER_LIFE, V } from '../view_state.ts';
import { eraOf } from '../../../game/production.ts';
import { S, raycastObjects, worldToScreen } from './scene.ts';
import { waygateLinked } from '../../../game/aether.ts';
import { aetherModel, bldLook, buildingModel, sourceModel, unitModel, type Model } from './models.ts';
import { teamMat } from './materials.ts';
import { MELEE_LAND } from '../../../game/combat.ts';
import { armorKit, armorLevel } from './armor3d.ts';
import { levelUnder } from './world3d.ts';
import { footprintY, heightAt, slopeAt, surfaceY } from './heights.ts';

interface Obj { model: Model; key: string }

/** Units are drawn larger than life so they read clearly next to buildings. */
const UNIT_SCALE = 1.4;

const holder = new THREE.Group();
const overlays = new THREE.Group();
const objs = new Map<number, Obj>();

export function resetEntities3d(): void {
  holder.clear();
  overlays.clear();
  objs.clear();
  ringPool.length = 0;
  markerPool.length = 0;
  ghost = null;
  rally = null;
  S.scene.add(holder, overlays);
}

function create(e: Ent): Model {
  const m = e.kind === 'unit' ? unitModel(e.type as UnitType, e.team) : e.type === 'aether' ? aetherModel() : e.kind === 'source' ? sourceModel() : buildingModel(e.type as BldType, e.team, eraOf(e.team));
  m.root.userData.id = e.id;
  if (e.kind === 'unit') {
    const kit = armorKit(e.type as UnitType, e.team, armorLevel(e.type as UnitType, e.team));
    if (kit) { m.root.add(kit.root); if (kit.turret) (m.parts.turret ?? m.root).add(kit.turret); }
  }
  if (e.kind === 'unit') { m.root.scale.setScalar(UNIT_SCALE); m.height *= UNIT_SCALE; }
  for (const p of Object.values(m.parts)) p.userData.rest = p.position.clone();
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
      // swing the pick while digging
      if (P.armR) P.armR.rotation.z = !e.moving && e.atkT > 0 ? 1.0 + Math.sin(G.gameT * 8) * 0.8 : 1.0 + swing * 0.2;
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
}

function animateBuilding(m: Model, e: Ent, dt: number): void {
  const P = m.parts, atk = e.atkT > 0 ? 1 - e.atkT / 0.25 : 0;
  m.root.scale.y = Math.max(0.02, e.prog);
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
const ringMats = { own: basic('#5f5'), enemy: basic('#f55'), neutral: basic('#ff5') };
let rally: THREE.Group | null = null;
let ghost: { type: BldType; look: number; group: THREE.Group; tiles: THREE.Mesh[] } | null = null;

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
    r.material = e.team === V.team ? ringMats.own : e.team < 0 ? ringMats.neutral : ringMats.enemy;
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
  ghost = { type, look, group, tiles };
  overlays.add(group);
  return ghost;
}

function updateGhost(): void {
  const m = V.mode;
  if (m?.t !== 'place') { if (ghost) ghost.group.visible = false; return; }
  const g = ghostFor(m.type), s = BUILDING[m.type].size, near = nearBase(m.tx, m.ty, s, V.team);
  g.group.visible = true;
  const base = footprintY(m.tx, m.ty, s, s);
  g.group.position.set(m.tx + s / 2, base, m.ty + s / 2);
  g.tiles.forEach((t, i) => {
    const x = m.tx + (i % s), y = m.ty + Math.floor(i / s);
    t.position.y = surfaceY(x + 0.5, y + 0.5) - base + 0.1;
    const ok = near && tileFree(x, y, V.team) && !nearPortal(x, y);
    (t.material as THREE.MeshBasicMaterial).color.set(ok ? '#4f4' : '#f33');
  });
}

/** Create, move, animate and remove models to match the world. Call once per frame. */
export function syncEntities(dt: number): void {
  const seen = new Set<number>();
  for (const e of G.ents) {
    if (e.dead) continue;
    seen.add(e.id);
    let o = objs.get(e.id);
    // structures change their look as their side advances through the ages
    const key = e.kind === 'bld' ? `${e.type}|${e.team}|${bldLook(e.type as BldType, eraOf(e.team))}` : `${e.type}|${e.team}|a${e.kind === 'unit' ? armorLevel(e.type as UnitType, e.team) : 0}`;
    if (o && o.key !== key) { holder.remove(o.model.root); o = undefined; }
    if (!o) { o = { model: create(e), key }; objs.set(e.id, o); }
    const r = o.model.root;
    r.visible = shownToPlayer(e);
    if (!r.visible) continue;
    const x = e.x / TS, z = e.y / TS;
    if (e.kind === 'unit') {
      r.position.set(x, 0, z);
      r.rotation.set(0, -e.face, 0, 'YXZ');
      animateUnit(o.model, e);
      const air = !!UNIT[e.type as UnitType]?.alt;
      // ground units stand on the ground (wading in shallows); aircraft keep their height over water
      r.position.y += air ? surfaceY(x, z) : heightAt(x, z);
      if (!air && UNIT[e.type as UnitType]?.cls === 'vehicle') tilt(r, x, z, e.face);
    } else if (e.kind === 'bld') {
      levelUnder(e.tx, e.ty, e.w, e.h);
      r.position.set(x, footprintY(e.tx, e.ty, e.w, e.h), z);
      animateBuilding(o.model, e, dt);
    } else r.position.set(x, heightAt(x, z), z);
  }
  for (const [id, o] of objs) if (!seen.has(id)) { holder.remove(o.model.root); objs.delete(id); }
  updateRings();
  updateMarkers();
  updateRally();
  updateGhost();
}

/** How high an aircraft flies (tiles). */
const altTiles = (e: Ent): number => (e.kind === 'unit' ? UNIT[e.type as UnitType].alt ?? 0 : 0);

/** How high the top of an entity's model is (tiles), for placing health bars. */
export const modelHeight = (e: Ent): number => (objs.get(e.id)?.model.height ?? 0.6) + altTiles(e);

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
