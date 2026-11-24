// Pre-rendered terrain: per-pixel ground with soft shorelines, scattered details, and trees.
// `ground` never changes and is the 3D ground's texture; `mini` is the radar's copy with the trees on top.
import { G } from '../../../game/state.ts';
import { MW, MH, TS, WATER, TREE, SHALLOW, ROCK } from '../../../game/const.ts';
import { DIRS } from '../../../game/path.ts';
import { clamp, hash, lerp, mulberry32, TAU } from '../../../util/math.ts';
import { fbm, seedNoise, vnoise } from '../../../util/noise.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';

export const MINI = 160;

interface Layers {
  ground: HTMLCanvasElement;
  mini: HTMLCanvasElement;
}

export const terrain = {} as Layers;

/** Bilinear sample of a per-tile layer at a pixel (tile centres at +0.5). */
function sampler(layer: ArrayLike<number>): (px: number, py: number) => number {
  const at = (a: number, b: number) => layer[clamp(b, 0, MH - 1) * MW + clamp(a, 0, MW - 1)];
  return (px, py) => {
    const fx = px / TS - 0.5, fy = py / TS - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
  };
}

function paintGround(g: CanvasRenderingContext2D): void {
  const W = MW * TS, img = g.createImageData(W, W), d = img.data;
  const wt = new Float32Array(MW * MH), rk = new Float32Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) {
    wt[i] = G.terr[i] === WATER ? 1 : G.terr[i] === SHALLOW ? 0.62 : 0;
    rk[i] = G.terr[i] === ROCK ? 1 : 0;
  }
  const wetAt = sampler(wt), rockAt = sampler(rk), elevAt = sampler(G.elev), oilAt = sampler(G.oilField.map((v) => (v > 0 ? 1 : 0)));
  for (let py = 0; py < W; py++) {
    for (let px = 0; px < W; px++) {
      // the wet mask gives rounded coasts; noise roughens them
      let w = wetAt(px, py);
      if (w > 0) w += (vnoise(px * 0.09, py * 0.09) - 0.5) * 0.3;
      const h = elevAt(px, py), slope = Math.hypot(elevAt(px + 8, py) - elevAt(px - 8, py), elevAt(px, py + 8) - elevAt(px, py - 8)) * 2;
      const grain = (Math.random() - 0.5) * 9;
      let r: number, gg: number, b: number;
      if (w > 0.5) {
        // lake and river beds, seen through the water: sandy in the shallows, dark and weedy when deep
        const dep = clamp((w - 0.5) * 2.2, 0, 1), rip = vnoise(px * 0.05 + 3, py * 0.18) * 0.5 + vnoise(px * 0.11, py * 0.03) * 0.5;
        r = lerp(150, 22, dep) + rip * 12; gg = lerp(150, 62, dep) + rip * 16; b = lerp(108, 78, dep) + rip * 14;
        const pebble = vnoise(px * 0.4, py * 0.4);
        if (dep < 0.5 && pebble > 0.72) { r -= 22; gg -= 20; b -= 16; }
      } else if (w > 0.36) {
        const t = (w - 0.36) / 0.14; // sand and wet mud at the water's edge
        r = lerp(206, 132, t); gg = lerp(186, 118, t); b = lerp(136, 84, t);
        const n = vnoise(px * 0.2, py * 0.2);
        r += (n - 0.5) * 18; gg += (n - 0.5) * 16; b += (n - 0.5) * 10;
      } else {
        const n = fbm(px * 0.012, py * 0.012), n2 = vnoise(px * 0.06, py * 0.06), n3 = vnoise(px * 0.21, py * 0.21);
        // lush and dark in the lowlands, drier and golden up on the hills
        const dry = clamp(h * 0.55 + (n - 0.5) * 0.5, 0, 1);
        r = lerp(lerp(46, 90, n), lerp(104, 150, n), dry * 0.7) + n2 * 10 + n3 * 8;
        gg = lerp(lerp(92, 142, n), lerp(124, 146, n), dry * 0.7) + n2 * 14 + n3 * 8;
        b = lerp(lerp(30, 52, n), lerp(46, 64, n), dry * 0.7) + n2 * 6;
        const m = fbm(px * 0.005 + 40, py * 0.005 + 40);
        if (m > 0.6) { const t = Math.min(1, (m - 0.6) * 5) * 0.7; r = lerp(r, 128, t); gg = lerp(gg, 106, t); b = lerp(b, 66, t); } // dirt
        if (w > 0.18) { const t = ((w - 0.18) / 0.18) * 0.5; r = lerp(r, 120, t); gg = lerp(gg, 122, t); b = lerp(b, 70, t); } // damp edge
        // steep ground wears down to bare earth and stone
        const bare = clamp((slope - 0.3) * 1.8, 0, 0.9);
        if (bare > 0) { const s = vnoise(px * 0.15, py * 0.15) * 20; r = lerp(r, 118 + s, bare); gg = lerp(gg, 100 + s, bare); b = lerp(b, 76 + s, bare); }
      }
      const rock = clamp((rockAt(px, py) - 0.08) * 2.6 + (vnoise(px * 0.07 + 9, py * 0.07) - 0.5) * 0.6, 0, 1);
      if (rock > 0 && w <= 0.5) {
        // cliffs: layered grey stone with dark cracks and lichen
        const strata = Math.sin(h * 26 + vnoise(px * 0.05, py * 0.05) * 6) * 0.5 + 0.5, crack = vnoise(px * 0.3, py * 0.3);
        let cr = 112 + strata * 34, cg = 106 + strata * 30, cb = 96 + strata * 26;
        if (crack < 0.22) { cr *= 0.6; cg *= 0.6; cb *= 0.6; }
        if (vnoise(px * 0.13 + 50, py * 0.13) > 0.72) { cr = lerp(cr, 120, 0.5); cg = lerp(cg, 130, 0.5); cb = lerp(cb, 70, 0.5); }
        r = lerp(r, cr, rock); gg = lerp(gg, cg, rock); b = lerp(b, cb, rock);
      }
      // oil-soaked earth around the wells
      const oil = clamp((oilAt(px, py) - 0.15) * 1.6 + (vnoise(px * 0.12 + 70, py * 0.12) - 0.5) * 0.7, 0, 0.9);
      if (oil > 0 && w <= 0.5) { r = lerp(r, 44, oil); gg = lerp(gg, 38, oil); b = lerp(b, 32, oil); }
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
      const t = G.terr[ty * MW + tx];
      if (t === WATER || t === SHALLOW || t === ROCK || G.oilField[ty * MW + tx] > 0) continue;
      const nearWater = DIRS.some(([dx, dy]) => {
        const x = tx + dx, y = ty + dy;
        return x >= 0 && y >= 0 && x < MW && y < MH && (G.terr[y * MW + x] === WATER || G.terr[y * MW + x] === SHALLOW);
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

export function initTerrain(seed: number): void {
  seedNoise(mulberry32(seed + 7));
  terrain.ground = mkCanvas(MW * TS, MH * TS);
  paintGround(ctx2d(terrain.ground));
  // the radar's picture: the ground shrunk down, with the woods drawn over it at that size
  terrain.mini = mkCanvas(MINI, MINI);
  const m = ctx2d(terrain.mini);
  m.drawImage(terrain.ground, 0, 0, MINI, MINI);
  m.save();
  m.scale(MINI / (MW * TS), MINI / (MH * TS));
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) if (G.terr[ty * MW + tx] === TREE) drawTree(m, tx, ty);
  m.restore();
}
