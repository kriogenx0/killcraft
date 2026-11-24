// While a structure is being placed: the ground where it may go, faintly tinted with a thin edge line,
// draped over the hills like the fog sheet. Redrawn only when the zone changes.
import * as THREE from 'three';
import { MW, MH } from '../../../game/const.ts';
import { buildZone } from '../../../game/building.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';
import { V } from '../view_state.ts';
import { shapedPlane } from './world3d.ts';

/** Canvas pixels per tile: enough for a crisp edge line without a big texture on phones. */
const PX = 8;
/** How often (seconds) the zone is worked out again while placing: buildings and sight change slowly. */
const EVERY = 0.25;

let mesh: THREE.Mesh | null = null;
let tex: THREE.CanvasTexture | null = null;
let canvas: HTMLCanvasElement | null = null;
const zone = new Uint8Array(MW * MH), last = new Uint8Array(MW * MH);
let lastKey = '', wait = 0;

/** Add the (hidden) zone sheet to the world layer; called when the map is built. */
export function initBuildZone(layer: THREE.Group): void {
  canvas = mkCanvas(MW * PX, MH * PX);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  mesh = new THREE.Mesh(shapedPlane(0.07, true), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  mesh.renderOrder = 2.5; // over the fog, under the ghost's own tiles
  mesh.visible = false;
  layer.add(mesh);
  lastKey = '';
}

function draw(): void {
  const g = ctx2d(canvas!);
  g.clearRect(0, 0, canvas!.width, canvas!.height);
  // kept quiet on purpose (Alex found a bright wash too much): a faint tint on open ground in reach,
  // nothing on rock, water or trees, and a thin, soft edge line
  g.fillStyle = 'rgba(220,255,220,0.06)';
  for (let i = 0; i < MW * MH; i++) if (zone[i] === 2) g.fillRect((i % MW) * PX, ((i / MW) | 0) * PX, PX, PX);
  g.fillStyle = 'rgba(225,255,225,0.45)';
  const W = 1, out = (x: number, y: number) => x < 0 || y < 0 || x >= MW || y >= MH || !zone[y * MW + x];
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      if (!zone[y * MW + x]) continue;
      const px = x * PX, py = y * PX;
      if (out(x - 1, y)) g.fillRect(px, py, W, PX);
      if (out(x + 1, y)) g.fillRect(px + PX - W, py, W, PX);
      if (out(x, y - 1)) g.fillRect(px, py, PX, W);
      if (out(x, y + 1)) g.fillRect(px, py + PX - W, PX, W);
    }
  tex!.needsUpdate = true;
}

/** Show, refresh or hide the zone for the structure being placed. Call once per frame. */
export function updateBuildZone(dt: number): void {
  if (!mesh) return;
  const m = V.mode;
  if (m?.t !== 'place') { mesh.visible = false; lastKey = ''; return; }
  mesh.visible = true;
  const key = `${m.type}|${V.team}`;
  wait -= dt;
  if (key === lastKey && wait > 0) return;
  wait = EVERY;
  buildZone(m.type, V.team, zone);
  if (key === lastKey && zone.every((v, i) => v === last[i])) return;
  last.set(zone);
  lastKey = key;
  draw();
}
