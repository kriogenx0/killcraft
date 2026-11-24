// The main menu: logo, the Play buttons, and the online lobby at a glance (players online, open games
// to join, matches to watch). It stays light on purpose: the game view, and three.js with it, load
// only once a game starts (or a refresh resumes one).
import { net } from '../../net/client.ts';
import type { LobbySummary, ServerMsg } from '../../net/protocol.ts';
import { closeModal, openModal } from '../../components/modal/modal.ts';
import { liveText, mountLobby } from '../lobby/lobby_view.ts';
import { mountSetup } from '../setup/setup_view.ts';
import { gameIdFromUrl, rememberOnline } from '../game/resume.ts';
import { takeUpdate } from '../../pwa/register.ts';
import type { GameBoot, GameView } from '../game/game_view.ts';

/** how often the lobby summary is fetched while the menu is showing */
const POLL_MS = 10_000;
/** rows of open games and matches on the menu; the rest are in Play Online */
const MAX_ROWS = 5;
/** URL test options that start a game right away (see applyTestOptions in game_view.ts) */
const TEST_STARTS = ['auto', 'demo', 'showcase', 'stress'];

type GameModule = typeof import('../game/game_view.ts');
let gameModule: Promise<GameModule> | null = null;

/** Fetch the game's code (and three.js). Called early when a game is about to start, to save time. */
function loadGameModule(): Promise<GameModule> {
  gameModule ??= import('../game/game_view.ts').catch((err) => { gameModule = null; throw err; });
  return gameModule;
}

function must<T extends Element>(root: Element, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

/** Mount the main menu. Resolves once the first screen is ready: the menu, or the game a refresh resumes. */
export function mountMenu(root: HTMLElement): Promise<void> {
  const startModal = must<HTMLElement>(root, '.game-start');
  const onlineBtn = must<HTMLButtonElement>(root, '.game-start-online');
  const status = must<HTMLElement>(root, '.game-start-status');
  const q = new URLSearchParams(location.search);
  if (matchMedia('(any-pointer: coarse)').matches) document.documentElement.classList.add('touch-ui');

  // ---- the game, loaded on demand ----
  let game: GameView | null = null, mounting: Promise<GameView> | null = null;
  /** server messages that arrive between a match starting and the game view being ready to take them */
  let buffering = false;
  const buffered: ServerMsg[] = [];
  net.onMessage((m) => { if (buffering && m.k !== 'lobby') buffered.push(m); });

  const mountGame = (boot: GameBoot): Promise<GameView> => {
    if (game) return Promise.resolve(game);
    mounting ??= loadGameModule().then((mod) => { game = mod.mountGameView(root, { lobby, setup }, boot); return game; })
      .catch((err) => { mounting = null; throw err; });
    return mounting;
  };

  /**
   * Run `start` on the game view, loading it first if need be. If the game's code can't be loaded (a
   * deploy replaced it under this page), `rescue` gets there on the new version instead, if it can.
   */
  const toGame = (start: (g: GameView) => void, rescue?: () => boolean) => {
    if (game) { start(game); return; }
    buffering = true;
    root.classList.add('view-game--loading');
    mountGame(null).then((g) => {
      buffering = false;
      start(g);
      for (const m of buffered.splice(0)) g.feed(m);
    }, (err) => {
      console.error(err);
      buffering = false;
      buffered.length = 0;
      if (rescue?.()) return;
      net.close();
      openMenu();
      status.textContent = "Couldn't load the game. Check your connection and try again.";
    }).finally(() => root.classList.remove('view-game--loading'));
  };

  // ---- the menu's screens ----
  const openMenu = () => { status.textContent = ''; openModal(startModal); };
  const lobby = mountLobby(must(root, '.view-lobby'), {
    // a match that started: rejoin it from its own address, which loads the new version
    onStart: (m) => toGame((g) => g.startOnline(m), () => {
      if (!m.game || !m.key) return false;
      rememberOnline(m.game, m.key);
      location.href = `/game/${m.game}`;
      return true;
    }),
    onSpectate: (m) => toGame((g) => g.startSpectate(m)),
    onBack: openMenu,
  });
  const setup = mountSetup(must(root, '.view-setup'), {
    onStart: (s, watch) => toGame((g) => g.newSolo(s, watch)),
    // Back from the pause menu's New Game returns to the paused game, otherwise to the main menu
    onBack: () => { if (!game?.playingSolo()) openMenu(); },
  });
  const openSetup = (watch: boolean) => { closeModal(startModal); setup.open(watch); void loadGameModule().catch(() => {}); };
  const openLobby = (o?: Parameters<typeof lobby.open>[0]) => { closeModal(startModal); lobby.open(o); void loadGameModule().catch(() => {}); };

  // with a new version waiting, each of these opens on it instead (see takeUpdate)
  must(root, '.game-start-play').addEventListener('click', () => { if (!takeUpdate('/?setup')) openSetup(false); });
  must(root, '.game-start-watch').addEventListener('click', () => { if (!takeUpdate('/?setup=watch')) openSetup(true); });
  onlineBtn.addEventListener('click', () => { if (!takeUpdate('/?online')) openLobby(); });

  // ---- who's online and what's being played ----
  const box = must<HTMLElement>(root, '.game-lobby'), count = must<HTMLElement>(root, '.game-lobby-online'), list = must<HTMLElement>(root, '.game-lobby-list');
  let summary: LobbySummary | null = null, summaryAt = 0, pollTimer = 0, polling = false;

  const renderSummary = () => {
    box.hidden = !summary || !navigator.onLine;
    if (!summary) return;
    const s = summary;
    count.textContent = `${s.online} ${s.online === 1 ? 'player' : 'players'} online`;
    const rows: HTMLLIElement[] = [];
    const row = (name: string, detail: string, action: HTMLButtonElement, title = '') => {
      const li = el('li', 'lobby-row'), label = el('span', 'lobby-row-label');
      label.append(el('span', 'lobby-row-name', name), el('span', 'lobby-row-status', detail));
      if (title) label.title = title;
      li.append(label, action);
      rows.push(li);
    };
    const button = (text: string, onClick: () => void, secondary = false) => {
      const b = el('button', `ui-button ui-button--small${secondary ? ' ui-button--secondary' : ''}`, text);
      b.type = 'button';
      b.addEventListener('click', onClick);
      return b;
    };
    for (const g of s.games.slice(0, MAX_ROWS)) row(`${g.host}'s game`, g.mode && g.mode !== '1v1' ? `${g.mode === 'ffa' ? 'Free-for-all' : '2v2'} · ${g.free ?? 0} open seat${g.free === 1 ? '' : 's'}` : 'Waiting for an opponent', button('Join', () => openLobby({ join: g.id })), `Game ID ${g.id}`);
    for (const g of s.live.slice(0, Math.max(0, MAX_ROWS - rows.length))) {
      const t = liveText(g, Date.now(), summaryAt);
      row(t.name, t.detail, button('Watch', () => openLobby({ watch: g.id }), true), `Game ID ${g.id}`);
    }
    const more = s.games.length + s.live.length - rows.length;
    if (more > 0) {
      const li = el('li', 'lobby-row lobby-empty');
      li.append(button(`${more} more in Play Online`, () => openLobby(), true));
      rows.push(li);
    }
    if (!rows.length) rows.push(el('li', 'lobby-row lobby-empty', 'No games right now. Start one with Play Online.'));
    list.replaceChildren(...rows);
  };

  const menuShowing = () => startModal.classList.contains('ui-modal--open') && document.visibilityState === 'visible';
  const poll = async () => {
    clearTimeout(pollTimer);
    if (!menuShowing() || polling) return;
    if (navigator.onLine) {
      polling = true;
      try {
        const res = await fetch('/lobby', { cache: 'no-store' });
        if (!res.ok) throw new Error(`lobby ${res.status}`);
        summary = await res.json() as LobbySummary;
        summaryAt = Date.now();
      } catch {
        summary = null; // no game server (offline, or it's restarting): just don't show the list
      } finally {
        polling = false;
      }
    } else summary = null;
    renderSummary();
    pollTimer = window.setTimeout(poll, POLL_MS);
  };
  // fetch as soon as the menu opens (it's also opened by the game, after leaving one) and when the tab comes back
  new MutationObserver(() => { if (menuShowing()) void poll(); else clearTimeout(pollTimer); }).observe(startModal, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (menuShowing()) void poll(); });

  // with no connection only solo play works (the game itself is cached by the service worker)
  const showConnection = () => {
    onlineBtn.disabled = !navigator.onLine;
    onlineBtn.textContent = navigator.onLine ? 'Play Online' : 'Play Online (offline)';
    onlineBtn.title = navigator.onLine ? '' : 'No internet connection. You can still play against the computer.';
    if (!navigator.onLine) summary = null;
    renderSummary();
    void poll();
  };
  window.addEventListener('online', showConnection);
  window.addEventListener('offline', showConnection);
  showConnection();

  // ---- where the address points ----
  if (gameIdFromUrl()) {
    // a refresh of a game's address: the game view rejoins or reloads it
    closeModal(startModal);
    return mountGame('resume').then(() => {}, (err) => { console.error(err); openMenu(); });
  }
  if (TEST_STARTS.some((k) => q.has(k))) return mountGame('test').then(() => {}, (err) => { console.error(err); });
  if (q.has('setup')) { history.replaceState(null, '', '/'); openSetup(q.get('setup') === 'watch'); return Promise.resolve(); }
  if (q.has('online') || q.has('join')) openLobby({ quick: q.get('online') === 'quick', join: q.get('join') ?? undefined });
  return Promise.resolve();
}
