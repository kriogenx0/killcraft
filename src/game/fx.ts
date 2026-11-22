// Particles and ground decals. Simulated here so they age with game time; drawn by the view.
import { G, tileOf, type FxKind, type Particle } from './state.ts';
import { MW } from './const.ts';
import { lerp, TAU } from '../util/math.ts';

const MAX_PARTICLES = 1200;
const MAX_DECALS = 400;
const GRAVITY: Partial<Record<FxKind, number>> = { blood: 500, chip: 500, debris: 600, spark: 300, ore: 400 };

const visible = (x: number, y: number) => G.vis[tileOf(y) * MW + tileOf(x)] === 2;

export function part(kind: FxKind, x: number, y: number, o: Partial<Particle> = {}): void {
  if (G.headless || G.fx.length > MAX_PARTICLES) return;
  G.fx.push({ kind, x, y, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 2, col: null, rot: Math.random() * TAU, soft: false, landed: false, ex: x, ey: y, ...o });
}

/** A spray of particles; skipped where the player can't see. */
export function burst(kind: FxKind, x: number, y: number, n: number, v0: number, v1: number, col: string | null = null): void {
  if (!visible(x, y)) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = lerp(v0, v1, Math.random()) * 0.5;
    part(kind, x, y, {
      vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, vz: v * (0.6 + Math.random() * 0.8),
      z: kind === 'debris' ? 6 : 4,
      max: kind === 'dust' ? 0.8 + Math.random() * 0.5 : 0.5 + Math.random() * 0.5,
      size: kind === 'debris' ? 2 + Math.random() * 3 : kind === 'dust' ? 4 + Math.random() * 4 : 1.5 + Math.random() * 1.5,
      col,
    });
  }
}

/** Fireball, smoke, flying debris and a scorch mark. `size` is roughly the blast radius in px. */
export function explosion(x: number, y: number, size: number): void {
  if (G.headless) return;
  G.decals.push({ kind: 'scorch', x, y, t: 0, max: 30, team: -1, seed: 0, w: 0, r: size * 0.8, a: 0 });
  if (!visible(x, y)) return;
  part('flash', x, y, { max: 0.15, size: size * 2.2 });
  const n = Math.round(4 + size / 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, d = Math.random() * size * 0.5;
    part('fire', x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, { vz: 20 + Math.random() * 50, max: 0.4 + Math.random() * 0.4, size: size * (0.35 + Math.random() * 0.3) });
    part('smoke', x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, { vz: 15 + Math.random() * 25, max: 1.5 + Math.random() * 1.5, size: size * (0.3 + Math.random() * 0.25), z: 6 });
  }
  burst('debris', x, y, Math.round(size / 2), 80, 220);
}

/** A shimmer where a unit enters or leaves a portal. */
export function warpFx(x: number, y: number): void {
  if (G.headless || !visible(x, y)) return;
  part('flash', x, y, { max: 0.25, size: 26, col: '#b48cff' });
  burst('spark', x, y, 10, 40, 140, '#c9a8ff');
}

/** A heavy rock landing: dust, flying stones and a dent in the ground, no fire. */
export function impact(x: number, y: number, size: number): void {
  if (G.headless) return;
  G.decals.push({ kind: 'scorch', x, y, t: 0, max: 20, team: -1, seed: 0, w: 0, r: size * 0.6, a: 0 });
  burst('dust', x, y, Math.round(size / 2), 40, 120);
  burst('debris', x, y, Math.round(size / 3), 80, 200, '#6e665c');
}

export function updFx(dt: number): void {
  for (const p of G.fx) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    const g = GRAVITY[p.kind];
    if (g) {
      p.vz -= g * dt;
      if (p.z <= 0) {
        p.z = 0; p.vz = 0; p.vx *= 0.6; p.vy *= 0.6;
        if (p.kind === 'blood' && !p.landed) {
          p.landed = true;
          if (Math.random() < 0.35) G.decals.push({ kind: 'splat', x: p.x, y: p.y, t: 0, max: 14, team: -1, seed: 0, w: 0, r: 1.5 + Math.random() * 2, a: 0 });
        }
      }
    } else {
      p.vx *= 0.98;
      p.vy *= 0.98;
    }
  }
  G.fx = G.fx.filter((p) => p.life < p.max);
  for (const d of G.decals) d.t += dt;
  G.decals = G.decals.filter((d) => d.t < d.max);
  if (G.decals.length > MAX_DECALS) G.decals.splice(0, G.decals.length - MAX_DECALS);
}
