// Follow cam: the camera keeps a selected unit in the middle of the view as it moves. Shift+F or the
// Follow button turns it on and off; panning by hand, or the unit dying or slipping into the fog,
// lets go. Works for spectators too, on any side's units.
import { G, valid, type Ent } from '../../game/state.ts';
import { visibleTo } from '../../net/snapshot.ts';
import { clampRig } from './camera_rig.ts';
import { V, spectating } from './view_state.ts';

/** How quickly the camera catches up with the unit (per second); high enough to keep it centred. */
const CATCH_UP = 8;
/** Moves of the camera's target smaller than this (px) are rounding, not a hand on the map. */
const NUDGE = 0.5;

/** Where the follow cam last put the camera, so a pan by hand shows up as a difference. */
let placed: { x: number; y: number } | null = null;

const seen = (e: Ent): boolean => spectating() || visibleTo(e, V.team);

/** The unit Follow would track: the first living, visible unit selected. */
export function followable(): Ent | null {
  return V.sel.find((e) => !e.dead && e.kind === 'unit' && G.byId.get(e.id) === e && seen(e)) ?? null;
}

/** The unit being followed, if any. */
export const followed = (): Ent | null => valid(V.follow);

/** Is the camera following one of the selected units? */
export const followingSelection = (): boolean => V.follow != null && V.sel.some((e) => e.id === V.follow);

export function stopFollow(): void {
  V.follow = null;
  placed = null;
}

/** Follow the selected unit, or stop if it's already being followed. */
export function toggleFollow(): void {
  const u = followable();
  if (followingSelection() || !u) { stopFollow(); return; }
  V.follow = u.id;
  placed = null;
}

/** Glide the camera after the followed unit; call once a frame, after the player's own camera moves. */
export function updateFollow(dt: number): void {
  if (V.follow == null) return;
  const e = followed();
  const panned = placed && (Math.abs(V.cam.x - placed.x) > NUDGE || Math.abs(V.cam.y - placed.y) > NUDGE);
  if (!e || !seen(e) || panned || G.over) { stopFollow(); return; }
  const k = 1 - Math.exp(-CATCH_UP * dt);
  V.cam.x += (e.x - V.cam.x) * k;
  V.cam.y += (e.y - V.cam.y) * k;
  clampRig(V.cam);
  placed = { x: V.cam.x, y: V.cam.y };
}
