// The game view: wires the engine, renderer, sidebar, HUD and input to the page and runs the
// frame loop. Solo and AI-vs-AI games simulate here; online games draw what the server sends.
import { G, hooks } from '../../game/state.ts';
import { STEP, TS } from '../../game/const.ts';
import { START_YARDS } from '../../data/map.ts';
import { LAST_ERA } from '../../data/era.ts';
import { initWorld, update } from '../../game/world.ts';
import { ais } from '../../game/ai.ts';
import { rebuildBlk } from '../../game/map.ts';
import { updFog } from '../../game/fog.ts';
import { updFx } from '../../game/fx.ts';
import { updProjs } from '../../game/combat.ts';
import { applyCommand } from '../../game/command.ts';
import { net } from '../../net/client.ts';
import type { ServerMsg, SnapMsg } from '../../net/protocol.ts';
import { applySnapshot, decodeOre, interpolate, resetSnapshots } from '../../net/snapshot.ts';
import { closeModal, openModal } from '../../components/modal/modal.ts';
import { ctx2d } from '../../util/canvas.ts';
import { mountLobby } from '../lobby/lobby_view.ts';
import { BUILDING, type BldType } from '../../data/building.ts';
import { canPlace } from '../../game/building.ts';
import { initTerrain } from './render/terrain.ts';
import { makeIcons } from './render/icon.ts';
import { drawMinimap, initFog } from './render/minimap.ts';
import { initScene, renderScene, resizeScene, updateCamera, viewFootprint } from './render3d/scene.ts';
import { initWorld3d, refreshFog, refreshOre } from './render3d/world3d.ts';
import { resetEntities3d, syncEntities } from './render3d/entities3d.ts';
import { initFx3d, updateFx3d } from './render3d/fx3d.ts';
import { animatePortals3d, initPortals3d } from './render3d/portals3d.ts';
import { drawOverlay } from './render3d/overlay.ts';
import { formatTime, initHud, refreshHud, setSelection } from './hud.ts';
import { initSidebar, refreshSidebar } from './sidebar.ts';
import { initInput, scrollCamera, updatePlacement } from './input.ts';
import { ageMarkers, centerCam, clampCam, V } from './view_state.ts';

const MAX_STEPS_PER_FRAME = 16;
const MESSAGE_TIME = 2600;
const FOG_INTERVAL = 0.2;
const RESIGN_CONFIRM = 3000;
const ORE_REFRESH = 0.5;

function must<T extends Element>(root: Element, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export function mountGameView(root: HTMLElement): void {
  const canvas = must<HTMLCanvasElement>(root, '.game-canvas'), overlay = must<HTMLCanvasElement>(root, '.game-overlay'), og = ctx2d(overlay);
  const minimap = must<HTMLCanvasElement>(root, '.sidebar-minimap'), mg = ctx2d(minimap);
  const sidebar = must<HTMLElement>(root, '.sidebar'), topbar = must<HTMLElement>(root, '.topbar');
  const message = must<HTMLElement>(root, '.game-message');
  const startModal = must<HTMLElement>(root, '.game-start'), endModal = must<HTMLElement>(root, '.game-end');
  const speedBtn = must<HTMLButtonElement>(root, '.topbar-speed'), pauseBtn = must<HTMLButtonElement>(root, '.topbar-pause');
  const resignBtn = must<HTMLButtonElement>(root, '.topbar-resign'), againBtn = must<HTMLButtonElement>(root, '.game-end-again');
  const q = new URLSearchParams(location.search);

  let errors = 0, messageTimer = 0, endReason = '', shownEnd = false;
  const show = (msg: string) => {
    message.textContent = msg;
    clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => { message.textContent = ''; }, MESSAGE_TIME);
  };
  hooks.notify = (team, msg) => { if (team === V.team && !G.demo) show(msg); };
  hooks.alert = (team, x, y) => { if (team === V.team) V.pings.push({ x, y, t: 0 }); };
  hooks.error = (err) => { console.error(err); root.dataset.errors = String(++errors); };

  /** Build everything drawn for the current map: terrain art, fog, and the 3D layers. */
  const setupWorldView = () => {
    initTerrain(G.seed);
    initFog(refreshFog);
    initWorld3d();
    initPortals3d();
    resetEntities3d();
    initFx3d();
  };

  G.reveal = q.has('reveal');
  initScene(canvas);
  initWorld(q.has('seed') ? Number(q.get('seed')) : Math.floor(Math.random() * 1e6));
  setupWorldView();
  makeIcons(V.team);
  initHud({
    credits: must(root, '.topbar-credits'), wood: must(root, '.topbar-wood'), oil: must(root, '.topbar-oil'), aether: must(root, '.topbar-aether'), power: must(root, '.topbar-power'), era: must(root, '.topbar-era'), time: must(root, '.topbar-time'),
    speed: speedBtn, pause: pauseBtn,
    details: must(root, '.selection-details'), commands: must(root, '.selection-commands'), tooltip: must(root, '.game-tooltip'),
  });
  initSidebar(must(root, '.build-list--structure'), must(root, '.build-list--unit'));
  initInput(canvas, minimap);

  const resize = () => {
    V.vw = window.innerWidth;
    V.vh = window.innerHeight;
    V.topH = topbar.offsetHeight;
    // the sidebar docks right on wide screens and at the bottom on narrow ones
    const r = sidebar.getBoundingClientRect(), right = r.left > V.vw / 2;
    V.viewW = Math.max(1, Math.round(right ? r.left : V.vw));
    V.viewH = Math.max(1, Math.round(right ? V.vh : r.top));
    resizeScene(V.viewW, V.viewH);
    overlay.width = V.viewW;
    overlay.height = V.viewH;
    clampCam();
  };
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(sidebar);
  resize();
  const home = (team: number) => { const [x, y] = START_YARDS[team]; centerCam((x + 1.5) * TS, (y + 1.5) * TS); };
  home(V.team);

  // ---- solo and AI vs AI ----
  const startSolo = (demo: boolean) => {
    closeModal(startModal);
    Object.assign(G, { demo, visualOnly: false, viewer: 0, human: [!demo, false] });
    ais[0].on = demo;
    ais[1].on = true;
    V.team = 0;
    V.online = false;
    V.started = true;
  };

  // ---- online ----
  const onSnapshot = (s: SnapMsg) => {
    G.gameT = s.t;
    G.credits[V.team] = s.credits;
    G.wood[V.team] = s.wood ?? 0;
    G.oil[V.team] = s.oil ?? 0;
    G.aether[V.team] = s.aether ?? 0;
    G.aetherFound[V.team] = !!s.aetherFound;
    G.tamed[V.team] = s.tamed ?? [];
    G.ward[V.team] = !!s.ward;
    G.era[V.team] = s.era ?? 0;
    G.heal[V.team] = s.heal ?? 0;
    G.prod[V.team] = s.prod;
    if (s.ore) decodeOre(s.ore);
    applySnapshot(s.ents, s.ev, (ev) => {
      if (ev[0] === 'm') show(ev[1]);
      else if (ev[0] === 'a') { V.pings.push({ x: ev[1], y: ev[2], t: 0 }); G.lastAlert = { x: ev[1], y: ev[2] }; }
    });
  };

  const onGameMessage = (m: ServerMsg) => {
    if (!V.online) return;
    if (m.k === 'snap') onSnapshot(m);
    else if (m.k === 'end' && !G.over) {
      G.over = true;
      G.winner = m.winner;
      endReason = m.reason === 'left' ? (m.winner === V.team ? 'Your opponent left the game.' : 'You left the game.')
        : m.reason === 'resigned' ? (m.winner === V.team ? 'Your opponent surrendered.' : 'You surrendered.') : '';
    }
  };
  net.onMessage(onGameMessage);
  net.onClose(() => {
    if (V.online && V.started && !G.over) { G.over = true; G.winner = -1; endReason = 'Lost connection to the game server.'; }
  });

  const startOnline = (m: Extract<ServerMsg, { k: 'start' }>) => {
    closeModal(startModal);
    V.online = true;
    V.team = m.team;
    for (const a of ais) a.on = false;
    initWorld(m.seed);
    // the server owns every unit and building: start empty and fill in from snapshots
    Object.assign(G, { ents: [], projs: [], fx: [], decals: [], demo: false, visualOnly: true, viewer: m.team, human: [m.team === 0, m.team === 1] });
    G.byId.clear();
    rebuildBlk();
    resetSnapshots();
    setupWorldView();
    makeIcons(m.team);
    Object.assign(V, { sel: [], mode: null, markers: [], pings: [], paused: false, speed: 1, started: true });
    root.classList.add('view-game--online');
    resignBtn.hidden = false;
    speedBtn.hidden = pauseBtn.hidden = true;
    againBtn.textContent = 'Back to lobby';
    home(m.team);
    setSelection([]);
    show(`Match found: you vs ${m.opponent}`);
  };

  const lobby = mountLobby(must(root, '.view-lobby'), { onStart: startOnline, onBack: () => openModal(startModal) });

  must(root, '.game-start-play').addEventListener('click', () => startSolo(false));
  must(root, '.game-start-watch').addEventListener('click', () => startSolo(true));
  must(root, '.game-start-online').addEventListener('click', () => { closeModal(startModal); lobby.open(); });
  againBtn.addEventListener('click', () => { location.search = V.online ? '?online' : ''; });
  pauseBtn.addEventListener('click', () => { V.paused = !V.paused; });
  speedBtn.addEventListener('click', () => { V.speed = V.speed >= 4 ? 0.5 : V.speed * 2; });
  let resignArmed = 0;
  resignBtn.addEventListener('click', () => {
    // two clicks so a stray tap doesn't end the game
    if (Date.now() - resignArmed < RESIGN_CONFIRM) { net.send({ k: 'resign' }); return; }
    resignArmed = Date.now();
    resignBtn.textContent = 'Confirm?';
    setTimeout(() => { resignBtn.textContent = 'Surrender'; }, RESIGN_CONFIRM);
  });

  applyTestOptions(q, startSolo, (quick, join) => { closeModal(startModal); lobby.open(quick, join); });

  let last = performance.now(), acc = 0, fogT = 0, oreT = 0;
  const frame = (t: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - last) / 1000 || 0);
    last = t;
    if (V.online) {
      if (V.started && !G.over) {
        interpolate(dt);
        updProjs(dt);
        updFx(dt);
        ageMarkers(dt);
        fogT -= dt;
        if (fogT <= 0) { fogT = FOG_INTERVAL; updFog(); }
      }
    } else if (V.started && !V.paused && !G.over) {
      acc += dt * V.speed;
      let n = 0;
      while (acc >= STEP && n < MAX_STEPS_PER_FRAME) { update(STEP); acc -= STEP; n++; }
      if (n >= MAX_STEPS_PER_FRAME) acc = 0;
      ageMarkers(dt * V.speed);
    }
    if (G.over && !shownEnd) {
      shownEnd = true;
      must(root, '.game-result').textContent = G.demo ? `${G.winner === 0 ? 'Blue' : 'Red'} wins` : G.winner === V.team ? 'Victory' : G.winner < 0 ? 'Game over' : 'Defeat';
      must(root, '.game-end-time').textContent = [endReason, `Time ${formatTime(G.gameT)}`].filter(Boolean).join(' ');
      resignBtn.hidden = true;
      openModal(endModal);
    }
    scrollCamera(dt);
    clampCam();
    updatePlacement((tx, ty) => V.mode?.t === 'place' && canPlace(tx, ty, BUILDING[V.mode.type].size, V.team), (t) => BUILDING[t as BldType].size);
    canvas.classList.toggle('game-canvas--targeting', !!V.mode);
    oreT -= dt;
    if (oreT <= 0) { oreT = ORE_REFRESH; refreshOre(); }
    try {
      updateCamera();
      syncEntities(dt);
      updateFx3d();
      animatePortals3d(dt);
      renderScene();
      drawOverlay(og);
      drawMinimap(mg, viewFootprint());
      refreshHud();
      refreshSidebar();
    } catch (err) {
      hooks.error(err);
    }
  };
  requestAnimationFrame(frame);
}

/**
 * URL options for testing: ?seed=N map seed, ?auto start a solo game, ?demo AI vs AI, ?online open
 * the lobby (?online=quick also joins quick match), ?join=ID open the lobby and join that game (invite links), ?sim=S simulate S seconds before the first frame, ?reveal no fog, ?cam=x,y center on a
 * tile, ?view=yaw,pitch,dist camera angle in degrees and distance in tiles, ?sel=type select up to six
 * of your units of that type, ?queue=a,b start building these, ?era=N start your side in age N.
 */
function applyTestOptions(q: URLSearchParams, startSolo: (demo: boolean) => void, openLobby: (quick: boolean, join?: string) => void): void {
  if (q.has('online') || q.has('join')) { openLobby(q.get('online') === 'quick', q.get('join') ?? undefined); return; }
  if (q.has('demo')) startSolo(true);
  else if (q.has('auto')) startSolo(false);
  if (q.has('era')) G.era[V.team] = Math.max(0, Math.min(LAST_ERA, Number(q.get('era')) || 0));
  for (const type of (q.get('queue') ?? '').split(',').filter(Boolean)) applyCommand(V.team, { c: 'build', type: type as never });
  const sim = Number(q.get('sim') ?? 0) / STEP;
  for (let i = 0; i < sim && !G.over; i++) update(STEP);
  const cam = q.get('cam');
  if (cam) {
    const [x, y] = cam.split(',').map(Number);
    centerCam(x * TS, y * TS);
  }
  // camera angle: ?view=yawDegrees,pitchDegrees,distanceTiles
  const view = q.get('view');
  if (view) {
    const [yaw, pitch, dist] = view.split(',').map(Number);
    Object.assign(V.cam, { yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180, dist });
    clampCam();
  }
  const sel = q.get('sel');
  if (sel) setSelection(G.ents.filter((e) => e.team === V.team && e.type === sel).slice(0, 6));
}
