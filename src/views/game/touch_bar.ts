// Touch selection bar: the buttons phones and tablets use for what a mouse does with drag and Shift.
import { G } from '../../game/state.ts';
import { V, spectating } from './view_state.ts';
import { refreshCommands, setSelection } from './hud.ts';
import { followable, followingSelection, toggleFollow } from './follow_cam.ts';
import { selectArmy, selectSameTypes, startRally } from './input.ts';

let bar: HTMLElement | null = null;
let boxBtn: HTMLButtonElement, armyBtn: HTMLButtonElement, rallyBtn: HTMLButtonElement, sameBtn: HTMLButtonElement, followBtn: HTMLButtonElement, clearBtn: HTMLButtonElement;
let shown = '';

export function initTouchBar(root: HTMLElement): void {
  bar = root.querySelector<HTMLElement>('.touch-bar');
  if (!bar) return;
  const btn = (c: string) => bar!.querySelector<HTMLButtonElement>(c)!;
  boxBtn = btn('.touch-bar-box'); armyBtn = btn('.touch-bar-army'); rallyBtn = btn('.touch-bar-rally'); sameBtn = btn('.touch-bar-same'); followBtn = btn('.touch-bar-follow'); clearBtn = btn('.touch-bar-clear');
  if (matchMedia('(any-pointer: coarse)').matches) document.documentElement.classList.add('touch-ui');
  boxBtn.addEventListener('click', () => { V.touchBox = !V.touchBox; refreshTouchBar(); });
  armyBtn.addEventListener('click', selectArmy);
  rallyBtn.addEventListener('click', () => { startRally(); refreshTouchBar(); });
  sameBtn.addEventListener('click', selectSameTypes);
  followBtn.addEventListener('click', () => { toggleFollow(); refreshCommands(true); refreshTouchBar(); });
  clearBtn.addEventListener('click', () => setSelection([]));
}

/** Keep the bar's buttons in step with the game; touches the page only when something changed. */
export function refreshTouchBar(): void {
  if (!bar) return;
  const units = V.sel.some((e) => e.kind === 'unit'), on = V.started && !G.over, canFollow = !!followable(), following = followingSelection();
  const rallying = V.mode?.t === 'rally';
  const state = `${rallying}${on}${V.touchBox}${units}${V.sel.length > 0}${spectating()}${canFollow}${following}`;
  if (state === shown) return;
  shown = state;
  bar.classList.toggle('touch-bar--on', on);
  boxBtn.setAttribute('aria-pressed', String(V.touchBox));
  sameBtn.hidden = !units;
  followBtn.hidden = !canFollow;
  followBtn.setAttribute('aria-pressed', String(following));
  clearBtn.hidden = !V.sel.length;
  armyBtn.hidden = spectating();
  rallyBtn.hidden = spectating();
  rallyBtn.setAttribute('aria-pressed', String(rallying));
}
