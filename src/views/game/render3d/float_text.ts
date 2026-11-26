// Numbers that float up off the map: red damage over anything struck, and "+25 ore" where your
// side banks resources. Damage is read from health changes rather than from the combat code, so it
// shows the same whether this screen runs the game or follows a server.
import { G, hooks, type Ent } from '../../../game/state.ts';
import { V } from '../view_state.ts';
import { shownToPlayer } from '../render/minimap.ts';
import { worldToScreen } from './scene.ts';
import { modelHeight } from './entities3d.ts';
import { groundY } from './heights.ts';

type Resource = 'ore' | 'wood' | 'oil' | 'aether';

const DAMAGE_COL = '#ff4a3a';
const RES_COL: Record<Resource, string> = { ore: '#ffd23a', wood: '#e8a860', oil: '#8fd0ff', aether: '#d2b0ff' };
const MAX = 160;

interface Kind { life: number; merge: number; rise: number }
/** hits (or a steady unload) on the same spot this close together add up into one number */
const DAMAGE: Kind = { life: 1.1, merge: 0.35, rise: 28 };
const GAIN: Kind = { life: 1.6, merge: 0.6, rise: 40 };

interface Pop { key: string; k: Kind; x: number; y: number; h: number; amt: number; t0: number; col: string; unit: string; dx: number; dy: number }

const lastHp = new Map<number, number>();
let pops: Pop[] = [];
let lastT = 0;

function add(key: string, k: Kind, x: number, y: number, h: number, amt: number, col: string, unit: string): void {
  const now = G.gameT, open = pops.find((p) => p.key === key && now - p.t0 < k.merge);
  if (open) {
    open.amt += amt; open.x = x; open.y = y;
    if (k === GAIN) open.t0 = now; // a load being unloaded counts up in place, then rises once it's all in
    return;
  }
  if (pops.length >= MAX) pops.shift();
  // numbers still rising from the same spot step aside so they don't sit on top of each other
  const stacked = pops.filter((p) => p.key.split('|')[0] === key.split('|')[0] && now - p.t0 < 0.3).length;
  pops.push({ key, k, x, y, h, amt, t0: now, col, unit, dx: stacked % 2 ? 16 : stacked ? -16 : 0, dy: -stacked * 6 });
}

// resources: only your own side's, and only from the game this screen runs
hooks.gain = (team, x, y, kind, amount, by) => {
  if (team !== V.team || amount <= 0) return;
  add(`${by}|${kind}`, GAIN, x, y, 0.6, amount, RES_COL[kind], ` ${kind === 'aether' ? 'Aether' : kind}`);
};

function damage(e: Ent, dmg: number): void {
  add(`${e.id}|hp`, DAMAGE, e.x, e.y, modelHeight(e), dmg, DAMAGE_COL, '');
}

function track(): void {
  if (G.gameT < lastT) { lastHp.clear(); pops = []; } // a new game
  lastT = G.gameT;
  for (const e of G.ents) {
    if (e.kind === 'source') continue;
    const before = lastHp.get(e.id);
    const hp = Math.max(0, e.hp);
    if (before !== undefined && hp < before - 0.5 && shownToPlayer(e)) damage(e, before - hp);
    if (e.dead) lastHp.delete(e.id);
    else lastHp.set(e.id, hp);
  }
  if (lastHp.size > G.ents.length * 2) for (const id of lastHp.keys()) if (!G.ents.some((e) => e.id === id)) lastHp.delete(id);
  pops = pops.filter((p) => G.gameT - p.t0 < p.k.life);
}

/** Track health and draw the numbers, rising and fading where they happened. */
export function drawFloatText(g: CanvasRenderingContext2D, left: number, top: number): void {
  track();
  if (!pops.length) return;
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.lineJoin = 'round';
  // phones (upright or on their side): smaller numbers, so they don't cover the little units
  const small = V.vw <= 760 || V.vh <= 500, sc = small ? 0.7 : 1;
  g.lineWidth = small ? 2.5 : 3;
  g.strokeStyle = 'rgba(0,0,0,.85)';
  for (const p of pops) {
    const n = Math.round(p.amt);
    if (n < 1) continue; // a trickle still adding up
    const k = (G.gameT - p.t0) / p.k.life, s = worldToScreen(p.x, p.y, groundY(p.x, p.y) + p.h + 0.2);
    if (!s.front) continue;
    const big = p.unit ? true : n >= 30, pop = k < 0.12 ? 1 + (0.12 - k) * 3 : 1;
    g.font = `bold ${Math.round((big ? 16 : 13) * sc * pop)}px system-ui, sans-serif`;
    g.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    const x = s.sx - left + p.dx * sc, y = s.sy - top - 6 + (p.dy - k * p.k.rise) * sc, txt = p.unit ? `+${n}${p.unit}` : String(n);
    g.strokeText(txt, x, y);
    g.fillStyle = p.col;
    g.fillText(txt, x, y);
  }
  g.restore();
}
