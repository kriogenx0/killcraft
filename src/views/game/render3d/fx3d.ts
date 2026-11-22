// Particles, tracers, projectiles and ground marks in 3D.
import * as THREE from 'three';
import { G, valid, type Ent, type FxKind, type Particle } from '../../../game/state.ts';
import { TS } from '../../../game/const.ts';
import { seenAt } from '../../../game/fog.ts';
import { lerp, mulberry32 } from '../../../util/math.ts';
import { mkCanvas, ctx2d } from '../../../util/canvas.ts';
import { S } from './scene.ts';
import { M, mat } from './materials.ts';
import { V } from '../view_state.ts';
import { shownToPlayer } from '../render/minimap.ts';
import { midHeight } from './entities3d.ts';
import { groundY, heightAt, slopeAt, surfaceY } from './heights.ts';

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
  // glows: around projectiles in flight, and on units and buildings as they are struck
  glow: cloud(0.55, { additive: true }),
  hit: cloud(0.7, { additive: true }),
  bigHit: cloud(1.6, { additive: true }),
};

const KIND_CLOUD: Record<FxKind, keyof typeof clouds> = {
  fire: 'fire', flash: 'flash', spark: 'spark', smoke: 'smoke', trail: 'smoke', dust: 'dust',
  blood: 'bits', chip: 'bits', debris: 'bits', ore: 'bits', tracer: 'spark', slash: 'spark',
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

// beams: glowing bars for bullet tracers and the streaks behind projectiles (lines are 1px, too thin to see)
const BEAMS = 600;
const beams = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  BEAMS,
);
beams.setColorAt(0, new THREE.Color());
beams.frustumCulled = false;
beams.renderOrder = 4;

// melee: a bright crescent sweeps across whoever is struck
const slashes = new THREE.InstancedMesh(
  new THREE.RingGeometry(0.72, 1, 18, 1, -1.1, 2.2).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }),
  200,
);
slashes.setColorAt(0, new THREE.Color());
slashes.frustumCulled = false;
slashes.renderOrder = 4;

// attack lines: from your selected units to what they are attacking
const atkPos = new Float32Array(300 * 6);
const atkLines = new THREE.LineSegments(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(atkPos, 3)),
  new THREE.LineBasicMaterial({ color: '#ff5a4a', transparent: true, opacity: 0.75, depthWrite: false, fog: false }),
);
atkLines.frustumCulled = false;
atkLines.renderOrder = 3;

// projectiles: a small pool of meshes per kind
const projGeo = {
  shell: new THREE.SphereGeometry(0.085, 10, 8),
  rocket: new THREE.CylinderGeometry(0.055, 0.055, 0.42, 8).rotateZ(Math.PI / 2),
  bolt: new THREE.BoxGeometry(0.5, 0.045, 0.045),
  boulder: new THREE.DodecahedronGeometry(0.2),
};
const projMat = {
  shell: mat('#ffe080', { emissive: '#ffb030', emissiveIntensity: 2 }),
  rocket: mat('#d8d8c8', { emissive: '#ff8a30', emissiveIntensity: 0.6 }),
  bolt: mat('#e8d8b0', { emissive: '#fff0c8', emissiveIntensity: 0.5 }),
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
  layer.add(...Object.values(clouds).map((c) => c.pts), beams, slashes, atkLines, ...Object.values(decal), stones, wrecks, bodies);
  for (const pool of Object.values(projPools)) pool.length = 0;
  S.scene.add(layer);
}

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const xAxis = new THREE.Vector3(1, 0, 0), dir = new THREE.Vector3(), bc = new THREE.Color();
let nBeam = 0;

/** A glowing bar from a to b (tiles), `w` thick. */
function beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, col: THREE.Color): void {
  if (nBeam >= BEAMS) return;
  dir.set(bx - ax, by - ay, bz - az);
  const len = dir.length();
  if (len < 1e-4) return;
  q.setFromUnitVectors(xAxis, dir.divideScalar(len));
  beams.setMatrixAt(nBeam, m4.compose(v.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, sc.set(len, w, w)));
  beams.setColorAt(nBeam++, col);
}

function addPoint(c: Cloud, x: number, y: number, z: number, col: THREE.Color): void {
  if (c.n >= CAP) return;
  c.pos.set([x, y, z], c.n * 3);
  c.col.set([col.r, col.g, col.b], c.n * 3);
  c.n++;
}

function updateParticles(): void {
  let ns = 0;
  for (const p of G.fx) {
    if (!seenAt(p.x, p.y)) continue;
    const k = p.life / p.max;
    if (p.kind === 'tracer') {
      // a bright streak that races from the muzzle to the target
      const head = Math.min(1, k * 1.7), tail = Math.max(0, head - (p.size > 1 ? 1 : 0.4)), fade = 1 - Math.max(0, k - 0.6) / 0.4;
      const ax = p.x / TS, ay = groundY(p.x, p.y) + Math.max(0.15, p.z / TS + 0.2), az = p.y / TS;
      const bx = p.ex / TS, by = groundY(p.ex, p.ey) + 0.25 + p.ez / TS, bz = p.ey / TS;
      (p.col ? bc.set(p.col) : bc.setRGB(1, 0.85, 0.45)).multiplyScalar(fade * 1.6);
      beam(lerp(ax, bx, tail), lerp(ay, by, tail), lerp(az, bz, tail), lerp(ax, bx, head), lerp(ay, by, head), lerp(az, bz, head), 0.03 * p.size, bc);
      continue;
    }
    if (p.kind === 'slash') {
      if (ns >= 200) continue;
      // sweeps a little as it fades
      q.setFromAxisAngle(up, -(p.rot + lerp(-0.7, 0.7, k)) + Math.PI / 2);
      const s = 0.32 * p.size * (0.8 + k * 0.4);
      slashes.setMatrixAt(ns, m4.compose(v.set(p.x / TS, surface(p.x, p.y) + 0.28 + p.z / TS, p.y / TS), q, sc.set(s, s, s)));
      slashes.setColorAt(ns++, (p.col ? bc.set(p.col) : bc.setRGB(1, 0.97, 0.85)).multiplyScalar((1 - k) * 1.4));
      continue;
    }
    const c = clouds[KIND_CLOUD[p.kind]];
    if (c.n >= CAP) continue;
    // smoke and dust drift upward as they age
    const rise = p.kind === 'smoke' || p.kind === 'trail' ? k * 0.6 : 0;
    c.pos.set([p.x / TS, surface(p.x, p.y) + p.z / TS + 0.08 + rise, p.y / TS], c.n * 3);
    const col = colorOf(p, k);
    c.col.set([col.r, col.g, col.b], c.n * 3);
    c.n++;
  }
  slashes.count = ns;
  slashes.instanceMatrix.needsUpdate = true;
  if (slashes.instanceColor) slashes.instanceColor.needsUpdate = true;
}

/** Units and buildings light up for a moment when struck. */
function updateHits(): void {
  for (const e of G.ents) {
    if (e.dead || e.flash <= 0 || e.kind === 'source' || !shownToPlayer(e)) continue;
    const k = Math.min(1, e.flash / 0.1);
    bc.setRGB(1, 0.55 + 0.35 * k, 0.4 + 0.3 * k).multiplyScalar(k * 0.9);
    addPoint(e.kind === 'bld' ? clouds.bigHit : clouds.hit, e.x / TS, groundY(e.x, e.y) + midHeight(e), e.y / TS, bc);
  }
}

/** Lines from your selected units to their targets. */
function updateAttackLines(): void {
  let n = 0;
  for (const u of V.sel) {
    if (n >= 300) break;
    if (u.dead || u.team !== V.team) continue;
    const t: Ent | null = valid(u.order?.t === 'attack' ? u.order.tgt : null) ?? valid(u.shot);
    if (!t || !shownToPlayer(t)) continue;
    atkPos.set([u.x / TS, surface(u.x, u.y) + 0.1, u.y / TS, t.x / TS, surface(t.x, t.y) + 0.1, t.y / TS], n * 6);
    n++;
  }
  atkLines.geometry.setDrawRange(0, n * 2);
  atkLines.geometry.attributes.position.needsUpdate = true;
}

/** glow colour around each kind of projectile, and the streak behind it: length (tiles), thickness, colour */
const PROJ_GLOW: Record<string, [number, number, number] | null> = { shell: [1, 0.6, 0.2], rocket: [1, 0.5, 0.15], bolt: [0.55, 0.5, 0.4], boulder: null };
const STREAK: Record<string, [number, number, number, number, number]> = {
  shell: [0.6, 0.05, 1, 0.65, 0.25], rocket: [0.5, 0.06, 1, 0.55, 0.2], bolt: [0.55, 0.025, 0.6, 0.55, 0.45], boulder: [0, 0, 0, 0, 0],
};

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
    const x = p.x / TS, y = surface(p.x, p.y) + p.z / TS + 0.1, z = p.y / TS;
    me.position.set(x, y, z);
    me.rotation.set(0, -p.a, 0);
    const g = PROJ_GLOW[p.kind];
    if (g) addPoint(clouds.glow, x, y, z, bc.setRGB(g[0], g[1], g[2]));
    const [len, w, r, gr, b] = STREAK[p.kind];
    if (len) beam(x - Math.cos(p.a) * len, y, z - Math.sin(p.a) * len, x, y, z, w, bc.setRGB(r, gr, b));
    if (p.kind === 'boulder') me.rotation.x = p.tr * 0.05;
  }
  for (const [kind, pool] of Object.entries(projPools)) for (let i = used[kind]; i < pool.length; i++) pool[i].visible = false;
}

const flat = new THREE.Quaternion(), normal = new THREE.Vector3();
/** Point `flat` so that marks lie along the slope at a point (tile coordinates). */
function lie(x: number, z: number): void {
  const [sx, sz] = slopeAt(x, z);
  flat.setFromUnitVectors(up, normal.set(-sx, 1, -sz).normalize());
}

/** Height (tiles) of the ground, or the water where it's deeper, under a world point (px). */
const surface = (x: number, y: number): number => surfaceY(x / TS, y / TS);

function updateDecals(): void {
  const n: Record<string, number> = { scorch: 0, splat: 0, corpse: 0, rubble: 0 };
  let ns = 0, nw = 0, nb = 0;
  for (const d of G.decals) {
    if (!G.vis[Math.floor(d.y / TS) * 64 + Math.floor(d.x / TS)]) continue;
    const fade = Math.min(1, (d.max - d.t) / (d.max * 0.3)), x = d.x / TS, z = d.y / TS, gy = heightAt(x, z);
    lie(x, z);
    if (d.kind === 'wreck') {
      if (nw >= 120) continue;
      const s = (d.r / TS) * 1.7 * fade;
      q.setFromAxisAngle(up, -d.a);
      wrecks.setMatrixAt(nw++, m4.compose(v.set(x, gy + 0.12 * fade, z), q.premultiply(flat), sc.set(s, s * 0.6, s)));
      if (n.scorch < 420) decal.scorch.setMatrixAt(n.scorch++, m4.compose(v.set(x, gy + 0.03, z), flat, sc.setScalar((d.r / TS) * 1.4 * fade)));
      continue;
    }
    const im = decal[d.kind];
    if (n[d.kind] >= 420) continue;
    const r = d.kind === 'splat' ? d.r / TS : d.kind === 'corpse' ? 0.28 : d.kind === 'rubble' ? d.w * 0.6 : d.r / TS;
    im.setMatrixAt(n[d.kind]++, m4.compose(v.set(x, gy + 0.025 + n[d.kind] * 0.00001, z), flat, sc.setScalar(Math.max(0.01, r * fade))));
    if (d.kind === 'corpse' && nb < 420 && d.t < d.max * 0.6) {
      q.setFromAxisAngle(up, -d.a);
      bodies.setMatrixAt(nb++, m4.compose(v.set(x, gy + 0.04, z), q.premultiply(flat), sc.set(1, 1, 1)));
    }
    if (d.kind === 'rubble') {
      const rnd = mulberry32(d.seed);
      for (let i = 0; i < d.w * 6 && ns < 1200; i++) {
        q.setFromAxisAngle(up, rnd() * 6);
        const s = (0.6 + rnd() * 1.4) * fade;
        const sx = x + (rnd() - 0.5) * d.w * 0.9, sz = z + (rnd() - 0.5) * d.w * 0.9;
        stones.setMatrixAt(ns++, m4.compose(v.set(sx, heightAt(sx, sz) + 0.05, sz), q, sc.set(s, s * 0.6, s)));
      }
    }
  }
  for (const [k, im] of Object.entries(decal)) { im.count = n[k]; im.instanceMatrix.needsUpdate = true; }
  stones.count = ns; wrecks.count = nw; bodies.count = nb;
  for (const im of [stones, wrecks, bodies]) im.instanceMatrix.needsUpdate = true;
}

export function updateFx3d(): void {
  for (const c of Object.values(clouds)) c.n = 0;
  nBeam = 0;
  updateParticles();
  updateProjectiles();
  updateHits();
  for (const c of Object.values(clouds)) {
    c.pts.geometry.setDrawRange(0, c.n);
    c.pts.geometry.attributes.position.needsUpdate = true;
    c.pts.geometry.attributes.color.needsUpdate = true;
  }
  beams.count = nBeam;
  beams.instanceMatrix.needsUpdate = true;
  if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
  updateAttackLines();
  updateDecals();
}
