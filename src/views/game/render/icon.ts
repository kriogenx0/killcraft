// Sidebar and command icons, drawn once to data URLs for use in the HUD.
import { UNIT, UNIT_TYPES } from '../../../data/unit.ts';
import { BLD_TYPES } from '../../../data/building.ts';
import { TECH, TECH_TYPES } from '../../../data/era.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';
import { drawTurretHead, drawUnitArt } from './unit_art.ts';
import { sprite } from './building_art.ts';
import { oline } from './draw.ts';

export const ICON: Record<string, string> = {};

const W = 64, H = 48;

function make(draw: (g: CanvasRenderingContext2D) => void, w = W, h = H): string {
  const c = mkCanvas(w, h), g = ctx2d(c);
  g.fillStyle = '#1a1e18';
  g.fillRect(0, 0, w, h);
  draw(g);
  return c.toDataURL();
}

const ANGLE = Math.PI / 5;

export function makeIcons(team = 0): void {
  for (const t of UNIT_TYPES) {
    const big = UNIT[t].radius > 8;
    ICON[t] = make((g) => drawUnitArt(g, t, team, W / 2, H / 2 + (big ? 4 : 8), { f: ANGLE, tf: ANGLE, walk: 0, atk: 0, load: 0.8 }, big ? 1.35 : 2.2));
  }
  for (const t of [...BLD_TYPES, 'yard' as const])
    ICON[t] = make((g) => {
      const { c } = sprite(t, team), s = Math.min((W - 4) / c.width, (H - 4) / c.height);
      g.drawImage(c, W / 2 - (c.width * s) / 2, H / 2 - (c.height * s) / 2, c.width * s, c.height * s);
      if (t === 'turret') drawTurretHead(g, team, W / 2 - c.width * s / 2 + 24 * s, H / 2 - c.height * s / 2 + 31 * s, ANGLE, 0);
    });
  // research: a gold medallion with the age's numeral
  const NUMERAL = ['I', 'II', 'III', 'IV'];
  for (const t of TECH_TYPES) {
    const { age, heal } = TECH[t];
    if (heal != null) {
      // healing research: a white medallion with a red cross, one pip per level
      ICON[t] = make((g) => {
        g.fillStyle = '#f4f0e6'; g.strokeStyle = '#000'; g.lineWidth = 2;
        g.beginPath(); g.arc(W / 2, 20, 16, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#c42a22';
        g.fillRect(W / 2 - 3.5, 9, 7, 22);
        g.fillRect(W / 2 - 11, 16.5, 22, 7);
        for (let i = 0; i < heal; i++) { g.beginPath(); g.arc(W / 2 + (i - (heal - 1) / 2) * 8, 42, 2.5, 0, Math.PI * 2); g.fill(); }
      });
      continue;
    }
    const era = age ?? 0;
    ICON[t] = make((g) => {
      const grad = g.createRadialGradient(W / 2 - 6, 14, 2, W / 2, 20, 22);
      grad.addColorStop(0, '#fff2c0');
      grad.addColorStop(0.55, '#d0a030');
      grad.addColorStop(1, '#6a4808');
      g.fillStyle = grad; g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.arc(W / 2, 20, 16, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#3a2404'; g.font = 'bold 15px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(NUMERAL[era] ?? String(era + 1), W / 2, 21);
    });
  }
  const cmd = (draw: (g: CanvasRenderingContext2D) => void) => make((g) => { g.clearRect(0, 0, 48, 48); g.translate(24, 24); draw(g); }, 48, 48);
  ICON.move = cmd((g) => {
    g.fillStyle = '#5ad04a'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath();
    for (const [x, y] of [[-12, -6], [2, -6], [2, -14], [15, 0], [2, 14], [2, 6], [-12, 6]]) g.lineTo(x, y);
    g.closePath(); g.fill(); g.stroke();
  });
  ICON.stop = cmd((g) => {
    g.fillStyle = '#c83a2a'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; g.lineTo(Math.cos(a) * 15, Math.sin(a) * 15); }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.fillRect(-9, -3, 18, 6);
  });
  ICON.amove = cmd((g) => {
    g.strokeStyle = '#e8e8e0'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2); g.stroke();
    for (const [x0, y0, x1, y1] of [[0, -16, 0, -6], [0, 6, 0, 16], [-16, 0, -6, 0], [6, 0, 16, 0]]) oline(g, x0, y0, x1, y1, 2.5, '#e84a3a');
  });
  ICON.cancel = cmd((g) => { oline(g, -11, -11, 11, 11, 4, '#e05040'); oline(g, 11, -11, -11, 11, 4, '#e05040'); });
  ICON.repair = cmd((g) => {
    g.rotate(-Math.PI / 4);
    oline(g, 0, -4, 0, 15, 5, '#c8ccd0');
    g.fillStyle = '#c8ccd0'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.arc(0, -8, 8, 0.6, Math.PI * 2 - 0.6 + Math.PI, false); g.fill(); g.stroke();
    g.fillStyle = '#1a1e18'; g.fillRect(-3, -18, 6, 10);
  });
  ICON.sell = cmd((g) => {
    // a small stack of gold coins
    g.strokeStyle = '#000'; g.lineWidth = 2;
    for (const [x, y] of [[-6, 8], [6, 8], [0, 0], [0, -8]]) {
      g.fillStyle = '#b88a18'; g.beginPath(); g.ellipse(x, y + 3, 11, 5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#e8c040'; g.beginPath(); g.ellipse(x, y, 11, 5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.strokeStyle = '#8a5a00'; g.lineWidth = 1; g.beginPath(); g.ellipse(0, -8, 6, 2.5, 0, 0, Math.PI * 2); g.stroke();
  });
}
