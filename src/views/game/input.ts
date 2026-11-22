// Mouse, touch and keyboard controls for the battlefield and minimap.
import { G, bldDef, tileOf, unitDef, valid, type Ent } from '../../game/state.ts';
import { MW, MH, TS } from '../../game/const.ts';
import { exploredAt, seenAt } from '../../game/fog.ts';
import { dispatch, ids } from './dispatch.ts';
import { centerCam, ownSelected, selectedUnits, V } from './view_state.ts';
import { refreshCommands, runHotkey, setSelection } from './hud.ts';
import { SCROLL_KEYS, scrollVector, tracksKey } from './keyboard.ts';

const DRAG_START = 6;
const DOUBLE_TAP = 350;

function shownAt(e: Ent): boolean {
  if (e.team === V.team) return true;
  return e.kind === 'unit' ? seenAt(e.x, e.y) : exploredAt(e.x, e.y);
}

export function entityAt(wx: number, wy: number): Ent | null {
  let best: Ent | null = null, bd = 1e9;
  for (const e of G.ents) {
    if (e.dead || !shownAt(e)) continue;
    if (e.w) {
      if (wx >= e.tx * TS && wx < (e.tx + e.w) * TS && wy >= e.ty * TS - 10 && wy < (e.ty + e.h) * TS) {
        const d = Math.hypot(wx - e.x, wy - e.y) + 100;
        if (d < bd) { bd = d; best = e; }
      }
    } else {
      const r = unitDef(e).radius, d = Math.hypot(wx - e.x, wy - (e.y - (r < 8 ? 6 : 0)));
      if (d < r + 7 && d < bd) { bd = d; best = e; }
    }
  }
  return best;
}

const mark = (x: number, y: number, color: string) => V.markers.push({ x, y, t: 0, color });
const isEnemy = (e: Ent | null): boolean => !!e && e.team !== V.team && e.team >= 0;

/** Context command at a world point: attack, harvest, unload, rally or move. */
export function worldCommand(wx: number, wy: number): void {
  const own = ownSelected();
  if (!own.length) return;
  const units = own.filter((e) => e.kind === 'unit');
  const tx = tileOf(wx), ty = tileOf(wy), hit = entityAt(wx, wy);
  if (!units.length) {
    const b = own[0];
    if (b.kind === 'bld' && b.done && bldDef(b).produces && bldDef(b).produces !== 'structure') { dispatch({ c: 'rally', id: b.id, x: Math.round(wx), y: Math.round(wy) }); mark(wx, wy, '#5f5'); }
    return;
  }
  if (hit && isEnemy(hit)) {
    const armed = units.filter((u) => unitDef(u).weapon), unarmed = units.filter((u) => !armed.includes(u));
    dispatch({ c: 'attack', ids: ids(armed), target: hit.id });
    if (unarmed.length) dispatch({ c: 'move', ids: ids(unarmed), tx, ty, amove: false });
    mark(wx, wy, '#f44');
    return;
  }
  const harvesters = units.filter((u) => u.type === 'harvester'), rest = units.filter((u) => u.type !== 'harvester');
  const moveRest = () => rest.length && dispatch({ c: 'move', ids: ids(rest), tx, ty, amove: false });
  if (harvesters.length && hit?.type === 'refinery' && hit.team === V.team) { dispatch({ c: 'return', ids: ids(harvesters) }); moveRest(); mark(wx, wy, '#ff5'); return; }
  if (harvesters.length && G.ore[ty * MW + tx] > 0 && G.vis[ty * MW + tx]) { dispatch({ c: 'harvest', ids: ids(harvesters), tx, ty }); moveRest(); mark(wx, wy, '#ff5'); return; }
  dispatch({ c: 'move', ids: ids(units), tx, ty, amove: false });
  mark(wx, wy, '#5f5');
}

/** Finish a targeting command (move, attack-move or place) at a world point. */
function useMode(wx: number, wy: number): void {
  const m = V.mode;
  if (!m) return;
  if (m.t === 'place') {
    if (m.ok) { dispatch({ c: 'place', tx: m.tx, ty: m.ty }); V.mode = null; }
    refreshCommands(true);
    return;
  }
  V.mode = null;
  const us = selectedUnits(), hit = entityAt(wx, wy);
  if (hit && isEnemy(hit)) { dispatch({ c: 'attack', ids: ids(us), target: hit.id }); mark(wx, wy, '#f44'); }
  else { dispatch({ c: 'move', ids: ids(us), tx: tileOf(wx), ty: tileOf(wy), amove: m.t === 'amove' }); mark(wx, wy, m.t === 'amove' ? '#f44' : '#5f5'); }
  refreshCommands(true);
}

function boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
  const l = Math.min(x0, x1) + V.cam.x, r = Math.max(x0, x1) + V.cam.x, t = Math.min(y0, y1) + V.cam.y, b = Math.max(y0, y1) + V.cam.y;
  const us = G.ents.filter((e) => !e.dead && e.kind === 'unit' && e.team === V.team && e.x >= l - 8 && e.x <= r + 8 && e.y >= t - 8 && e.y <= b + 8);
  // prefer combat units over harvesters in a box
  const army = us.filter((u) => u.type !== 'harvester'), pick = army.length ? army : us;
  if (pick.length) setSelection(add ? [...new Set([...selectedUnits(), ...pick])] : pick);
  else if (!add) setSelection([]);
}

function selectSameType(e: Ent): void {
  const { cam, viewW, viewH } = V;
  setSelection(G.ents.filter((o) => !o.dead && o.team === V.team && o.type === e.type && o.x > cam.x && o.x < cam.x + viewW && o.y > cam.y && o.y < cam.y + viewH));
}

function clickSelect(sx: number, sy: number, add: boolean): void {
  const e = entityAt(sx + V.cam.x, sy + V.cam.y);
  if (!e) { if (!add) setSelection([]); return; }
  if (add && e.kind === 'unit' && e.team === V.team && V.sel.every((s) => s.kind === 'unit' && s.team === V.team)) {
    setSelection(V.sel.includes(e) ? V.sel.filter((s) => s !== e) : [...V.sel, e]);
    return;
  }
  setSelection([e]);
}

let lastTap = { t: 0, id: 0 };
/** Touch: tap selects your own things; with something selected, tapping elsewhere gives an order. */
function tap(sx: number, sy: number): void {
  const wx = sx + V.cam.x, wy = sy + V.cam.y;
  if (V.mode) { useMode(wx, wy); return; }
  const e = entityAt(wx, wy), now = performance.now();
  if (e && e.team === V.team) {
    if (lastTap.id === e.id && now - lastTap.t < DOUBLE_TAP && e.kind === 'unit') selectSameType(e);
    else setSelection([e]);
    lastTap = { t: now, id: e.id };
    return;
  }
  if (ownSelected().length) worldCommand(wx, wy);
  else setSelection(e ? [e] : []);
}

function minimapWorld(ev: PointerEvent, mini: HTMLCanvasElement): [number, number] {
  const r = mini.getBoundingClientRect();
  return [((ev.clientX - r.left) / r.width) * MW * TS, ((ev.clientY - r.top) / r.height) * MH * TS];
}

export function initInput(canvas: HTMLCanvasElement, mini: HTMLCanvasElement): void {
  let touch: { id: number; x: number; y: number; panned: boolean } | null = null;

  canvas.addEventListener('pointerdown', (ev) => {
    if (!V.started || G.demo) return;
    V.mouse.x = ev.clientX; V.mouse.y = ev.clientY;
    if (ev.pointerType === 'touch') { touch = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, panned: false }; return; }
    const wx = ev.clientX + V.cam.x, wy = ev.clientY + V.cam.y;
    if (ev.button === 2) {
      if (V.mode) { V.mode = null; refreshCommands(true); } else worldCommand(wx, wy);
      return;
    }
    if (ev.button !== 0) return;
    if (V.mode) { useMode(wx, wy); return; }
    Object.assign(V.mouse, { down: true, drag: false, sx: ev.clientX, sy: ev.clientY });
    canvas.setPointerCapture(ev.pointerId);
  });

  window.addEventListener('pointermove', (ev) => {
    V.mouse.x = ev.clientX; V.mouse.y = ev.clientY; V.mouse.inside = ev.pointerType === 'mouse';
    if (touch && ev.pointerId === touch.id) {
      const dx = ev.clientX - touch.x, dy = ev.clientY - touch.y;
      if (touch.panned || Math.hypot(dx, dy) > DRAG_START) {
        touch.panned = true;
        V.cam.x -= dx; V.cam.y -= dy;
        touch.x = ev.clientX; touch.y = ev.clientY;
      }
      return;
    }
    if (V.mouse.down && Math.hypot(V.mouse.x - V.mouse.sx, V.mouse.y - V.mouse.sy) > DRAG_START) V.mouse.drag = true;
  });

  canvas.addEventListener('pointerup', (ev) => {
    if (touch && ev.pointerId === touch.id) {
      if (!touch.panned) tap(ev.clientX, ev.clientY);
      touch = null;
      return;
    }
    if (ev.button !== 0 || !V.mouse.down) return;
    if (V.mouse.drag) boxSelect(V.mouse.sx, V.mouse.sy, ev.clientX, ev.clientY, ev.shiftKey);
    else clickSelect(ev.clientX, ev.clientY, ev.shiftKey);
    V.mouse.down = false;
    V.mouse.drag = false;
  });

  canvas.addEventListener('pointercancel', () => { touch = null; V.mouse.down = false; V.mouse.drag = false; });
  document.addEventListener('pointerleave', () => { V.mouse.inside = false; });
  canvas.addEventListener('dblclick', (ev) => {
    if (!V.started || G.demo) return;
    const e = entityAt(ev.clientX + V.cam.x, ev.clientY + V.cam.y);
    if (e?.kind === 'unit' && e.team === V.team) selectSameType(e);
  });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  mini.addEventListener('contextmenu', (ev) => ev.preventDefault());

  let miniDrag = false;
  mini.addEventListener('pointerdown', (ev) => {
    if (!V.started) return;
    const [wx, wy] = minimapWorld(ev, mini);
    if (ev.button === 2) { worldCommand(wx, wy); return; }
    if (V.mode && V.mode.t !== 'place') { useMode(wx, wy); return; }
    miniDrag = true;
    mini.setPointerCapture(ev.pointerId);
    centerCam(wx, wy);
  });
  mini.addEventListener('pointermove', (ev) => { if (miniDrag) centerCam(...minimapWorld(ev, mini)); });
  mini.addEventListener('pointerup', () => { miniDrag = false; });

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', (ev) => {
    const k = ev.key.toLowerCase();
    // macOS drops key-ups while Cmd is held, so forget everything when a modifier is involved
    if (k === 'meta' || k === 'control') keys.clear();
    else keys.delete(k);
  });
  window.addEventListener('blur', () => { keys.clear(); V.mouse.inside = false; });
}

export const keys = new Set<string>();
let lastGroupKey = 0;

function onKey(ev: KeyboardEvent): void {
  if (!V.started) return;
  const k = ev.key.toLowerCase(), target = ev.target as HTMLElement;
  if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return; // typing, not playing
  if (k === 'meta' || k === 'control') { keys.clear(); return; }
  if (tracksKey(ev)) keys.add(k);
  if (SCROLL_KEYS[k] && tracksKey(ev)) { ev.preventDefault(); return; } // W A S D and arrows only scroll
  if (target.closest?.('button') && (k === 'enter' || k === ' ')) return; // let buttons activate
  if (k === 'escape') { V.mode = null; refreshCommands(true); return; }
  if (k === 'p' || k === 'pause') { V.paused = !V.paused; return; }
  if (k === '+' || k === '=') { V.speed = Math.min(4, V.speed * 2); return; }
  if (k === '-' || k === '_') { V.speed = Math.max(0.5, V.speed / 2); return; }
  if (k === ' ') { ev.preventDefault(); if (G.lastAlert) centerCam(G.lastAlert.x, G.lastAlert.y); return; }
  if (k === 'home' || k === 'h') {
    const y = G.ents.find((x) => !x.dead && x.team === V.team && x.kind === 'bld');
    if (y) centerCam(y.x, y.y);
    return;
  }
  if (/^[1-9]$/.test(k)) {
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      V.groups.set(k, ownSelected().map((x) => x.id));
      return;
    }
    const l = (V.groups.get(k) ?? []).map(valid).filter((x): x is Ent => !!x);
    if (!l.length) return;
    setSelection(l);
    if (performance.now() - lastGroupKey < 400) centerCam(l[0].x, l[0].y);
    lastGroupKey = performance.now();
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (runHotkey(k)) ev.preventDefault();
}

/** Scroll the camera with W A S D, the arrow keys, or by holding the mouse at the screen edge. */
export function scrollCamera(dt: number): void {
  const sp = 900 * dt, m = V.mouse, edge = m.inside && !m.down;
  let [dx, dy] = scrollVector(keys);
  if (edge) {
    if (m.x <= 4) dx = -1; else if (m.x >= V.vw - 5) dx = 1;
    if (m.y <= 4) dy = -1; else if (m.y >= V.vh - 5) dy = 1;
  }
  V.cam.x += dx * sp;
  V.cam.y += dy * sp;
}
