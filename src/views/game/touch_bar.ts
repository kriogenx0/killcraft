// Touch selection bar: the buttons phones and tablets use for what a mouse does with drag and Shift.
import { G } from '../../game/state.ts';
import { V, spectating } from './view_state.ts';
import { setSelection } from './hud.ts';
import { selectArmy, selectSameTypes } from './input.ts';

let bar: HTMLElement | null = null;
let boxBtn: HTMLButtonElement, armyBtn: HTMLButtonElement, sameBtn: HTMLButtonElement, clearBtn: HTMLButtonElement;
let shown = '';

export function initTouchBar(root: HTMLElement): void {
  bar = root.querySelector<HTMLElement>('.touch-bar');
  if (!bar) return;
  const btn = (c: string) => bar!.querySelector<HTMLButtonElement>(c)!;
  boxBtn = btn('.touch-bar-box'); armyBtn = btn('.touch-bar-army'); sameBtn = btn('.touch-bar-same'); clearBtn = btn('.touch-bar-clear');
  if (matchMedia('(any-pointer: coarse)').matches) document.documentElement.classList.add('touch-ui');
  boxBtn.addEventListener('click', () => { V.touchBox = !V.touchBox; refreshTouchBar(); });
  armyBtn.addEventListener('click', selectArmy);
  sameBtn.addEventListener('click', selectSameTypes);
  clearBtn.addEventListener('click', () => setSelection([]));
}

/** Keep the bar's buttons in step with the game; touches the page only when something changed. */
export function refreshTouchBar(): void {
  if (!bar) return;
  const units = V.sel.some((e) => e.kind === 'unit'), on = V.started && !G.over, state = `${on}${V.touchBox}${units}${V.sel.length > 0}${spectating()}`;
  if (state === shown) return;
  shown = state;
  bar.classList.toggle('touch-bar--on', on);
  boxBtn.setAttribute('aria-pressed', String(V.touchBox));
  sameBtn.disabled = !units;
  clearBtn.disabled = !V.sel.length;
  armyBtn.hidden = spectating();
}
