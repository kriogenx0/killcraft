// Particles, tracers, projectiles and ground marks in 3D.
import * as THREE from 'three';
import { G, type FxKind, type Particle } from '../../../game/state.ts';
import { TS } from '../../../game/const.ts';
import { seenAt } from '../../../game/fog.ts';
import { mulberry32 } from '../../../util/math.ts';
import { mkCanvas, ctx2d } from '../../../util/canvas.ts';
import { S } from './scene.ts';
import { M, mat } from './materials.ts';

const CAP = 1600;
const layer = new THREE.Group();

function dotTexture(soft: boolean): THREE.CanvasTexture {
  const c = mkCanvas(64, 64), g = ctx2d(c), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(soft ? 0.35 : 0.7, soft ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Cloud { pts: THREE.Points; pos: Float32Array; col: Float32Array; n: number }

function cloud(size: number, opts: { additive?: boolean; soft?: boolean; opacity?: number }): Cloud {
  const pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 3), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({
    size, sizeAttenuation: true, vertexColors: true, map: dotTexture(opts.soft !== false), transparent: true,
    opacity: opts.opacity ?? 1, depthWrite: false, fog: false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, m);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return { pts, pos, col, n: 0 };
}

const clouds = {
  fire: cloud(0.55, { additive: true }),
  flash: cloud(1.3, { additive: true }),
  spark: cloud(0.12, { additive: true }),
  smoke: cloud(0.8, { opacity: 0.45 }),
  dust: cloud(0.55, { opacity: 0.5 }),
  bits: cloud(0.09, { soft: false }),
};

const KIND_CLOUD: Record<FxKind, keyof typeof clouds> = {
  fire: 'fire', flash: 'flash', spark: 'spark', smoke: 'smoke', trail: 'smoke', dust: 'dust',
  blood: 'bits', chip: 'bits', debris: 'bits', ore: 'bits', tracer: 'spark',
};

const tmp = new THREE.Color();
function colorOf(p: Particle, k: number): THREE.Color {
  switch (p.kind) {
    case 'fire': return tmp.setRGB(1, 0.85 - k * 0.5, 0.45 - k * 0.4).multiplyScalar(1 - k);
    case 'flash': return (p.col ? tmp.set(p.col) : tmp.setRGB(1, 1, 0.8)).multiplyScalar(1 - k);
    case 'spark': return (p.col ? tmp.set(p.col) : tmp.setRGB(1, 0.85, 0.4)).multiplyScalar(1 - k);
    case 'smoke': return p.soft ? tmp.setRGB(0.85, 0.85, 0.85) : tmp.setRGB(0.16, 0.15, 0.14);
    case 'trail': return tmp.setRGB(0.8, 0.8, 0.78);
    case 'dust': return tmp.setRGB(0.74, 0.66, 0.5);
    case 'blood': return tmp.setRGB(0.45, 0.02, 0.02);
    case 'ore': return tmp.setRGB(0.95, 0.75, 0.2);
    default: return p.col ? tmp.set(p.col) : tmp.setRGB(0.33, 0.31, 0.28);
  }
}

// tracers
const tracerPos = new Float32Array(400 * 6);
const tracers = new THREE.LineSegments(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(tracerPos, 3)),
  new THREE.LineBasicMaterial({ color: '#ffe8a0', transparent: true, opacity: 0.9, fog: false }),
);
tracers.frustumCulled = false;

// projectiles: a small pool of meshes per kind
const projGeo = {
  shell: new THREE.SphereGeometry(0.045, 8, 6),
  rocket: new THREE.CylinderGeometry(0.03, 0.03, 0.26, 8).rotateZ(Math.PI / 2),
  bolt: new THREE.BoxGeometry(0.28, 0.018, 0.018),
  boulder: new THREE.DodecahedronGeometry(0.11),
};
const projMat = {
  shell: mat('#ffe080', { emissive: '#ffb030', emissiveIntensity: 2 }),
  rocket: mat('#d8d8c8', { emissive: '#ff8a30', emissiveIntensity: 0.6 }),
  bolt: M.wood(),
  boulder: M.rock(),
};
const projPools: Record<string, THREE.Mesh[]> = { shell: [], rocket: [], bolt: [], boulder: [] };

// ground marks: one instanced disc per kind, plus stones and wrecks
const discGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
function marks(color: string, opacity: number): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), 420);
  im.renderOrder = 1;
  im.frustumCulled = false;
  return im;
}
const decal = { scorch: marks('#141210', 0.45), splat: marks('#4a0505', 0.75), corpse: marks('#3a0606', 0.6), rubble: marks('#1a1612', 0.55) };
const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.1), M.rock(), 1200);
const wrecks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.5, 0.7), mat('#1e1c1a', { rough: 1 }), 120);
const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.07, 0.13), mat('#4e5430'), 420);
for (const im of [stones, wrecks, bodies]) { im.frustumCulled = false; im.castShadow = true; }

export function initFx3d(): void {
  S.scene.remove(layer);
  layer.clear();
  layer.add(...Object.values(clouds).map((c) => c.pts), tracers, ...Object.values(decal), stones, wrecks, bodies);
  for (const pool of Object.values(projPools)) pool.length = 0;
  S.scene.add(layer);
}

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

function updateParticles(): void {
  for (const c of Object.values(clouds)) c.n = 0;
  let nt = 0;
  for (const p of G.fx) {
    if (!seenAt(p.x, p.y)) continue;
    const k = p.life / p.max;
    if (p.kind === 'tracer') {
      if (nt >= 400) continue;
      tracerPos.set([p.x / TS, Math.max(0.15, p.z / TS + 0.2), p.y / TS, p.ex / TS, 0.25 + p.ez / TS, p.ey / TS], nt * 6);
      nt++;
      continue;
    }
    const c = clouds[KIND_CLOUD[p.kind]];
    if (c.n >= CAP) continue;
    // smoke and dust drift upward as they age
    const rise = p.kind === 'smoke' || p.kind === 'trail' ? k * 0.6 : 0;
    c.pos.set([p.x / TS, p.z / TS + 0.08 + rise, p.y / TS], c.n * 3);
    const col = colorOf(p, k);
    c.col.set([col.r, col.g, col.b], c.n * 3);
    c.n++;
  }
  for (const c of Object.values(clouds)) {
    c.pts.geometry.setDrawRange(0, c.n);
    c.pts.geometry.attributes.position.needsUpdate = true;
    c.pts.geometry.attributes.color.needsUpdate = true;
  }
  tracers.geometry.setDrawRange(0, nt * 2);
  tracers.geometry.attributes.position.needsUpdate = true;
}

function updateProjectiles(): void {
  const used: Record<string, number> = { shell: 0, rocket: 0, bolt: 0, boulder: 0 };
  for (const p of G.projs) {
    if (!seenAt(p.x, p.y)) continue;
    const pool = projPools[p.kind];
    let me = pool[used[p.kind]];
    if (!me) {
      me = new THREE.Mesh(projGeo[p.kind], projMat[p.kind]);
      me.castShadow = true;
      pool.push(me);
      layer.add(me);
    }
    used[p.kind]++;
    me.visible = true;
    me.position.set(p.x / TS, p.z / TS + 0.1, p.y / TS);
    me.rotation.set(0, -p.a, 0);
    if (p.kind === 'boulder') me.rotation.x = p.tr * 0.05;
  }
  for (const [kind, pool] of Object.entries(projPools)) for (let i = used[kind]; i < pool.length; i++) pool[i].visible = false;
}

function updateDecals(): void {
  const n: Record<string, number> = { scorch: 0, splat: 0, corpse: 0, rubble: 0 };
  let ns = 0, nw = 0, nb = 0;
  for (const d of G.decals) {
    if (!G.vis[Math.floor(d.y / TS) * 64 + Math.floor(d.x / TS)]) continue;
    const fade = Math.min(1, (d.max - d.t) / (d.max * 0.3)), x = d.x / TS, z = d.y / TS;
    if (d.kind === 'wreck') {
      if (nw >= 120) continue;
      const s = (d.r / TS) * 1.7 * fade;
      q.setFromAxisAngle(up, -d.a);
      wrecks.setMatrixAt(nw++, m4.compose(v.set(x, 0.12 * fade, z), q, sc.set(s, s * 0.6, s)));
      if (n.scorch < 420) decal.scorch.setMatrixAt(n.scorch++, m4.compose(v.set(x, 0.015, z), q.identity(), sc.setScalar((d.r / TS) * 1.4 * fade)));
      continue;
    }
    const im = decal[d.kind];
    if (n[d.kind] >= 420) continue;
    const r = d.kind === 'splat' ? d.r / TS : d.kind === 'corpse' ? 0.28 : d.kind === 'rubble' ? d.w * 0.6 : d.r / TS;
    im.setMatrixAt(n[d.kind]++, m4.compose(v.set(x, 0.012 + n[d.kind] * 0.00001, z), q.identity(), sc.setScalar(Math.max(0.01, r * fade))));
    if (d.kind === 'corpse' && nb < 420 && d.t < d.max * 0.6) {
      q.setFromAxisAngle(up, -d.a);
      bodies.setMatrixAt(nb++, m4.compose(v.set(x, 0.04, z), q, sc.set(1, 1, 1)));
    }
    if (d.kind === 'rubble') {
      const rnd = mulberry32(d.seed);
      for (let i = 0; i < d.w * 6 && ns < 1200; i++) {
        q.setFromAxisAngle(up, rnd() * 6);
        const s = (0.6 + rnd() * 1.4) * fade;
        stones.setMatrixAt(ns++, m4.compose(v.set(x + (rnd() - 0.5) * d.w * 0.9, 0.05, z + (rnd() - 0.5) * d.w * 0.9), q, sc.set(s, s * 0.6, s)));
      }
    }
  }
  for (const [k, im] of Object.entries(decal)) { im.count = n[k]; im.instanceMatrix.needsUpdate = true; }
  stones.count = ns; wrecks.count = nw; bodies.count = nb;
  for (const im of [stones, wrecks, bodies]) im.instanceMatrix.needsUpdate = true;
}

export function updateFx3d(): void {
  updateParticles();
  updateProjectiles();
  updateDecals();
}
