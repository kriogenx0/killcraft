// Control groups: save a selection under a number (Ctrl+1..9, or hold a group button) and get it back later
// (1..9, or tap the button). Recalling a group that is already selected looks at it.
import { hooks, valid, type Ent } from '../../game/state.ts';
import { centerCam, ownSelected, spectating, V } from './view_state.ts';
import { setSelection } from './hud.ts';

/** group buttons always shown on screen; keys 6-9 still work and show a button once used */
export const GROUP_SLOTS = 5;
export const GROUP_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** The living, own members of a group (dead ones are dropped from it). */
export function groupMembers(k: string): Ent[] {
  const ids = V.groups.get(k);
  if (!ids?.length) return [];
  const l = ids.map(valid).filter((e): e is Ent => !!e && !e.dead && e.team === V.team);
  if (l.length !== ids.length) V.groups.set(k, l.map((e) => e.id));
  return l;
}

const say = (msg: string): void => hooks.notify(V.team, msg);

/** Save the selection as group k (add: join it to what the group already holds). Returns the group's size. */
export function saveGroup(k: string, add = false): number {
  if (spectating()) return 0;
  const sel = ownSelected();
  const l = add ? [...new Set([...groupMembers(k), ...sel])] : sel;
  if (!l.length) {
    V.groups.delete(k);
    say(`Group ${k} cleared`);
    return 0;
  }
  V.groups.set(k, l.map((e) => e.id));
  say(`Group ${k}: ${l.length} ${l.length === 1 ? 'unit' : 'units'}`);
  return l.length;
}

/** The selection is exactly this group. */
export function groupSelected(k: string): boolean {
  const l = groupMembers(k), sel = ownSelected();
  if (!l.length || l.length !== sel.length) return false;
  const ids = new Set(sel.map((e) => e.id));
  return l.every((e) => ids.has(e.id));
}

/** Point the camera at a group: at the member nearest its middle, so a straggler doesn't pull the view off. */
export function lookAtGroup(l: Ent[]): void {
  if (!l.length) return;
  const mx = l.reduce((s, e) => s + e.x, 0) / l.length, my = l.reduce((s, e) => s + e.y, 0) / l.length;
  const c = l.reduce((a, e) => (Math.hypot(e.x - mx, e.y - my) < Math.hypot(a.x - mx, a.y - my) ? e : a));
  centerCam(c.x, c.y);
}

/** Select group k; look at it too when asked, or when it was already selected. False if the group is empty. */
export function recallGroup(k: string, look = false): boolean {
  const l = groupMembers(k);
  if (!l.length) return false;
  if (look || groupSelected(k)) lookAtGroup(l);
  setSelection(l);
  return true;
}
