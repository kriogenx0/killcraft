// The unicorns (game/unicorns.ts): small, happy, and always under a rainbow that arches over them
// wherever they wander.
import * as THREE from 'three';
import { G } from '../../../game/state.ts';
import { MW } from '../../../game/const.ts';
import { currentUnicorns, unicornAt, UNICORN_ROAM } from '../../../game/unicorns.ts';
import { RAINBOW, unicornModel } from './creatures3d.ts';
import { mesh } from './model_kit.ts';
import { torus } from './materials.ts';
import { heightAt } from './heights.ts';
import type { Model } from './models.ts';

/** About the size of a cow. */
const S = 0.55;
/** The rainbow's span (tiles, outer radius) and its bands' thickness. */
const ARC_R = 9, BAND = 0.48;

/** The arc is soft and see-through (the mane and tail keep the solid colours). */
const SOFT = RAINBOW.map((m) => Object.assign(m.clone(), { transparent: true, opacity: 0.15, depthWrite: false }));

const group = new THREE.Group();
const shown: { model: Model; arc: THREE.Group }[] = [];

function rainbow(): THREE.Group {
  const g = new THREE.Group();
  SOFT.forEach((m, i) => g.add(mesh(torus(ARC_R - i * BAND * 1.6, BAND, Math.PI, 12, 128), m)));
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
    // the rainbow drifts over the meadow on its own, slower than the unicorn and turning only gently
    const ax = u.hx + Math.sin(t * u.wy * 0.45 + u.py + 2) * UNICORN_ROAM * 0.8, ay = u.hy + Math.sin(t * u.wx * 0.45 + u.px + 1) * UNICORN_ROAM * 0.8;
    arc.position.set(ax, heightAt(ax, ay), ay);
    arc.rotation.set(0, u.px + Math.sin(t * 0.02 + u.py) * 0.5, 0);
  });
}
