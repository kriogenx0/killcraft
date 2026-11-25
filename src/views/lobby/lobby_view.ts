// The online lobby: pick a name, see who's online, then quick match, host/join a public game,
// or challenge a specific player.
import { net } from '../../net/client.ts';
import { MAX_NAME, cleanName, type LiveGame, type LobbyMsg, type OnlinePlayer, type RoomView, type ServerMsg } from '../../net/protocol.ts';
import { FOG_MODES, MODES, isFogMode, isMode } from '../../data/setup.ts';
import { seatRows } from '../../components/seats/seats.ts';
import { closeModal, openModal } from '../../components/modal/modal.ts';
import { copyButton } from '../../components/copy_button/copy_button.ts';
import { gameIdFromUrl, leaveGameUrl } from '../game/resume.ts';

type StartMsg = Extract<ServerMsg, { k: 'start' }>;
type SpectateMsg = Extract<ServerMsg, { k: 'spectate' }>;

const NAME_KEY = 'killcraft.name';
/** the game this tab is hosting, so a refresh lists it again under the same id and its invite link keeps working */
const HOSTING_KEY = 'killcraft.hosting';

/** The invite link for a game: its own address, so opening it joins the game. */
export function inviteUrl(game: string): string {
  return new URL(`/game/${game}`, location.origin).href;
}

/** The game this tab was hosting before a refresh, if any. */
export function hostedGame(): string | null {
  try { return sessionStorage.getItem(HOSTING_KEY); } catch { return null; }
}

function setHostedGame(game: string | null): void {
  try { if (game) sessionStorage.setItem(HOSTING_KEY, game); else sessionStorage.removeItem(HOSTING_KEY); } catch { /* ignore */ }
}

const MARKUP = `
  <h2 class="lobby-title">Play online</h2>
  <label class="ui-text-field">
    <span class="ui-text-field-label">Your name</span>
    <input class="ui-text-field-input lobby-name" maxlength="${MAX_NAME}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
  </label>
  <div class="ui-modal-actions lobby-actions">
    <button type="button" class="ui-button ui-button--secondary lobby-create">Create game</button>
    <button type="button" class="ui-button lobby-quick">Quick match</button>
  </div>
  <p class="lobby-status" role="status" aria-live="polite"></p>
  <div class="lobby-room" hidden>
    <h3 class="lobby-room-title"></h3>
    <div class="ui-segmented lobby-room-mode" role="radiogroup" aria-label="Players">
      ${Object.entries(MODES).map(([value, m]) => `<label class="ui-segmented-option" title="${m.desc}"><input type="radio" autocomplete="off" name="lobby-mode" value="${value}"><span>${m.short}</span></label>`).join('')}
    </div>
    <div class="seats lobby-seats" role="group" aria-label="Seats"></div>
    <div class="lobby-room-fog">
      <span class="lobby-room-fog-label">Fog</span>
      <div class="ui-segmented" role="radiogroup" aria-label="Fog of war">
        ${Object.entries(FOG_MODES).map(([value, f]) => `<label class="ui-segmented-option" title="${f.desc}"><input type="radio" autocomplete="off" name="lobby-fog" value="${value}"><span>${f.name}</span></label>`).join('')}
      </div>
    </div>
  </div>
  <div class="lobby-invite-box" hidden>
    <div class="lobby-link">
      <input class="ui-text-field-input lobby-link-url" readonly autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Invite link">
      <button type="button" class="ui-button ui-button--small lobby-copy">Copy invite link</button>
      <button type="button" class="ui-button ui-button--small ui-button--secondary lobby-share" hidden>Share</button>
    </div>
  </div>
  <!-- the way out on the left, Start on the right -->
  <div class="ui-modal-actions lobby-room-actions">
    <button type="button" class="ui-button ui-button--secondary lobby-cancel" hidden>Cancel</button>
    <button type="button" class="ui-button lobby-begin" hidden>Start game</button>
  </div>
  <ul class="lobby-invites" aria-label="Challenges"></ul>
  <div class="lobby-columns">
    <section class="lobby-section lobby-games" aria-label="Open games">
      <h3>Open games</h3>
      <ul class="lobby-list lobby-game-list"></ul>
      <h3 class="lobby-live-title">Games in progress</h3>
      <ul class="lobby-list lobby-live-list" aria-label="Games in progress"></ul>
    </section>
    <section class="lobby-section lobby-players" aria-label="Players online">
      <h3 class="lobby-online">Players online</h3>
      <ul class="lobby-list lobby-player-list"></ul>
    </section>
  </div>
  <button type="button" class="ui-button ui-button--secondary lobby-back">Back</button>
`;

export function storedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}

function storeName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode: the name just isn't remembered */ }
}

export interface LobbyOptions {
  onStart: (msg: StartMsg) => void;
  /** started watching a match under way */
  onSpectate: (msg: SpectateMsg) => void;
  onBack: () => void;
}

const STATUS_TEXT: Record<OnlinePlayer['status'], string> = {
  idle: 'In the lobby',
  quick: 'Looking for a match',
  host: 'Hosting a game',
  room: 'In a game, waiting to start',
  playing: 'In a match',
  watching: 'Watching a match',
};

function statusText(p: OnlinePlayer): string {
  if (p.status === 'playing' && p.opponent) return `Playing ${p.opponent}`;
  if (p.status === 'watching' && p.opponent) return `Watching ${p.opponent}`;
  return STATUS_TEXT[p.status];
}

/** "Alice vs Bob", and how long it's been going and who's watching. */
export function liveText(g: LiveGame, now = Date.now(), at = now): { name: string; detail: string } {
  const mins = Math.floor((g.secs + (now - at) / 1000) / 60);
  const since = mins < 1 ? 'Just started' : `${mins} min in`;
  return { name: g.title ?? g.players.filter(Boolean).join(' vs '), detail: g.watchers ? `${since} · ${g.watchers} watching` : since };
}

function button(label: string, cls: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ui-button ui-button--small ${secondary ? 'ui-button--secondary ' : ''}${cls}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function row(cls: string, ...children: (Node | string)[]): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `lobby-row ${cls}`;
  li.append(...children);
  return li;
}

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

export type Lobby = ReturnType<typeof mountLobby>;

export function mountLobby(root: HTMLElement, opts: LobbyOptions) {
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const name = $<HTMLInputElement>('.lobby-name'), status = $('.lobby-status'), online = $('.lobby-online');
  const gameList = $('.lobby-game-list'), liveList = $('.lobby-live-list'), playerList = $('.lobby-player-list'), inviteList = $('.lobby-invites');
  const quick = $<HTMLButtonElement>('.lobby-quick'), create = $<HTMLButtonElement>('.lobby-create'), cancel = $<HTMLButtonElement>('.lobby-cancel');
  let waiting: 'quick' | 'host' | 'room' | 'invite' | null = null, connectedAs = '';
  const roomBox = $('.lobby-room'), roomTitle = $('.lobby-room-title'), roomSeats = $('.lobby-seats'), begin = $<HTMLButtonElement>('.lobby-begin');
  const roomMode = $('.lobby-room-mode'), roomFog = $('.lobby-room-fog');
  let last: LobbyMsg | null = null, lastAt = 0;
  const link = $('.lobby-invite-box'), linkUrl = $<HTMLInputElement>('.lobby-link-url'), copy = $<HTMLButtonElement>('.lobby-copy');
  const share = $<HTMLButtonElement>('.lobby-share');
  share.hidden = typeof navigator.share !== 'function';
  /** joined from an invite link: if that fails, the address goes back to the start screen's */
  let joiningLink = false;

  /** Show the invite link for the game you're hosting or have joined (only a hosted one is listed again after a refresh). */
  const showLink = (game: string | null, hosting = true) => {
    link.hidden = !game;
    setHostedGame(hosting ? game : null);
    if (!game) {
      // stopped hosting: the address no longer names a game
      if (!joiningLink && gameIdFromUrl() && gameIdFromUrl() === lastHosted) leaveGameUrl();
      lastHosted = null;
      return;
    }
    lastHosted = game;
    // the address bar shows the invite link too, and a refresh keeps hosting the same game
    if (gameIdFromUrl() !== game) { try { history.replaceState(null, '', `/game/${game}`); } catch { /* ignore */ } }
    const url = inviteUrl(game);
    if (linkUrl.value !== url) { linkUrl.value = url; copy.textContent = 'Copy invite link'; }
  };
  let lastHosted: string | null = null;

  const setStatus = (text: string, busy = false, error = false) => {
    status.replaceChildren();
    if (busy) { const s = document.createElement('span'); s.className = 'ui-spinner'; s.setAttribute('aria-hidden', 'true'); status.append(s, ' '); }
    status.append(text);
    status.classList.toggle('lobby-status--error', error);
  };

  const empty = (text: string) => row('lobby-empty', text);

  const watchButton = (game: string) => button('Watch', 'lobby-watch', () => { setStatus('Opening the game…', true); net.send({ k: 'watch', game }); }, true);

  /** The game room you're in: how the sides line up and who sits where; the host changes seats and starts it. */
  const renderRoom = (r: RoomView | null | undefined) => {
    roomBox.hidden = !r;
    begin.hidden = !r?.host;
    if (!r) return;
    const me = r.seats.find((s) => s.you)?.team ?? 0;
    roomTitle.textContent = r.host ? `Your game: ${MODES[r.mode].name}` : `${r.hostName}'s game: ${MODES[r.mode].name}`;
    roomMode.hidden = !r.host;
    roomMode.querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.checked = i.value === r.mode; });
    // everyone sees the fog the host picked; only the host can change it
    roomFog.querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.checked = i.value === (r.fog ?? 'show'); i.disabled = !r.host; });
    roomSeats.innerHTML = seatRows(r.mode, r.seats.map((s) => ({ ...s, editable: r.host && s.kind !== 'person', openable: true })), me);
    roomSeats.querySelectorAll<HTMLSelectElement>('.seat-select').forEach((sel) => {
      if (r.mode === '1v1') sel.querySelector('option[value="closed"]')?.remove();
      sel.addEventListener('change', () => net.send({ k: 'room', seat: Number(sel.name.slice(5)), pick: sel.value as never }));
    });
    begin.disabled = !r.ready;
    const open = r.seats.filter((s) => s.kind === 'open').length;
    if (r.host) setStatus(open ? `Waiting for ${open === 1 ? 'a player' : `${open} players`} to join. Send them the invite link, or put a computer in the seat.` : r.ready ? 'Everyone is here. Start when you like.' : 'Put someone on the other side.', !!open);
    else setStatus(`Waiting for the host to start${open ? ` (${open} open seat${open === 1 ? '' : 's'} left)` : ''}…`, true);
  };

  const render = (m: LobbyMsg) => {
    last = m;
    lastAt = Date.now();
    showLink(m.hosting ?? m.room?.id ?? null, !!m.hosting);
    const byId = new Map(m.players.map((p) => [p.id, p]));

    inviteList.replaceChildren(...m.invites.map((inv) => row('lobby-invite',
      span('lobby-row-name', `${inv.name} challenges you`),
      button('Decline', 'lobby-decline', () => net.send({ k: 'decline', from: inv.id }), true),
      button('Accept', 'lobby-accept', () => { setStatus('Starting…', true); net.send({ k: 'accept', from: inv.id }); }),
    )));

    const games = m.games.filter((g) => g.id !== m.hosting && g.id !== m.room?.id);
    gameList.replaceChildren(...games.map((g) => {
      const join = button('Join', 'lobby-join', () => { setStatus('Joining…', true); net.send({ k: 'join', game: g.id }); });
      join.disabled = waiting === 'host' || waiting === 'room' || g.free === 0;
      const label = document.createElement('span');
      label.className = 'lobby-row-label';
      const shape = g.mode && g.mode !== '1v1' ? `${MODES[g.mode].short} · ${g.free ?? 0} open seat${g.free === 1 ? '' : 's'} · ` : '';
      const id = span('lobby-row-status lobby-game-id', `${shape}Game ${g.id.slice(0, 8)}`);
      id.title = `Game ID ${g.id}`;
      id.append(copyButton(() => inviteUrl(g.id), 'Copy invite link'));
      label.append(span('lobby-row-name', `${g.host}'s game`), id);
      return row('lobby-game', label, join);
    }));
    if (!games.length) gameList.append(empty('No open games. Create one or use Quick match.'));

    liveList.replaceChildren(...(m.live ?? []).map((g) => {
      const t = liveText(g, Date.now(), lastAt);
      const label = document.createElement('span');
      label.className = 'lobby-row-label';
      label.append(span('lobby-row-name', t.name), span('lobby-row-status lobby-live-detail', t.detail));
      label.title = `Game ID ${g.id}`;
      return row('lobby-live', label, watchButton(g.id));
    }));
    if (!m.live?.length) liveList.append(empty('No games being played right now.'));

    playerList.replaceChildren(...m.players.map((p) => {
      const you = p.id === m.you;
      const label = document.createElement('span');
      label.className = 'lobby-row-label';
      label.append(span('lobby-row-name', you ? `${p.name} (you)` : p.name), span(`lobby-row-status lobby-row-status--${p.status}`, statusText(p)));
      const li = row(`lobby-player${you ? ' lobby-player--you' : ''}`, label);
      if (!you && p.status !== 'playing') {
        const challenged = m.inviting === p.id;
        const b = button(challenged ? 'Challenged' : 'Challenge', 'lobby-challenge', () => ensure(() => net.send({ k: 'invite', to: p.id })), true);
        b.disabled = challenged;
        li.append(b);
      }
      return li;
    }));
    const hidden = m.online - m.players.length;
    if (hidden > 0) playerList.append(empty(`and ${hidden} more`));
    online.textContent = `Players online (${m.online})`;

    renderRoom(m.room);
    if (m.inviting) {
      const target = byId.get(m.inviting)?.name ?? 'them';
      setWaiting('invite');
      setStatus(`Challenge sent to ${target}. Waiting for an answer…`, true);
    }
  };

  const setWaiting = (w: typeof waiting) => {
    waiting = w;
    quick.hidden = create.hidden = !!w;
    cancel.hidden = !w;
    cancel.textContent = w === 'room' ? 'Leave game' : w === 'host' ? 'Close game' : 'Cancel';
    name.disabled = !!w;
    if (w === 'quick') setStatus('Looking for an opponent…', true);
    else if (w === 'host') setStatus('Copy the invite link and send it to a friend. They join your game as soon as they open it.', true);
  };

  net.onMessage((m) => {
    if (m.k === 'lobby') {
      const w = m.waiting ?? (m.room ? 'room' : m.inviting ? 'invite' : null);
      const wasBusy = !!status.querySelector('.ui-spinner');
      setWaiting(w);
      if (!w && wasBusy) setStatus('');
      render(m);
    }
    else if (m.k === 'error') {
      // a link to a game that has started: offer to watch it
      if (m.live) {
        const game = m.live.id;
        joiningLink = false;
        setStatus(m.msg);
        status.append(' ', watchButton(game));
        return;
      }
      setStatus(m.msg, false, true);
      if (joiningLink) { joiningLink = false; if (gameIdFromUrl()) leaveGameUrl(); }
    }
    else if (m.k === 'spectate') { joiningLink = false; closeModal(root); opts.onSpectate(m); }
    else if (m.k === 'notice') setStatus(m.msg);
    else if (m.k === 'start') { joiningLink = false; lastHosted = null; setHostedGame(null); closeModal(root); opts.onStart(m); }
  });
  // the server restarts on every deploy: keep trying to get back, then pick up what this tab was doing
  let retry: ReturnType<typeof setTimeout> | null = null, retries = 0;
  const isOpen = () => root.classList.contains('ui-modal--open');
  const reconnect = (resume: () => void) => {
    if (retry) clearTimeout(retry);
    retry = setTimeout(async () => {
      retry = null;
      if (!isOpen() || net.connected) return;
      try {
        await net.connect(cleanName(name.value));
        connectedAs = cleanName(name.value);
        retries = 0;
        setStatus('');
        resume();
      } catch {
        retries++;
        setStatus('Reconnecting to the game server…', true);
        reconnect(resume);
      }
    }, Math.min(1000 * 2 ** retries, 10_000));
  };
  net.onClose(() => {
    if (!isOpen()) return;
    const was = waiting, hosted = lastHosted;
    setWaiting(null);
    setStatus('Disconnected from the game server. Reconnecting…', true);
    connectedAs = '';
    last = null;
    inviteList.replaceChildren();
    // keep the hosted game remembered: reconnecting (or a refresh) lists it again under the same link
    link.hidden = true;
    playerList.replaceChildren(empty('Not connected.'));
    online.textContent = 'Players online';
    retries = 0;
    reconnect(() => {
      if (hosted) net.send({ k: 'create', game: hosted });
      else if (was === 'quick') net.send({ k: 'quick' });
    });
  });

  /** Connect (or reconnect after a name change), then run `then`. */
  const ensure = async (then?: () => void) => {
    const n = cleanName(name.value);
    storeName(n);
    try {
      if (connectedAs !== n) {
        if (connectedAs) net.close();
        setStatus('Connecting…', true);
        await net.connect(n);
        connectedAs = n;
        setStatus('');
      }
      then?.();
    } catch (err) {
      setStatus((err as Error).message, false, true);
    }
  };

  roomMode.addEventListener('change', (e) => { const v = (e.target as HTMLInputElement).value; if (isMode(v)) net.send({ k: 'room', mode: v }); });
  roomFog.addEventListener('change', (e) => { const v = (e.target as HTMLInputElement).value; if (isFogMode(v)) net.send({ k: 'room', fog: v }); });
  begin.addEventListener('click', () => { begin.disabled = true; net.send({ k: 'begin' }); });
  quick.addEventListener('click', () => ensure(() => net.send({ k: 'quick' })));
  create.addEventListener('click', () => ensure(() => net.send({ k: 'create' })));
  cancel.addEventListener('click', () => { net.send({ k: 'leave' }); setWaiting(null); setStatus(''); if (last) render({ ...last, inviting: null, hosting: null, room: null }); });
  linkUrl.addEventListener('focus', () => linkUrl.select());
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(linkUrl.value); copy.textContent = 'Copied!'; }
    catch { linkUrl.focus(); copy.textContent = 'Press Ctrl+C to copy'; }
  });
  share.addEventListener('click', () => {
    navigator.share({ title: 'Killcraft', text: 'Join my Killcraft game', url: linkUrl.value }).catch(() => { /* closed the share sheet */ });
  });
  name.addEventListener('change', () => ensure());
  $('.lobby-back').addEventListener('click', () => {
    if (retry) { clearTimeout(retry); retry = null; }
    net.send({ k: 'leave' });
    net.close();
    connectedAs = '';
    showLink(null);
    closeModal(root);
    opts.onBack();
  });

  return {
    /**
     * Show the lobby. `quick` starts looking for a match right away; `join` joins that game (an invite link);
     * `watch` watches that match (a refresh while watching); `host` lists the game this tab was hosting before a refresh again, under the same id.
     */
    open(o: { quick?: boolean; join?: string; host?: string; watch?: string } = {}): void {
      name.value = storedName();
      setWaiting(null);
      openModal(root);
      joiningLink = !!(o.join || o.watch);
      if (o.watch) { const game = o.watch; void ensure(() => { setStatus('Opening the game…', true); net.send({ k: 'watch', game }); }); }
      else if (o.join) { const game = o.join; void ensure(() => { setStatus("Joining your friend's game…", true); net.send({ k: 'join', game }); }); }
      else if (o.host) { const game = o.host; void ensure(() => net.send({ k: 'create', game })); }
      else void ensure(o.quick ? () => net.send({ k: 'quick' }) : undefined);
    },
  };
}
