// How spells and elements show on a unit (game/spells.ts): a coloured glow over its model, a block
// of ice around it while frozen, frost crystals and falling snow while slowed, a red throbbing rage
// while bloodlusted, and fumes, drips or sparks rising off it.
import * as THREE from 'three';
import { altOf, G, type Ent } from '../../../game/state.ts';
import { V } from '../view_state.ts';
import { part } from '../../../game/fx.ts';
import { burning, frozen, lusting, cursed, poisoned, sludged, wet } from '../../../game/spells.ts';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import type { Model } from './model_kit.ts';

const COL = {
  frozen: new THREE.Color('#9ae8ff'),
  burning: new THREE.Color('#ff7a20'),
  poisoned: new THREE.Color('#70ff30'),
  lust: new THREE.Color('#ff3a00'),
  // a cold, pale frost: no strong colour, so it doesn't read as a magic shield
  slow: new THREE.Color('#d6eeff'),
  sludge: new THREE.Color('#6a4010'),
  wet: new THREE.Color('#3090ff'),
};

/** The glow a unit's effects put over its model, strongest first, and how strong (0..1); null if none. */
export function statusTint(e: Ent): [THREE.Color, number] | null {
  if (e.kind !== 'unit') return null;
  const t = performance.now() / 1000 + e.id;
  if (frozen(e)) return [COL.frozen, 0.65];
  if (burning(e)) return [COL.burning, 0.35 + Math.sin(t * 14) * 0.1];
  if (poisoned(e)) return [COL.poisoned, 0.28 + Math.sin(t * 4) * 0.06];
  if (lusting(e)) return [COL.lust, 0.22 + heartbeat(t) * 0.35];
  if (slowed(e)) return [COL.slow, 0.2];
  if (sludged(e)) return [COL.sludge, 0.35];
  if (wet(e)) return [COL.wet, 0.18];
  return null;
}

/** Slowed by the Slow spell or a hex shot (Hex Rifle). */
export const slowed = (e: Ent): boolean => cursed(e) || (e.slowT ?? 0) > G.gameT;

/** A heart's double beat, 0..1, about 2 a second: rage. */
function heartbeat(t: number): number {
  const p = (t * 2) % 1;
  return Math.max(Math.exp(-((p - 0.08) ** 2) / 0.002), 0.7 * Math.exp(-((p - 0.3) ** 2) / 0.002));
}

const iceGeo = new THREE.IcosahedronGeometry(1, 1);
const iceMat = new THREE.MeshStandardMaterial({ color: '#cff4ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45, emissive: '#5ac8ff', emissiveIntensity: 0.35, flatShading: true, depthWrite: false });

// ---- slowed: icy crystals growing out of the ground round its feet and up its legs ----

const shardGeo = new THREE.ConeGeometry(0.03, 0.15, 4);
shardGeo.translate(0, 0.075, 0); // grows from its base
const shardMat = new THREE.MeshStandardMaterial({ color: '#e6f8ff', roughness: 0.1, metalness: 0.2, emissive: '#7ccfff', emissiveIntensity: 0.45, transparent: true, opacity: 0.9, flatShading: true });

/** A cluster of frost crystals sized to the unit: some leaning out from its feet, a few smaller ones on its legs. */
function frostShards(e: Ent, m: Model): THREE.Group {
  const g = new THREE.Group();
  // in the model's own units (the root is scaled): a unit's radius is in px, 32 to the tile
  const k = m.root.scale.x || 1, r = (UNIT[e.type as UnitType]?.radius ?? 8) / 32 / k, h = (m.height || 0.6) / k;
  let seed = e.id * 9301 + 49297;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5, d = r * (0.55 + rnd() * 0.5), s = 0.7 + rnd() * 0.9;
    const c = new THREE.Mesh(shardGeo, shardMat);
    c.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    c.scale.set(s * Math.max(1, r * 3), s * Math.max(1, r * 2.5), s * Math.max(1, r * 3));
    // lean outward, like hoarfrost
    c.rotation.set(Math.sin(a) * (0.35 + rnd() * 0.4), 0, -Math.cos(a) * (0.35 + rnd() * 0.4));
    g.add(c);
  }
  // rime creeping up the body
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, d = r * 0.35;
    const c = new THREE.Mesh(shardGeo, shardMat);
    c.position.set(Math.cos(a) * d, h * (0.1 + rnd() * 0.25), Math.sin(a) * d);
    c.scale.setScalar(0.45 + rnd() * 0.3);
    c.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
    g.add(c);
  }
  // snowflakes drifting down round it, each on its own loop (see snowfall)
  const flakes = new THREE.Group();
  for (let i = 0; i < FLAKES; i++) {
    const f = new THREE.Mesh(flakeGeo, flakeMat);
    f.userData = { a: rnd() * Math.PI * 2, d: r * (0.3 + rnd() * 0.8), ph: rnd(), sp: 0.25 + rnd() * 0.15 };
    flakes.add(f);
  }
  flakes.userData.top = h + 0.15;
  g.add(flakes);
  g.userData.flakes = flakes;
  g.renderOrder = 2;
  return g;
}

const FLAKES = 7;
const flakeGeo = new THREE.OctahedronGeometry(0.022, 0);
const flakeMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95 });

/** Let a slowed unit's snowflakes fall, slowly and swaying, round and round. */
function snowfall(frost: THREE.Object3D, t: number): void {
  const flakes = frost.userData.flakes as THREE.Group, top = flakes.userData.top as number;
  for (const f of flakes.children) {
    const u = f.userData as { a: number; d: number; ph: number; sp: number };
    const k = (t * u.sp + u.ph) % 1, sway = Math.sin(t * 1.7 + u.ph * 9) * 0.04;
    f.position.set(Math.cos(u.a) * u.d + sway, top * (1 - k), Math.sin(u.a) * u.d + sway * 0.6);
    f.rotation.set(t * 2 + u.ph * 6, t * 1.3, 0);
    f.scale.setScalar(k < 0.1 ? k * 10 : k > 0.9 ? (1 - k) * 10 : 1);
  }
}

// ---- bloodlust: bigger, red eyes and a throbbing red glow ----

const eyeGeo = new THREE.SphereGeometry(0.017, 6, 4);
const eyeMat = new THREE.MeshBasicMaterial({ color: '#ff2010' });
const LUST_GROW = 0.12;

/** Foot soldiers (models.ts soldier()): their faces are all in one place. */
const SOLDIERS = new Set(['rifleman', 'gunner', 'medic', 'rocket', 'swordsman', 'crossbowman', 'worker']);

/** Glowing red eyes on a foot soldier's face (soldier heads all sit at the same spot: models.ts). */
function rageEyes(): THREE.Group {
  const g = new THREE.Group();
  for (const z of [-0.04, 0.04]) g.add(new THREE.Mesh(eyeGeo, eyeMat).translateX(0.112).translateY(0.476).translateZ(z));
  return g;
}

/** Add or remove an effect's extra meshes on a model. */
function toggle(m: Model, key: string, on: boolean, make: () => THREE.Object3D): void {
  const cur = m.root.userData[key] as THREE.Object3D | undefined;
  if (on && !cur) { const o = make(); m.root.add(o); m.root.userData[key] = o; }
  else if (!on && cur) { m.root.remove(cur); m.root.userData[key] = undefined; }
}

/** Particles a second for each effect. */
const RATE = { poisoned: 6, sludge: 4, wet: 3, lust: 5, frozen: 2 };

const chance = (perSec: number, dt: number): boolean => Math.random() < perSec * dt;

/** Show a unit's effects: the ice block while frozen, and whatever rises off it. Call each frame. */
export function statusFx(m: Model, e: Ent, dt: number): void {
  let ice = m.root.userData.ice as THREE.Mesh | undefined;
  const fz = frozen(e);
  if (fz && !ice) {
    ice = new THREE.Mesh(iceGeo, iceMat);
    // the model is in tiles: a unit's radius is in px (32 to the tile)
    const r = (UNIT[e.type as UnitType]?.radius ?? 8) / 32, h = m.height || 0.8;
    ice.scale.set(r * 1.25 + 0.05, h * 0.6, r * 1.25 + 0.05);
    ice.position.y = h * 0.45;
    ice.renderOrder = 3;
    m.root.add(ice);
    m.root.userData.ice = ice;
  } else if (!fz && ice) {
    m.root.remove(ice);
    m.root.userData.ice = undefined;
  }
  const sl = slowed(e) && !fz;
  toggle(m, 'frost', sl, () => frostShards(e, m));
  if (sl) snowfall(m.root.userData.frost as THREE.Object3D, performance.now() / 1000);
  const lu = lusting(e) && !fz;
  toggle(m, 'eyes', lu && SOLDIERS.has(e.type), rageEyes);
  // swell with rage: a bit bigger, throbbing with the heartbeat
  const base = (m.root.userData.baseScale ??= m.root.scale.x) as number;
  const grow = lu ? 1 + LUST_GROW + heartbeat(performance.now() / 1000 + e.id) * 0.03 : 1;
  if (m.root.scale.x !== base * grow) m.root.scale.setScalar(base * grow);
  if (V.paused) return;
  const z = altOf(e), jx = () => e.x + (Math.random() - 0.5) * 10, jy = () => e.y + (Math.random() - 0.5) * 6;
  // flames on burning units: burn3d.ts
  if (poisoned(e) && chance(RATE.poisoned, dt)) part('smoke', jx(), jy() - 4, { z: z + 8, vz: 10, max: 1, size: 3, soft: true, col: '#8adf50' });
  if (sludged(e) && chance(RATE.sludge, dt)) part('chip', jx(), jy(), { z: z + 6, vz: -10, max: 0.6, size: 2, col: '#2a1a08' });
  if (wet(e) && chance(RATE.wet, dt)) part('spark', jx(), jy(), { z: z + 10, vz: -30, max: 0.4, size: 1.2, col: '#80c8ff' });
  if (lu && chance(RATE.lust, dt)) part('spark', jx(), jy(), { z: z + 4, vz: 40, max: 0.4, size: 1.5, col: '#ff4030' });
  if (fz && chance(RATE.frozen, dt)) part('flash', jx(), jy(), { z: z + 8 + Math.random() * 8, max: 0.3, size: 5, col: '#c8f4ff' });
}
