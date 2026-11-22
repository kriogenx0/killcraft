// Modern units in a top-down style. Infantry stand upright and point their weapons; vehicles are
// drawn in their hull's frame, with turrets rotated separately.
import { UNIT, type UnitType } from '../../../data/unit.ts';
import { teamColors, type TeamColors } from '../../../data/team.ts';
import { HARVESTER_CAPACITY } from '../../../data/ore.ts';
import { TAU } from '../../../util/math.ts';
import { blob, ellipseFill, oline, shade } from './draw.ts';

type G2 = CanvasRenderingContext2D;

export interface UnitPose {
  /** hull / body facing */
  f: number;
  /** turret facing */
  tf: number;
  /** walk or track phase */
  walk: number;
  /** firing recoil 0..1 */
  atk: number;
  /** harvester load 0..1 */
  load: number;
}

const UNIFORM: [string, string] = ['#8a8f5a', '#3e4226'];
const SKIN = '#e2b48a';

function roundRect(g: G2, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function panel(g: G2, x: number, y: number, w: number, h: number, r: number, light: string, dark: string): void {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, light);
  gr.addColorStop(1, dark);
  roundRect(g, x, y, w, h, r);
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(0,0,0,.75)';
  g.stroke();
}

function treads(g: G2, len: number, w: number, off: number, phase: number): void {
  for (const s of [-1, 1]) {
    panel(g, -len / 2, s * off - w / 2, len, w, 2, '#4a4a48', '#202020');
    g.strokeStyle = 'rgba(0,0,0,.6)';
    g.lineWidth = 1;
    const shift = (phase * 6) % 4;
    for (let x = -len / 2 + shift; x < len / 2; x += 4) { g.beginPath(); g.moveTo(x, s * off - w / 2 + 1); g.lineTo(x, s * off + w / 2 - 1); g.stroke(); }
  }
}

function barrel(g: G2, x0: number, y: number, len: number, w: number): void {
  roundRect(g, x0, y - w / 2, len, w, 1);
  g.fillStyle = '#3a3e38';
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.8)';
  g.lineWidth = 0.8;
  g.stroke();
}

function infantry(g: G2, type: UnitType, T: TeamColors, p: UnitPose): void {
  const cs = Math.cos(p.f), sn = Math.sin(p.f), px = -sn, py = cs, sw = Math.sin(p.walk * TAU) * 2.6;
  blob(g, px * 2.4 + cs * sw, 1 + py * 1.2 + sn * sw * 0.5, 2, 1.6, '#2a2a22');
  blob(g, -px * 2.4 - cs * sw, 1 - py * 1.2 - sn * sw * 0.5, 2, 1.6, '#2a2a22');
  const by = -6 - Math.abs(sw) * 0.4, back = sn < -0.3;
  const gun = () => {
    const recoil = p.atk > 0 ? (1 - p.atk) * 2 : 0;
    const hx = cs * 3 + px * 2.5, hy = by + 1 + sn * 2;
    if (type === 'rocket') {
      // launcher on the shoulder
      oline(g, hx - cs * (5 + recoil), hy - 3 - sn * 5, hx + cs * (9 - recoil), hy - 3 + sn * 7, 3.4, '#5a6232');
      blob(g, hx + cs * (9 - recoil), hy - 3 + sn * 7, 1.8, 1.8, '#2a2e1a');
    } else oline(g, hx - cs * recoil, hy - sn * recoil, hx + cs * (11 - recoil), hy + sn * (9 - recoil), 1.6, '#262626');
  };
  if (back) gun();
  if (type === 'rocket') blob(g, -cs * 4, by - 1 - sn * 2, 3.5, 4, '#4e5430'); // backpack
  blob(g, 0, by, 5, 6, shade(g, 0, by, 6, UNIFORM[0], UNIFORM[1]));
  g.fillStyle = T.m;
  g.fillRect(-4, by - 2, 8, 3.2);
  blob(g, 0, by - 8, 3.6, 3.6, SKIN);
  g.beginPath();
  g.arc(0, by - 8.6, 4.2, Math.PI, TAU);
  g.fillStyle = T.d;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.7)';
  g.lineWidth = 0.8;
  g.stroke();
  if (!back) gun();
}

function jeep(g: G2, T: TeamColors, p: UnitPose): void {
  g.save();
  g.rotate(p.f);
  for (const [x, y] of [[-7, -6.5], [7, -6.5], [-7, 6.5], [7, 6.5]]) panel(g, x - 3, y - 2, 6, 4, 1.5, '#3a3a3a', '#111');
  panel(g, -11, -6, 22, 12, 3, T.l, T.d);
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.fillRect(4, -5, 6, 10);
  g.fillStyle = '#9ec4d8';
  g.fillRect(2, -4.5, 2.2, 9);
  oline(g, -3, -6, -3, 6, 1.2, '#2a2a2a');
  g.restore();
  g.save();
  g.translate(-Math.cos(p.f) * 4, -Math.sin(p.f) * 4);
  g.rotate(p.tf);
  barrel(g, 0, 0, 11 - (p.atk > 0 ? (1 - p.atk) * 2 : 0), 1.8);
  blob(g, 0, 0, 3, 3, '#4a4a4a');
  g.restore();
}

function tank(g: G2, T: TeamColors, p: UnitPose, heavy: boolean): void {
  const L = heavy ? 34 : 28, W = heavy ? 24 : 18, tw = heavy ? 8 : 6;
  g.save();
  g.rotate(p.f);
  treads(g, L, tw, W / 2 - tw / 2 + 1, p.walk);
  panel(g, -L / 2 + 2, -W / 2 + tw - 1, L - 4, W - tw * 2 + 2, 2, T.l, T.d);
  g.strokeStyle = 'rgba(0,0,0,.3)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(L / 2 - 6, -W / 2 + tw); g.lineTo(L / 2 - 6, W / 2 - tw); g.stroke();
  g.restore();
  g.save();
  g.rotate(p.tf);
  const recoil = p.atk > 0 ? (1 - p.atk) * 3 : 0, len = heavy ? 20 : 16;
  if (heavy) { barrel(g, 4 - recoil, -2.8, len, 2.6); barrel(g, 4 - recoil, 2.8, len, 2.6); }
  else { barrel(g, 4 - recoil, 0, len, 3); barrel(g, len + 1 - recoil, 0, 3, 4.2); }
  blob(g, 0, 0, heavy ? 9 : 7, heavy ? 8 : 6.5, shade(g, 0, 0, heavy ? 9 : 7, T.l, T.d));
  blob(g, -2, -2, 2, 2, 'rgba(0,0,0,.35)', false);
  g.restore();
}

function harvester(g: G2, T: TeamColors, p: UnitPose): void {
  g.save();
  g.rotate(p.f);
  treads(g, 32, 7, 9, p.walk);
  // ore bin
  panel(g, -15, -8, 19, 16, 2, '#9a9a92', '#55554e');
  if (p.load > 0.02) {
    const h = 6 * p.load;
    g.fillStyle = '#d8a828';
    g.beginPath(); g.ellipse(-5.5, 0, 8, Math.max(1, h), 0, 0, TAU); g.fill();
    g.fillStyle = '#ffe070';
    g.beginPath(); g.ellipse(-7, -1, 3, Math.max(0.5, h / 3), 0, 0, TAU); g.fill();
  }
  // cab
  panel(g, 4, -7, 9, 14, 2, T.l, T.d);
  g.fillStyle = '#9ec4d8';
  g.fillRect(9, -5, 2.4, 10);
  // scoop
  const dig = p.atk > 0 ? Math.sin(p.walk * 20) * 1.2 : 0;
  g.fillStyle = '#6a6a64';
  g.fillRect(13 + dig, -8, 3, 16);
  g.fillStyle = '#3a3a36';
  for (let y = -7; y < 8; y += 3) { g.beginPath(); g.moveTo(16 + dig, y); g.lineTo(19 + dig, y + 1.2); g.lineTo(16 + dig, y + 2.4); g.fill(); }
  g.restore();
}

// ---- medieval ----

const STEEL: [string, string] = ['#eef2f6', '#68707c'];

function feet(g: G2, p: UnitPose, color: string): number {
  const cs = Math.cos(p.f), sn = Math.sin(p.f), px = -sn, py = cs, sw = Math.sin(p.walk * TAU) * 2.6;
  blob(g, px * 2.4 + cs * sw, 1 + py * 1.2 + sn * sw * 0.5, 2, 1.6, color);
  blob(g, -px * 2.4 - cs * sw, 1 - py * 1.2 - sn * sw * 0.5, 2, 1.6, color);
  return -6 - Math.abs(sw) * 0.4;
}

function helmet(g: G2, T: TeamColors, hy: number, cs: number, back: boolean, plume: boolean): void {
  blob(g, 0, hy, 4, 4, shade(g, 0, hy, 4, STEEL[0], STEEL[1]));
  if (!back) { g.fillStyle = '#16161c'; g.fillRect(-2.8 + cs * 1, hy - 0.4, 5.6, 1.3); }
  if (plume) blob(g, 0, hy - 4.5, 1.5, 2.6, T.m);
}

function swordsman(g: G2, T: TeamColors, p: UnitPose): void {
  const cs = Math.cos(p.f), sn = Math.sin(p.f), back = sn < -0.3, by = feet(g, p, '#4c525c');
  // kite shield on the off hand
  const sa = p.f - 1.35, sx = Math.cos(sa) * 6, sy = by + 1.5 + Math.sin(sa) * 4;
  const shield = () => {
    g.beginPath(); g.moveTo(sx - 4, sy - 4.5); g.lineTo(sx + 4, sy - 4.5); g.lineTo(sx + 3.6, sy + 1); g.lineTo(sx, sy + 6); g.lineTo(sx - 3.6, sy + 1); g.closePath();
    g.fillStyle = shade(g, sx, sy, 6, T.l, T.d); g.fill();
    g.lineWidth = 1.2; g.strokeStyle = '#d8b040'; g.stroke();
    g.fillStyle = '#f4ecd8'; g.fillRect(sx - 0.7, sy - 3.5, 1.4, 7.5); g.fillRect(sx - 2.6, sy - 1.2, 5.2, 1.4);
  };
  // sword on the main hand, swinging through an arc
  const ha = p.f + 1.25, hx = Math.cos(ha) * 6, hy = by + 1.5 + Math.sin(ha) * 4;
  const a = p.atk > 0 ? p.f - 1.4 + p.atk * 2.5 : p.f - 0.4, qx = -Math.sin(a) * 2.6, qy = Math.cos(a) * 2.6;
  const gx = hx + Math.cos(a) * 2.5, gy = hy + Math.sin(a) * 2.5;
  const sword = () => {
    oline(g, gx, gy, hx + Math.cos(a) * 14, hy + Math.sin(a) * 14, 1.8, '#eef2f8');
    oline(g, gx + qx, gy + qy, gx - qx, gy - qy, 1.5, '#d8b040');
    blob(g, hx, hy, 1.7, 1.7, '#6a5a48');
  };
  if (back) { sword(); shield(); }
  blob(g, 0, by, 5.2, 6, shade(g, 0, by, 6, STEEL[0], STEEL[1]));
  g.fillStyle = T.m; g.fillRect(-3, by - 3.5, 6, 8);
  g.fillStyle = '#e8c050'; g.fillRect(-3, by + 0.5, 6, 1.2);
  helmet(g, T, by - 8, cs, back, true);
  if (!back) { sword(); shield(); }
}

function crossbowman(g: G2, T: TeamColors, p: UnitPose): void {
  const cs = Math.cos(p.f), sn = Math.sin(p.f), px = -sn, py = cs, back = sn < -0.3, by = feet(g, p, '#4a3418');
  const quiver = () => {
    g.save(); g.translate(-cs * 4 + px * 2, by - 3 - sn * 2); g.rotate(-0.5);
    g.fillStyle = '#6a4220'; g.fillRect(-2, -5, 4, 9);
    g.fillStyle = '#eee'; g.fillRect(-1.5, -7, 1.2, 2.4); g.fillRect(0.4, -7.5, 1.2, 2.4);
    g.restore();
  };
  // crossbow held out front: stock along the facing, bow across it
  const loaded = p.atk <= 0 || p.atk > 0.85;
  const bx = cs * 4, byy = by + 1 + sn * 3, fx = bx + cs * 8, fy = byy + sn * 6;
  const bow = () => {
    oline(g, bx, byy, fx, fy, 2, '#7a4a1e');
    oline(g, fx + px * 5, fy + py * 3.5, fx - px * 5, fy - py * 3.5, 1.6, '#4a4a4a');
    const pull = loaded ? 3.5 : 0;
    g.strokeStyle = 'rgba(240,240,230,.9)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(fx + px * 5, fy + py * 3.5); g.lineTo(fx - cs * pull, fy - sn * pull * 0.8); g.lineTo(fx - px * 5, fy - py * 3.5); g.stroke();
  };
  if (back) bow(); else quiver();
  blob(g, 0, by, 5, 6, shade(g, 0, by, 6, '#b0a48a', '#5a503c')); // padded jack
  oline(g, -3.5, by - 3.5, 3.5, by + 3.5, 1.8, T.m);
  // kettle hat: wide brim over a round crown
  blob(g, 0, by - 7.6, 3.4, 3.4, '#e2b48a');
  ellipseFill(g, 0, by - 9, 5.4, 2, '#7a808a');
  blob(g, 0, by - 10, 3.2, 2.6, shade(g, 0, by - 10, 3.2, STEEL[0], STEEL[1]));
  if (back) quiver(); else bow();
}

function knight(g: G2, T: TeamColors, p: UnitPose): void {
  const cs = Math.cos(p.f), sn = Math.sin(p.f), back = sn < -0.3, sw = Math.sin(p.walk * TAU);
  // barded horse, turned to its heading
  g.save();
  g.rotate(p.f);
  g.strokeStyle = '#2a1a0c'; g.lineWidth = 2; g.lineCap = 'round';
  for (const [lx, ly, ph] of [[7, 3.5, 1], [7, -3.5, -1], [-7, 3.5, -1], [-7, -3.5, 1]]) { g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + sw * ph * 3.5, ly + (ly > 0 ? 2.5 : -2.5)); g.stroke(); }
  oline(g, -11.5, 0, -16, sw * 2, 2, '#2a1a0c');
  blob(g, 0, 0, 11.5, 5.8, shade(g, 0, 0, 11, '#a87848', '#4a2a12'));
  blob(g, -1, 0, 8, 6.4, shade(g, -1, 0, 8, T.l, T.d)); // caparison
  g.strokeStyle = '#d8b040'; g.lineWidth = 1; g.beginPath(); g.ellipse(-1, 0, 8, 6.4, 0, 0, TAU); g.stroke();
  blob(g, 12, 0, 5.2, 3.2, shade(g, 12, 0, 5, '#9a6a3a', '#4a2a12'));
  blob(g, 13, 0, 3.2, 2.6, shade(g, 13, 0, 3, STEEL[0], STEEL[1]), false); // chanfron
  g.restore();
  // rider in plate, lance couched along the heading
  const ry = -9, reach = p.atk > 0 ? Math.sin(p.atk * Math.PI) * 6 : 0, la = p.f - 0.12;
  const lx0 = cs * 2 - sn * 4, ly0 = ry + 1 + sn * 2, lx1 = lx0 + Math.cos(la) * (24 + reach), ly1 = ly0 + Math.sin(la) * (24 + reach) - 3;
  const lance = () => {
    oline(g, lx0 - Math.cos(la) * 5, ly0 - Math.sin(la) * 5, lx1, ly1, 2, '#c8b890');
    g.fillStyle = T.m; g.beginPath();
    g.moveTo(lx1 - Math.cos(la) * 4, ly1 - Math.sin(la) * 4); g.lineTo(lx1 - Math.cos(la) * 9, ly1 - Math.sin(la) * 9 - 1); g.lineTo(lx1 - Math.cos(la) * 8, ly1 - Math.sin(la) * 8 - 5);
    g.fill();
  };
  const cape = () => blob(g, -cs * 2.5, ry + 2.5 - sn * 2, 5, 4.5, T.d);
  if (back) lance(); else cape();
  blob(g, 0, ry, 5.4, 5.8, shade(g, 0, ry, 6, STEEL[0], STEEL[1]));
  g.fillStyle = T.m; g.fillRect(-2.6, ry - 2.5, 5.2, 6);
  helmet(g, T, ry - 7.5, cs, back, true);
  if (back) cape(); else lance();
}

function catapult(g: G2, T: TeamColors, p: UnitPose): void {
  g.save();
  g.rotate(p.f);
  for (const [x, y] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) blob(g, x, y, 3.4, 1.8, '#3a2614');
  // frame
  g.fillStyle = '#7a5028';
  g.fillRect(-12, -7, 24, 3); g.fillRect(-12, 4, 24, 3); g.fillRect(-11, -7, 3, 14); g.fillRect(6, -7, 3, 14);
  g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.strokeRect(-12, -7, 24, 14);
  g.fillStyle = T.m; g.fillRect(-12, -7, 6, 3); g.fillRect(-12, 4, 6, 3);
  // uprights and axle
  g.fillStyle = '#5a3a1a'; g.fillRect(-1.5, -7, 3, 14);
  // throwing arm: rests pointing back, whips forward when it fires
  const k = p.atk > 0 ? Math.min(1, p.atk * 1.6) : 0, end = -14 + k * 26;
  oline(g, 0, 0, end, 0, 2.6, '#8a5e2c');
  blob(g, end, 0, 3.2, 3.2, '#6a4422');
  if (k < 0.3) blob(g, end, 0, 2.4, 2.4, shade(g, end, 0, 2.4, '#b8b0a4', '#5a544c'));
  g.fillStyle = '#4a4a4a'; g.fillRect(-4, -3, 4, 6); // counterweight
  g.restore();
}

/** A hot-air balloon seen from above and the side: striped envelope over a basket. */
function balloon(g: G2, T: TeamColors): void {
  g.save();
  g.translate(0, -10);
  oline(g, -5, 2, -2, 10, 0.8, '#a8885a');
  oline(g, 5, 2, 2, 10, 0.8, '#a8885a');
  g.fillStyle = '#8c7048'; g.fillRect(-3.5, 9, 7, 5); g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 0.8; g.strokeRect(-3.5, 9, 7, 5);
  blob(g, 0, -4, 9, 10, shade(g, 0, -4, 10, '#f2ece0', '#a89c80'));
  g.save();
  g.beginPath(); g.ellipse(0, -4, 9, 10, 0, 0, TAU); g.clip();
  g.fillStyle = T.m;
  for (const x of [-6, 0, 6]) g.fillRect(x - 1.6, -15, 3.2, 22);
  g.restore();
  g.restore();
}

/** A biplane from above: two wings across a fuselage, roundels and a propeller disc. */
function biplane(g: G2, T: TeamColors, p: UnitPose): void {
  g.save();
  g.translate(0, -6);
  g.rotate(p.f);
  panel(g, -3, -13, 7, 26, 1.5, '#e4dcc0', '#a49c80'); // top wing
  for (const y of [-9, 9]) blob(g, 0.5, y, 2.4, 2.4, T.m);
  panel(g, -11, -2.5, 20, 5, 2, T.l, T.d); // fuselage
  panel(g, -12, -5, 3, 10, 1, '#e4dcc0', '#a49c80'); // tailplane
  blob(g, 10, 0, 2, 2, '#3a3a3a');
  oline(g, 11, -5, 11, 5, 1.2, 'rgba(60,40,20,.6)');
  g.restore();
}

/** An attack helicopter from above: body, tail boom and a rotor disc. */
function helicopter(g: G2, T: TeamColors, p: UnitPose): void {
  g.save();
  g.translate(0, -6);
  g.rotate(p.f);
  oline(g, -4, 0, -15, 0, 2.2, T.d);
  panel(g, -16, -4, 3, 8, 1, T.d, '#222');
  panel(g, -3, -7, 4, 14, 1, '#4a4f58', '#2a2d30'); // stub wings
  blob(g, 1, 0, 7, 4.2, shade(g, 1, 0, 7, T.l, T.d));
  blob(g, 5, 0, 2.6, 2.2, '#9ec4d8');
  g.globalAlpha = 0.45;
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(-12, -9); g.lineTo(12, 9); g.moveTo(-12, 9); g.lineTo(12, -9); g.stroke();
  g.beginPath(); g.arc(0, 0, 14, 0, TAU); g.stroke();
  g.restore();
}

export function drawUnitArt(g: G2, type: UnitType, team: number, x: number, y: number, p: UnitPose, scale = 1): void {
  const T = teamColors(team), big = UNIT[type].radius > 8;
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  ellipseFill(g, 1.5, 3, big ? 16 : 6, big ? 9 : 3, 'rgba(0,0,0,.3)');
  switch (type) {
    case 'rifleman': case 'rocket': infantry(g, type, T, p); break;
    case 'swordsman': swordsman(g, T, p); break;
    case 'crossbowman': crossbowman(g, T, p); break;
    case 'knight': knight(g, T, p); break;
    case 'catapult': catapult(g, T, p); break;
    case 'jeep': jeep(g, T, p); break;
    case 'harvester': harvester(g, T, p); break;
    case 'balloon': balloon(g, T); break;
    case 'biplane': biplane(g, T, p); break;
    case 'helicopter': helicopter(g, T, p); break;
    default: tank(g, T, p, type === 'heavy');
  }
  g.restore();
}

/** A gun turret's rotating head, drawn over the building's base sprite. */
export function drawTurretHead(g: G2, team: number, x: number, y: number, tf: number, atk: number): void {
  const T = teamColors(team);
  g.save();
  g.translate(x, y);
  g.rotate(tf);
  const recoil = atk > 0 ? (1 - atk) * 3 : 0;
  barrel(g, 3 - recoil, 0, 18, 3.4);
  blob(g, 0, 0, 8, 7, shade(g, 0, 0, 8, T.l, T.d));
  blob(g, -2, -1.5, 2.4, 2.4, 'rgba(0,0,0,.3)', false);
  g.restore();
}

export const loadOf = (carry: number): number => Math.min(1, carry / HARVESTER_CAPACITY);
