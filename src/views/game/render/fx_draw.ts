// Drawing particles and ground decals.
import { G, tileOf } from '../../../game/state.ts';
import { MW } from '../../../game/const.ts';
import { seenAt } from '../../../game/fog.ts';
import { teamColors } from '../../../data/team.ts';
import { mulberry32, TAU } from '../../../util/math.ts';
import { V } from '../view_state.ts';

type G2 = CanvasRenderingContext2D;

function glow(g: G2, x: number, y: number, r: number, inner: string, mid: string): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.4, mid);
  gr.addColorStop(1, 'rgba(200,40,0,0)');
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.globalCompositeOperation = 'source-over';
}

export function drawFx(g: G2): void {
  const { cam } = V;
  for (const p of G.fx) {
    if (!seenAt(p.x, p.y)) continue;
    const x = p.x - cam.x, y = p.y - cam.y - p.z, k = p.life / p.max;
    switch (p.kind) {
      case 'blood':
        g.fillStyle = '#8a0a0a'; g.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
        break;
      case 'chip':
      case 'debris':
      case 'ore':
        g.fillStyle = p.col ?? (p.kind === 'debris' ? '#4a4640' : '#a07040');
        g.save(); g.translate(x, y); g.rotate(p.rot + p.life * 8); g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6); g.restore();
        break;
      case 'spark':
        g.strokeStyle = `rgba(255,${(200 + Math.random() * 55) | 0},120,${1 - k})`; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - p.vx * 0.03, y - p.vy * 0.03 + p.vz * 0.03); g.stroke();
        break;
      case 'tracer':
        g.strokeStyle = `rgba(255,240,160,${1 - k})`; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(p.ex - cam.x, p.ey - cam.y); g.stroke();
        break;
      case 'flash':
        glow(g, x, y, Math.max(0.1, p.size * (1 - k * 0.5)), `rgba(255,255,220,${1 - k})`, `rgba(255,190,60,${0.8 * (1 - k)})`);
        break;
      case 'dust':
        g.fillStyle = `rgba(190,170,130,${0.45 * (1 - k)})`;
        g.beginPath(); g.arc(x, y, Math.max(0.1, p.size * (1 + k)), 0, TAU); g.fill();
        break;
      case 'smoke':
      case 'trail':
        g.fillStyle = p.soft ? `rgba(200,200,200,${0.3 * (1 - k)})` : `rgba(40,36,34,${0.5 * (1 - k)})`;
        g.beginPath(); g.arc(x, y, Math.max(0.1, p.size * (1 + k * 2.2)), 0, TAU); g.fill();
        break;
      case 'fire':
        glow(g, x, y, Math.max(0.1, p.size * (1 - k * 0.6)), `rgba(255,240,160,${0.9 * (1 - k)})`, `rgba(255,140,30,${0.7 * (1 - k)})`);
        break;
    }
  }
}

export function drawDecals(g: G2): void {
  const { cam, viewW, viewH } = V;
  for (const d of G.decals) {
    if (G.vis[tileOf(d.y) * MW + tileOf(d.x)] === 0) continue;
    const x = d.x - cam.x, y = d.y - cam.y;
    if (x < -120 || y < -120 || x > viewW + 120 || y > viewH + 120) continue;
    g.globalAlpha = Math.min(1, (d.max - d.t) / (d.max * 0.3));
    const r = mulberry32(d.seed);
    switch (d.kind) {
      case 'splat':
        g.fillStyle = '#5a0606'; g.beginPath(); g.ellipse(x, y, d.r, d.r * 0.6, 0, 0, TAU); g.fill();
        break;
      case 'scorch':
        g.fillStyle = 'rgba(20,16,12,.45)'; g.beginPath(); g.ellipse(x, y, d.r, d.r * 0.7, 0, 0, TAU); g.fill();
        break;
      case 'corpse':
        g.fillStyle = 'rgba(90,6,6,.7)'; g.beginPath(); g.ellipse(x, y, 8, 4.5, 0, 0, TAU); g.fill();
        g.fillStyle = '#4e5430'; g.beginPath(); g.ellipse(x + (r() - 0.5) * 3, y - 1, 5, 2.6, r() * 3, 0, TAU); g.fill();
        g.fillStyle = teamColors(d.team).d; g.beginPath(); g.arc(x + 4, y - 1.5, 2.4, 0, TAU); g.fill();
        break;
      case 'wreck':
        g.save(); g.translate(x, y); g.rotate(d.a);
        g.fillStyle = '#1e1c1a'; g.fillRect(-d.r, -d.r * 0.6, d.r * 2, d.r * 1.2);
        g.fillStyle = '#34302c'; g.fillRect(-d.r * 0.5, -d.r * 0.35, d.r, d.r * 0.7);
        g.restore();
        if (d.t < 8 && Math.random() < 0.3) { g.fillStyle = 'rgba(255,120,30,.8)'; g.fillRect(x + (Math.random() - 0.5) * d.r, y + (Math.random() - 0.5) * d.r * 0.6, 2, 2); }
        break;
      case 'rubble': {
        const s = (d.w * 32) / 2;
        g.fillStyle = 'rgba(20,16,12,.55)'; g.beginPath(); g.ellipse(x, y + 4, s * 1.05, s * 0.8, 0, 0, TAU); g.fill();
        for (let i = 0; i < d.w * 7; i++) {
          const px = x + (r() - 0.5) * s * 1.6, py = y + (r() - 0.5) * s * 1.2, rs = 2 + r() * 4;
          g.fillStyle = r() < 0.5 ? '#6e6c64' : '#4e4c46'; g.beginPath(); g.ellipse(px, py, rs, rs * 0.7, r() * 3, 0, TAU); g.fill();
        }
        g.strokeStyle = '#2a2a28'; g.lineWidth = 2;
        for (let i = 0; i < d.w * 2; i++) {
          const px = x + (r() - 0.5) * s * 1.4, py = y + (r() - 0.5) * s;
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + (r() - 0.5) * 20, py + (r() - 0.5) * 10); g.stroke();
        }
        break;
      }
    }
    g.globalAlpha = 1;
  }
}
