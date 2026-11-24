// The new game screen: computer difficulty, opponents, map, starting resources and units, game speed
// and fog of war, before a game against the computer (or a match to watch). The last choices are remembered.
import { AI_LEVEL, DEFAULT_SETUP, SPEEDS, START_ARMY, START_RESOURCES, type GameSetup } from '../../data/setup.ts';
import { closeModal, openModal } from '../../components/modal/modal.ts';

const SETUP_KEY = 'killcraft.setup';

interface Choice { value: string; label: string; title?: string }

// Each setting is one row at every width; phones show the short label so the row fits in 320px.
const legend = (label: string, short = label): string => short === label
  ? `<legend class="setup-label">${label}</legend>`
  : `<legend class="setup-label"><span class="setup-label-full">${label}</span><span class="setup-label-short">${short}</span></legend>`;

const group = (name: string, label: string, choices: Choice[], short?: string): string => `
  <fieldset class="setup-row setup-row--${name}">
    ${legend(label, short)}
    <div class="ui-segmented" role="radiogroup" aria-label="${label}">
      ${choices.map((c) => `<label class="ui-segmented-option"${c.title ? ` title="${c.title}"` : ''}><input type="radio" name="setup-${name}" value="${c.value}"><span>${c.label}</span></label>`).join('')}
    </div>
  </fieldset>`;

const MARKUP = `
  <h2 class="setup-title">New game</h2>
  <form class="setup-form">
    ${group('difficulty', 'Computer difficulty', Object.entries(AI_LEVEL).map(([value, l]) => ({ value, label: l.name, title: l.desc })), 'Difficulty')}
    <p class="setup-hint setup-difficulty-desc"></p>
    ${group('foes', 'Opponents', [{ value: '1', label: 'One', title: 'One against one' }, { value: '3', label: 'Three', title: 'Four-player free-for-all, one base in each corner' }])}
    ${group('resources', 'Starting resources', Object.entries(START_RESOURCES).map(([value, r]) => ({ value, label: r.name })), 'Resources')}
    ${group('army', 'Starting units', Object.entries(START_ARMY).map(([value, a]) => ({ value, label: a.name, title: a.desc })), 'Units')}
    ${group('speed', 'Game speed', SPEEDS.map((s) => ({ value: String(s), label: `${s}x` })), 'Speed')}
    ${group('fog', 'Fog of war', [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off', title: 'See the whole map' }], 'Fog')}
    <fieldset class="setup-row">
      <legend class="setup-label">Map</legend>
      <div class="setup-map">
        <input class="ui-text-field-input setup-seed" inputmode="numeric" pattern="[0-9]*" maxlength="7" placeholder="Random" aria-label="Map number (blank for a random map)">
        <button type="button" class="ui-button ui-button--small ui-button--secondary setup-reroll" title="Pick a random map number">New map</button>
      </div>
    </fieldset>
  </form>
  <div class="ui-modal-actions">
    <button type="button" class="ui-button ui-button--secondary setup-back">Back</button>
    <button type="button" class="ui-button setup-start">Start</button>
  </div>
`;

function load(): GameSetup {
  try {
    const s = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') as Partial<GameSetup>;
    const out = { ...DEFAULT_SETUP, ...s };
    // drop anything a newer version no longer offers
    if (!(out.difficulty in AI_LEVEL)) out.difficulty = DEFAULT_SETUP.difficulty;
    if (!(out.resources in START_RESOURCES)) out.resources = DEFAULT_SETUP.resources;
    if (!(out.army in START_ARMY)) out.army = DEFAULT_SETUP.army;
    if (!SPEEDS.includes(out.speed)) out.speed = DEFAULT_SETUP.speed;
    if (out.foes !== 1 && out.foes !== 3) out.foes = DEFAULT_SETUP.foes;
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

export function mountSetup(root: HTMLElement, opts: SetupOptions) {
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const form = $<HTMLFormElement>('.setup-form'), seed = $<HTMLInputElement>('.setup-seed'), title = $('.setup-title'), desc = $('.setup-difficulty-desc');
  const foesLabel = $('.setup-row--foes .setup-label');
  let watch = false;

  const radio = (name: string): string => (form.querySelector<HTMLInputElement>(`input[name="setup-${name}"]:checked`)?.value ?? '');
  const set = (name: string, value: string) => {
    const r = form.querySelector<HTMLInputElement>(`input[name="setup-${name}"][value="${value}"]`);
    if (r) r.checked = true;
  };
  const showDesc = () => { desc.textContent = AI_LEVEL[radio('difficulty') as keyof typeof AI_LEVEL]?.desc ?? ''; };

  const read = (): GameSetup => {
    const n = Number(seed.value.trim());
    return {
      difficulty: radio('difficulty') as GameSetup['difficulty'],
      foes: radio('foes') === '3' ? 3 : 1,
      seed: seed.value.trim() && Number.isFinite(n) ? Math.floor(Math.abs(n)) : null,
      resources: radio('resources') as GameSetup['resources'],
      army: radio('army') as GameSetup['army'],
      speed: Number(radio('speed')) || 1,
      fog: radio('fog') !== 'off',
    };
  };

  form.addEventListener('change', showDesc);
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
      set('difficulty', s.difficulty);
      set('foes', String(s.foes));
      set('resources', s.resources);
      set('army', s.army);
      set('speed', String(s.speed));
      set('fog', s.fog ? 'on' : 'off');
      seed.value = '';
      showDesc();
      title.textContent = watchAi ? 'Watch AI vs AI' : 'New game';
      foesLabel.textContent = watchAi ? 'Sides' : 'Opponents';
      root.querySelectorAll<HTMLElement>('input[name="setup-foes"] + span').forEach((el, i) => { el.textContent = watchAi ? ['Two', 'Four'][i] : ['One', 'Three'][i]; });
      // spectators always see the whole map
      $('.setup-row--fog').hidden = watchAi;
      openModal(root);
      root.querySelector<HTMLElement>('.setup-start')?.focus();
    },
  };
}
