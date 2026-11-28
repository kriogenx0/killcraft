// The unicorns (game/unicorns.ts): small, happy, and always under a rainbow that arches over them
// wherever they wander.
import * as THREE from 'three';
import { G } from '../../../game/state.ts';
import { MW } from '../../../game/const.ts';
import { currentUnicorns, unicornAt, UNICORN_ROAM } from '../../../game/unicorns.ts';
import { unicornModel } from './creatures3d.ts';
import { heightAt } from './heights.ts';
import type { Model } from './models.ts';

/** About the size of a cow. */
const S = 0.55;
/** The rainbow: a flat arc (tiles, inner and outer radius) standing over the meadow. */
const ARC_IN = 3, ARC_OUT = 9.5;

/** The six colours, red on the outside. */
const COLOURS = ['#ff4a4a', '#ff9a30', '#ffe040', '#50d860', '#40a0ff', '#9a60ff'].map((c) => new THREE.Color(c));

/**
 * One flat, soft sheet: each colour is a blurry band with a faint gap before the next, fading out at the
 * edges, toward the ground and when seen edge-on. Unlit and without fog, so it looks the same at every distance and hour.
 */
const arcMat = new THREE.ShaderMaterial({
  uniforms: { colours: { value: COLOURS }, peak: { value: 0.2 } },
  vertexShader: `
    varying vec2 vP;
    varying float vFace;
    void main() {
      vP = position.xy;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 colours[6];
    uniform float peak;
    varying vec2 vP;
    varying float vFace;
    void main() {
      float u = clamp((${ARC_OUT.toFixed(1)} - length(vP)) / ${(ARC_OUT - ARC_IN).toFixed(1)}, 0.0, 1.0) * 6.0;
      int i = int(min(floor(u), 5.0));
      vec3 c = colours[0];
      for (int k = 1; k < 6; k++) if (k == i) c = colours[k];
      float band = pow(sin(3.14159 * fract(u)), 1.5);
      float edge = smoothstep(0.0, 0.6, u) * smoothstep(6.0, 5.4, u);
      float feet = smoothstep(0.0, 1.5, vP.y);
      gl_FragColor = vec4(c, peak * band * edge * feet * smoothstep(0.05, 0.5, vFace));
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
});
const arcGeo = new THREE.RingGeometry(ARC_IN, ARC_OUT, 128, 1, 0, Math.PI);

const group = new THREE.Group();
const shown: { model: Model; arc: THREE.Object3D }[] = [];

function rainbow(): THREE.Object3D {
  const m = new THREE.Mesh(arcGeo, arcMat);
  m.renderOrder = 2;
  return m;
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
