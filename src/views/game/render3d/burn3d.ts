// Fire, all of it: burning buildings, units set alight by fire weapons, the Dragon's and Chimera's
// breath, fireballs and meteors in flight and where they land, and the flames of every explosion.
//
// Flames are camera-facing sprites shaded in the fragment shader: a flickering tongue of fire whose
// edge is eaten by scrolling noise, white-yellow at the core cooling to orange and deep red at the
// tips as it rises. Round them float embers and a soft glow that lights the ground and walls, and the
// smoke above starts lit orange from below before it darkens and billows. Buildings below 60% health
// smoke, below 35% catch fire, below 15% blaze. Purely visual, run by the view, so it also shows for
// online players. One fixed pool of particles drawn in two draw calls; on a slow device the fires
// thin out rather than costing frames.
import * as THREE from 'three';
import { G, altOf, unitDef, type Ent, type Projectile as Proj } from '../../../game/state.ts';
import { MW, TS } from '../../../game/const.ts';
import { TREE_BURN } from '../../../data/wildfire.ts';
import { seenAt } from '../../../game/fog.ts';
import { burning } from '../../../game/spells.ts';
import { WEAPON } from '../../../data/weapon.ts';
import { hash } from '../../../util/math.ts';
import { S, frameTime, qualityLevel } from './scene.ts';
import { footprintY, groundY, surfaceY } from './heights.ts';
import { modelHeight, ventsOf } from './entities3d.ts';
import { shownToPlayer } from '../render/minimap.ts';

export const SMOKE_AT = 0.6, FIRE_AT = 0.35, BLAZE_AT = 0.15;
const CAP = 1800;

// particle kinds: flames and their light are drawn in one pool, smoke and steam in the other
const FLAME = 0, SMOKE = 1, BLACK = 2, STEAM = 3, CHIMNEY = 4, EMBER = 5, GLOW = 6;
const isFlame = (k: number): boolean => k === FLAME || k === EMBER || k === GLOW;

interface Pool { pts: THREE.Points; pos: Float32Array; col: Float32Array; size: Float32Array; misc: Float32Array; n: number }

const VERT = `
  attribute vec4 aColor; attribute float aSize; attribute vec4 aMisc; uniform float uScale;
  varying vec4 vColor; varying vec4 vMisc;
  void main() {
    vColor = aColor; vMisc = aMisc;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const NOISE = `
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;

// vMisc: x = shape (0 flame, 1 ember, 2 glow), y = random seed, z = age 0..1
const FLAME_FRAG = `
  uniform float uTime;
  varying vec4 vColor; varying vec4 vMisc;
  ${NOISE}
  void main() {
    vec2 uv = gl_PointCoord - 0.5; uv.y = -uv.y;
    float seed = vMisc.y, k = vMisc.z;
    if (vMisc.x > 1.5) { // glow: the light a fire throws on what's round it
      float g = exp(-dot(uv, uv) * 14.0);
      gl_FragColor = vec4(vColor.rgb * g * vColor.a, 0.0);
      return;
    }
    if (vMisc.x > 0.5) { // ember: a hot spark that twinkles
      float g = exp(-dot(uv, uv) * 60.0), tw = 0.55 + 0.45 * sin(uTime * 23.0 + seed * 61.0);
      gl_FragColor = vec4(vec3(1.0, 0.62, 0.22) * g * tw * vColor.a * 2.2, 0.0);
      return;
    }
    // a tongue of flame: noise scrolls up through it, bending the tip and tearing ragged edges
    float t = uTime * 2.2 + seed * 13.0;
    float n = noise(vec2(uv.x * 3.5 + seed * 7.0, uv.y * 3.0 - t * 1.7)) * 0.65
            + noise(vec2(uv.x * 7.5 - seed * 3.0, uv.y * 6.5 - t * 3.1)) * 0.35;
    float up = clamp(uv.y + 0.5, 0.0, 1.0);
    vec2 p = uv;
    p.x += (n - 0.5) * 0.34 * up + sin(t * 1.3 + uv.y * 5.0) * 0.04 * up;
    // a teardrop: round at the base, drawn up to a point
    float wid = mix(0.34, 0.06, smoothstep(-0.25, 0.48, p.y));
    float d = length(vec2(p.x / wid, (p.y + 0.12) / (p.y < -0.12 ? 0.3 : 0.62)));
    float heat = (1.0 - d) * 1.3 - (n - 0.5) * 0.9 - k * 0.3;
    if (heat <= 0.0) discard;
    // blackbody ramp: deep red, then orange and yellow, then white at the hottest core
    vec3 c = clamp(vec3(heat * 2.4, heat * 2.4 - 0.75, heat * 2.4 - 1.7), 0.0, 1.0);
    c = mix(c, c * vColor.rgb * 1.6, 0.55);
    float a = smoothstep(0.0, 0.22, heat) * vColor.a;
    // mostly light, a little body: overlapping flames build up but don't wash out to white
    gl_FragColor = vec4(c * a * 1.35, a * 0.2);
  }`;

const SMOKE_FRAG = `
  uniform float uTime;
  varying vec4 vColor; varying vec4 vMisc;
  ${NOISE}
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float seed = vMisc.y, k = vMisc.z, r = seed * 6.283;
    vec2 q = mat2(cos(r), -sin(r), sin(r), cos(r)) * uv;
    float n = noise(q * 3.2 + seed * 17.0 + vec2(0.0, uTime * 0.25)) * 0.6 + noise(q * 7.0 - seed * 5.0) * 0.4;
    float d = length(uv) * 2.0 + (n - 0.5) * 0.7;
    float a = smoothstep(1.0, 0.25, d) * vColor.a;
    if (a < 0.004) discard;
    // billows: lighter on the bulges, darker in the folds
    gl_FragColor = vec4(vColor.rgb * (0.72 + n * 0.55), a);
  }`;

const uScale = { value: 400 }, uTime = { value: 0 };
function pool(flames: boolean, order: number): Pool {
  const pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 4), size = new Float32Array(CAP), misc = new Float32Array(CAP * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aMisc', new THREE.BufferAttribute(misc, 4));
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: flames ? FLAME_FRAG : SMOKE_FRAG, uniforms: { uScale, uTime }, transparent: true, depthWrite: false,
    // flames are premultiplied: mostly added light, with a little cover
    ...(flames ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor } : { blending: THREE.NormalBlending }),
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = order;
  return { pts, pos, col, size, misc, n: 0 };
}

// particle state, struct-of-arrays
const px = new Float32Array(CAP), py = new Float32Array(CAP), pz = new Float32Array(CAP);
const vx = new Float32Array(CAP), vy = new Float32Array(CAP), vz = new Float32Array(CAP);
const age = new Float32Array(CAP), life = new Float32Array(CAP), base = new Float32Array(CAP), seed = new Float32Array(CAP);
const kind = new Uint8Array(CAP), tint = new Uint8Array(CAP);
let count = 0;
const flames = pool(true, 6), smoke = pool(false, 5);
const group = new THREE.Group();
group.add(smoke.pts, flames.pts);
const debt = new Map<number, number>();

// flame tints: plain fire, the Dragon's hotter red, the Phoenix's gold
const TINTS = [[1, 0.62, 0.3], [1, 0.42, 0.2], [1, 0.8, 0.38]];
const TINT_OF: Partial<Record<string, number>> = { dragonfire: 1, phoenixfire: 2 };

/** How much fire this device can afford: fewer particles when frames run slow, and on phones. */
let budget = 1;
const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function emit(k: number, x: number, y: number, z: number, s: number, life0 = 0, tn = 0): number {
  if (count >= CAP) return -1;
  const i = count++, r = Math.random;
  px[i] = x + (r() - 0.5) * 0.12; py[i] = y; pz[i] = z + (r() - 0.5) * 0.12;
  vx[i] = (r() - 0.5) * 0.15; vz[i] = (r() - 0.5) * 0.15;
  age[i] = 0;
  seed[i] = r();
  tint[i] = tn;
  if (k === FLAME) { vy[i] = 0.55 + r() * 0.5; life[i] = 0.4 + r() * 0.35; }
  else if (k === EMBER) { vx[i] = (r() - 0.5) * 0.5; vz[i] = (r() - 0.5) * 0.5; vy[i] = 0.6 + r() * 0.9; life[i] = 1 + r() * 1.4; }
  else if (k === GLOW) { vx[i] = vz[i] = 0; vy[i] = 0; life[i] = 0.18 + r() * 0.12; }
  else if (k >= STEAM) { const j = k === STEAM ? 0.2 : 0.05; px[i] = x + (r() - 0.5) * j; pz[i] = z + (r() - 0.5) * j; vy[i] = 0.55 + r() * 0.25; life[i] = 1.8 + r(); }
  else { vx[i] += 0.12; vz[i] += 0.05; vy[i] = 0.45 + r() * 0.3; life[i] = 2.2 + r() * 1.6; }
  if (life0) life[i] = life0 * (0.8 + r() * 0.4);
  base[i] = s * (0.7 + r() * 0.6);
  kind[i] = k;
  return i;
}

/** Where on a building fire breaks out: fixed spots on its roof, then down its walls as it burns. */
function hotspots(e: Ent, n: number, out: [number, number, number][]): void {
  out.length = 0;
  const foot = footprintY(e.tx, e.ty, e.w, e.h), top = foot + modelHeight(e);
  for (let k = 0; k < n; k++) {
    const a = hash(e.id * 1.7 + k * 3.1, k + 0.5), b = hash(k * 2.3 + 1, e.id * 0.9);
    const hgt = k < 3 ? 0.6 + hash(e.id, k * 5.7) * 0.35 : 0.2 + hash(e.id, k * 5.7) * 0.4;
    out.push([e.tx + e.w * (0.15 + a * 0.7), foot + (top - foot) * hgt, e.ty + e.h * (0.15 + b * 0.7)]);
  }
}

const spots: [number, number, number][] = [];

function ignite(e: Ent, dt: number): void {
  const f = e.hp / e.maxhp;
  if (f >= SMOKE_AT) { debt.delete(e.id); return; }
  const size = Math.sqrt(e.w * e.h), heat = 1 - f / SMOKE_AT; // 0 at 60% health, 1 at death
  const fire = f < FIRE_AT, blaze = f < BLAZE_AT, burn = fire ? 1 - f / FIRE_AT : 0;
  hotspots(e, blaze ? 7 : fire ? 3 : 1, spots);
  // particles per second, spread over the hotspots
  const smokeRate = (2 + heat * 9) * size * budget, flameRate = fire ? (22 + burn * 60) * size * budget : 0;
  let d = (debt.get(e.id) ?? 0) + dt;
  const step = 1 / (smokeRate + flameRate);
  while (d >= step) {
    d -= step;
    const [x, y, z] = spots[(Math.random() * spots.length) | 0];
    if (Math.random() * (smokeRate + flameRate) < flameRate) {
      const r = Math.random();
      if (r < 0.06) emit(EMBER, x, y + 0.1, z, 0.05);
      else if (r < 0.14) emit(GLOW, x, y + 0.1, z, 1.2 + burn * 1.2);
      else emit(FLAME, x, y, z, 0.3 + burn * 0.32, blaze ? 0.55 : 0);
    } else emit(fire ? BLACK : SMOKE, x, y + (fire ? 0.35 + burn * 0.3 : 0), z, 0.42 + heat * 0.4);
  }
  debt.set(e.id, Math.min(d, 0.25));
}

const steamDebt = new Map<number, number>(), at = new THREE.Vector3();

/** Steam rising from the tops of cooling towers and chimneys (model parts named vent0, vent1...). */
function vent(e: Ent, dt: number): void {
  const vents = ventsOf(e);
  if (!vents.length) return;
  let d = (steamDebt.get(e.id) ?? 0) + dt;
  const step = 1 / (5 * vents.length);
  for (; d >= step; d -= step) {
    const v = vents[(Math.random() * vents.length) | 0];
    v.at.getWorldPosition(at);
    emit(v.smoke ? CHIMNEY : STEAM, at.x, at.y, at.z, v.smoke ? 0.22 : 0.45);
  }
  steamDebt.set(e.id, Math.min(d, 0.25));
}

/** A unit set alight by a fire weapon: flames lick up its body, with embers and a wisp of smoke. */
function unitOnFire(e: Ent, dt: number): void {
  const r = unitDef(e).radius / TS, bottom = groundY(e.x, e.y) + altOf(e) / TS, h = Math.max(0.3, modelHeight(e) - altOf(e) / TS);
  const scale = Math.min(1.6, 0.6 + r * 1.6), rate = 22 * scale * budget;
  let d = (debt.get(e.id) ?? 0) + dt;
  const step = 1 / rate;
  for (; d >= step; d -= step) {
    const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * r * 0.7;
    const x = e.x / TS + Math.cos(a) * rr, z = e.y / TS + Math.sin(a) * rr, y = bottom + h * (0.15 + Math.random() * 0.6), q = Math.random();
    if (q < 0.07) emit(EMBER, x, y, z, 0.04);
    else if (q < 0.15) emit(SMOKE, x, bottom + h + 0.1, z, 0.22 * scale, 1.4);
    else if (q < 0.21) emit(GLOW, x, y, z, 0.55 * scale);
    else emit(FLAME, x, y, z, 0.17 * scale + 0.05, 0.35);
  }
  debt.set(e.id, Math.min(d, 0.25));
}

const treeDebt = new Map<number, number>();

/** A tree on fire (game/wildfire.ts): flames climb its crown, then sink to the stump as it burns away. */
function treeOnFire(i: number, dt: number): void {
  const tx = i % MW, ty = (i / MW) | 0, x0 = tx + 0.5, z0 = ty + 0.5, bottom = groundY(x0 * TS, z0 * TS);
  const left = Math.min(1, G.treeFire[i] / TREE_BURN), h = 0.35 + 1.0 * left, rate = (24 + 16 * left) * budget;
  let d = (treeDebt.get(i) ?? 0) + dt;
  const step = 1 / rate;
  for (; d >= step; d -= step) {
    const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * 0.3;
    const x = x0 + Math.cos(a) * rr, z = z0 + Math.sin(a) * rr, y = bottom + h * (0.1 + Math.random() * 0.75), q = Math.random();
    if (q < 0.08) emit(EMBER, x, y, z, 0.05);
    else if (q < 0.18) emit(BLACK, x, bottom + h + 0.2, z, 0.4, 2.4);
    else if (q < 0.27) emit(GLOW, x, y, z, 1.1);
    else emit(FLAME, x, y, z, 0.3 + 0.22 * left, 0.55);
  }
  treeDebt.set(i, Math.min(d, 0.25));
}

/** what a flying fire shot leaves behind it: flame size, flames per tile, black smoke per tile, and how far its flames are flung */
interface Flight { size: number; dens: number; smoke: number; spread: number; gout: boolean }
const FLIGHT: Partial<Record<string, Flight>> = {
  fireball: { size: 0.3, dens: 26, smoke: 2, spread: 0.25, gout: false },
  meteor: { size: 0.75, dens: 30, smoke: 10, spread: 0.6, gout: false },
  dragonfire: { size: 0.62, dens: 70, smoke: 3, spread: 1.2, gout: true },
  chimerafire: { size: 0.38, dens: 60, smoke: 1, spread: 0.8, gout: true },
  phoenixfire: { size: 0.34, dens: 55, smoke: 0.5, spread: 0.6, gout: true },
  flamethrower: { size: 0.2, dens: 90, smoke: 1.5, spread: 0.5, gout: true },
  impfire: { size: 0.22, dens: 30, smoke: 0.5, spread: 0.2, gout: false },
  drakefire: { size: 0.45, dens: 60, smoke: 2, spread: 0.9, gout: true },
};

/** Is this projectile a ball or gout of fire (drawn here instead of as a glowing orb)? */
export const fiery = (p: Proj): boolean => p.kind === 'orb' && !!FLIGHT[p.weapon] && WEAPON[p.weapon as keyof typeof WEAPON]?.element === 'fire';

/** each fire shot's last spot (tiles) and what it was, so it can burst into flame where it lands */
const flying = new Map<Proj, { x: number; y: number; z: number; w: string }>(), live = new Set<Proj>();

function inFlight(p: Proj, dt: number): void {
  const f = FLIGHT[p.weapon]!, tn = TINT_OF[p.weapon] ?? 0;
  const x = p.x / TS, y = surfaceY(x, p.y / TS) + p.z / TS + 0.1, z = p.y / TS;
  const last = flying.get(p);
  const dx = last ? x - last.x : 0, dy = last ? y - last.y : 0, dz = last ? z - last.z : 0, len = Math.hypot(dx, dy, dz);
  const sp = dt > 0 ? len / dt : 0;
  // the head: a knot of the hottest flame
  if (dt > 0) {
    for (let j = 0; j < 2; j++) { const i = emit(FLAME, x, y - f.size * 0.25, z, f.size * 1.1, 0.16, tn); if (i >= 0) vy[i] = 0.4; }
    emit(GLOW, x, y, z, f.size * 4, 0.12, tn);
  }
  // the trail: flames spawned all along the stretch it covered this frame, so it reads as a stream
  const n = Math.min(60, Math.round(len * f.dens * budget + Math.random()));
  for (let j = 0; j < n; j++) {
    const t = Math.random();
    const ax = x - dx * t, ay = y - dy * t, az = z - dz * t;
    if (f.gout) {
      // breath: a gout of fire that keeps flying forward and spreads as it goes
      const i = emit(FLAME, ax, ay - f.size * 0.3, az, f.size * (0.7 + Math.random() * 0.6), 0.5, tn);
      if (i >= 0 && sp > 0) {
        const fw = 0.25 + Math.random() * 0.35;
        vx[i] = (dx / dt) * fw + (Math.random() - 0.5) * f.spread; vz[i] = (dz / dt) * fw + (Math.random() - 0.5) * f.spread;
        vy[i] = (dy / dt) * fw + 0.3 + Math.random() * 0.4;
      }
    } else {
      emit(FLAME, ax, ay - f.size * 0.3, az, f.size * (0.55 + (1 - t) * 0.4), 0.3, tn);
    }
    if (Math.random() < 0.12) emit(EMBER, ax, ay, az, 0.04, 0, tn);
  }
  for (let j = Math.min(10, Math.round(len * f.smoke * budget + Math.random() * 0.6)); j > 0; j--) {
    const t = Math.random();
    emit(BLACK, x - dx * t, y - dy * t + f.size * 0.3, z - dz * t, f.size * 1.4, 1.4);
  }
  flying.set(p, { x, y, z, w: p.weapon });
}

/** A fire shot bursts where it lands: a ball of flame, embers flung out, and smoke rolling up. */
function landed(x: number, y: number, z: number, w: string): void {
  const sp = WEAPON[w as keyof typeof WEAPON]?.splash ?? 16, r = sp / TS, tn = TINT_OF[w] ?? 0;
  const n = Math.round((8 + sp * 0.9) * budget);
  emit(GLOW, x, y + 0.2, z, r * 5, 0.45, tn);
  for (let j = 0; j < n; j++) {
    const a = Math.random() * 6.283, d = Math.random() * r * 0.7;
    const i = emit(FLAME, x + Math.cos(a) * d * 0.3, y, z + Math.sin(a) * d * 0.3, r * (0.5 + Math.random() * 0.6) + 0.15, 0.45 + Math.random() * 0.4, tn);
    if (i >= 0) { const v = 0.6 + Math.random() * 1.6; vx[i] = Math.cos(a) * v * r; vz[i] = Math.sin(a) * v * r; vy[i] = 0.4 + Math.random() * 0.9; }
  }
  for (let j = Math.round(n * 0.5); j > 0; j--) {
    const i = emit(EMBER, x, y + 0.1, z, 0.05, 0, tn);
    if (i >= 0) { const a = Math.random() * 6.283, v = 0.8 + Math.random() * 2.2; vx[i] = Math.cos(a) * v; vz[i] = Math.sin(a) * v; vy[i] = 1 + Math.random() * 2.5; }
  }
  for (let j = Math.round(n * 0.25); j > 0; j--) emit(SMOKE, x + (Math.random() - 0.5) * r, y + 0.6 + Math.random() * 0.4, z + (Math.random() - 0.5) * r, r + 0.25, 1.6);
}

const color = new THREE.Color();

/** Advance the fires by dt seconds (0 when paused: they freeze) and refresh the sprites. */
export function updateBurning(dt: number): void {
  const ms = frameTime();
  // fewer flames and less smoke at the lower graphics levels too (scene.ts), so they don't climb straight back
  budget = (touch ? 0.7 : 1) * (ms > 45 ? 0.35 : ms > 30 ? 0.6 : 1) * [1, 0.85, 0.65, 0.45][qualityLevel()];
  if (dt > 0) {
    uTime.value += dt;
    for (const e of G.ents) {
      if (e.dead) continue;
      if (e.kind === 'bld') { if (e.done && e.hp > 0 && seenAt(e.x, e.y)) { ignite(e, dt); vent(e, dt); } }
      else if (e.kind === 'unit' && burning(e) && shownToPlayer(e)) unitOnFire(e, dt);
      else if (debt.has(e.id)) debt.delete(e.id);
    }
    for (const i of G.wildfire?.burning ?? []) if (seenAt(((i % MW) + 0.5) * TS, (((i / MW) | 0) + 0.5) * TS)) treeOnFire(i, dt);
    if (treeDebt.size > 64) treeDebt.clear();
    live.clear();
    for (const p of G.projs) if (fiery(p) && seenAt(p.x, p.y)) { live.add(p); inFlight(p, dt); }
    for (const [p, l] of flying) if (!live.has(p)) { flying.delete(p); if (!G.projs.includes(p)) landed(l.x, l.y, l.z, l.w); }
    for (let i = 0; i < count; i++) {
      age[i] += dt;
      if (age[i] >= life[i]) { // swap-remove
        const j = --count;
        px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
        age[i] = age[j]; life[i] = life[j]; base[i] = base[j]; kind[i] = kind[j]; seed[i] = seed[j]; tint[i] = tint[j];
        i--;
        continue;
      }
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      const k = kind[i];
      if (k === FLAME) { const drag = 1 - 3 * dt; vx[i] *= drag; vz[i] *= drag; vy[i] += 0.9 * dt; } // flung flames slow, then rise
      else if (k === EMBER) { // embers ride the hot air, swirling
        vx[i] = vx[i] * (1 - 1.2 * dt) + (Math.random() - 0.5) * 3 * dt + 0.08 * dt;
        vz[i] = vz[i] * (1 - 1.2 * dt) + (Math.random() - 0.5) * 3 * dt;
        vy[i] = vy[i] * (1 - 1.5 * dt) + 0.5 * dt;
      } else if (k !== GLOW) { vx[i] += 0.05 * dt; vy[i] *= 1 - 0.25 * dt; } // smoke drifts downwind and slows
    }
  }
  flames.n = smoke.n = 0;
  for (let i = 0; i < count; i++) {
    const k = age[i] / life[i], kd = kind[i], p = isFlame(kd) ? flames : smoke, n = p.n++;
    p.pos[n * 3] = px[i]; p.pos[n * 3 + 1] = py[i]; p.pos[n * 3 + 2] = pz[i];
    let a: number, s: number;
    if (kd === FLAME) {
      const t = TINTS[tint[i]];
      color.setRGB(t[0], t[1], t[2]);
      a = Math.min(1, k * 8) * (1 - k * k); s = base[i] * (0.75 + k * 0.5 - k * k * 0.6); // swells, then gutters out
    } else if (kd === EMBER) {
      color.setRGB(1, 0.6, 0.2);
      a = (1 - k) * (k > 0.7 ? 0.6 : 1); s = base[i];
    } else if (kd === GLOW) {
      const t = TINTS[tint[i]];
      color.setRGB(t[0] * 0.9, t[1] * 0.55, t[2] * 0.35);
      a = Math.sin(k * Math.PI) * 0.9 * (0.8 + Math.random() * 0.4); s = base[i];
    } else {
      // fire's smoke starts lit orange from below, then cools to soot; plain smoke stays grey
      const g = kd === STEAM ? 0.92 : kd === CHIMNEY ? 0.55 + k * 0.2 : kd === BLACK ? 0.16 + k * 0.18 : 0.45 + k * 0.15;
      const lit = kd === BLACK ? Math.max(0, 1 - k * 5) : 0;
      color.setRGB(g + lit * 0.55, g + lit * 0.2, g * 0.96, THREE.SRGBColorSpace);
      a = Math.min(1, k * 6) * (1 - k) * (kd === BLACK ? 0.5 : kd >= STEAM ? 0.4 : 0.5); s = base[i] * (1 + k * 2.2);
    }
    p.col[n * 4] = color.r; p.col[n * 4 + 1] = color.g; p.col[n * 4 + 2] = color.b; p.col[n * 4 + 3] = a;
    p.misc[n * 4] = kd === EMBER ? 1 : kd === GLOW ? 2 : 0; p.misc[n * 4 + 1] = seed[i]; p.misc[n * 4 + 2] = k;
    p.size[n] = s;
  }
  // the flames of explosions (game/fx.ts 'fire' particles) are drawn as real fire too
  for (const q of G.fx) {
    if (q.kind !== 'fire' || flames.n >= CAP || !seenAt(q.x, q.y)) continue;
    const k = q.life / q.max, n = flames.n++, x = q.x / TS, z = q.y / TS;
    flames.pos[n * 3] = x; flames.pos[n * 3 + 1] = surfaceY(x, z) + q.z / TS + 0.05; flames.pos[n * 3 + 2] = z;
    flames.col.set([1, 0.62, 0.3, Math.min(1, k * 10) * (1 - k * k)], n * 4);
    flames.misc.set([0, (q.rot * 0.159) % 1, k * 0.8, 0], n * 4);
    flames.size[n] = (q.size / TS) * (1.6 + k * 0.6);
  }
  for (const p of [flames, smoke]) {
    const g = p.pts.geometry;
    g.setDrawRange(0, p.n);
    for (const a of ['position', 'aColor', 'aSize', 'aMisc']) g.attributes[a].needsUpdate = true;
  }
  // sprite size in world units -> pixels at distance 1
  uScale.value = S.renderer.domElement.height * 0.5 * S.camera.projectionMatrix.elements[5];
}

export function initBurning(): void {
  count = 0;
  debt.clear();
  steamDebt.clear();
  flying.clear();
  S.scene.remove(group);
  S.scene.add(group);
}
