// The radar minimap, the fog-of-war image it shares with the 3D view, and who-can-see-what.
import { G, hooks, tileOf, type Ent } from '../../../game/state.ts';
import { MW, MH, TS } from '../../../game/const.ts';
import { exploredAt, seenAt } from '../../../game/fog.ts';
import { teamColors } from '../../../data/team.ts';
import { TAU } from '../../../util/math.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';
import { MINI, terrain } from './terrain.ts';
import { PING_LIFE, V } from '../view_state.ts';
import { cloakedFrom } from '../../../game/aether.ts';

const fog = { c: null as HTMLCanvasElement | null, img: null as ImageData | null, listeners: [] as (() => void)[] };

/** 64×64 image of the fog: black, see-through where visible, half dark where explored. */
export const fogCanvas = (): HTMLCanvasElement => {
  if (!fog.c) throw new Error('initFog first');
  return fog.c;
};

function updateFogImage(): void {
  if (!fog.c || !fog.img) return;
  const d = fog.img.data;
  for (let i = 0; i < MW * MH; i++) {
    d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; // pure black, so unexplored ground matches the void past the map
    d[i * 4 + 3] = G.vis[i] === 2 ? 0 : G.vis[i] === 1 ? 120 : 255;
  }
  ctx2d(fog.c).putImageData(fog.img, 0, 0);
  for (const l of fog.listeners) l();
}

/** Create the fog image; `onChange` runs whenever the fog moves. */
export function initFog(onChange?: () => void): void {
  fog.c = mkCanvas(MW, MH);
  fog.img = ctx2d(fog.c).createImageData(MW, MH);
  if (onChange) fog.listeners = [onChange];
  hooks.fogUpdated = updateFogImage;
  updateFogImage();
}

/** Enemy units show only while seen (and not cloaked); buildings once explored. */
export function shownToPlayer(e: Ent): boolean {
  if (e.team === V.team) return true;
  if (cloakedFrom(e, V.team)) return false;
  return e.kind === 'unit' ? seenAt(e.x, e.y) : exploredAt(e.x, e.y);
}

/** Radar: terrain, ore, units and buildings, fog, alerts, and the ground the camera sees. */
export function drawMinimap(m: CanvasRenderingContext2D, footprint: [number, number][]): void {
  const k = MINI / MW;
  m.imageSmoothingEnabled = true;
  m.drawImage(terrain.mini, 0, 0);
  m.fillStyle = '#e0b030';
  for (let i = 0; i < MW * MH; i++) if (G.ore[i] > 0 && G.vis[i]) m.fillRect((i % MW) * k, ((i / MW) | 0) * k, k, k);
  for (const e of G.ents) {
    if (e.dead) continue;
    if (e.type === 'aether') continue; // drawn over the fog below
    if (cloakedFrom(e, V.team)) continue;
    if (e.team !== V.team && G.vis[tileOf(e.y) * MW + tileOf(e.x)] < (e.kind === 'unit' ? 2 : 1)) continue;
    m.fillStyle = e.team < 0 ? '#fff0a0' : teamColors(e.team).l;
    const s = e.w ? e.w * k : 3, x = (e.x / TS) * k - s / 2, y = (e.y / TS) * k - s / 2;
    m.fillRect(x, y, s, s);
    if (e.w) { m.strokeStyle = 'rgba(0,0,0,.6)'; m.lineWidth = 1; m.strokeRect(x, y, s, s); }
  }
  if (fog.c) m.drawImage(fog.c, 0, 0, MINI, MINI);
  // Aether deposits glow on the radar even under fog: everyone saw where the stars fell
  for (const e of G.ents) {
    if (e.dead || e.type !== 'aether') continue;
    const x = (e.x / TS) * k, y = (e.y / TS) * k, r = 2 + Math.sin(G.gameT * 3) * 0.6;
    m.fillStyle = 'rgba(200,110,255,.35)'; m.beginPath(); m.arc(x, y, r + 2.5, 0, TAU); m.fill();
    m.fillStyle = '#e8b8ff'; m.beginPath(); m.arc(x, y, r, 0, TAU); m.fill();
  }
  for (const p of V.pings) {
    m.strokeStyle = `rgba(255,60,60,${1 - p.t / PING_LIFE})`; m.lineWidth = 2;
    m.beginPath(); m.arc((p.x / TS) * k, (p.y / TS) * k, 4 + ((p.t * 20) % 14), 0, TAU); m.stroke();
  }
  m.strokeStyle = '#fff'; m.lineWidth = 1;
  m.beginPath();
  footprint.forEach(([x, y], i) => (i ? m.lineTo((x / TS) * k, (y / TS) * k) : m.moveTo((x / TS) * k, (y / TS) * k)));
  m.closePath();
  m.stroke();
}
