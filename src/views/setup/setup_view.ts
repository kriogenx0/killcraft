// The new game screen: how the sides line up (one vs one, two vs two or a free-for-all), the computer
// in each seat (its difficulty, or closed), map, starting resources and units, game speed and fog of war,
// before a game against the computer (or a match to watch). The last choices are remembered.
import { AI_LEVEL, DEFAULT_SETUP, MODES, SPEEDS, START_ARMY, START_RESOURCES, isMode, isSeatPick, playable, type Difficulty, type GameSetup, type Mode, type SeatPick } from '../../data/setup.ts';
import { closeModal, openModal } from '../../components/modal/modal.ts';
import { seatRows } from '../../components/seats/seats.ts';

const SETUP_KEY = 'killcraft.setup';

interface Choice { value: string; label: string; title?: string }

// Each setting is one row at every width; phones show the short label so the row fits in 320px.
// Rows are plain divs (not fieldset/legend), which Safari lays out like every other browser.
const rowLabel = (label: string, short = label): string => short === label
  ? `<span class="setup-label">${label}</span>`
  : `<span class="setup-label"><span class="setup-label-full">${label}</span><span class="setup-label-short">${short}</span></span>`;

const group = (name: string, label: string, choices: Choice[], short?: string): string => `
  <div class="setup-row setup-row--${name}">
    ${rowLabel(label, short)}
    <div class="ui-segmented" role="radiogroup" aria-label="${label}">
      ${choices.map((c) => `<label class="ui-segmented-option"${c.title ? ` title="${c.title}"` : ''}><input type="radio" autocomplete="off" name="setup-${name}" value="${c.value}"><span>${c.label}</span></label>`).join('')}
    </div>
  </div>`;

const MARKUP = `
  <h2 class="setup-title">New game</h2>
  <form class="setup-form">
    ${group('mode', 'Players', Object.entries(MODES).map(([value, m]) => ({ value, label: m.short, title: m.desc })))}
    <p class="setup-hint setup-mode-desc"></p>
    <div class="seats setup-seats" role="group" aria-label="Seats"></div>
    <p class="setup-hint setup-seats-hint"></p>
    ${group('resources', 'Starting resources', Object.entries(START_RESOURCES).map(([value, r]) => ({ value, label: r.name })), 'Resources')}
    ${group('army', 'Starting units', Object.entries(START_ARMY).map(([value, a]) => ({ value, label: a.name, title: a.desc })), 'Units')}
    ${group('speed', 'Game speed', SPEEDS.map((s) => ({ value: String(s), label: `${s}x` })), 'Speed')}
    ${group('fog', 'Fog of war', [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off', title: 'See the whole map' }], 'Fog')}
    <div class="setup-row" role="group" aria-label="Map">
      <span class="setup-label">Map</span>
      <div class="setup-map">
        <input class="ui-text-field-input setup-seed" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="numeric" pattern="[0-9]*" maxlength="7" placeholder="Random" aria-label="Map number (blank for a random map)">
        <button type="button" class="ui-button ui-button--small ui-button--secondary setup-reroll" title="Pick a random map number">New map</button>
      </div>
    </div>
  </form>
  <div class="ui-modal-actions">
    <button type="button" class="ui-button ui-button--secondary setup-back">Back</button>
    <button type="button" class="ui-button setup-start">Start</button>
  </div>
`;

function load(): GameSetup {
  try {
    const s = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') as Partial<GameSetup>;
    const old = s as Partial<GameSetup> & { difficulty?: Difficulty; foes?: number };
    const out = { ...DEFAULT_SETUP, ...s };
    // choices saved before seats existed: one difficulty for every computer, one or three opponents
    if (!s.mode && old.foes === 3) out.mode = 'ffa';
    if (!s.seats && old.difficulty && old.difficulty in AI_LEVEL) out.seats = [old.difficulty, old.difficulty, old.difficulty, old.difficulty];
    // drop anything a newer version no longer offers
    if (!isMode(out.mode)) out.mode = DEFAULT_SETUP.mode;
    out.seats = Array.from({ length: 4 }, (_, t) => (Array.isArray(out.seats) && isSeatPick(out.seats[t]) ? out.seats[t] : DEFAULT_SETUP.seats[t]));
    if (!(out.resources in START_RESOURCES)) out.resources = DEFAULT_SETUP.resources;
    if (!(out.army in START_ARMY)) out.army = DEFAULT_SETUP.army;
    if (!SPEEDS.includes(out.speed)) out.speed = DEFAULT_SETUP.speed;
    return out;
  } catch { return { ...DEFAULT_SETUP }; }
}

function save(s: GameSetup): void {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* private mode: choices just aren't remembered */ }
}

export interface SetupOptions {
  onStart: (setup: GameSetup, watch: boolean) => void;
  onBack: () => void;
}

export type Setup = ReturnType<typeof mountSetup>;

export function mountSetup(root: HTMLElement, opts: SetupOptions) {
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const form = $<HTMLFormElement>('.setup-form'), seed = $<HTMLInputElement>('.setup-seed'), title = $('.setup-title'), desc = $('.setup-mode-desc');
  const seatsEl = $('.setup-seats'), seatsHint = $('.setup-seats-hint'), startBtn = $<HTMLButtonElement>('.setup-start');
  let watch = false;
  /** the computer picked for each seat, kept while switching between modes */
  let seats: SeatPick[] = [...DEFAULT_SETUP.seats];

  const radio = (name: string): string => (form.querySelector<HTMLInputElement>(`input[name="setup-${name}"]:checked`)?.value ?? '');
  const set = (name: string, value: string) => {
    const r = form.querySelector<HTMLInputElement>(`input[name="setup-${name}"][value="${value}"]`);
    if (r) r.checked = true;
  };
  const mode = (): Mode => (isMode(radio('mode')) ? radio('mode') as Mode : DEFAULT_SETUP.mode);
  const closed = (): boolean[] => seats.map((p, t) => (t > 0 || watch) && p === 'closed');
  /** Draw the seats for the chosen mode; a game needs someone on at least two sides. */
  const showSeats = () => {
    const m = mode(), n = MODES[m].teams;
    desc.textContent = watch ? MODES[m].desc.replace('You against one computer.', 'Two computers against each other.') : MODES[m].desc;
    seatsEl.innerHTML = seatRows(m, Array.from({ length: n }, (_, t) => t === 0 && !watch
      ? { team: t, kind: 'person' as const, name: 'You', you: true, editable: false }
      : { team: t, kind: seats[t] === 'closed' ? 'closed' as const : 'computer' as const, level: seats[t] === 'closed' ? undefined : seats[t], editable: true }));
    seatsEl.querySelectorAll<HTMLSelectElement>('.seat-select').forEach((sel) => {
      const t = Number(sel.name.slice(5));
      sel.title = AI_LEVEL[sel.value as Difficulty]?.desc ?? 'Nobody plays this corner';
      // a one-on-one game has nobody to close
      if (m === '1v1') sel.querySelector('option[value="closed"]')?.remove();
      sel.addEventListener('change', () => { if (isSeatPick(sel.value)) seats[t] = sel.value; showSeats(); });
    });
    const ok = m === '1v1' || playable(m, closed().slice(0, n));
    seatsHint.textContent = ok ? '' : 'Put a computer on the other side.';
    startBtn.disabled = !ok;
  };

  const read = (): GameSetup => {
    const n = Number(seed.value.trim());
    return {
      mode: mode(),
      seats: mode() === '1v1' ? seats.map((p) => (p === 'closed' ? 'normal' : p)) : [...seats],
      seed: seed.value.trim() && Number.isFinite(n) ? Math.floor(Math.abs(n)) : null,
      resources: radio('resources') as GameSetup['resources'],
      army: radio('army') as GameSetup['army'],
      speed: Number(radio('speed')) || 1,
      fog: radio('fog') !== 'off',
    };
  };

  form.addEventListener('change', (e) => { if ((e.target as HTMLElement).matches('input[name="setup-mode"]')) showSeats(); });
  form.addEventListener('submit', (e) => e.preventDefault());
  seed.addEventListener('input', () => { seed.value = seed.value.replace(/\D/g, ''); });
  $('.setup-reroll').addEventListener('click', () => { seed.value = String(Math.floor(Math.random() * 1e6)); });
  $('.setup-back').addEventListener('click', () => { closeModal(root); opts.onBack(); });
  $('.setup-start').addEventListener('click', () => {
    const s = read();
    // a typed map number is a one-off: next time starts on a random map again
    save({ ...s, seed: null });
    closeModal(root);
    opts.onStart(s, watch);
  });

  return {
    /** Show the screen; `watchAi` sets up a computer-only match to watch. */
    open(watchAi: boolean): void {
      watch = watchAi;
      const s = load();
      set('mode', s.mode);
      seats = [...s.seats];
      set('resources', s.resources);
      set('army', s.army);
      set('speed', String(s.speed));
      set('fog', s.fog ? 'on' : 'off');
      seed.value = '';
      title.textContent = watchAi ? 'Watch AI vs AI' : 'New game';
      showSeats();
      // spectators always see the whole map
      $('.setup-row--fog').hidden = watchAi;
      openModal(root);
      root.querySelector<HTMLElement>('.setup-start')?.focus();
    },
  };
}
