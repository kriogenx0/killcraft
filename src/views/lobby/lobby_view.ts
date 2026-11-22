// The online lobby: pick a name, see who's online, then quick match, host/join a public game,
// or challenge a specific player.
import { net } from '../../net/client.ts';
import { MAX_NAME, cleanName, type LobbyMsg, type OnlinePlayer, type ServerMsg } from '../../net/protocol.ts';
import { closeModal, openModal } from '../../components/modal/modal.ts';

type StartMsg = Extract<ServerMsg, { k: 'start' }>;

const NAME_KEY = 'killcraft.name';

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
  <div class="lobby-link" hidden>
    <input class="ui-text-field-input lobby-link-url" readonly aria-label="Invite link">
    <button type="button" class="ui-button ui-button--small lobby-copy">Copy invite link</button>
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

function storedName(): string {
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
  const link = $('.lobby-link'), linkUrl = $<HTMLInputElement>('.lobby-link-url'), copy = $<HTMLButtonElement>('.lobby-copy');

  const showLink = (game: string | null) => {
    link.hidden = !game;
    if (!game) return;
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('join', game);
    if (linkUrl.value !== url.href) { linkUrl.value = url.href; copy.textContent = 'Copy invite link'; }
  };

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
      return row('lobby-game', span('lobby-row-name', `${g.host}'s game`), join);
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
    else if (w === 'host') setStatus('Your game is listed. Send the invite link to a friend, or wait for someone to join…', true);
  };

  net.onMessage((m) => {
    if (m.k === 'lobby') {
      const w = m.waiting ?? (m.inviting ? 'invite' : null);
      const wasBusy = !!status.querySelector('.ui-spinner');
      setWaiting(w);
      if (!w && wasBusy) setStatus('');
      render(m);
    }
    else if (m.k === 'error') setStatus(m.msg, false, true);
    else if (m.k === 'notice') setStatus(m.msg);
    else if (m.k === 'start') { closeModal(root); opts.onStart(m); }
  });
  net.onClose(() => {
    if (!root.classList.contains('ui-modal--open')) return;
    setWaiting(null);
    setStatus('Disconnected from the game server.', false, true);
    connectedAs = '';
    last = null;
    inviteList.replaceChildren();
    showLink(null);
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
  name.addEventListener('change', () => ensure());
  $('.lobby-back').addEventListener('click', () => {
    net.send({ k: 'leave' });
    net.close();
    connectedAs = '';
    closeModal(root);
    opts.onBack();
  });

  return {
    /** Show the lobby; with `quick`, start looking for a match right away; with `join`, join that game (an invite link). */
    open(quick = false, join?: string): void {
      name.value = storedName();
      setWaiting(null);
      openModal(root);
      if (join) void ensure(() => { setStatus('Joining…', true); net.send({ k: 'join', game: join }); });
      else void ensure(quick ? () => net.send({ k: 'quick' }) : undefined);
    },
  };
}
