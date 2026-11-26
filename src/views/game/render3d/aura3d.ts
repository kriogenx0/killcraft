// A glowing aura over a fallen creature (Alex, 2026-11-26): a wild creature beaten down until it
// kneels will rise again, and a creature captured from a lair that died comes back to its lair a
// minute later. Both show a soft golden glow on the ground and a column of light, so the player
// can see it isn't gone for good. (Its health bar stays hidden meanwhile: overlay.ts.)
import * as THREE from 'three';
import { G, type Ent } from '../../../game/state.ts';
import { MW, TS } from '../../../game/const.ts';
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { mkCanvas, ctx2d } from '../../../util/canvas.ts';
import { surfaceY } from './heights.ts';

/** How far the glow reaches past the creature's own footprint (tiles), and how tall the light stands. */
const PAD = 0.45, TALL = 2.2;
/** Seconds for one slow breath of the glow. */
const BREATH = 2.4;

let disc: THREE.CanvasTexture | null = null, beam: THREE.CanvasTexture | null = null;

function gradient(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = mkCanvas(w, h);
  paint(ctx2d(c));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The ground glow: bright in the middle, a brighter ring near the edge, fading out. */
function discTex(): THREE.CanvasTexture {
  return (disc ??= gradient(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,236,150,0.8)');
    r.addColorStop(0.55, 'rgba(255,205,90,0.35)');
    r.addColorStop(0.8, 'rgba(255,215,100,0.75)');
    r.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }));
}

/** The column of light: strongest at its foot, gone at the top. */
function beamTex(): THREE.CanvasTexture {
  return (beam ??= gradient(4, 64, (g) => {
    const l = g.createLinearGradient(0, 64, 0, 0);
    l.addColorStop(0, 'rgba(255,225,130,0.6)');
    l.addColorStop(0.35, 'rgba(255,215,110,0.25)');
    l.addColorStop(1, 'rgba(255,210,100,0)');
    g.fillStyle = l;
    g.fillRect(0, 0, 4, 64);
  }));
}

const discGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);

interface Aura { group: THREE.Group; disc: THREE.Mesh; beam: THREE.Mesh; mats: THREE.MeshBasicMaterial[] }
const pool: Aura[] = [];

function make(layer: THREE.Group): Aura {
  const glow = (map: THREE.Texture) => new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const dm = glow(discTex()), bm = glow(beamTex());
  const d = new THREE.Mesh(discGeo, dm), b = new THREE.Mesh(beamGeo, bm);
  d.renderOrder = b.renderOrder = 3;
  const group = new THREE.Group().add(d, b);
  layer.add(group);
  return { group, disc: d, beam: b, mats: [dm, bm] };
}

/** The glow's radius (tiles) for a creature of this kind. */
const size = (type: string): number => (UNIT[type as UnitType]?.radius ?? 12) / TS * 1.6 + PAD;

/** Is this creature down and going to get up again? */
export const fallenCreature = (e: Ent): boolean => !!e.wild?.down;

/** Forget the pool (the layer was cleared with the rest of the scene). */
export function resetAuras(): void { pool.length = 0; }

/**
 * Place an aura on each kneeling creature the player can see, and on each lair waiting for its
 * creature to come back. `seen(e)` says whether the creature's model is on screen.
 */
export function updateAuras(layer: THREE.Group, seen: (e: Ent) => boolean): void {
  const spots: { x: number; z: number; r: number; seed: number }[] = [];
  for (const e of G.ents) {
    if (e.dead || !fallenCreature(e) || !seen(e)) continue;
    spots.push({ x: e.x / TS, z: e.y / TS, r: size(e.type as string), seed: e.id });
  }
  for (const [i, r] of G.respawns.entries()) {
    const x = r.x / TS, z = r.y / TS;
    if (!G.vis[Math.floor(z) * MW + Math.floor(x)]) continue;
    spots.push({ x, z, r: size(r.type), seed: i * 7 + 3 });
  }
  const now = performance.now() / 1000;
  spots.forEach((s, i) => {
    const a = (pool[i] ??= make(layer));
    a.group.visible = true;
    a.group.position.set(s.x, surfaceY(s.x, s.z) + 0.05, s.z);
    const breath = 0.5 + 0.5 * Math.sin((now / BREATH + s.seed * 0.37) * Math.PI * 2);
    a.disc.scale.setScalar(s.r * (0.92 + 0.1 * breath));
    a.disc.rotation.y = now * 0.3;
    a.beam.scale.set(s.r * 0.8, TALL * (0.85 + 0.15 * breath), s.r * 0.8);
    a.mats[0].opacity = 0.75 + 0.25 * breath;
    a.mats[1].opacity = 0.55 + 0.35 * breath;
  });
  for (let i = spots.length; i < pool.length; i++) pool[i].group.visible = false;
}
