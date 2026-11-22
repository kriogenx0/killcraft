// Portal gates: a ring of standing stones round a slowly turning swirl of light, one colour per linked pair.
import * as THREE from 'three';
import { heightAt } from './heights.ts';
import { G } from '../../../game/state.ts';
import { MW } from '../../../game/const.ts';
import { PORTAL_COLORS } from '../../../data/map.ts';
import { mkCanvas, ctx2d } from '../../../util/canvas.ts';
import { S } from './scene.ts';
import { mat } from './materials.ts';


interface Gate { i: number; group: THREE.Group; swirl: THREE.Mesh; glow: THREE.Mesh; phase: number }

const layer = new THREE.Group();
let gates: Gate[] = [];
let swirlTex: THREE.CanvasTexture | null = null;

function swirlTexture(): THREE.CanvasTexture {
  const c = mkCanvas(128, 128), g = ctx2d(c);
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.5, 'rgba(255,255,255,.45)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  // spiral arms
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    g.lineWidth = 5;
    g.beginPath();
    for (let t = 0; t <= 1; t += 0.02) {
      const a = arm * ((Math.PI * 2) / 3) + t * Math.PI * 2.2, r = 6 + t * 54;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGate(x: number, y: number, color: string, seed: number): Gate {
  const group = new THREE.Group();
  group.position.set(x + 0.5, heightAt(x + 0.5, y + 0.5), y + 0.5);
  // worn stone platform
  const stone = mat('#8d877c', { rough: 0.95, tex: 'stone' }), dark = mat('#5e5a52', { rough: 1, tex: 'stone' });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.08, 10), dark);
  pad.position.y = 0.04;
  pad.receiveShadow = true;
  group.add(pad);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.07, 5, 24).rotateX(Math.PI / 2), mat(color, { emissive: color, emissiveIntensity: 0.8, rough: 0.4 }));
  rim.position.y = 0.09;
  group.add(rim);
  // standing stones, a little crooked, with a glowing rune on each
  const rune = new THREE.MeshBasicMaterial({ color });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + seed, h = 0.62 + ((k * 37 + seed * 11) % 7) * 0.035;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.17, h, 0.12), stone);
    s.position.set(Math.cos(a) * 1.0, h / 2, Math.sin(a) * 1.0);
    s.rotation.set(((k % 3) - 1) * 0.06, -a, ((k % 2) - 0.5) * 0.08);
    s.castShadow = true;
    group.add(s);
    const r = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.16), rune);
    r.position.set(Math.cos(a) * 0.93, h * 0.6, Math.sin(a) * 0.93);
    r.rotation.y = -a - Math.PI / 2;
    group.add(r);
  }
  // the swirl on the ground and a faint column of light above it
  const swirl = new THREE.Mesh(
    new THREE.CircleGeometry(0.78, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: swirlTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  swirl.position.y = 0.1;
  swirl.renderOrder = 3;
  group.add(swirl);
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.75, 1.6, 20, 1, true).translate(0, 0.8, 0),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  glow.renderOrder = 3;
  group.add(glow);
  group.visible = false;
  return { i: y * MW + x, group, swirl, glow, phase: seed };
}

/** Rebuild the gates for the current map. */
export function initPortals3d(): void {
  S.scene.remove(layer);
  layer.clear();
  gates = [];
  swirlTex ??= swirlTexture();
  G.portals.forEach((p, k) => {
    const color = PORTAL_COLORS[k % PORTAL_COLORS.length];
    for (const [end, [x, y]] of [p.a, p.b].entries()) {
      const g = makeGate(x, y, color, k * 2 + end + 0.4);
      gates.push(g);
      layer.add(g.group);
    }
  });
  S.scene.add(layer);
}

/** Spin the swirls and show each gate once its ground has been explored. */
export function animatePortals3d(dt: number): void {
  for (const g of gates) {
    g.group.visible = G.vis[g.i] > 0;
    if (!g.group.visible) continue;
    g.phase += dt;
    g.swirl.rotation.y -= dt * 1.6;
    const pulse = 0.5 + 0.5 * Math.sin(g.phase * 2.3);
    (g.glow.material as THREE.MeshBasicMaterial).opacity = 0.12 + pulse * 0.12;
    g.swirl.scale.setScalar(0.92 + pulse * 0.1);
  }
}
