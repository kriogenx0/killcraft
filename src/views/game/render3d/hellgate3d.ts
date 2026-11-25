// The Gate of Hell (data/hell.ts): a black stone arch of horns over a pit of fire, ringed with
// jagged spikes, in the middle of the map. Shown once its ground has been explored.
import * as THREE from 'three';
import { heightAt } from './heights.ts';
import { G } from '../../../game/state.ts';
import { MW } from '../../../game/const.ts';
import { GATE_SIZE, GATE_TILE } from '../../../data/hell.ts';
import { mkCanvas, ctx2d } from '../../../util/canvas.ts';
import { S } from './scene.ts';
import { mat } from './materials.ts';
import { mesh, rod } from './model_kit.ts';

const layer = new THREE.Group();
let gate: { group: THREE.Group; swirl: THREE.Mesh; churn: THREE.Mesh; glow: THREE.Mesh; flames: THREE.Mesh[]; i: number } | null = null;
let swirlTex: THREE.CanvasTexture | null = null;

/** A churning red-orange vortex. */
function vortexTexture(): THREE.CanvasTexture {
  const c = mkCanvas(128, 128), g = ctx2d(c);
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,240,160,1)');
  rg.addColorStop(0.3, 'rgba(255,120,20,.9)');
  rg.addColorStop(0.7, 'rgba(180,20,0,.6)');
  rg.addColorStop(1, 'rgba(60,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(40,0,0,.7)';
  g.lineCap = 'round';
  for (let arm = 0; arm < 4; arm++) {
    g.lineWidth = 6;
    g.beginPath();
    for (let t = 0; t <= 1; t += 0.02) {
      const a = arm * (Math.PI / 2) + t * Math.PI * 2.6, r = 4 + t * 56;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGate(): NonNullable<typeof gate> {
  const cx = GATE_TILE[0] + GATE_SIZE / 2, cz = GATE_TILE[1] + GATE_SIZE / 2, R = GATE_SIZE / 2;
  const group = new THREE.Group();
  group.position.set(cx, heightAt(cx, cz), cz);
  const black = mat('#1e1816', { rough: 0.9, tex: 'stone', flat: true }), char = mat('#2e2420', { rough: 1, tex: 'stone' });
  const bone = mat('#d8ccb0', { rough: 0.6 });
  const ember = mat('#ffb040', { rough: 0.4, emissive: '#ff7000', emissiveIntensity: 2 });
  // a scorched stone rim round the pit
  const rim = mesh(new THREE.CylinderGeometry(R + 0.1, R + 0.35, 0.22, 10), char, 0, 0.11, 0);
  group.add(rim);
  const pit = mesh(new THREE.CylinderGeometry(R - 0.25, R - 0.25, 0.02, 24), mat('#3a0804', { rough: 0.7, emissive: '#801000', emissiveIntensity: 0.9 }), 0, 0.23, 0);
  group.add(pit);
  // the fire churning in the pit
  const churn = new THREE.Mesh(
    new THREE.CircleGeometry(R - 0.28, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: swirlTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  churn.position.y = 0.25;
  churn.renderOrder = 3;
  group.add(churn);
  // jagged black spikes all round it, leaning outward
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.13, h = 0.5 + ((k * 7) % 5) * 0.12;
    const s = mesh(new THREE.ConeGeometry(0.13, h, 5), black, Math.cos(a) * (R + 0.15), 0.2 + h / 2, Math.sin(a) * (R + 0.15));
    s.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    group.add(s);
  }
  // the arch: two pillars that curve up into great horns meeting over the pit
  for (const s of [-1, 1]) {
    const px = 0, pz = s * (R - 0.15);
    group.add(mesh(new THREE.BoxGeometry(0.42, 1.5, 0.42), black, px, 0.95, pz));
    group.add(mesh(new THREE.BoxGeometry(0.55, 0.2, 0.55), char, px, 0.2, pz));
    group.add(rod([px, 1.65, pz], [px, 2.35, pz * 0.55], 0.17, black, 6));
    group.add(rod([px, 2.35, pz * 0.55], [px, 2.65, pz * 0.08], 0.11, black, 6));
    // a horned skull on each pillar, eyes aglow
    const skull = new THREE.Group();
    skull.position.set(0.24, 1.25, pz);
    skull.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), bone, 0, 0, 0));
    skull.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.12), bone, 0.06, -0.09, 0)); // jaw
    for (const e of [-1, 1]) {
      skull.add(mesh(new THREE.SphereGeometry(0.03, 6, 4), ember, 0.11, 0.02, e * 0.05));
      // ram's horns curling out to the sides
      skull.add(rod([0, 0.06, e * 0.09], [-0.02, 0.1, e * 0.2], 0.03, black, 5));
      skull.add(rod([-0.02, 0.1, e * 0.2], [0.04, -0.02, e * 0.25], 0.022, black, 5));
    }
    group.add(skull);
    // braziers of fire on top of the pillars
    const f = mesh(new THREE.ConeGeometry(0.16, 0.4, 6), ember, px, 1.9, pz);
    group.add(f);
  }
  group.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), ember, 0, 2.68, 0)); // a burning eye where the horns meet
  const flames = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.material === ember && c.geometry.type === 'ConeGeometry');
  // the vortex standing in the arch, and a glow rising from the pit
  const swirl = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 40),
    new THREE.MeshBasicMaterial({ map: swirlTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  swirl.position.set(0, 1.35, 0);
  swirl.rotation.y = Math.PI / 2;
  swirl.renderOrder = 3;
  group.add(swirl);
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.45, R * 0.8, 2.6, 24, 1, true).translate(0, 1.3, 0),
    new THREE.MeshBasicMaterial({ color: '#ff3a00', transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  glow.renderOrder = 3;
  group.add(glow);
  group.visible = false;
  return { group, swirl, churn, glow, flames, i: Math.floor(cz) * MW + Math.floor(cx) };
}

/** Build the gate for the current map (if it has one). */
export function initHellGate3d(): void {
  S.scene.remove(layer);
  layer.clear();
  gate = null;
  if (!G.hell?.gate) return;
  swirlTex ??= vortexTexture();
  gate = makeGate();
  layer.add(gate.group);
  S.scene.add(layer);
}

/** Churn the vortex and flicker the fires; show the gate once its ground has been explored. */
export function animateHellGate3d(dt: number): void {
  if (!gate) return;
  gate.group.visible = G.vis[gate.i] > 0;
  if (!gate.group.visible) return;
  const t = performance.now() / 1000;
  gate.swirl.rotation.z -= dt * 1.3;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.1);
  (gate.glow.material as THREE.MeshBasicMaterial).opacity = 0.05 + pulse * 0.07;
  gate.churn.rotation.y += dt * 0.6;
  gate.swirl.scale.setScalar(0.94 + pulse * 0.08);
  gate.flames.forEach((f, k) => { f.scale.set(1, 0.8 + Math.abs(Math.sin(t * 9 + k * 1.7)) * 0.45, 1); });
}
