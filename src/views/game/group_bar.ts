// Group bar: numbered buttons for control groups, so phones (no number keys) can use them too.
// Hold a number to save the selected units under it, tap it to select them, tap again to look at them.
// With a mouse, Ctrl+click saves and Shift+click adds, like the keys.
import { G, hooks } from '../../game/state.ts';
import { ownSelected, spectating, V } from './view_state.ts';
import { GROUP_KEYS, GROUP_SLOTS, groupMembers, groupSelected, recallGroup, saveGroup } from './control_groups.ts';

/** how long a press must last to save the selection (ms) */
export const HOLD_MS = 450;

let bar: HTMLElement | null = null;
let shown = '';
let holdTimer = 0;
/** the button whose press turned into a save: its click must not also select */
let held: string | null = null;

const keyOf = (t: EventTarget | null): string | null =>
  (t as HTMLElement | null)?.closest?.<HTMLElement>('.group-bar-btn')?.dataset.group ?? null;

function cancelHold(): void {
  clearTimeout(holdTimer);
  holdTimer = 0;
}

export function initGroupBar(root: HTMLElement): void {
  bar = root.querySelector<HTMLElement>('.group-bar');
  if (!bar) return;
  bar.addEventListener('pointerdown', (ev) => {
    const k = keyOf(ev.target);
    if (!k || ev.button !== 0) return;
    held = null;
    cancelHold();
    holdTimer = window.setTimeout(() => {
      holdTimer = 0;
      held = k;
      saveGroup(k);
      navigator.vibrate?.(15);
      refreshGroupBar(true);
    }, HOLD_MS);
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) bar.addEventListener(t, cancelHold);
  // a long press must not open the phone's menu or start selecting text
  bar.addEventListener('contextmenu', (ev) => ev.preventDefault());
  bar.addEventListener('click', (ev) => {
    const k = keyOf(ev.target);
    if (!k) return;
    if (held === k) { held = null; return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) saveGroup(k);
    else if (ev.shiftKey) saveGroup(k, true);
    else if (!groupMembers(k).length) {
      // an empty slot: tapping it is the obvious first try, so save what is selected, or say how
      if (ownSelected().length) saveGroup(k);
      else hooks.notify(V.team, `Select units, then hold ${k} to save them as group ${k}`);
    } else recallGroup(k);
    refreshGroupBar(true);
  });
}

/** Keep the buttons in step with the groups; touches the page only when something changed. */
export function refreshGroupBar(force = false): void {
  if (!bar) return;
  const on = V.started && !G.over && !spectating();
  const slots = on ? GROUP_KEYS.filter((k, i) => i < GROUP_SLOTS || groupMembers(k).length) : [];
  const rows = slots.map((k) => [k, groupMembers(k).length, groupSelected(k)] as const);
  const state = `${on}|${rows.join(';')}`;
  if (state === shown && !force) return;
  shown = state;
  bar.classList.toggle('group-bar--on', on);
  // rebuild only when the set of buttons changes, so a button under a finger stays the same element
  const keys = slots.join('');
  if (bar.dataset.keys !== keys) {
    bar.dataset.keys = keys;
    bar.innerHTML = slots.map((k) => `<button type="button" class="group-bar-btn" data-group="${k}"><span class="group-bar-num">${k}</span><span class="group-bar-count"></span></button>`).join('');
  }
  bar.querySelectorAll<HTMLButtonElement>('.group-bar-btn').forEach((b, i) => {
    const [k, n, sel] = rows[i];
    const tip = n
      ? `Group ${k}: ${n} ${n === 1 ? 'unit' : 'units'}. Tap to select, tap again to look at them, hold to save the selection instead (Ctrl+${k})`
      : `Group ${k} is empty: select units, then hold or tap here to save them (Ctrl+${k})`;
    b.classList.toggle('group-bar-btn--empty', !n);
    b.setAttribute('aria-pressed', String(sel));
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.querySelector('.group-bar-count')!.textContent = n ? String(n) : '';
  });
}
