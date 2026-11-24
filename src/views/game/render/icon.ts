// Sidebar and command icons, drawn once to data URLs for use in the HUD.
import { UNIT, UNIT_TYPES } from '../../../data/unit.ts';
import { BLD_TYPES } from '../../../data/building.ts';
import { TECH, TECH_TYPES } from '../../../data/era.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';
import { drawTurretHead, drawUnitArt } from './unit_art.ts';
import { sprite } from './building_art.ts';
import { unitIcon } from '../render3d/icon3d.ts';
import { COMMAND_GLYPH } from './command_icons.ts';

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
    // pictured from the 3D model, with the flat sprite as a fallback without WebGL
    const pic = unitIcon(t, team);
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
    const { age, heal, ward, upg } = TECH[t];
    if (upg) {
      // Armory upgrades: a sword (weapons) or shield (armor), steel for troops and dark iron for
      // machines, one pip per level
      const weapon = upg.track.endsWith('Weapon'), inf = upg.track.startsWith('inf'), lvl = upg.level;
      ICON[t] = make((g) => {
        g.fillStyle = inf ? '#3a5a3a' : '#4a4a58'; g.strokeStyle = '#000'; g.lineWidth = 2;
        g.beginPath(); g.arc(W / 2, 20, 16, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#d8dce4'; g.lineWidth = 1.2;
        if (weapon) {
          g.beginPath(); g.moveTo(W / 2, 6); g.lineTo(W / 2 + 3, 10); g.lineTo(W / 2 + 3, 27); g.lineTo(W / 2 - 3, 27); g.lineTo(W / 2 - 3, 10); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#c8a040'; g.fillRect(W / 2 - 8, 27, 16, 3); g.fillRect(W / 2 - 1.5, 30, 3, 6);
        } else {
          g.beginPath(); g.moveTo(W / 2 - 11, 9); g.lineTo(W / 2 + 11, 9); g.lineTo(W / 2 + 10, 22); g.lineTo(W / 2, 33); g.lineTo(W / 2 - 10, 22); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#8a8e98'; g.fillRect(W / 2 - 1.5, 11, 3, 18);
        }
        g.fillStyle = '#e8c050';
        for (let i = 0; i < lvl; i++) { g.beginPath(); g.arc(W / 2 + (i - (lvl - 1) / 2) * 8, 42, 2.5, 0, Math.PI * 2); g.fill(); }
      });
      continue;
    }
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
  // command buttons: line glyphs, see command_icons.ts
  Object.assign(ICON, COMMAND_GLYPH);
}
