// The online lobby: pick a name, then quick match or host/join a public game.
import { net } from '../../net/client.ts';
import { MAX_NAME, cleanName, type OpenGame, type ServerMsg } from '../../net/protocol.ts';
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
  <button type="button" class="ui-button ui-button--secondary lobby-cancel" hidden>Cancel</button>
  <section class="lobby-games" aria-label="Open games">
    <h3>Open games</h3>
    <ul class="lobby-list"></ul>
  </section>
  <p class="lobby-online"></p>
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

export function mountLobby(root: HTMLElement, opts: LobbyOptions) {
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const name = $<HTMLInputElement>('.lobby-name'), status = $('.lobby-status'), list = $('.lobby-list'), online = $('.lobby-online');
  const quick = $<HTMLButtonElement>('.lobby-quick'), create = $<HTMLButtonElement>('.lobby-create'), cancel = $<HTMLButtonElement>('.lobby-cancel');
  let waiting: 'quick' | 'host' | null = null, connectedAs = '';

  const setStatus = (text: string, busy = false, error = false) => {
    status.replaceChildren();
    if (busy) { const s = document.createElement('span'); s.className = 'ui-spinner'; s.setAttribute('aria-hidden', 'true'); status.append(s, ' '); }
    status.append(text);
    status.classList.toggle('lobby-status--error', error);
  };

  const render = (games: OpenGame[], count: number) => {
    list.replaceChildren(...games.map((g) => {
      const li = document.createElement('li'), label = document.createElement('span'), join = document.createElement('button');
      li.className = 'lobby-game';
      label.textContent = `${g.host}'s game`;
      join.type = 'button';
      join.className = 'ui-button ui-button--small lobby-join';
      join.textContent = 'Join';
      join.disabled = waiting === 'host';
      join.addEventListener('click', () => { setStatus('Joining…', true); net.send({ k: 'join', game: g.id }); });
      li.append(label, join);
      return li;
    }));
    if (!games.length) { const li = document.createElement('li'); li.className = 'lobby-empty'; li.textContent = 'No open games. Create one or use Quick match.'; list.append(li); }
    online.textContent = `${count} ${count === 1 ? 'player' : 'players'} online`;
  };

  const setWaiting = (w: 'quick' | 'host' | null) => {
    waiting = w;
    quick.hidden = create.hidden = !!w;
    cancel.hidden = !w;
    name.disabled = !!w;
    if (w === 'quick') setStatus('Looking for an opponent…', true);
    else if (w === 'host') setStatus('Your game is listed. Waiting for someone to join…', true);
  };

  net.onMessage((m) => {
    if (m.k === 'lobby') { setWaiting(m.waiting); if (!m.waiting && status.querySelector('.ui-spinner')) setStatus(''); render(m.games, m.online); }
    else if (m.k === 'error') setStatus(m.msg, false, true);
    else if (m.k === 'start') { closeModal(root); opts.onStart(m); }
  });
  net.onClose(() => { if (root.classList.contains('ui-modal--open')) { setWaiting(null); setStatus('Disconnected from the game server.', false, true); connectedAs = ''; } });

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
  cancel.addEventListener('click', () => { net.send({ k: 'leave' }); setWaiting(null); setStatus(''); });
  name.addEventListener('change', () => ensure());
  $('.lobby-back').addEventListener('click', () => {
    net.send({ k: 'leave' });
    net.close();
    connectedAs = '';
    closeModal(root);
    opts.onBack();
  });

  return {
    /** Show the lobby; with `quick`, start looking for a match right away. */
    open(quick = false): void {
      name.value = storedName();
      setWaiting(null);
      openModal(root);
      void ensure(quick ? () => net.send({ k: 'quick' }) : undefined);
    },
  };
}
