// Pre-rendered terrain: per-pixel ground with soft shorelines, scattered details, and trees.
// `ground` never changes; `full` adds the trees on top.
import { G } from '../../../game/state.ts';
import { MW, MH, TS, WATER, TREE } from '../../../game/const.ts';
import { DIRS } from '../../../game/path.ts';
import { clamp, hash, lerp, mulberry32, TAU } from '../../../util/math.ts';
import { fbm, seedNoise, vnoise } from '../../../util/noise.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';

export const MINI = 160;

interface Layers {
  ground: HTMLCanvasElement;
  full: HTMLCanvasElement;
  mini: HTMLCanvasElement;
}

export const terrain = {} as Layers;

function paintGround(g: CanvasRenderingContext2D): void {
  const W = MW * TS, img = g.createImageData(W, W), d = img.data, wt = new Float32Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) wt[i] = G.terr[i] === WATER ? 1 : 0;
  const at = (a: number, b: number) => wt[clamp(b, 0, MH - 1) * MW + clamp(a, 0, MW - 1)];
  for (let py = 0; py < W; py++) {
    const fy = py / TS - 0.5, iy = Math.floor(fy), ty = fy - iy;
    for (let px = 0; px < W; px++) {
      const fx = px / TS - 0.5, ix = Math.floor(fx), tx = fx - ix;
      // bilinear water mask gives rounded coasts; noise roughens them
      let w = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
      if (w > 0) w += (vnoise(px * 0.09, py * 0.09) - 0.5) * 0.32;
      const grain = (Math.random() - 0.5) * 10;
      let r: number, gg: number, b: number;
      if (w > 0.5) {
        const dep = clamp((w - 0.5) * 2.4, 0, 1), rip = vnoise(px * 0.05 + 3, py * 0.18) * 0.5 + vnoise(px * 0.11, py * 0.03) * 0.5;
        r = lerp(64, 18, dep) + rip * 14; gg = lerp(132, 62, dep) + rip * 18; b = lerp(150, 112, dep) + rip * 20;
        if (w < 0.56) { const t = (w - 0.5) / 0.06; r = lerp(150, r, t); gg = lerp(170, gg, t); b = lerp(160, b, t); } // surf
      } else if (w > 0.37) {
        const t = (w - 0.37) / 0.13; // sand
        r = lerp(200, 150, t); gg = lerp(180, 132, t); b = lerp(128, 92, t);
      } else {
        const n = fbm(px * 0.012, py * 0.012), n2 = vnoise(px * 0.06, py * 0.06);
        r = lerp(50, 96, n) + n2 * 10; gg = lerp(96, 146, n) + n2 * 14; b = lerp(30, 54, n) + n2 * 6;
        const m = fbm(px * 0.005 + 40, py * 0.005 + 40);
        if (m > 0.6) { const t = Math.min(1, (m - 0.6) * 5) * 0.75; r = lerp(r, 124, t); gg = lerp(gg, 104, t); b = lerp(b, 64, t); } // dirt
        if (w > 0.2) { const t = ((w - 0.2) / 0.17) * 0.45; r = lerp(r, 140, t); gg = lerp(gg, 130, t); b = lerp(b, 80, t); } // damp edge
      }
      const o = (py * W + px) * 4;
      d[o] = r + grain; d[o + 1] = gg + grain; d[o + 2] = b + grain; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  paintDetails(g);
}

function paintDetails(g: CanvasRenderingContext2D): void {
  const rnd = mulberry32(4242);
  for (let ty = 0; ty < MH; ty++)
    for (let tx = 0; tx < MW; tx++) {
      if (G.terr[ty * MW + tx] === WATER) continue;
      const nearWater = DIRS.some(([dx, dy]) => {
        const x = tx + dx, y = ty + dy;
        return x >= 0 && y >= 0 && x < MW && y < MH && G.terr[y * MW + x] === WATER;
      });
      const n = 2 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const x = tx * TS + rnd() * TS, y = ty * TS + rnd() * TS, r = rnd();
        if (r < 0.55 && !nearWater) {
          g.strokeStyle = rnd() < 0.5 ? 'rgba(30,70,20,.55)' : 'rgba(150,200,90,.4)';
          g.lineWidth = 1;
          for (let s = -1; s <= 1; s++) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * 2.5, y - 4 - rnd() * 2); g.stroke(); }
        } else if (r < 0.62 && !nearWater) {
          g.fillStyle = ['#f0e070', '#f4f4f4', '#d070d0', '#e05050'][Math.floor(rnd() * 4)];
          g.fillRect(x, y, 2, 2);
        } else if (r < 0.66) {
          g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x + 1, y + 1.5, 3, 2, 0, 0, TAU); g.fill();
          g.fillStyle = '#8f8a80'; g.beginPath(); g.ellipse(x, y, 3, 2, 0, 0, TAU); g.fill();
          g.fillStyle = '#bdb8ac'; g.fillRect(x - 1.5, y - 1.2, 1.5, 1);
        }
      }
    }
}

function drawTree(g: CanvasRenderingContext2D, tx: number, ty: number): void {
  const h = hash(tx, ty), h2 = hash(ty + 3.3, tx - 7.1), cx = tx * TS + 16 + (h - 0.5) * 7, cy = ty * TS + 24 + (h2 - 0.5) * 4;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(cx + 7, cy + 2, 15, 6, 0, 0, TAU); g.fill();
  if (h2 > 0.42) {
    // pine
    g.fillStyle = '#4a2e16'; g.fillRect(cx - 2, cy - 6, 4, 8);
    for (const [r, yy] of [[15, -4], [12, -12], [8.5, -19], [5, -25]]) {
      const gr = g.createLinearGradient(cx - r, 0, cx + r, 0);
      gr.addColorStop(0, '#3d7a3a'); gr.addColorStop(0.5, '#235a26'); gr.addColorStop(1, '#123818');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(cx - r, cy + yy); g.lineTo(cx, cy + yy - 13); g.lineTo(cx + r, cy + yy); g.quadraticCurveTo(cx, cy + yy + 4, cx - r, cy + yy); g.fill();
      g.strokeStyle = 'rgba(0,20,0,.5)'; g.lineWidth = 1; g.stroke();
    }
    return;
  }
  // broadleaf
  g.fillStyle = '#53341a'; g.fillRect(cx - 2.5, cy - 8, 5, 10);
  for (const [dx, dy, r] of [[-6, -12, 9], [6, -12, 9], [0, -18, 10], [-3, -8, 8], [4, -7, 8]]) {
    const x = cx + dx, y = cy + dy, gr = g.createRadialGradient(x - r * 0.4, y - r * 0.5, 1, x, y, r);
    gr.addColorStop(0, h > 0.5 ? '#7cb648' : '#6aa83e'); gr.addColorStop(0.6, '#2f6e2a'); gr.addColorStop(1, '#1a4a1c');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  g.fillStyle = 'rgba(200,240,140,.18)';
  for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(cx - 6 + hash(tx + i, ty) * 10, cy - 20 + hash(ty, tx + i) * 8, 1.6, 0, TAU); g.fill(); }
}

/** Redraw ground and trees inside a tile rectangle (inclusive). */
export function repaintRegion(tx0: number, ty0: number, tx1: number, ty1: number): void {
  tx0 = clamp(tx0, 0, MW - 1); ty0 = clamp(ty0, 0, MH - 1); tx1 = clamp(tx1, 0, MW - 1); ty1 = clamp(ty1, 0, MH - 1);
  const x = tx0 * TS, y = ty0 * TS, w = (tx1 - tx0 + 1) * TS, h = (ty1 - ty0 + 1) * TS, g = ctx2d(terrain.full);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.drawImage(terrain.ground, x, y, w, h, x, y, w, h);
  // trees overhang the tile above, so paint one extra row below the region
  for (let ty = ty0 - 1; ty <= ty1 + 2; ty++) {
    if (ty < 0 || ty >= MH) continue;
    for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) if (tx >= 0 && tx < MW && G.terr[ty * MW + tx] === TREE) drawTree(g, tx, ty);
  }
  g.restore();
  if (terrain.mini) {
    const k = MINI / (MW * TS), m = ctx2d(terrain.mini);
    m.drawImage(terrain.full, x, y, w, h, x * k, y * k, w * k, h * k);
  }
}

export function initTerrain(seed: number): void {
  seedNoise(mulberry32(seed + 7));
  terrain.ground = mkCanvas(MW * TS, MH * TS);
  terrain.full = mkCanvas(MW * TS, MH * TS);
  paintGround(ctx2d(terrain.ground));
  repaintRegion(0, 0, MW - 1, MH - 1);
  terrain.mini = mkCanvas(MINI, MINI);
  ctx2d(terrain.mini).drawImage(terrain.full, 0, 0, MINI, MINI);
}
