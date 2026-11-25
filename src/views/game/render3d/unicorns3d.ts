// The unicorns (game/unicorns.ts): small, happy, and always under a rainbow that arches over them
// wherever they wander.
import * as THREE from 'three';
import { G } from '../../../game/state.ts';
import { MW } from '../../../game/const.ts';
import { currentUnicorns, unicornAt } from '../../../game/unicorns.ts';
import { RAINBOW, unicornModel } from './creatures3d.ts';
import { mesh } from './model_kit.ts';
import { torus } from './materials.ts';
import { heightAt } from './heights.ts';
import type { Model } from './models.ts';

/** About the size of a cow. */
const S = 0.55;
/** The rainbow's span (tiles, outer radius) and its bands' thickness. */
const ARC_R = 0.85, BAND = 0.045;

const group = new THREE.Group();
const shown: { model: Model; arc: THREE.Group }[] = [];

function rainbow(): THREE.Group {
  const g = new THREE.Group();
  RAINBOW.forEach((m, i) => g.add(mesh(torus(ARC_R - i * BAND * 1.6, BAND, Math.PI, 6, 36), m)));
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = false; });
  return g;
}

/** Add the unicorns' layer to the 3D scene for a new map. */
export function initUnicorns3d(parent: THREE.Object3D): void {
  parent.add(group);
}

/** Move every unicorn you can see to where it is now, under its rainbow. Call once per frame. */
export function updateUnicorns3d(): void {
  const list = currentUnicorns(), t = G.gameT;
  while (shown.length < list.length) {
    const model = unicornModel(), arc = rainbow();
    group.add(model.root, arc);
    shown.push({ model, arc });
  }
  shown.forEach(({ model, arc }, k) => {
    const u = list[k], on = !!u;
    if (!u) { model.root.visible = arc.visible = false; return; }
    const { x, y, face } = unicornAt(u, t), seen = on && !!G.vis[Math.floor(y) * MW + Math.floor(x)];
    model.root.visible = arc.visible = seen;
    if (!seen) return;
    const ground = heightAt(x, y), w = t * 6 + k, s = S * u.size;
    model.root.position.set(x, ground + Math.abs(Math.sin(w)) * 0.02, y);
    model.root.rotation.set(0, -face, 0);
    model.root.scale.setScalar(s);
    // a happy trot
    for (const [p, sgn] of [['legFL', 1], ['legBR', 1], ['legFR', -1], ['legBL', -1]] as const) if (model.parts[p]) model.parts[p].rotation.z = Math.sin(w) * 0.5 * sgn;
    // the rainbow stands over it, feet on the ground either side, turned to face across its path
    arc.position.set(x, ground, y);
    arc.rotation.set(0, -face + Math.PI / 2, 0);
  });
}
