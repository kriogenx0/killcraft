// Floating damage numbers. Read from health changes rather than from the combat code, so they
// show the same whether this screen runs the game or follows a server.
import { G, type Ent } from '../../../game/state.ts';
import { V } from '../view_state.ts';
import { shownToPlayer } from '../render/minimap.ts';
import { worldToScreen } from './scene.ts';
import { modelHeight } from './entities3d.ts';
import { groundY } from './heights.ts';

const LIFE = 1.1;
/** hits on the same target this close together add up into one number (fast guns would spam) */
const MERGE = 0.35;
const MAX = 120;

interface Pop { id: number; x: number; y: number; h: number; dmg: number; t0: number; own: boolean; dx: number }

const lastHp = new Map<number, number>();
let pops: Pop[] = [];
let lastT = 0;

function note(e: Ent, dmg: number): void {
  const now = G.gameT, open = pops.find((p) => p.id === e.id && now - p.t0 < MERGE);
  if (open) { open.dmg += dmg; open.x = e.x; open.y = e.y; return; }
  if (pops.length >= MAX) pops.shift();
  // numbers still rising over the same unit step aside so they don't sit on top of each other
  const stacked = pops.filter((p) => p.id === e.id).length;
  pops.push({ id: e.id, x: e.x, y: e.y, h: modelHeight(e), dmg, t0: now, own: e.team === V.team, dx: ((stacked % 3) - (stacked ? 0.5 : 0)) * 14 * (stacked % 2 ? 1 : -1) });
}

function track(): void {
  if (G.gameT < lastT) { lastHp.clear(); pops = []; } // a new game
  lastT = G.gameT;
  for (const e of G.ents) {
    if (e.kind === 'source') continue;
    const before = lastHp.get(e.id);
    const hp = Math.max(0, e.hp);
    if (before !== undefined && hp < before - 0.5 && shownToPlayer(e)) note(e, before - hp);
    if (e.dead) lastHp.delete(e.id);
    else lastHp.set(e.id, hp);
  }
  if (lastHp.size > G.ents.length * 2) for (const id of lastHp.keys()) if (!G.ents.some((e) => e.id === id)) lastHp.delete(id);
  pops = pops.filter((p) => G.gameT - p.t0 < LIFE);
}

/** Track health and draw the numbers, rising and fading over each struck unit. */
export function drawDamage(g: CanvasRenderingContext2D, left: number, top: number): void {
  track();
  if (!pops.length) return;
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,.85)';
  for (const p of pops) {
    const k = (G.gameT - p.t0) / LIFE, s = worldToScreen(p.x, p.y, groundY(p.x, p.y) + p.h + 0.2);
    if (!s.front) continue;
    const big = p.dmg >= 30, pop = k < 0.12 ? 1 + (0.12 - k) * 3 : 1;
    g.font = `bold ${Math.round((big ? 17 : 13) * pop)}px system-ui, sans-serif`;
    g.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    const x = s.sx - left + p.dx, y = s.sy - top - 6 - k * 28, txt = String(Math.round(p.dmg));
    g.strokeText(txt, x, y);
    g.fillStyle = p.own ? '#ff6a55' : big ? '#ffd23a' : '#fff4c8';
    g.fillText(txt, x, y);
  }
  g.restore();
}
