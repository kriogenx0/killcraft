// Group bar: numbered buttons for control groups, so phones (no number keys) can use them too.
// + saves the selected units as a group; tap a group to select it, tap again to look at it, hold to overwrite it.
// With a mouse, Ctrl+click saves and Shift+click adds, like the keys.
import { G, type Ent } from '../../game/state.ts';
import type { UnitType } from '../../data/unit.ts';
import type { BldType } from '../../data/building.ts';
import { buildingIcon, unitIcon } from './render3d/icon3d.ts';
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
    else if (!groupMembers(k).length) saveGroup(k); // the + button
    else recallGroup(k);
    refreshGroupBar(true);
  });
}

/** The type most of a group is made of: its picture on the button. */
function mainType(l: Ent[]): Ent {
  const n = new Map<string, number>();
  for (const e of l) n.set(e.type, (n.get(e.type) ?? 0) + (e.kind === 'unit' ? 2 : 1)); // units beat buildings
  const top = [...n].sort((a, b) => b[1] - a[1])[0][0];
  return l.find((e) => e.type === top)!;
}

function pictureOf(e: Ent): string {
  if (e.kind === 'unit') return unitIcon(e.type as UnitType, e.team) ?? '';
  return buildingIcon(e.type as BldType, e.team, G.era[e.team] ?? 0) ?? '';
}

/** Keep the buttons in step with the groups; touches the page only when something changed.
 * Each saved group is a button with a picture of its main unit and how many it holds (the key number
 * only shows where there is a keyboard); one + button saves the selection as a new group. */
export function refreshGroupBar(force = false): void {
  if (!bar) return;
  const on = V.started && !G.over && !spectating();
  const groups = on ? GROUP_KEYS.map((k) => [k, groupMembers(k)] as const).filter(([, l]) => l.length) : [];
  const free = GROUP_KEYS.slice(0, GROUP_SLOTS).find((k) => !groupMembers(k).length);
  const canAdd = on && !!free && ownSelected().some((e) => e.kind === 'unit') && !groups.some(([k]) => groupSelected(k));
  const rows = groups.map(([k, l]) => [k, l.length, mainType(l).type, groupSelected(k)] as const);
  const state = `${on}|${rows.join(';')}|${canAdd && free}`;
  if (state === shown && !force) return;
  shown = state;
  bar.classList.toggle('group-bar--on', on && (rows.length > 0 || canAdd));
  // rebuild only when the set of buttons changes, so a button under a finger stays the same element
  const keys = rows.map((r) => `${r[0]}${r[2]}`).join(',') + (canAdd ? `+${free}` : '');
  if (bar.dataset.keys !== keys) {
    bar.dataset.keys = keys;
    bar.innerHTML = groups.map(([k, l]) => `<button type="button" class="group-bar-btn" data-group="${k}">`
      + `<img class="group-bar-pic" alt="" src="${pictureOf(mainType(l))}"><span class="group-bar-key">${k}</span><span class="group-bar-count"></span></button>`).join('')
      + (canAdd ? `<button type="button" class="group-bar-btn group-bar-add" data-group="${free}" title="Save the selected units as a group" aria-label="Save the selected units as a group">`
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button>' : '');
  }
  bar.querySelectorAll<HTMLButtonElement>('.group-bar-btn:not(.group-bar-add)').forEach((b, i) => {
    const [k, n, , sel] = rows[i];
    const tip = `${n} ${n === 1 ? 'unit' : 'units'}. Tap to select, tap again to look at them, hold to save the selection here instead (key ${k})`;
    b.setAttribute('aria-pressed', String(sel));
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.querySelector('.group-bar-count')!.textContent = String(n);
  });
}
