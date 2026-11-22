// Mouse, touch and keyboard controls for the 3D battlefield and the minimap.
import { G, bldDef, tileOf, unitDef, valid, type Ent } from '../../game/state.ts';
import { MW, MH, TS } from '../../game/const.ts';
import { exploredAt, seenAt } from '../../game/fog.ts';
import { dispatch, ids } from './dispatch.ts';
import { centerCam, clampCam, ownSelected, selectedUnits, V } from './view_state.ts';
import { refreshCommands, runHotkey, setSelection } from './hud.ts';
import { ROTATE_KEYS, SCROLL_KEYS, scrollVector, tracksKey } from './keyboard.ts';
import { panDelta } from './camera_rig.ts';
import { screenToWorld, worldToScreen } from './render3d/scene.ts';
import { modelHeight, pickEntity } from './render3d/entities3d.ts';

const DRAG_START = 6;
const DOUBLE_TAP = 350;
const ORBIT_SPEED = 0.006;
const ZOOM_STEP = 1.12;

function shownAt(e: Ent): boolean {
  if (e.team === V.team) return true;
  return e.kind === 'unit' ? seenAt(e.x, e.y) : exploredAt(e.x, e.y);
}

/** The entity at a world point (px), for clicks on the minimap. */
export function entityAt(wx: number, wy: number): Ent | null {
  let best: Ent | null = null, bd = 1e9;
  for (const e of G.ents) {
    if (e.dead || !shownAt(e)) continue;
    if (e.w) {
      if (wx >= e.tx * TS && wx < (e.tx + e.w) * TS && wy >= e.ty * TS && wy < (e.ty + e.h) * TS) return e;
    } else {
      const d = Math.hypot(wx - e.x, wy - e.y);
      if (d < unitDef(e).radius + 7 && d < bd) { bd = d; best = e; }
    }
  }
  return best;
}

const mark = (x: number, y: number, color: string) => V.markers.push({ x, y, t: 0, color });
const isEnemy = (e: Ent | null): boolean => !!e && e.team !== V.team && e.team >= 0;

/** Context command at a world point: harvest, unload, rally or move. Units only ever move; their stance decides whether they fight. */
export function worldCommand(wx: number, wy: number, hit: Ent | null): void {
  const own = ownSelected();
  if (!own.length) return;
  const units = own.filter((e) => e.kind === 'unit');
  const tx = tileOf(wx), ty = tileOf(wy);
  if (!units.length) {
    const b = own[0];
    if (b.kind === 'bld' && b.done && bldDef(b).produces && bldDef(b).produces !== 'structure') { dispatch({ c: 'rally', id: b.id, x: Math.round(wx), y: Math.round(wy) }); mark(wx, wy, '#5f5'); }
    return;
  }
  const harvesters = units.filter((u) => u.type === 'harvester'), rest = units.filter((u) => u.type !== 'harvester');
  const moveRest = () => rest.length && dispatch({ c: 'move', ids: ids(rest), tx, ty });
  if (harvesters.length && hit?.type === 'refinery' && hit.team === V.team) { dispatch({ c: 'return', ids: ids(harvesters) }); moveRest(); mark(wx, wy, '#ff5'); return; }
  if (harvesters.length && G.ore[ty * MW + tx] > 0 && G.vis[ty * MW + tx]) { dispatch({ c: 'harvest', ids: ids(harvesters), tx, ty }); moveRest(); mark(wx, wy, '#ff5'); return; }
  dispatch({ c: 'move', ids: ids(units), tx, ty });
  mark(wx, wy, isEnemy(hit) ? '#f44' : '#5f5');
}

/** Finish a targeting command (move or place) at a world point. */
function useMode(wx: number, wy: number, hit: Ent | null): void {
  const m = V.mode;
  if (!m) return;
  if (m.t === 'place') {
    if (m.ok) { dispatch({ c: 'place', tx: m.tx, ty: m.ty }); V.mode = null; }
    refreshCommands(true);
    return;
  }
  V.mode = null;
  const us = selectedUnits();
  dispatch({ c: 'move', ids: ids(us), tx: tileOf(wx), ty: tileOf(wy) });
  mark(wx, wy, isEnemy(hit) ? '#f44' : '#5f5');
  refreshCommands(true);
}

/** Your units whose on-screen position passes a test. */
function unitsOnScreen(test: (sx: number, sy: number) => boolean): Ent[] {
  return G.ents.filter((e) => {
    if (e.dead || e.kind !== 'unit' || e.team !== V.team) return false;
    const p = worldToScreen(e.x, e.y, modelHeight(e) * 0.4);
    return p.front && test(p.sx, p.sy);
  });
}

function boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
  const us = unitsOnScreen((sx, sy) => sx >= l - 6 && sx <= r + 6 && sy >= t - 6 && sy <= b + 6);
  // prefer combat units over harvesters in a box
  const army = us.filter((u) => u.type !== 'harvester'), pick = army.length ? army : us;
  if (pick.length) setSelection(add ? [...new Set([...selectedUnits(), ...pick])] : pick);
  else if (!add) setSelection([]);
}

let canvasRect = { left: 0, top: 0, right: 0, bottom: 0 };
function selectSameType(e: Ent): void {
  const r = canvasRect;
  setSelection(unitsOnScreen((sx, sy) => sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom).filter((u) => u.type === e.type));
}

function clickSelect(sx: number, sy: number, add: boolean): void {
  const e = pickEntity(sx, sy);
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
  const w = screenToWorld(sx, sy), e = pickEntity(sx, sy), now = performance.now();
  if (V.mode) { if (w) useMode(w.x, w.y, e); return; }
  if (e && e.team === V.team) {
    if (lastTap.id === e.id && now - lastTap.t < DOUBLE_TAP && e.kind === 'unit') selectSameType(e);
    else setSelection([e]);
    lastTap = { t: now, id: e.id };
    return;
  }
  if (ownSelected().length && w) worldCommand(w.x, w.y, e);
  else setSelection(e ? [e] : []);
}

function minimapWorld(ev: PointerEvent, mini: HTMLCanvasElement): [number, number] {
  const r = mini.getBoundingClientRect();
  return [((ev.clientX - r.left) / r.width) * MW * TS, ((ev.clientY - r.top) / r.height) * MH * TS];
}

/** Turn and tilt the camera by a screen drag (px). */
function orbit(dx: number, dy: number): void {
  V.cam.yaw -= dx * ORBIT_SPEED;
  V.cam.pitch += dy * ORBIT_SPEED * 0.8;
  clampCam();
}

export function initInput(canvas: HTMLCanvasElement, mini: HTMLCanvasElement): void {
  const touches = new Map<number, { x: number; y: number }>();
  let panned = false, pinch: { d: number; a: number } | null = null, orbiting: { x: number; y: number } | null = null;
  const refreshRect = () => { const r = canvas.getBoundingClientRect(); canvasRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };

  canvas.addEventListener('pointerdown', (ev) => {
    if (!V.started) return;
    refreshRect();
    V.mouse.x = ev.clientX; V.mouse.y = ev.clientY;
    if (ev.pointerType === 'touch') {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 1) { panned = false; V.mouse.sx = ev.clientX; V.mouse.sy = ev.clientY; }
      pinch = null;
      return;
    }
    if (ev.button === 1) { ev.preventDefault(); orbiting = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); return; }
    if (G.demo) return;
    const w = screenToWorld(ev.clientX, ev.clientY);
    if (ev.button === 2) {
      if (V.mode) { V.mode = null; refreshCommands(true); }
      else if (w) worldCommand(w.x, w.y, pickEntity(ev.clientX, ev.clientY));
      return;
    }
    if (ev.button !== 0) return;
    if (V.mode) { if (w) useMode(w.x, w.y, pickEntity(ev.clientX, ev.clientY)); return; }
    Object.assign(V.mouse, { down: true, drag: false, sx: ev.clientX, sy: ev.clientY });
    canvas.setPointerCapture(ev.pointerId);
  });

  window.addEventListener('pointermove', (ev) => {
    V.mouse.x = ev.clientX; V.mouse.y = ev.clientY; V.mouse.inside = ev.pointerType === 'mouse';
    if (orbiting) { orbit(ev.clientX - orbiting.x, ev.clientY - orbiting.y); orbiting = { x: ev.clientX, y: ev.clientY }; return; }
    const t = touches.get(ev.pointerId);
    if (t) {
      const prev = { ...t };
      t.x = ev.clientX; t.y = ev.clientY;
      if (touches.size >= 2) {
        // two fingers: pinch to zoom, twist to turn
        const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (pinch) { V.cam.dist *= pinch.d / Math.max(1, d); V.cam.yaw -= ang - pinch.a; clampCam(); }
        pinch = { d, a: ang };
        panned = true;
        return;
      }
      if (!panned && Math.hypot(t.x - V.mouse.sx, t.y - V.mouse.sy) < DRAG_START) return;
      // one finger: drag the ground under it
      const w0 = screenToWorld(prev.x, prev.y), w1 = screenToWorld(t.x, t.y);
      if (w0 && w1) { V.cam.x += w0.x - w1.x; V.cam.y += w0.y - w1.y; clampCam(); }
      panned = true;
      return;
    }
    if (V.mouse.down && Math.hypot(V.mouse.x - V.mouse.sx, V.mouse.y - V.mouse.sy) > DRAG_START) V.mouse.drag = true;
  });

  canvas.addEventListener('pointerup', (ev) => {
    if (orbiting && ev.button === 1) { orbiting = null; return; }
    if (touches.has(ev.pointerId)) {
      touches.delete(ev.pointerId);
      if (!touches.size && !panned && !G.demo) tap(ev.clientX, ev.clientY);
      if (touches.size < 2) pinch = null;
      return;
    }
    if (ev.button !== 0 || !V.mouse.down) return;
    if (V.mouse.drag) boxSelect(V.mouse.sx, V.mouse.sy, ev.clientX, ev.clientY, ev.shiftKey);
    else clickSelect(ev.clientX, ev.clientY, ev.shiftKey);
    V.mouse.down = false;
    V.mouse.drag = false;
  });

  canvas.addEventListener('pointercancel', (ev) => { touches.delete(ev.pointerId); pinch = null; orbiting = null; V.mouse.down = false; V.mouse.drag = false; });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    // Ctrl/Cmd+wheel (and trackpad pinch, which arrives as Ctrl+wheel) zooms; Alt+wheel tilts
    if (ev.ctrlKey || ev.metaKey) {
      V.cam.dist *= Math.exp(Math.max(-1, Math.min(1, ev.deltaY * (ev.deltaMode ? 0.33 : 0.01))) * Math.log(ZOOM_STEP));
      clampCam();
      return;
    }
    if (ev.altKey) { V.cam.pitch += Math.sign(ev.deltaY || ev.deltaX) * 0.06; clampCam(); return; }
    // plain scrolling pans the map; Shift turns a mouse wheel's vertical scroll into sideways
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? V.vh : 1;
    let dx = ev.deltaX * unit, dy = ev.deltaY * unit;
    if (ev.shiftKey && !dx) { dx = dy; dy = 0; }
    panScreen(dx, dy);
  }, { passive: false });
  document.addEventListener('pointerleave', () => { V.mouse.inside = false; });
  canvas.addEventListener('dblclick', (ev) => {
    if (!V.started || G.demo) return;
    refreshRect();
    const e = pickEntity(ev.clientX, ev.clientY);
    if (e?.kind === 'unit' && e.team === V.team) selectSameType(e);
  });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  mini.addEventListener('contextmenu', (ev) => ev.preventDefault());

  let miniDrag = false;
  mini.addEventListener('pointerdown', (ev) => {
    if (!V.started) return;
    const [wx, wy] = minimapWorld(ev, mini);
    if (ev.button === 2) { worldCommand(wx, wy, entityAt(wx, wy)); return; }
    if (V.mode && V.mode.t !== 'place') { useMode(wx, wy, entityAt(wx, wy)); return; }
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
  if ((SCROLL_KEYS[k] || ROTATE_KEYS[k]) && tracksKey(ev)) { ev.preventDefault(); return; } // camera keys only move the camera
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

/** Move the view by a screen offset (px), as if dragging the ground the other way. */
function panScreen(dx: number, dy: number): void {
  const cx = V.vw / 2, cy = V.vh / 2;
  const w0 = screenToWorld(cx, cy), w1 = screenToWorld(cx + dx, cy + dy);
  if (w0 && w1) { V.cam.x += w1.x - w0.x; V.cam.y += w1.y - w0.y; }
  else {
    const [px, py] = panDelta(V.cam.yaw, dx * V.cam.dist * 0.05, dy * V.cam.dist * 0.05);
    V.cam.x += px; V.cam.y += py;
  }
  clampCam();
}

/** Pan with W A S D, the arrow keys or the screen edge; turn with Q and E. */
export function scrollCamera(dt: number): void {
  const m = V.mouse, edge = m.inside && !m.down;
  let [dx, dy] = scrollVector(keys);
  if (edge) {
    if (m.x <= 4) dx = -1; else if (m.x >= V.vw - 5) dx = 1;
    if (m.y <= 4) dy = -1; else if (m.y >= V.vh - 5) dy = 1;
  }
  let turn = 0;
  for (const k of keys) turn += ROTATE_KEYS[k] ?? 0;
  if (!dx && !dy && !turn) return;
  const sp = V.cam.dist * 48 * dt, [px, py] = panDelta(V.cam.yaw, dx * sp, dy * sp);
  V.cam.x += px;
  V.cam.y += py;
  V.cam.yaw += turn * 1.8 * dt;
  clampCam();
}

/** Snap the building ghost to the tile under the pointer. */
export function updatePlacement(canPlaceAt: (tx: number, ty: number) => boolean, size: (t: string) => number): void {
  const m = V.mode;
  if (m?.t !== 'place') return;
  const w = screenToWorld(V.mouse.x, V.mouse.y);
  if (!w) return;
  const s = size(m.type);
  m.tx = Math.max(0, Math.min(MW - s, Math.round(w.x / TS - s / 2)));
  m.ty = Math.max(0, Math.min(MH - s, Math.round(w.y / TS - s / 2)));
  m.ok = canPlaceAt(m.tx, m.ty);
}
