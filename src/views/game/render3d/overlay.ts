// Flat things drawn over the 3D view: health bars and the drag-select box.
import { G, haulOf, isHarvester, unitDef } from '../../../game/state.ts';
import { V } from '../view_state.ts';
import { standLift } from './heights.ts';
import { shownToPlayer } from '../render/minimap.ts';
import { clamp } from '../../../util/math.ts';
import { S, worldToScreen } from './scene.ts';
import { modelHeight } from './entities3d.ts';
import { drawFloatText } from './float_text.ts';
import { maxMana } from '../../../game/spells.ts';

/**
 * The one quiet bar for work under way on a building (going up, or upgrading): thin and gold over a
 * faint track, centered on (cx, y).
 */
function workBar(g: CanvasRenderingContext2D, cx: number, y: number, bw: number, f: number): void {
  const x = cx - bw / 2;
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x - 1, y - 1, bw + 2, 4);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, bw, 2);
  g.fillStyle = 'rgba(240,200,90,.9)'; g.fillRect(x, y, bw * clamp(f, 0, 1), 2);
}

export function drawOverlay(g: CanvasRenderingContext2D): void {
  const w = g.canvas.width, h = g.canvas.height, r = S.canvas.getBoundingClientRect();
  g.clearRect(0, 0, w, h);
  for (const e of G.ents) {
    if (e.dead || e.kind === 'source' || !shownToPlayer(e)) continue;
    // a construction site: a thin progress bar instead of a health bar (its health is in the panel)
    if (e.kind === 'bld' && !e.done) {
      const s = worldToScreen(e.x, e.y, standLift(e) + modelHeight(e) * Math.max(0.15, e.prog) + 0.2);
      if (s.front) workBar(g, s.sx - r.left, s.sy - r.top, e.w * 16, e.prog);
      continue;
    }
    const hurt = e.hp < e.maxhp || V.sel.includes(e);
    if (!hurt && e.upT == null) continue;
    const p = worldToScreen(e.x, e.y, standLift(e) + modelHeight(e) + 0.15);
    if (!p.front) continue;
    const x0 = p.sx - r.left, y0 = p.sy - r.top;
    if (x0 < -40 || y0 < -20 || x0 > w + 40 || y0 > h + 20) continue;
    const bw = e.w ? e.w * 18 : e.kind === 'unit' && unitDef(e).radius > 8 ? 30 : 22, f = clamp(e.hp / e.maxhp, 0, 1);
    const x = x0 - bw / 2;
    // an upgrade under way: the work bar, just under the health bar when that shows
    if (e.upT != null) workBar(g, x0, hurt ? y0 + 7 : y0, e.w * 16, e.upT);
    if (!hurt) continue;
    g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(x - 1, y0 - 1, bw + 2, 6);
    g.fillStyle = f > 0.6 ? '#3d3' : f > 0.3 ? '#ec3' : '#e33'; g.fillRect(x, y0, bw * f, 4);
    if (isHarvester(e) && e.team === V.team) { g.fillStyle = '#f0c040'; g.fillRect(x, y0 + 5, bw * Math.min(1, e.carry / haulOf(e)), 2); }
    // a caster's mana, in blue under its health
    const mm = e.team === V.team ? maxMana(e) : 0;
    if (mm) { g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(x - 1, y0 + 4, bw + 2, 4); g.fillStyle = '#4a9cff'; g.fillRect(x, y0 + 5, bw * clamp((e.mana ?? 0) / mm, 0, 1), 2); }
  }
  drawFloatText(g, r.left, r.top);
  if (V.mouse.down && V.mouse.drag) {
    const { sx, sy, x: mx, y: my } = V.mouse, x = Math.min(sx, mx) - r.left, y = Math.min(sy, my) - r.top, bw = Math.abs(mx - sx), bh = Math.abs(my - sy);
    g.fillStyle = 'rgba(80,255,80,.08)'; g.fillRect(x, y, bw, bh);
    g.strokeStyle = '#5f5'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, bw, bh);
  }
  // a finger held long enough to draw a box: a ring under it says so
  if (V.mouse.down && V.mouse.hold) {
    g.strokeStyle = '#5f5'; g.lineWidth = 2;
    g.beginPath(); g.arc(V.mouse.x - r.left, V.mouse.y - r.top, 28, 0, Math.PI * 2); g.stroke();
  }
  if (V.paused) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, w, h); }
}
