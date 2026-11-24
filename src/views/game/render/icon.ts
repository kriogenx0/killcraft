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
    // creatures of myth, spellcasters and cyborgs are pictured from their 3D models
    const pic = UNIT[t].beast || UNIT[t].magic || UNIT[t].cyborg ? unitIcon(t, team) : null;
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
  const cmd = (draw: (g: CanvasRenderingContext2D) => void) => make((g) => { g.clearRect(0, 0, 48, 48); g.translate(24, 24); draw(g); }, 48, 48);
  ICON.move = cmd((g) => {
    g.fillStyle = '#5ad04a'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath();
    for (const [x, y] of [[-12, -6], [2, -6], [2, -14], [15, 0], [2, 14], [2, 6], [-12, 6]]) g.lineTo(x, y);
    g.closePath(); g.fill(); g.stroke();
  });
  ICON.patrol = cmd((g) => {
    // two arrows chasing each other: there and back
    g.fillStyle = '#5ab0f0'; g.strokeStyle = '#000'; g.lineWidth = 2;
    for (const k of [1, -1]) {
      g.beginPath();
      for (const [x, y] of [[-14, -2], [6, -2], [6, -9], [16, 0], [6, 9], [6, 2], [-14, 2]]) g.lineTo(x * k, (y - 7) * k);
      g.closePath(); g.fill(); g.stroke();
    }
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
  ICON.follow = cmd((g) => {
    // an eye: keep watching this one
    g.fillStyle = '#f0f0e8'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-16, 0); g.quadraticCurveTo(0, -17, 16, 0); g.quadraticCurveTo(0, 17, -16, 0); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#4a9ad8'; g.beginPath(); g.arc(0, 0, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#000'; g.beginPath(); g.arc(0, 0, 3, 0, Math.PI * 2); g.fill();
  });
  ICON.cancel = cmd((g) => { oline(g, -11, -11, 11, 11, 4, '#e05040'); oline(g, 11, -11, -11, 11, 4, '#e05040'); });
  ICON.repair = cmd((g) => {
    g.rotate(-Math.PI / 4);
    oline(g, 0, -4, 0, 15, 5, '#c8ccd0');
    g.fillStyle = '#c8ccd0'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.arc(0, -8, 8, 0.6, Math.PI * 2 - 0.6 + Math.PI, false); g.fill(); g.stroke();
    g.fillStyle = '#1a1e18'; g.fillRect(-3, -18, 6, 10);
  });
  ICON.upgrade = cmd((g) => {
    // a raised arrow over a new course of bricks
    g.strokeStyle = '#000'; g.lineWidth = 2;
    for (const [x, y] of [[-14, 8], [-4, 8], [6, 8], [-9, 14], [1, 14]]) { g.fillStyle = '#b8643c'; g.fillRect(x, y, 9, 5); g.strokeRect(x, y, 9, 5); }
    g.fillStyle = '#f0c040';
    g.beginPath();
    for (const [x, y] of [[0, -17], [11, -4], [4, -4], [4, 5], [-4, 5], [-4, -4], [-11, -4]]) g.lineTo(x, y);
    g.closePath(); g.fill(); g.stroke();
  });
  ICON.scrap = cmd((g) => {
    // a wrecking bar over a heap of rubble
    g.strokeStyle = '#000'; g.lineWidth = 2;
    for (const [x, y, w, h] of [[-12, 6, 10, 8], [-2, 9, 12, 7], [6, 3, 8, 7], [-6, 0, 9, 7]]) {
      g.fillStyle = '#8a8478'; g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
    }
    g.rotate(-Math.PI / 4);
    oline(g, 0, -16, 0, 10, 5, '#c8ccd0');
    oline(g, 0, -16, 6, -19, 5, '#c8ccd0');
  });
}
