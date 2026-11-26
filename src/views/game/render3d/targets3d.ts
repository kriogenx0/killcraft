// What the selected units are working on: a reticle of four corner brackets on the enemy they're
// attacking, the ally they're mending, the ore, tree or derrick a Worker is gathering from, and a
// small cross where a move ends; with a few units selected, a faint dashed line runs out to it too.
// Amber is for a fight, white for everything else: neither is a team color (green, blue, red) nor a
// spell's (shield blue, frost cyan, bloodlust red, Aether violet).
import * as THREE from 'three';
import { valid, type Ent } from '../../../game/state.ts';
import { TS } from '../../../game/const.ts';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { shownToPlayer } from '../render/minimap.ts';
import { V, spectating } from '../view_state.ts';
import { surfaceY } from './heights.ts';

/** what a reticle sits on: a point in tiles and the half-width to frame */
interface Mark { x: number; z: number; r: number; fight: boolean; key: string }

/** lines are drawn only for a small selection: an army's worth would be a tangle */
const MAX_LINES = 6;
const MAX_MARKS = 24;
const FIGHT = '#ffb030', OTHER = '#ffffff';

const reticles: THREE.Mesh[] = [];
const crosses: THREE.Mesh[] = [];
const lines: THREE.Line[] = [];
const mats = { fight: flat(FIGHT, 0.95), other: flat(OTHER, 0.8) };
const lineMats = { fight: dashed(FIGHT), other: dashed(OTHER) };

function flat(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide });
}
function dashed(color: string): THREE.LineDashedMaterial {
  return new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
}

/** four L-shaped corners round a unit square (half-width 1), flat on the ground */
const bracketGeo = (() => {
  const parts: number[] = [], L = 0.42, W = 0.09;
  const quad = (x0: number, z0: number, x1: number, z1: number) => parts.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    quad(Math.min(sx, sx - sx * L), Math.min(sz, sz - sz * W), Math.max(sx, sx - sx * L), Math.max(sz, sz - sz * W));
    quad(Math.min(sx, sx - sx * W), Math.min(sz, sz - sz * L), Math.max(sx, sx - sx * W), Math.max(sz, sz - sz * L));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3));
  return g;
})();
/** a small X where a move ends */
const crossGeo = (() => {
  const a = new THREE.PlaneGeometry(0.5, 0.07).rotateX(-Math.PI / 2).rotateY(Math.PI / 4);
  const b = new THREE.PlaneGeometry(0.5, 0.07).rotateX(-Math.PI / 2).rotateY(-Math.PI / 4);
  const g = new THREE.BufferGeometry();
  const pa = a.toNonIndexed().getAttribute('position').array, pb = b.toNonIndexed().getAttribute('position').array;
  g.setAttribute('position', new THREE.Float32BufferAttribute([...pa, ...pb], 3));
  return g;
})();

export function resetTargets(): void {
  reticles.length = 0;
  crosses.length = 0;
  lines.length = 0;
}

const radiusOf = (e: Ent): number => (e.w ? (e.w / 2) * 0.95 + 0.1 : (UNIT[e.type as UnitType]?.radius ?? 8) / TS + 0.28);

/** The entity a unit is going for right now, if any: the one it's shooting, attacking or mending. */
function targetEnt(u: Ent): { e: Ent; fight: boolean } | null {
  const o = u.order;
  const foe = valid(u.breach) ?? valid(u.shot) ?? (o?.t === 'attack' ? valid(o.tgt) : o?.t === 'move' ? valid(o.sub) : null);
  if (foe) return { e: foe, fight: true };
  const mend = o?.t === 'heal' ? valid(o.tgt) : null;
  return mend ? { e: mend, fight: false } : null;
}

/** Where a selected unit's attention is: an entity, a resource tile, or the end of a move. */
function targetOf(u: Ent): (Mark & { cross?: boolean }) | null {
  const t = targetEnt(u);
  if (t) return shownToPlayer(t.e) ? { x: t.e.x / TS, z: t.e.y / TS, r: radiusOf(t.e), fight: t.fight, key: `e${t.e.id}` } : null;
  const o = u.order;
  if (o?.t === 'harvest') {
    // oil comes from a derrick; ore and wood from a tile (the ore patch, or the tree being felled)
    const src = o.res === 'oil' ? valid(o.src) : null;
    if (src) return { x: src.x / TS, z: src.y / TS, r: radiusOf(src), fight: false, key: `e${src.id}` };
    return { x: o.tx + 0.5, z: o.ty + 0.5, r: 0.55, fight: false, key: `t${o.tx},${o.ty}` };
  }
  if (o?.t === 'move') {
    const gx = o.gx, gy = o.gy;
    return { x: gx + 0.5, z: gy + 0.5, r: 0, fight: false, key: `m${gx},${gy}`, cross: true };
  }
  return null;
}

function poolMesh(pool: THREE.Mesh[], i: number, geo: THREE.BufferGeometry, parent: THREE.Object3D): THREE.Mesh {
  let m = pool[i];
  if (!m) { m = new THREE.Mesh(geo, mats.other); m.renderOrder = 3.5; pool.push(m); parent.add(m); }
  m.visible = true;
  return m;
}

/** Draw the selection's targets. `seen` says whether a unit's model is on screen. */
export function updateTargets(parent: THREE.Object3D, seen: (e: Ent) => boolean): void {
  const mine = V.sel.filter((e) => !e.dead && (e.team === V.team || spectating()) && seen(e));
  const marks = new Map<string, Mark & { cross?: boolean }>();
  const withLines = mine.length <= MAX_LINES;
  let nl = 0;
  const now = performance.now() / 1000;
  for (const u of mine) {
    const t = targetOf(u);
    if (!t) continue;
    // a unit standing at the end of its move needs no cross under its feet
    if (t.cross && Math.hypot(u.x / TS - t.x, u.y / TS - t.z) < 0.8) continue;
    if (marks.size < MAX_MARKS && !marks.has(t.key)) marks.set(t.key, t);
    if (!withLines) continue;
    const ux = u.x / TS, uz = u.y / TS, d = Math.hypot(t.x - ux, t.z - uz);
    // nothing to draw when it's already on top of its target
    const gap = d - t.r - (UNIT[u.type as UnitType]?.radius ?? 8) / TS;
    if (gap < 0.4) continue;
    let ln = lines[nl];
    if (!ln) { ln = new THREE.Line(new THREE.BufferGeometry(), lineMats.other); ln.renderOrder = 3.5; lines.push(ln); parent.add(ln); }
    nl++;
    ln.visible = true;
    ln.material = t.fight ? lineMats.fight : lineMats.other;
    // from the unit's edge to the reticle's edge, hugging the ground over hills
    const pts: THREE.Vector3[] = [], from = (UNIT[u.type as UnitType]?.radius ?? 8) / TS / d, to = 1 - t.r / d;
    for (let k = 0, n = Math.max(2, Math.ceil(d * 2)); k <= n; k++) {
      const f = from + ((to - from) * k) / n, px = ux + (t.x - ux) * f, pz = uz + (t.z - uz) * f;
      pts.push(new THREE.Vector3(px, surfaceY(px, pz) + 0.1, pz));
    }
    ln.geometry.dispose();
    ln.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    ln.computeLineDistances();
  }
  for (let i = nl; i < lines.length; i++) lines[i].visible = false;

  let nr = 0, nc = 0;
  // a gentle breathing so the eye finds it, and the brackets close in a touch
  const pulse = 1 + Math.sin(now * 5) * 0.06;
  for (const m of marks.values()) {
    const mesh = m.cross ? poolMesh(crosses, nc++, crossGeo, parent) : poolMesh(reticles, nr++, bracketGeo, parent);
    mesh.material = m.fight ? mats.fight : mats.other;
    mesh.scale.setScalar(m.cross ? 1 : m.r * pulse);
    mesh.position.set(m.x, surfaceY(m.x, m.z) + 0.12, m.z);
  }
  for (let i = nr; i < reticles.length; i++) reticles[i].visible = false;
  for (let i = nc; i < crosses.length; i++) crosses[i].visible = false;
}
