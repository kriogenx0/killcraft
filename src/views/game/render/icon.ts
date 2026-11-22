// Sidebar and command icons, drawn once to data URLs for use in the HUD.
import { UNIT, UNIT_TYPES } from '../../../data/unit.ts';
import { BLD_TYPES } from '../../../data/building.ts';
import { TECH, TECH_TYPES } from '../../../data/era.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';
import { drawTurretHead, drawUnitArt } from './unit_art.ts';
import { sprite } from './building_art.ts';
import { oline } from './draw.ts';
import { unitIcon } from '../render3d/icon3d.ts';

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
    // creatures of myth are pictured from their 3D models
    const pic = UNIT[t].beast ? unitIcon(t, team) : null;
    ICON[t] = pic ?? make((g) => drawUnitArt(g, t, team, W / 2, H / 2 + (big ? 4 : 8), { f: ANGLE, tf: ANGLE, walk: 0, atk: 0, load: 0.8 }, big ? 1.35 : 2.2));
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
    const { age, heal, ward } = TECH[t];
    if (ward) {
      // the Aether Ward: a violet shard over a stone shield
      ICON[t] = make((g) => {
        g.fillStyle = '#7a7468'; g.strokeStyle = '#000'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(W / 2 - 15, 6); g.lineTo(W / 2 + 15, 6); g.lineTo(W / 2 + 13, 26); g.lineTo(W / 2, 42); g.lineTo(W / 2 - 13, 26); g.closePath(); g.fill(); g.stroke();
        const grad = g.createLinearGradient(W / 2 - 6, 10, W / 2 + 6, 36);
        grad.addColorStop(0, '#fbeaff'); grad.addColorStop(0.5, '#c060ff'); grad.addColorStop(1, '#4a1080');
        g.fillStyle = grad; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(W / 2, 9); g.lineTo(W / 2 + 7, 22); g.lineTo(W / 2, 37); g.lineTo(W / 2 - 7, 22); g.closePath(); g.fill(); g.stroke();
      });
      continue;
    }
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
  const crosshair = (g: CanvasRenderingContext2D, r: number) => {
    g.strokeStyle = '#e8e8e0'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    const a = r * 0.55, b = r * 1.45;
    for (const [x0, y0, x1, y1] of [[0, -b, 0, -a], [0, a, 0, b], [-b, 0, -a, 0], [a, 0, b, 0]]) oline(g, x0, y0, x1, y1, 2.5, '#e84a3a');
  };
  ICON.engage = cmd((g) => crosshair(g, 11));
  ICON.skirmish = cmd((g) => {
    g.fillStyle = '#5ad04a'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath();
    for (const [x, y] of [[-16, 2], [-6, 2], [-6, -4], [4, 7], [-6, 18], [-6, 12], [-16, 12]]) g.lineTo(x, y);
    g.closePath(); g.fill(); g.stroke();
    g.translate(7, -7);
    crosshair(g, 7);
  });
  ICON.passive = cmd((g) => {
    oline(g, -8, -15, -8, 16, 3, '#b08850');
    g.fillStyle = '#f0f0e8'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-7, -14); g.lineTo(13, -10); g.lineTo(9, -4); g.lineTo(13, 2); g.lineTo(-7, -1); g.closePath(); g.fill(); g.stroke();
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
