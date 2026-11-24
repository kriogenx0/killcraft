// The online lobby: pick a name, see who's online, then quick match, host/join a public game,
// or challenge a specific player.
import { net } from '../../net/client.ts';
import { MAX_NAME, cleanName, type LobbyMsg, type OnlinePlayer, type ServerMsg } from '../../net/protocol.ts';
import { closeModal, openModal } from '../../components/modal/modal.ts';
import { gameIdFromUrl, leaveGameUrl } from '../game/resume.ts';

type StartMsg = Extract<ServerMsg, { k: 'start' }>;

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
    <input class="ui-text-field-input lobby-name" maxlength="${MAX_NAME}" autocomplete="nickname" spellcheck="false">
  </label>
  <div class="ui-modal-actions lobby-actions">
    <button type="button" class="ui-button lobby-quick">Quick match</button>
    <button type="button" class="ui-button ui-button--secondary lobby-create">Create game</button>
  </div>
  <p class="lobby-status" role="status" aria-live="polite"></p>
  <div class="lobby-invite-box" hidden>
    <div class="lobby-link">
      <input class="ui-text-field-input lobby-link-url" readonly aria-label="Invite link">
      <button type="button" class="ui-button ui-button--small lobby-copy">Copy invite link</button>
      <button type="button" class="ui-button ui-button--small ui-button--secondary lobby-share" hidden>Share</button>
    </div>
  </div>
  <button type="button" class="ui-button ui-button--secondary lobby-cancel" hidden>Cancel</button>
  <ul class="lobby-invites" aria-label="Challenges"></ul>
  <div class="lobby-columns">
    <section class="lobby-section lobby-games" aria-label="Open games">
      <h3>Open games</h3>
      <ul class="lobby-list lobby-game-list"></ul>
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
  onBack: () => void;
}

const STATUS_TEXT: Record<OnlinePlayer['status'], string> = {
  idle: 'In the lobby',
  quick: 'Looking for a match',
  host: 'Hosting a game',
  playing: 'In a match',
};

function statusText(p: OnlinePlayer): string {
  return p.status === 'playing' && p.opponent ? `Playing ${p.opponent}` : STATUS_TEXT[p.status];
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

export function mountLobby(root: HTMLElement, opts: LobbyOptions) {
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const name = $<HTMLInputElement>('.lobby-name'), status = $('.lobby-status'), online = $('.lobby-online');
  const gameList = $('.lobby-game-list'), playerList = $('.lobby-player-list'), inviteList = $('.lobby-invites');
  const quick = $<HTMLButtonElement>('.lobby-quick'), create = $<HTMLButtonElement>('.lobby-create'), cancel = $<HTMLButtonElement>('.lobby-cancel');
  let waiting: 'quick' | 'host' | 'invite' | null = null, connectedAs = '';
  let last: LobbyMsg | null = null;
  const link = $('.lobby-invite-box'), linkUrl = $<HTMLInputElement>('.lobby-link-url'), copy = $<HTMLButtonElement>('.lobby-copy');
  const share = $<HTMLButtonElement>('.lobby-share');
  share.hidden = typeof navigator.share !== 'function';
  /** joined from an invite link: if that fails, the address goes back to the start screen's */
  let joiningLink = false;

  const showLink = (game: string | null) => {
    link.hidden = !game;
    setHostedGame(game);
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

  const render = (m: LobbyMsg) => {
    last = m;
    showLink(m.hosting);
    const byId = new Map(m.players.map((p) => [p.id, p]));

    inviteList.replaceChildren(...m.invites.map((inv) => row('lobby-invite',
      span('lobby-row-name', `${inv.name} challenges you`),
      button('Accept', 'lobby-accept', () => { setStatus('Starting…', true); net.send({ k: 'accept', from: inv.id }); }),
      button('Decline', 'lobby-decline', () => net.send({ k: 'decline', from: inv.id }), true),
    )));

    const games = m.games.filter((g) => g.id !== m.hosting);
    gameList.replaceChildren(...games.map((g) => {
      const join = button('Join', 'lobby-join', () => { setStatus('Joining…', true); net.send({ k: 'join', game: g.id }); });
      join.disabled = waiting === 'host';
      const label = document.createElement('span');
      label.className = 'lobby-row-label';
      const id = span('lobby-row-status lobby-game-id', `Game ${g.id.slice(0, 8)}`);
      id.title = `Game ID ${g.id}`;
      label.append(span('lobby-row-name', `${g.host}'s game`), id);
      return row('lobby-game', label, join);
    }));
    if (!games.length) gameList.append(empty('No open games. Create one or use Quick match.'));

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
    name.disabled = !!w;
    if (w === 'quick') setStatus('Looking for an opponent…', true);
    else if (w === 'host') setStatus('Copy the invite link and send it to a friend. They join your game as soon as they open it.', true);
  };

  net.onMessage((m) => {
    if (m.k === 'lobby') {
      const w = m.waiting ?? (m.inviting ? 'invite' : null);
      const wasBusy = !!status.querySelector('.ui-spinner');
      setWaiting(w);
      if (!w && wasBusy) setStatus('');
      render(m);
    }
    else if (m.k === 'error') {
      setStatus(m.msg, false, true);
      if (joiningLink) { joiningLink = false; if (gameIdFromUrl()) leaveGameUrl(); }
    }
    else if (m.k === 'notice') setStatus(m.msg);
    else if (m.k === 'start') { joiningLink = false; lastHosted = null; setHostedGame(null); closeModal(root); opts.onStart(m); }
  });
  net.onClose(() => {
    if (!root.classList.contains('ui-modal--open')) return;
    setWaiting(null);
    setStatus('Disconnected from the game server.', false, true);
    connectedAs = '';
    last = null;
    inviteList.replaceChildren();
    // keep the hosted game remembered: a refresh lists it again under the same link
    link.hidden = true;
    playerList.replaceChildren(empty('Not connected.'));
    online.textContent = 'Players online';
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

  quick.addEventListener('click', () => ensure(() => net.send({ k: 'quick' })));
  create.addEventListener('click', () => ensure(() => net.send({ k: 'create' })));
  cancel.addEventListener('click', () => { net.send({ k: 'leave' }); setWaiting(null); setStatus(''); if (last) render({ ...last, inviting: null, hosting: null }); });
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
     * `host` lists the game this tab was hosting before a refresh again, under the same id.
     */
    open(o: { quick?: boolean; join?: string; host?: string } = {}): void {
      name.value = storedName();
      setWaiting(null);
      openModal(root);
      joiningLink = !!o.join;
      if (o.join) { const game = o.join; void ensure(() => { setStatus("Joining your friend's game…", true); net.send({ k: 'join', game }); }); }
      else if (o.host) { const game = o.host; void ensure(() => net.send({ k: 'create', game })); }
      else void ensure(o.quick ? () => net.send({ k: 'quick' }) : undefined);
    },
  };
}
