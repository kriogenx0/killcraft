// Modern structures and the ore crystal rock, rendered once per type and team into cached sprites.
// Drawn in a 3/4 view: a roof on top and a front wall below it.
import { BUILDING, type BldType } from '../../../data/building.ts';
import { teamColors, type TeamColors } from '../../../data/team.ts';
import { TS } from '../../../game/const.ts';
import { TAU } from '../../../util/math.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';
import { blob, ellipseFill, oline } from './draw.ts';

type G2 = CanvasRenderingContext2D;
export type SpriteType = BldType | 'source';

export interface Sprite {
  c: HTMLCanvasElement;
  /** offset from the footprint's top-left corner to the sprite's top-left */
  ox: number;
  oy: number;
}

const PAD = 8;
const SOURCE_TOP = 18;
const cache = new Map<string, Sprite>();

function vgrad(g: G2, y0: number, y1: number, a: string, b: string): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  return gr;
}

function hgrad(g: G2, x0: number, x1: number, stops: string[]): CanvasGradient {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
}

function outline(g: G2, w = 1.4): void {
  g.lineWidth = w;
  g.strokeStyle = 'rgba(0,0,0,.8)';
  g.stroke();
}

/** Concrete foundation covering the footprint. */
function pad(g: G2, w: number, h: number): void {
  ellipseFill(g, w / 2 + 4, h - 2, w / 2 + 2, 8, 'rgba(0,0,0,.25)');
  g.fillStyle = vgrad(g, 0, h, '#a8a69c', '#7c7a70');
  g.beginPath(); g.rect(1, 1, w - 2, h - 2); g.fill(); outline(g, 1);
  g.strokeStyle = 'rgba(0,0,0,.15)';
  g.lineWidth = 1;
  for (let x = 16; x < w; x += 16) { g.beginPath(); g.moveTo(x, 2); g.lineTo(x, h - 2); g.stroke(); }
  for (let y = 16; y < h; y += 16) { g.beginPath(); g.moveTo(2, y); g.lineTo(w - 2, y); g.stroke(); }
}

/** A box seen from above and the front: roof rectangle plus a darker front wall. */
function box(g: G2, x: number, y: number, w: number, roofH: number, wallH: number, roof: string | CanvasGradient, wall: [string, string]): void {
  g.fillStyle = vgrad(g, y + roofH, y + roofH + wallH, wall[0], wall[1]);
  g.beginPath(); g.rect(x, y + roofH, w, wallH); g.fill(); outline(g);
  g.fillStyle = roof;
  g.beginPath(); g.rect(x, y, w, roofH); g.fill(); outline(g);
}

function stripe(g: G2, x: number, y: number, w: number, h: number, T: TeamColors): void {
  g.fillStyle = T.m;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,.25)';
  g.fillRect(x, y, w, Math.max(1, h / 3));
}

function windows(g: G2, x: number, y: number, n: number, step: number, w = 6, h = 4): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = '#1e2a30';
    g.fillRect(x + i * step, y, w, h);
    g.fillStyle = 'rgba(160,210,240,.55)';
    g.fillRect(x + i * step, y, w, h / 2);
  }
}

function hazard(g: G2, x: number, y: number, w: number, h: number): void {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#e8c020'; g.fillRect(x, y, w, h);
  g.fillStyle = '#222';
  for (let i = -h; i < w; i += 8) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + h, y); g.lineTo(x + i + h + 4, y); g.lineTo(x + i + 4, y + h); g.fill(); }
  g.restore();
}

function cylinder(g: G2, cx: number, top: number, bottom: number, r: number, body: string[], cap: string): void {
  g.fillStyle = hgrad(g, cx - r, cx + r, body);
  g.beginPath(); g.moveTo(cx - r, top); g.lineTo(cx - r, bottom); g.ellipse(cx, bottom, r, r * 0.35, 0, Math.PI, 0, true); g.lineTo(cx + r, top); g.fill(); outline(g);
  g.fillStyle = cap;
  g.beginPath(); g.ellipse(cx, top, r, r * 0.35, 0, 0, TAU); g.fill(); outline(g);
}

function drawYard(g: G2, T: TeamColors): void {
  pad(g, 96, 96);
  box(g, 6, -10, 62, 40, 34, vgrad(g, -10, 30, '#c4c4bc', '#8e8e86'), ['#9a9a90', '#64645c']);
  stripe(g, 6, 24, 62, 5, T);
  windows(g, 12, 38, 6, 9);
  g.fillStyle = '#2a2a28'; g.fillRect(24, 50, 26, 14);
  g.strokeStyle = 'rgba(255,255,255,.15)';
  for (let y = 52; y < 64; y += 3) { g.beginPath(); g.moveTo(24, y); g.lineTo(50, y); g.stroke(); }
  // crane
  g.fillStyle = '#d8a820'; g.fillRect(76, -36, 8, 90); g.beginPath(); g.rect(76, -36, 8, 90); outline(g, 1);
  g.strokeStyle = '#7a5a10'; g.lineWidth = 1;
  for (let y = -32; y < 54; y += 8) { g.beginPath(); g.moveTo(76, y); g.lineTo(84, y + 8); g.stroke(); }
  oline(g, 84, -36, 30, -36, 4, '#e0b428');
  oline(g, 80, -44, 40, -36, 1, '#444');
  oline(g, 38, -36, 38, -14, 1, '#333');
  blob(g, 38, -12, 3, 2.5, '#555');
  blob(g, 80, -38, 5, 4, '#b08010');
  // radar dish
  g.fillStyle = '#d8d8d0'; g.beginPath(); g.ellipse(20, -16, 9, 5, -0.4, 0, TAU); g.fill(); outline(g, 1);
  oline(g, 20, -16, 22, -6, 1.5, '#666');
}

function drawPower(g: G2, T: TeamColors): void {
  pad(g, 64, 64);
  box(g, 22, 24, 22, 10, 24, vgrad(g, 24, 34, '#c0c0b8', '#909088'), ['#8a8a80', '#5c5c54']);
  stripe(g, 22, 40, 22, 4, T);
  for (const cx of [14, 50]) cylinder(g, cx, -16, 52, 11, ['#6e6e68', '#d0d0c8', '#8a8a84', '#55554f'], '#3a3a36');
  for (const cx of [14, 50]) { g.fillStyle = 'rgba(255,190,80,.25)'; g.beginPath(); g.ellipse(cx, -16, 7, 2.4, 0, 0, TAU); g.fill(); }
  g.fillStyle = '#ffd860'; g.fillRect(29, 46, 8, 3);
}

function drawRefinery(g: G2, T: TeamColors): void {
  pad(g, 96, 96);
  hazard(g, 22, 68, 52, 26);
  g.fillStyle = '#5a5a54'; g.fillRect(30, 72, 36, 18);
  for (let x = 32; x < 66; x += 4) { g.fillStyle = '#3a3a34'; g.fillRect(x, 74, 2, 14); }
  box(g, 4, -6, 54, 34, 30, vgrad(g, -6, 28, '#bcbcb4', '#8a8a82'), ['#94948a', '#5e5e56']);
  stripe(g, 4, 22, 54, 5, T);
  windows(g, 10, 34, 5, 9);
  cylinder(g, 74, -12, 30, 12, ['#6a6a64', '#e0e0d8', '#9a9a94', '#5a5a54'], '#b8b8b0');
  cylinder(g, 74, 30, 56, 10, ['#6a6a64', '#d0d0c8', '#8a8a84', '#55554f'], '#a8a8a0');
  oline(g, 58, 10, 62, 10, 3, '#777');
  oline(g, 58, 40, 64, 40, 3, '#777');
  g.fillStyle = '#d8a828'; g.beginPath(); g.ellipse(74, -12, 7, 2.5, 0, 0, TAU); g.fill();
}

function drawBarracks(g: G2, T: TeamColors): void {
  pad(g, 64, 64);
  // sandbags
  for (let i = 0; i < 9; i++) { blob(g, 6 + i * 6.5, 58, 4, 2.6, '#b8a070'); blob(g, 6 + i * 6.5, 6, 4, 2.6, '#b8a070'); }
  // quonset hut
  const body = hgrad(g, 10, 54, ['#3e4a26', '#7e8c4e', '#5a6838', '#2e3a1c']);
  g.fillStyle = body;
  g.beginPath(); g.moveTo(10, 44); g.lineTo(10, 10); g.quadraticCurveTo(32, -12, 54, 10); g.lineTo(54, 44); g.closePath(); g.fill(); outline(g);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1;
  for (let x = 16; x < 54; x += 6) { g.beginPath(); g.moveTo(x, 44); g.lineTo(x, 8 - Math.sin(((x - 10) / 44) * Math.PI) * 12); g.stroke(); }
  g.fillStyle = '#4a5630'; g.fillRect(10, 40, 44, 14); g.beginPath(); g.rect(10, 40, 44, 14); outline(g, 1);
  g.fillStyle = '#1e2412'; g.fillRect(26, 42, 12, 12);
  stripe(g, 10, 38, 44, 3, T);
  oline(g, 58, 50, 58, 16, 1.4, '#555');
  g.fillStyle = T.m; g.beginPath(); g.moveTo(59, 16); g.lineTo(70, 20); g.lineTo(59, 24); g.fill();
}

function drawFactory(g: G2, T: TeamColors): void {
  pad(g, 96, 96);
  const roof = g.createLinearGradient(0, -10, 0, 30);
  roof.addColorStop(0, '#b4b4ac'); roof.addColorStop(1, '#84847c');
  box(g, 2, -10, 92, 40, 46, roof, ['#8e8e84', '#56564e']);
  g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1;
  for (let x = 8; x < 94; x += 6) { g.beginPath(); g.moveTo(x, -9); g.lineTo(x, 29); g.stroke(); }
  stripe(g, 2, 30, 92, 6, T);
  // big door
  g.fillStyle = '#26261f'; g.fillRect(22, 44, 52, 32);
  for (let y = 46; y < 76; y += 4) { g.fillStyle = '#3a3a32'; g.fillRect(22, y, 52, 2); }
  hazard(g, 22, 40, 52, 4);
  windows(g, 6, 44, 2, 8, 5, 4);
  windows(g, 78, 44, 2, 8, 5, 4);
  for (const x of [12, 84]) { g.fillStyle = '#ffd860'; g.beginPath(); g.arc(x, 64, 2.4, 0, TAU); g.fill(); }
}

function drawTurretBase(g: G2): void {
  ellipseFill(g, 18, 30, 16, 5, 'rgba(0,0,0,.3)');
  g.fillStyle = vgrad(g, 0, 32, '#b0aea4', '#6a685e');
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; g.lineTo(16 + Math.cos(a) * 16, 16 + Math.sin(a) * 15); }
  g.closePath(); g.fill(); outline(g);
  g.fillStyle = '#4a4a44'; g.beginPath(); g.ellipse(16, 15, 10, 9, 0, 0, TAU); g.fill(); outline(g, 1);
}

function drawTower(g: G2, T: TeamColors): void {
  ellipseFill(g, 18, 30, 16, 5, 'rgba(0,0,0,.3)');
  // round stone shaft, wider at the foot
  g.fillStyle = hgrad(g, 4, 28, ['#6e6a62', '#b8b2a6', '#8a857b', '#4e4a44']);
  g.beginPath(); g.moveTo(4, 30); g.lineTo(7, -24); g.lineTo(25, -24); g.lineTo(28, 30); g.closePath(); g.fill(); outline(g);
  g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 1;
  for (let y = -16; y < 30; y += 8) { g.beginPath(); g.moveTo(6, y); g.lineTo(26, y); g.stroke(); }
  // parapet with merlons
  g.fillStyle = hgrad(g, 3, 29, ['#7a766c', '#c4beb2', '#5a564e']);
  g.beginPath(); g.rect(3, -32, 26, 9); g.fill(); outline(g, 1);
  for (let x = 3; x < 29; x += 7) { g.beginPath(); g.rect(x, -38, 4, 6); g.fill(); outline(g, 1); }
  // ballista and a team banner
  oline(g, 10, -36, 26, -42, 2, '#5a3a1c');
  g.fillStyle = T.m; g.beginPath(); g.moveTo(11, -22); g.lineTo(21, -22); g.lineTo(21, -6); g.lineTo(16, -10); g.lineTo(11, -6); g.closePath(); g.fill(); outline(g, 1);
  g.fillStyle = '#2a1a0e'; g.beginPath(); g.moveTo(12, 30); g.lineTo(12, 20); g.arc(16, 20, 4, Math.PI, 0); g.lineTo(20, 30); g.fill();
  g.fillStyle = '#1a1612'; g.fillRect(15, 2, 2, 7);
}

function drawSource(g: G2): void {
  ellipseFill(g, 18, 30, 16, 5, 'rgba(0,0,0,.3)');
  g.fillStyle = vgrad(g, -10, 32, '#6a625a', '#2e2a26');
  g.beginPath();
  for (const [x, y] of [[0, 30], [3, 12], [10, 2], [20, 4], [30, 12], [32, 30]]) g.lineTo(x, y);
  g.closePath(); g.fill(); outline(g);
  for (const [x, y, h, a] of [[9, 14, 16, -0.3], [17, 10, 20, 0.05], [25, 15, 14, 0.35], [13, 22, 10, -0.6], [22, 22, 11, 0.6]]) {
    g.save(); g.translate(x, y); g.rotate(a);
    const gr = g.createLinearGradient(-3, 0, 3, 0);
    gr.addColorStop(0, '#fff0a0'); gr.addColorStop(0.5, '#e8b028'); gr.addColorStop(1, '#8a5a08');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(-3, 0); g.lineTo(0, -h); g.lineTo(3, 0); g.closePath(); g.fill(); outline(g, 0.8);
    g.restore();
  }
}

const ART: Record<BldType, (g: G2, T: TeamColors) => void> = {
  yard: drawYard, power: drawPower, refinery: drawRefinery, barracks: drawBarracks, factory: drawFactory, turret: (g) => drawTurretBase(g), tower: drawTower,
};

/** Cached sprite for a building type and team. */
export function sprite(type: SpriteType, team: number): Sprite {
  const key = `${type}|${team}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = type === 'source' ? 1 : BUILDING[type].size, top = type === 'source' ? SOURCE_TOP : BUILDING[type].top;
  const W = size * TS, c = mkCanvas(W + PAD * 2, W + top + PAD + 4), g = ctx2d(c);
  g.translate(PAD, top + 4);
  if (type === 'source') drawSource(g);
  else ART[type](g, teamColors(team));
  const s = { c, ox: PAD, oy: top + 4 };
  cache.set(key, s);
  return s;
}
