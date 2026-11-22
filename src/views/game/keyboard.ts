// Keyboard layout: which keys scroll the map and which run commands. Kept apart from the DOM so
// the layout can be tested and the two sets can never overlap.

/** Held keys that scroll the camera, as [dx, dy]. */
export const SCROLL_KEYS: Record<string, [number, number]> = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

/** Command card hotkeys. None of these may also scroll the map. */
export const COMMAND_KEYS = { move: 'M', stop: 'X', amove: 'F', repair: 'R' } as const;

/** Direction to scroll for the keys being held (opposite keys cancel out). */
export function scrollVector(held: Iterable<string>): [number, number] {
  let dx = 0, dy = 0;
  for (const k of new Set(held)) {
    const v = SCROLL_KEYS[k];
    if (v) { dx += v[0]; dy += v[1]; }
  }
  return [Math.sign(dx), Math.sign(dy)];
}

/**
 * Should a key press count as held for scrolling? Not while typing in a field, and not with
 * Cmd/Ctrl/Alt held: browsers (macOS especially) often skip the key-up for those shortcuts,
 * which would leave the map scrolling forever.
 */
export function tracksKey(ev: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: unknown }): boolean {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const t = ev.target as { tagName?: string; isContentEditable?: boolean } | null;
  return !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
}
