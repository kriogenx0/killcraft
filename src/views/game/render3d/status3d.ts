// How spells and elements show on a unit (game/spells.ts): a coloured glow over its model, a block
// of ice around it while frozen, and fumes, drips or sparks rising off it.
import * as THREE from 'three';
import { altOf, type Ent } from '../../../game/state.ts';
import { V } from '../view_state.ts';
import { part } from '../../../game/fx.ts';
import { burning, frozen, lusting, cursed, poisoned, sludged, wet } from '../../../game/spells.ts';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import type { Model } from './model_kit.ts';

const COL = {
  frozen: new THREE.Color('#9ae8ff'),
  burning: new THREE.Color('#ff7a20'),
  poisoned: new THREE.Color('#70ff30'),
  lust: new THREE.Color('#ff2a1a'),
  slow: new THREE.Color('#a080ff'),
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
  if (lusting(e)) return [COL.lust, 0.3 + Math.sin(t * 8) * 0.1];
  if (cursed(e)) return [COL.slow, 0.25];
  if (sludged(e)) return [COL.sludge, 0.35];
  if (wet(e)) return [COL.wet, 0.18];
  return null;
}

const iceGeo = new THREE.IcosahedronGeometry(1, 1);
const iceMat = new THREE.MeshStandardMaterial({ color: '#cff4ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45, emissive: '#5ac8ff', emissiveIntensity: 0.35, flatShading: true, depthWrite: false });

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
  if (V.paused) return;
  const z = altOf(e), jx = () => e.x + (Math.random() - 0.5) * 10, jy = () => e.y + (Math.random() - 0.5) * 6;
  // flames on burning units: burn3d.ts
  if (poisoned(e) && chance(RATE.poisoned, dt)) part('smoke', jx(), jy() - 4, { z: z + 8, vz: 10, max: 1, size: 3, soft: true, col: '#8adf50' });
  if (sludged(e) && chance(RATE.sludge, dt)) part('chip', jx(), jy(), { z: z + 6, vz: -10, max: 0.6, size: 2, col: '#2a1a08' });
  if (wet(e) && chance(RATE.wet, dt)) part('spark', jx(), jy(), { z: z + 10, vz: -30, max: 0.4, size: 1.2, col: '#80c8ff' });
  if (lusting(e) && chance(RATE.lust, dt)) part('spark', jx(), jy(), { z: z + 4, vz: 40, max: 0.4, size: 1.5, col: '#ff4030' });
  if (fz && chance(RATE.frozen, dt)) part('flash', jx(), jy(), { z: z + 8 + Math.random() * 8, max: 0.3, size: 5, col: '#c8f4ff' });
}
