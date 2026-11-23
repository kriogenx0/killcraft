// Flat things drawn over the 3D view: health bars and the drag-select box.
import { G, haulOf, isHarvester, unitDef } from '../../../game/state.ts';
import { V } from '../view_state.ts';
import { shownToPlayer } from '../render/minimap.ts';
import { clamp } from '../../../util/math.ts';
import { S, worldToScreen } from './scene.ts';
import { modelHeight } from './entities3d.ts';
import { drawFloatText } from './float_text.ts';

export function drawOverlay(g: CanvasRenderingContext2D): void {
  const w = g.canvas.width, h = g.canvas.height, r = S.canvas.getBoundingClientRect();
  g.clearRect(0, 0, w, h);
  for (const e of G.ents) {
    if (e.dead || e.kind === 'source' || !shownToPlayer(e) || (e.hp >= e.maxhp && !V.sel.includes(e) && e.upT == null)) continue;
    const p = worldToScreen(e.x, e.y, modelHeight(e) + 0.15);
    if (!p.front) continue;
    const x0 = p.sx - r.left, y0 = p.sy - r.top;
    if (x0 < -40 || y0 < -20 || x0 > w + 40 || y0 > h + 20) continue;
    const bw = e.w ? e.w * 18 : e.kind === 'unit' && unitDef(e).radius > 8 ? 30 : 22, f = clamp(e.hp / e.maxhp, 0, 1);
    const x = x0 - bw / 2;
    g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(x - 1, y0 - 1, bw + 2, 6);
    g.fillStyle = f > 0.6 ? '#3d3' : f > 0.3 ? '#ec3' : '#e33'; g.fillRect(x, y0, bw * f, 4);
    // a building upgrade under way: a bar below the health
    if (e.upT != null) { g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(x - 1, y0 + 5, bw + 2, 4); g.fillStyle = '#f0c040'; g.fillRect(x, y0 + 6, bw * clamp(e.upT, 0, 1), 2); }
    if (isHarvester(e) && e.team === V.team) { g.fillStyle = '#f0c040'; g.fillRect(x, y0 + 5, bw * Math.min(1, e.carry / haulOf(e)), 2); }
  }
  drawFloatText(g, r.left, r.top);
  if (V.mouse.down && V.mouse.drag) {
    const { sx, sy, x: mx, y: my } = V.mouse, x = Math.min(sx, mx) - r.left, y = Math.min(sy, my) - r.top, bw = Math.abs(mx - sx), bh = Math.abs(my - sy);
    g.fillStyle = 'rgba(80,255,80,.08)'; g.fillRect(x, y, bw, bh);
    g.strokeStyle = '#5f5'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, bw, bh);
  }
  if (V.paused) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, w, h); }
}
