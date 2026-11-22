// Draws one frame of the battlefield and the minimap from engine state plus view state.
import { G, hooks, tileOf, unitDef, type Ent } from '../../../game/state.ts';
import { MW, MH, TS, WATER } from '../../../game/const.ts';
import { exploredAt, seenAt } from '../../../game/fog.ts';
import { canPlace, nearBase, tileFree } from '../../../game/building.ts';
import { BUILDING, type BldType } from '../../../data/building.ts';
import { ORE_TILE_MAX } from '../../../data/ore.ts';
import { teamColors } from '../../../data/team.ts';
import type { UnitType } from '../../../data/unit.ts';
import { clamp, hash, TAU } from '../../../util/math.ts';
import { ctx2d, mkCanvas } from '../../../util/canvas.ts';
import { MINI, terrain } from './terrain.ts';
import { sprite } from './building_art.ts';
import { drawTurretHead, drawUnitArt, loadOf } from './unit_art.ts';
import { drawDecals, drawFx } from './fx_draw.ts';
import { blob, oline } from './draw.ts';
import { MARKER_LIFE, PING_LIFE, V } from '../view_state.ts';

type G2 = CanvasRenderingContext2D;

const fog = { c: null as HTMLCanvasElement | null, img: null as ImageData | null };
let vignette: { w: number; h: number; grad: CanvasGradient } | null = null;

function updateFogImage(): void {
  if (!fog.c || !fog.img) return;
  const d = fog.img.data;
  for (let i = 0; i < MW * MH; i++) {
    d[i * 4] = 4; d[i * 4 + 1] = 6; d[i * 4 + 2] = 10;
    d[i * 4 + 3] = G.vis[i] === 2 ? 0 : G.vis[i] === 1 ? 135 : 255;
  }
  ctx2d(fog.c).putImageData(fog.img, 0, 0);
}

export function initFog(): void {
  fog.c = mkCanvas(MW, MH);
  fog.img = ctx2d(fog.c).createImageData(MW, MH);
  hooks.fogUpdated = updateFogImage;
  updateFogImage();
}

/** Enemy units show only while seen; buildings once explored. */
export function shownToPlayer(e: Ent): boolean {
  if (e.team === V.team) return true;
  return e.kind === 'unit' ? seenAt(e.x, e.y) : exploredAt(e.x, e.y);
}

/** Snap the building ghost under the pointer to the grid. */
export function updatePlacement(): void {
  const m = V.mode;
  if (m?.t !== 'place') return;
  const s = BUILDING[m.type].size;
  m.tx = clamp(Math.floor((V.mouse.x + V.cam.x - (s * TS) / 2 + TS / 2) / TS), 0, MW - s);
  m.ty = clamp(Math.floor((V.mouse.y + V.cam.y - (s * TS) / 2 + TS / 2) / TS), 0, MH - s);
  m.ok = canPlace(m.tx, m.ty, s, V.team);
}

const sortY = (e: Ent) => (e.kind === 'unit' ? e.y : (e.ty + e.h) * TS - 6);

function visibleTiles(): [number, number, number, number] {
  const { cam, viewW, viewH } = V;
  return [Math.max(0, Math.floor(cam.x / TS)), Math.max(0, Math.floor(cam.y / TS)), Math.min(MW - 1, Math.floor((cam.x + viewW) / TS) + 1), Math.min(MH - 1, Math.floor((cam.y + viewH) / TS) + 1)];
}

function drawWaterGlints(g: G2): void {
  const [tx0, ty0, tx1, ty1] = visibleTiles();
  g.strokeStyle = '#dff4ff';
  g.lineWidth = 1.2;
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      if (G.terr[ty * MW + tx] !== WATER || !G.vis[ty * MW + tx]) continue;
      const h = hash(tx, ty), ph = (G.gameT * 0.5 + h * 7) % 2.5;
      if (ph > 1) continue;
      g.globalAlpha = Math.sin(ph * Math.PI) * 0.5;
      const x = tx * TS - V.cam.x + 6 + h * 16, y = ty * TS - V.cam.y + 8 + hash(ty, tx) * 14;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 4, y - 2.5, x + 8, y); g.stroke();
    }
  g.globalAlpha = 1;
}

/** Ore nuggets: more and bigger on richer tiles. */
function drawOre(g: G2): void {
  const [tx0, ty0, tx1, ty1] = visibleTiles(), t = G.gameT;
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * MW + tx, ore = G.ore[i];
      if (ore <= 0 || !G.vis[i]) continue;
      const x0 = tx * TS - V.cam.x, y0 = ty * TS - V.cam.y, f = ore / ORE_TILE_MAX, n = 1 + Math.round(f * 5);
      g.fillStyle = 'rgba(120,80,20,.28)';
      g.beginPath(); g.ellipse(x0 + 16, y0 + 17, 12 * Math.sqrt(f) + 4, 9 * Math.sqrt(f) + 3, 0, 0, TAU); g.fill();
      for (let k = 0; k < n; k++) {
        const hx = hash(tx * 7 + k, ty * 3 - k), hy = hash(ty * 5 + k, tx - k * 2), s = 2 + f * 2.5 + hx * 1.5;
        const x = x0 + 5 + hx * 22, y = y0 + 6 + hy * 20;
        g.fillStyle = '#7a4c08';
        g.beginPath(); g.moveTo(x - s, y + s * 0.6); g.lineTo(x - s * 0.4, y - s); g.lineTo(x + s * 0.6, y - s * 0.8); g.lineTo(x + s, y + s * 0.5); g.closePath(); g.fill();
        g.fillStyle = hx > 0.5 ? '#f0c040' : '#e0a828';
        g.beginPath(); g.moveTo(x - s * 0.7, y + s * 0.3); g.lineTo(x - s * 0.3, y - s * 0.8); g.lineTo(x + s * 0.4, y - s * 0.6); g.lineTo(x + s * 0.6, y + s * 0.2); g.closePath(); g.fill();
        if ((t * 0.7 + hx * 9) % 3 < 0.25) { g.fillStyle = '#fff8d0'; g.fillRect(x - 0.5, y - s * 0.6, 1.5, 1.5); }
      }
    }
}

function drawSelection(g: G2, list: Ent[]): void {
  const { cam } = V;
  for (const e of V.sel) {
    if (e.dead || !list.includes(e)) continue;
    g.strokeStyle = e.team === V.team ? '#5f5' : e.team < 0 ? '#ff5' : '#f55';
    g.lineWidth = 2;
    g.beginPath();
    if (e.w) {
      const x = e.tx * TS - cam.x, y = e.ty * TS - cam.y, w = e.w * TS, h = e.h * TS, c = Math.min(10, w / 3);
      for (const [px, py, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
        g.moveTo(px + dx * c, py); g.lineTo(px, py); g.lineTo(px, py + dy * c);
      }
    } else {
      const r = unitDef(e).radius + 5;
      g.ellipse(e.x - cam.x, e.y - cam.y + 2, r, r * 0.55, 0, 0, TAU);
    }
    g.stroke();
    if (e.kind === 'bld' && e.rally && e.team === V.team) {
      const rx = e.rally.x - cam.x, ry = e.rally.y - cam.y;
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.setLineDash([5, 5]);
      g.beginPath(); g.moveTo(e.x - cam.x, e.y - cam.y); g.lineTo(rx, ry); g.stroke(); g.setLineDash([]);
      oline(g, rx, ry, rx, ry - 18, 1.5, '#555');
      g.fillStyle = teamColors(V.team).m; g.beginPath(); g.moveTo(rx + 1, ry - 18); g.lineTo(rx + 12, ry - 14); g.lineTo(rx + 1, ry - 10); g.fill();
    }
  }
}

function drawBuilding(g: G2, b: Ent): void {
  const x = b.tx * TS - V.cam.x, y = b.ty * TS - V.cam.y;
  const sp = b.kind === 'source' ? sprite('source', -1) : sprite(b.type as BldType, b.team);
  if (b.flash > 0) g.globalAlpha = 0.8;
  if (b.prog < 1) {
    // rising out of the ground after placement
    const full = sp.c.height, shown = full * b.prog;
    g.save();
    g.beginPath(); g.rect(x - sp.ox, y - sp.oy + full - shown, sp.c.width, shown); g.clip();
    g.drawImage(sp.c, x - sp.ox, y - sp.oy + (1 - b.prog) * 10);
    g.restore();
  } else g.drawImage(sp.c, x - sp.ox, y - sp.oy);
  g.globalAlpha = 1;
  if (b.type === 'turret' && b.prog >= 1) drawTurretHead(g, b.team, b.x - V.cam.x, b.y - V.cam.y - 1, b.tface, b.atkT > 0 ? 1 - b.atkT / 0.25 : 0);
  if (b.repairing && (G.gameT * 2) % 1 < 0.6) {
    g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.arc(b.x - V.cam.x, b.y - V.cam.y, 9, 0, TAU); g.fill();
    oline(g, b.x - V.cam.x - 4, b.y - V.cam.y + 4, b.x - V.cam.x + 4, b.y - V.cam.y - 4, 2.5, '#e8e8e0');
  }
}

function drawUnit(g: G2, u: Ent): void {
  if (u.flash > 0) g.globalAlpha = 0.6;
  drawUnitArt(g, u.type as UnitType, u.team, u.x - V.cam.x, u.y - V.cam.y, {
    f: u.face, tf: u.tface, walk: u.moving || u.atkT > 0 ? u.walk + (u.type === 'harvester' ? G.gameT : 0) : 0,
    atk: u.atkT > 0 ? 1 - u.atkT / 0.25 : 0, load: loadOf(u.carry),
  });
  g.globalAlpha = 1;
}

function drawProjectiles(g: G2): void {
  for (const p of G.projs) {
    if (!seenAt(p.x, p.y)) continue;
    const x = p.x - V.cam.x, y = p.y - V.cam.y, yy = y - p.z, ca = Math.cos(p.a), sa = Math.sin(p.a);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - 2, y - 1, 4, 2);
    if (p.kind === 'rocket') {
      oline(g, x - ca * 7, yy - sa * 7, x, yy, 2, '#d8d8c8');
      g.fillStyle = '#ffb040'; g.beginPath(); g.arc(x - ca * 8, yy - sa * 8, 2.2, 0, TAU); g.fill();
    } else if (p.kind === 'bolt') {
      oline(g, x - ca * 8, yy - sa * 8, x, yy, 1, '#c8a878');
      g.fillStyle = '#e8e8e0'; g.fillRect(x - ca * 8 - 1, yy - sa * 8 - 1, 2, 2);
    } else if (p.kind === 'boulder') {
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, y, 4, 2, 0, 0, TAU); g.fill();
      blob(g, x, yy, 4, 3.6, '#8a8278');
      g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(x - 1.2, yy - 1.2, 1.4, 0, TAU); g.fill();
    } else {
      g.strokeStyle = 'rgba(255,220,140,.9)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - ca * 8, yy - sa * 8); g.lineTo(x, yy); g.stroke();
    }
  }
}

function drawHealthBars(g: G2, list: Ent[]): void {
  for (const e of list) {
    if (e.kind === 'source' || (e.hp >= e.maxhp && !V.sel.includes(e))) continue;
    const f = clamp(e.hp / e.maxhp, 0, 1);
    const r = e.kind === 'unit' ? unitDef(e).radius : 0;
    const [x, y, w] = e.w
      ? [e.tx * TS - V.cam.x + 4, (e.ty + e.h) * TS - V.cam.y + 3, e.w * TS - 8]
      : [e.x - V.cam.x - r - 4, e.y - V.cam.y - r - 18, r * 2 + 8];
    g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(x - 1, y - 1, w + 2, 6);
    g.fillStyle = f > 0.6 ? '#3d3' : f > 0.3 ? '#ec3' : '#e33'; g.fillRect(x, y, w * f, 4);
    if (e.type === 'harvester' && e.team === V.team) { g.fillStyle = '#f0c040'; g.fillRect(x, y + 5, w * loadOf(e.carry), 2); }
  }
}

function drawPlacement(g: G2): void {
  const m = V.mode;
  if (m?.t !== 'place') return;
  const s = BUILDING[m.type].size, sp = sprite(m.type, V.team), near = nearBase(m.tx, m.ty, s, V.team);
  g.globalAlpha = 0.55;
  g.drawImage(sp.c, m.tx * TS - V.cam.x - sp.ox, m.ty * TS - V.cam.y - sp.oy);
  g.globalAlpha = 1;
  for (let y = m.ty; y < m.ty + s; y++)
    for (let x = m.tx; x < m.tx + s; x++) {
      g.fillStyle = near && tileFree(x, y, V.team) ? 'rgba(60,255,60,.28)' : 'rgba(255,40,40,.45)';
      g.fillRect(x * TS - V.cam.x + 1, y * TS - V.cam.y + 1, TS - 2, TS - 2);
    }
}

export function render(g: G2): void {
  const { cam, vw, vh, viewW, viewH } = V;
  g.fillStyle = '#000'; g.fillRect(0, 0, vw, vh);
  g.imageSmoothingEnabled = false;
  g.drawImage(terrain.full, cam.x, cam.y, vw, vh, 0, 0, vw, vh);
  drawWaterGlints(g);
  drawOre(g);
  drawDecals(g);
  const list = G.ents.filter((e) => !e.dead && shownToPlayer(e) && e.x + 140 > cam.x && e.x - 140 < cam.x + viewW && e.y + 160 > cam.y && e.y - 140 < cam.y + viewH);
  drawSelection(g, list);
  list.sort((a, b) => sortY(a) - sortY(b));
  for (const e of list) if (e.kind === 'unit') drawUnit(g, e); else drawBuilding(g, e);
  drawProjectiles(g);
  drawFx(g);
  drawHealthBars(g, list);
  for (const m of V.markers) {
    const k = m.t / MARKER_LIFE;
    g.strokeStyle = m.color; g.globalAlpha = 1 - k; g.lineWidth = 2;
    g.beginPath(); g.ellipse(m.x - cam.x, m.y - cam.y, 14 * (1 - k * 0.6), 7 * (1 - k * 0.6), 0, 0, TAU); g.stroke();
    g.globalAlpha = 1;
  }
  if (fog.c) {
    // two offset, smoothed passes give soft fog edges
    g.imageSmoothingEnabled = true;
    g.drawImage(fog.c, -cam.x - TS / 2, -cam.y - TS / 2, (MW + 1) * TS, (MH + 1) * TS);
    g.drawImage(fog.c, -cam.x, -cam.y, MW * TS, MH * TS);
  }
  drawPlacement(g);
  if (V.mouse.down && V.mouse.drag) {
    const { sx, sy, x: mx, y: my } = V.mouse, x = Math.min(sx, mx), y = Math.min(sy, my), w = Math.abs(mx - sx), h = Math.abs(my - sy);
    g.fillStyle = 'rgba(80,255,80,.08)'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#5f5'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w, h);
  }
  if (!vignette || vignette.w !== viewW || vignette.h !== viewH) {
    const grad = g.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.45, viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,.35)');
    vignette = { w: viewW, h: viewH, grad };
  }
  g.fillStyle = vignette.grad; g.fillRect(0, 0, viewW, viewH);
  if (V.paused) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, vw, vh); }
}

export function drawMinimap(m: G2): void {
  const k = MINI / MW;
  m.imageSmoothingEnabled = true;
  m.drawImage(terrain.mini, 0, 0);
  m.fillStyle = '#e0b030';
  for (let i = 0; i < MW * MH; i++) if (G.ore[i] > 0 && G.vis[i]) m.fillRect((i % MW) * k, ((i / MW) | 0) * k, k, k);
  for (const e of G.ents) {
    if (e.dead) continue;
    if (e.team !== V.team && G.vis[tileOf(e.y) * MW + tileOf(e.x)] < (e.kind === 'unit' ? 2 : 1)) continue;
    m.fillStyle = e.team < 0 ? '#fff0a0' : teamColors(e.team).l;
    const s = e.w ? e.w * k : 3, x = (e.x / TS) * k - s / 2, y = (e.y / TS) * k - s / 2;
    m.fillRect(x, y, s, s);
    if (e.w) { m.strokeStyle = 'rgba(0,0,0,.6)'; m.lineWidth = 1; m.strokeRect(x, y, s, s); }
  }
  if (fog.c) m.drawImage(fog.c, 0, 0, MINI, MINI);
  for (const p of V.pings) {
    m.strokeStyle = `rgba(255,60,60,${1 - p.t / PING_LIFE})`; m.lineWidth = 2;
    m.beginPath(); m.arc((p.x / TS) * k, (p.y / TS) * k, 4 + ((p.t * 20) % 14), 0, TAU); m.stroke();
  }
  m.strokeStyle = '#fff'; m.lineWidth = 1;
  m.strokeRect((V.cam.x / TS) * k + 0.5, (Math.max(0, V.cam.y) / TS) * k + 0.5, (V.viewW / TS) * k, (V.viewH / TS) * k);
}
