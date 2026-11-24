// The game view: wires the engine, renderer, sidebar, HUD and input to the page and runs the
// frame loop. Solo and AI-vs-AI games simulate here; online games draw what the server sends.
import { G, hooks } from '../../game/state.ts';
import { MH, MW, STEP, TS } from '../../game/const.ts';
import { layoutFor } from '../../data/map.ts';
import { AI_LEVEL, DEFAULT_SETUP, START_ARMY, START_RESOURCES, type GameSetup } from '../../data/setup.ts';
import { teamColors } from '../../data/team.ts';
import { LAST_ERA } from '../../data/era.ts';
import { initWorld, update } from '../../game/world.ts';
import { ais, setAiLevel } from '../../game/ai.ts';
import { noUpgrades } from '../../game/upgrade.ts';
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
import { hostedGame, mountLobby, storedName } from '../lobby/lobby_view.ts';
import { captureWorld, restoreWorld } from '../../game/save.ts';
import { enterGameUrl, forgetGame, gameIdFromUrl, leaveGameUrl, loadGame, onlineKey, openSaves, pruneGames, rememberOnline, saveGame, type SavedGame } from './resume.ts';
import { mountSetup } from '../setup/setup_view.ts';
import { autoFullscreen, mountFullscreenButton } from './fullscreen.ts';
import { BUILDING, type BldType } from '../../data/building.ts';
import { canPlaceType } from '../../game/building.ts';
import { addBuilding, addUnit } from '../../game/entity.ts';
import { UNIT, type UnitType } from '../../data/unit.ts';
import { initTerrain } from './render/terrain.ts';
import { makeIcons } from './render/icon.ts';
import { drawMinimap, initFog } from './render/minimap.ts';
import { moodFor } from './render3d/mood.ts';
import { initScene, setMood, renderScene, resizeScene, updateCamera, viewFootprint } from './render3d/scene.ts';
import { animateWater, initWorld3d, refreshFog, refreshOre } from './render3d/world3d.ts';
import { updateCows3d } from './render3d/cows3d.ts';
import { resetEntities3d, syncEntities } from './render3d/entities3d.ts';
import { initFx3d, updateFx3d } from './render3d/fx3d.ts';
import { initBurning, updateBurning } from './render3d/burn3d.ts';
import { animatePortals3d, initPortals3d } from './render3d/portals3d.ts';
import { updateAetherBeams, updateAetherGlows } from './render3d/aetherbeam3d.ts';
import { drawOverlay } from './render3d/overlay.ts';
import { formatTime, initHud, refreshHud, setSelection } from './hud.ts';
import { initSidebar, refreshSidebar } from './sidebar.ts';
import { initInput, scrollCamera, updatePlacement } from './input.ts';
import { updateFollow } from './follow_cam.ts';
import { initTouchBar, refreshTouchBar } from './touch_bar.ts';
import { ageMarkers, centerCam, clampCam, V } from './view_state.ts';

const MAX_STEPS_PER_FRAME = 16;
const MESSAGE_TIME = 2600;
const FOG_INTERVAL = 0.2;
const RESIGN_CONFIRM = 3000;
const ORE_REFRESH = 0.5;
/** seconds between saves of a solo game (it's also saved when the page is hidden or closed) */
const SAVE_INTERVAL = 2;
/** tries, and seconds apart, at getting back into an online match after the connection drops */
const REJOIN_TRIES = 6;
const REJOIN_WAIT = 3;

/** A random UUID (crypto.randomUUID needs a secure context, so fall back to random bytes). */
function newGameId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

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

  let errors = 0, messageTimer = 0, endReason = '', shownEnd = false, quitting = false;
  const pausedBox = must<HTMLElement>(root, '.game-paused'), timeEl = must<HTMLElement>(root, '.topbar-time');
  /** Every game gets a UUID when it starts (online games use the server's match id). */
  const setGameId = (id: string) => {
    root.dataset.gameId = id;
    for (const el of root.querySelectorAll<HTMLElement>('.game-id')) el.textContent = `Game ID ${id}`;
    timeEl.title = `Game ID ${id}`;
  };
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
    setMood(moodFor(G.seed, new URLSearchParams(location.search).get('mood')));
    initFog(refreshFog);
    initWorld3d();
    initPortals3d();
    resetEntities3d();
    initFx3d();
    initBurning();
  };

  G.reveal = q.has('reveal');
  initScene(canvas);
  initWorld(q.has('seed') ? Number(q.get('seed')) : Math.floor(Math.random() * 1e6));
  setupWorldView();
  makeIcons(V.team);
  initHud({
    credits: must(root, '.topbar-credits'), wood: must(root, '.topbar-wood'), oil: must(root, '.topbar-oil'), aether: must(root, '.topbar-aether'), power: must(root, '.topbar-power'), era: must(root, '.topbar-era'), time: must(root, '.topbar-time'),
    speed: speedBtn, pause: pauseBtn,
    details: must(root, '.selection-details'), commands: must(root, '.selection-commands'), tooltip: must(root, '.game-tooltip'), army: must(root, '.army-bar'), team: must(root, '.topbar-team'),
  });
  initSidebar(must(root, '.build-list--structure'), must(root, '.build-list--unit'), must(root, '.game-tooltip'));
  initInput(canvas, minimap);
  initTouchBar(root);

  const resize = () => {
    V.vw = window.innerWidth;
    V.vh = window.innerHeight;
    V.topH = topbar.offsetHeight;
    // the sidebar docks right on wide screens and at the bottom on narrow ones
    const r = sidebar.getBoundingClientRect(), right = r.left > V.vw / 2;
    V.viewW = Math.max(1, Math.round(right ? r.left : V.vw));
    V.viewH = Math.max(1, Math.round(right ? V.vh : r.top));
    if (V.viewW === overlay.width && V.viewH === overlay.height) return;
    resizeScene(V.viewW, V.viewH);
    overlay.width = V.viewW;
    overlay.height = V.viewH;
    clampCam();
    // resizing clears the canvas, so draw again now rather than show a blank frame
    try { updateCamera(); renderScene(); drawOverlay(og); } catch (err) { hooks.error(err); }
  };
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(sidebar);
  resize();
  const home = (team: number) => { const [x, y] = layoutFor(G.teams).yards[team]; centerCam((x + 1.5) * TS, (y + 1.5) * TS); };
  home(V.team);

  // ---- solo and AI vs AI ----
  /** Start a game against the computer (or, with `demo`, a computer-only match to watch) with these settings. */
  const startSolo = (demo: boolean, s: GameSetup = DEFAULT_SETUP) => {
    closeModal(startModal);
    const teams = s.foes === 3 ? 4 : 2;
    // no map number: play on the map already showing behind the menu
    initWorld(s.seed ?? G.seed, teams, { share: START_RESOURCES[s.resources].share, units: START_ARMY[s.army].units });
    setAiLevel(s.difficulty);
    // spectators see the whole map, so they can follow and inspect every side
    Object.assign(G, { demo, visualOnly: false, viewer: 0, human: Array.from({ length: teams }, (_, t) => t === 0 && !demo), reveal: q.has('reveal') || demo || !s.fog });
    const bonus = AI_LEVEL[s.difficulty].bonus;
    ais.forEach((a, t) => {
      a.on = t < teams && !G.human[t];
      if (a.on && bonus !== 1) { G.credits[t] = Math.round(G.credits[t] * bonus); G.wood[t] = Math.round(G.wood[t] * bonus); }
    });
    updFog();
    setGameId(newGameId());
    enterGameUrl(root.dataset.gameId ?? '');
    setupWorldView();
    makeIcons(0);
    Object.assign(V, { team: 0, online: false, sel: [], mode: null, markers: [], pings: [], paused: false, speed: s.speed, started: true });
    autoFullscreen();
    (document.activeElement as HTMLElement | null)?.blur?.(); // keys go to the game, not a closed dialog's field
    home(0);
    setSelection([]);
    saveNow();
    void pruneGames().catch(() => {});
  };

  /** Save the solo game in progress, so a refresh comes back to it. */
  const saveNow = () => {
    const id = root.dataset.gameId;
    if (!id || !V.started || V.online || G.over || quitting) return;
    const g: SavedGame = { id, savedAt: Date.now(), world: captureWorld(), view: { team: V.team, speed: V.speed, paused: V.paused, cam: { ...V.cam } } };
    saveGame(g).catch((err) => console.warn('Could not save the game', err));
  };
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

  /** Pick a saved solo game back up. */
  const resumeSolo = (g: SavedGame) => {
    closeModal(startModal);
    const w = g.world.g as { seed: number; teams: number };
    initWorld(w.seed, w.teams);
    if (!restoreWorld(g.world)) return false;
    rebuildBlk();
    updFog();
    setGameId(g.id);
    setupWorldView();
    makeIcons(g.view.team);
    Object.assign(V, { team: g.view.team, online: false, sel: [], mode: null, markers: [], pings: [], paused: g.view.paused, speed: g.view.speed, started: true });
    autoFullscreen();
    Object.assign(V.cam, g.view.cam);
    clampCam();
    setSelection([]);
    return true;
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
    G.upg[V.team] = { ...noUpgrades(), ...s.upg };
    G.prod[V.team] = s.prod;
    if (s.ore) decodeOre(s.ore);
    applySnapshot(s.ents, s.ev, (ev) => {
      if (ev[0] === 'm') show(ev[1]);
      else if (ev[0] === 'a') { V.pings.push({ x: ev[1], y: ev[2], t: 0 }); G.lastAlert = { x: ev[1], y: ev[2] }; }
    });
  };

  const onGameMessage = (m: ServerMsg) => {
    if (m.k === 'nogame') { rejoinFailed('That game has ended.'); return; }
    if (!V.online) return;
    if (m.k === 'notice' && V.started) show(m.msg);
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
    // the server holds our side for a while: try to get back in before giving up
    if (V.online && V.started && !G.over) rejoin(root.dataset.gameId ?? '', REJOIN_TRIES);
  });

  /** Get back into an online match (after a refresh or a dropped connection) with the key the server gave us. */
  let rejoining = 0;
  const rejoin = (id: string, tries: number) => {
    const key = onlineKey(id);
    if (!key) { rejoinFailed('Lost connection to the game server.'); return; }
    show(V.started ? 'Connection lost. Reconnecting…' : 'Rejoining your game…');
    const attempt = rejoining = window.setTimeout(() => {
      net.connect(storedName()).then(() => net.send({ k: 'rejoin', game: id, key }), () => {
        if (attempt !== rejoining) return;
        if (tries > 1) rejoin(id, tries - 1);
        else rejoinFailed('Lost connection to the game server.');
      });
    }, V.started ? REJOIN_WAIT * 1000 : 0);
  };
  const rejoinFailed = (why: string) => {
    clearTimeout(rejoining);
    const id = root.dataset.gameId ?? gameIdFromUrl();
    if (id) void forgetGame(id).catch(() => {});
    if (V.online && V.started && !G.over) { G.over = true; G.winner = -1; endReason = why; return; }
    leaveGameUrl();
    openModal(startModal);
    show(why);
  };

  const startOnline = (m: Extract<ServerMsg, { k: 'start' }>) => {
    closeModal(startModal);
    V.online = true;
    V.team = m.team;
    for (const a of ais) a.on = false;
    initWorld(m.seed);
    setGameId(m.game ?? newGameId());
    if (m.game) {
      if (m.key) rememberOnline(m.game, m.key);
      enterGameUrl(m.game);
    }
    // the server owns every unit and building: start empty and fill in from snapshots
    Object.assign(G, { ents: [], projs: [], fx: [], decals: [], demo: false, visualOnly: true, viewer: m.team, human: [m.team === 0, m.team === 1] });
    G.byId.clear();
    rebuildBlk();
    resetSnapshots();
    setupWorldView();
    makeIcons(m.team);
    Object.assign(V, { sel: [], mode: null, markers: [], pings: [], paused: false, speed: 1, started: true });
    autoFullscreen();
    (document.activeElement as HTMLElement | null)?.blur?.(); // the lobby's name box would swallow every key
    root.classList.add('view-game--online');
    resignBtn.hidden = false;
    speedBtn.hidden = pauseBtn.hidden = true;
    againBtn.textContent = 'Back to lobby';
    home(m.team);
    setSelection([]);
    show(m.resumed ? `Back in your game vs ${m.opponent}` : `Match found: you vs ${m.opponent}`);
  };

  const lobby = mountLobby(must(root, '.view-lobby'), { onStart: startOnline, onBack: () => openModal(startModal) });

  const setupEl = must<HTMLElement>(root, '.view-setup');
  const setup = mountSetup(setupEl, {
    onStart: (s, watch) => {
      // a new game from the pause menu replaces the paused one: drop its save and its address
      if (V.started && !V.online) {
        const old = root.dataset.gameId;
        if (old) void forgetGame(old).catch(() => {});
        delete root.dataset.gameId;
        leaveGameUrl();
      }
      startSolo(watch, s);
    },
    // Back from the pause menu's New Game returns to the paused game, otherwise to the main menu
    onBack: () => { if (!(V.started && !V.online && !G.over)) openModal(startModal); },
  });
  must(root, '.game-paused-resume').addEventListener('click', () => { V.paused = false; });
  must(root, '.game-paused-new').addEventListener('click', () => { V.paused = true; setup.open(false); });
  // End Game: a second tap confirms, then the game is dropped (save and address) for the main menu
  const quitBtn = must<HTMLButtonElement>(root, '.game-paused-quit');
  let quitArmed = 0;
  quitBtn.addEventListener('click', () => {
    if (Date.now() - quitArmed >= RESIGN_CONFIRM) {
      quitArmed = Date.now();
      quitBtn.textContent = 'Tap again to end';
      setTimeout(() => { quitBtn.textContent = 'End Game'; }, RESIGN_CONFIRM);
      return;
    }
    const id = root.dataset.gameId;
    quitting = true; // no autosave brings it back on the way out
    const leave = () => { location.href = '/'; };
    if (id) forgetGame(id).then(leave, leave); else leave();
  });

  must(root, '.game-start-play').addEventListener('click', () => { closeModal(startModal); setup.open(false); });
  must(root, '.game-start-watch').addEventListener('click', () => { closeModal(startModal); setup.open(true); });
  const onlineBtn = must<HTMLButtonElement>(root, '.game-start-online');
  onlineBtn.addEventListener('click', () => { closeModal(startModal); lobby.open(); });
  // with no connection only solo play works (the game itself is cached by the service worker)
  const showConnection = () => {
    onlineBtn.disabled = !navigator.onLine;
    onlineBtn.textContent = navigator.onLine ? 'Play Online' : 'Play Online (offline)';
    onlineBtn.title = navigator.onLine ? '' : 'No internet connection. You can still play against the computer.';
  };
  showConnection();
  window.addEventListener('online', showConnection);
  window.addEventListener('offline', showConnection);
  /** A game's address with nothing of ours behind it: a game we were hosting (refreshed), or a friend's invite link. */
  const openGameLink = (id: string) => {
    delete root.dataset.gameId;
    lobby.open(hostedGame() === id ? { host: id } : { join: id });
  };
  againBtn.addEventListener('click', () => { location.href = V.online ? '/?online' : '/'; });
  // Back from a game's address leaves the game for the start screen (a solo game stays saved there)
  window.addEventListener('popstate', () => { if (V.started && gameIdFromUrl() !== root.dataset.gameId) location.reload(); });
  pauseBtn.addEventListener('click', () => { V.paused = !V.paused; });
  mountFullscreenButton(must<HTMLButtonElement>(root, '.topbar-fullscreen'));
  speedBtn.addEventListener('click', () => { V.speed = V.speed >= 4 ? 0.5 : V.speed * 2; });
  let resignArmed = 0;
  resignBtn.addEventListener('click', () => {
    // two clicks so a stray tap doesn't end the game
    if (Date.now() - resignArmed < RESIGN_CONFIRM) { net.send({ k: 'resign' }); return; }
    resignArmed = Date.now();
    resignBtn.textContent = 'Confirm?';
    setTimeout(() => { resignBtn.textContent = 'Surrender'; }, RESIGN_CONFIRM);
  });

  openSaves();
  const resumeId = gameIdFromUrl();
  if (resumeId) {
    // a refresh of a game's address: rejoin the online match, or load the saved solo game
    closeModal(startModal);
    root.dataset.gameId = resumeId;
    if (onlineKey(resumeId)) rejoin(resumeId, 1);
    else {
      loadGame(resumeId).then(
        (g) => { if (!g) openGameLink(resumeId); else if (!resumeSolo(g)) rejoinFailed('That game has ended.'); },
        () => openGameLink(resumeId),
      );
    }
  } else applyTestOptions(q, startSolo, (quick, join) => { closeModal(startModal); lobby.open({ quick, join }); });

  let last = performance.now(), acc = 0, fogT = 0, oreT = 0, savedAt = performance.now();
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
    const showPaused = V.started && V.paused && !G.over && !V.online && !setupEl.classList.contains('ui-modal--open');
    if (pausedBox.hidden === showPaused) pausedBox.hidden = !showPaused;
    if (!V.online && V.started && !G.over) {
      // real time, not game time: a slow machine still saves every few seconds
      if (t - savedAt >= SAVE_INTERVAL * 1000) { savedAt = t; saveNow(); }
    }
    if (G.over && !shownEnd) {
      shownEnd = true;
      if (root.dataset.gameId) void forgetGame(root.dataset.gameId).catch(() => {});
      must(root, '.game-result').textContent = G.demo ? (G.winner < 0 ? 'Draw' : `${teamColors(G.winner).name} wins`) : G.winner === V.team ? 'Victory' : G.winner < 0 ? 'Game over' : 'Defeat';
      must(root, '.game-end-time').textContent = [endReason, `Time ${formatTime(G.gameT)}`].filter(Boolean).join(' ');
      resignBtn.hidden = true;
      openModal(endModal);
    }
    scrollCamera(dt);
    clampCam();
    updateFollow(dt);
    updatePlacement((tx, ty) => V.mode?.t === 'place' && canPlaceType(V.mode.type, tx, ty, V.team), (t) => BUILDING[t as BldType].size);
    canvas.classList.toggle('game-canvas--targeting', !!V.mode);
    oreT -= dt;
    if (oreT <= 0) { oreT = ORE_REFRESH; refreshOre(); }
    try {
      updateCamera();
      syncEntities(dt);
      updateCows3d();
      updateFx3d();
      updateBurning(V.paused ? 0 : dt);
      animatePortals3d(dt);
      updateAetherBeams();
      updateAetherGlows();
      animateWater(dt);
      renderScene();
      drawOverlay(og);
      drawMinimap(mg, viewFootprint());
      refreshHud();
      refreshSidebar();
      refreshTouchBar();
    } catch (err) {
      hooks.error(err);
    }
  };
  requestAnimationFrame(frame);
}

/**
 * Lay out one of every structure (and a row of every unit) for your side near the middle of the
 * map, to look at the models: ?showcase, or ?showcase=units / ?showcase=buildings.
 */
function showcase(what: string): void {
  ais.forEach((a) => { a.on = false; });
  const free = (tx: number, ty: number, s: number) => {
    for (let y = ty - 1; y <= ty + s; y++) for (let x = tx - 1; x <= tx + s; x++) if (x < 0 || y < 0 || x >= MW || y >= MH || G.blk[y * MW + x] || G.terr[y * MW + x] !== 0) return false;
    return true;
  };
  let tx = 16, ty = 22;
  if (what !== 'units')
    for (const type of Object.keys(BUILDING) as BldType[]) {
      const s = BUILDING[type].size;
      for (let tries = 0; tries < 400 && !free(tx, ty, s); tries++) { tx += 1; if (tx > 48) { tx = 16; ty += 1; } }
      if (!free(tx, ty, s)) continue;
      addBuilding(type, V.team, tx, ty, false);
      tx += s + 1;
      if (tx > 46) { tx = 16; ty += 4; }
    }
  if (what === 'buildings') return;
  ty += 4;
  (Object.keys(UNIT) as UnitType[]).forEach((type, i) => {
    const u = addUnit(type, V.team, (18 + (i % 12) * 1.5) * TS, (ty + Math.floor(i / 12) * 1.5) * TS);
    u.face = u.tface = Math.PI / 2;
  });
}

/**
 * URL options for testing: ?seed=N map seed, ?auto start a solo game, ?demo AI vs AI, ?online open
 * the lobby (?online=quick also joins quick match), ?join=ID open the lobby and join that game (invite links), ?sim=S simulate S seconds before the first frame, ?reveal no fog, ?cam=x,y center on a
 * tile, ?view=yaw,pitch,dist camera angle in degrees and distance in tiles, ?sel=type select up to six
 * of your units of that type, ?queue=a,b start building these, ?era=N start your side in age N,
 * ?showcase put one of everything near the middle, ?mood=morning|midday|afternoon|evening the light, ?armor=N
 * your Armory armour upgrades at level N, ?damage=0.5,0.3,0.1 your buildings' health in turn (fires).
 * New game settings for ?auto and ?demo: ?ai=easy|normal|hard|brutal, ?foes=3, ?res=low|high, ?army=squad|army,
 * ?fog=off, ?speed=2.
 */
function testSetup(q: URLSearchParams): GameSetup {
  const s: GameSetup = { ...DEFAULT_SETUP, seed: null };
  const ai = q.get('ai'), res = q.get('res'), army = q.get('army');
  if (ai && ai in AI_LEVEL) s.difficulty = ai as GameSetup['difficulty'];
  if (res && res in START_RESOURCES) s.resources = res as GameSetup['resources'];
  if (army && army in START_ARMY) s.army = army as GameSetup['army'];
  if (q.get('foes') === '3') s.foes = 3;
  if (q.get('fog') === 'off') s.fog = false;
  if (q.has('speed')) s.speed = Number(q.get('speed')) || 1;
  if (q.has('seed')) s.seed = Number(q.get('seed')) || null;
  return s;
}

function applyTestOptions(q: URLSearchParams, startSolo: (demo: boolean, s?: GameSetup) => void, openLobby: (quick: boolean, join?: string) => void): void {
  if (q.has('online') || q.has('join')) { openLobby(q.get('online') === 'quick', q.get('join') ?? undefined); return; }
  if (q.has('demo') || q.has('auto')) startSolo(q.has('demo'), testSetup(q));
  if (q.has('era')) G.era[V.team] = Math.max(0, Math.min(LAST_ERA, Number(q.get('era')) || 0));
  if (q.has('showcase')) showcase(q.get('showcase') ?? '');
  const dmg = (q.get('damage') ?? '').split(',').map(Number).filter((f) => f > 0);
  if (dmg.length) G.ents.filter((e) => e.kind === 'bld' && e.team === V.team).forEach((e, i) => { e.hp = e.maxhp * dmg[i % dmg.length]; });
  const armor = Number(q.get('armor'));
  if (armor > 0 && G.upg[V.team]) G.upg[V.team].infArmor = G.upg[V.team].vehArmor = Math.min(3, armor);
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
