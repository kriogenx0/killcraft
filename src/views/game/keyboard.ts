// Keyboard layout: which keys scroll the map and which run commands. Kept apart from the DOM so
// the layout can be tested and the two sets can never overlap.

/** Held keys that scroll the camera, as [dx, dy]. */
export const SCROLL_KEYS: Record<string, [number, number]> = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

/** Held keys that turn the camera around its target (+1 = clockwise when seen from above). */
export const ROTATE_KEYS: Record<string, number> = { q: 1, e: -1 };

/** Hotkeys for the commands of a selected unit. None of these may also move the camera. */
export const COMMAND_KEYS = { move: 'M', patrol: 'O', stop: 'X', engage: 'G', skirmish: 'F', passive: 'V', tend: 'T' } as const;

/** Hotkeys for a selected building. Production keys (see hotkeys.ts) fit around these. */
export const BUILDING_KEYS = { repair: 'R', upgrade: 'U', scrap: 'Delete' } as const;

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
  return !isTyping(ev.target);
}

/**
 * Is a key going into a text field? Only a field you can see: the online lobby's name box keeps
 * focus after its dialog closes, and must not swallow every key for the whole match.
 */
export function isTyping(target: unknown): boolean {
  const t = target as { tagName?: string; isContentEditable?: boolean; getClientRects?: () => { length: number } } | null;
  if (!t || !(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
  return !t.getClientRects || t.getClientRects().length > 0;
}

/** Keys that work whatever is selected: P pauses, H selects the Town Hall and looks at it. */
export const GLOBAL_KEYS = { pause: 'P', home: 'H' } as const;

/**
 * Follow the selected unit with the camera. Every letter is some building's or unit's key, so it's
 * Shift+F; plain F works too while spectating, where nothing else uses it.
 */
export const FOLLOW_KEY = 'Shift+F';

/** Rally the army: pick a spot every fighting unit heads to, and new troops from every producer follow. */
export const RALLY_KEY = 'Shift+R';

/** Letters no command or production hotkey may take: the camera keys and the global keys. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(SCROLL_KEYS), ...Object.keys(ROTATE_KEYS), ...Object.values(GLOBAL_KEYS).map((k) => k.toLowerCase()),
].filter((k) => k.length === 1));

export interface Keyed { id: string; name: string; key?: string }

/**
 * Give each item a single-letter hotkey, in list order. An item's own `key` wins if it's free;
 * otherwise the first letter of each word of its name, then its other letters, then any free
 * letter. Keys in `taken` and the reserved keys are never used. Items are keyed in a fixed order
 * from their definitions, so a key never changes as items unlock, and new items get one for free.
 */
export function assignKeys(items: readonly Keyed[], taken: Iterable<string> = []): Map<string, string> {
  const used = new Set([...RESERVED_KEYS, ...[...taken].map((k) => k.toLowerCase())]);
  const out = new Map<string, string>();
  const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const take = (id: string, tries: string[]): void => {
    const k = tries.map((c) => c.toLowerCase()).find((c) => c.length === 1 && /[a-z]/.test(c) && !used.has(c));
    if (k) { used.add(k); out.set(id, k.toUpperCase()); }
  };
  // first pass: chosen keys and initials, so "Factory" isn't beaten to F by a later letter of "Refinery"
  for (const it of items) take(it.id, [it.key ?? '', ...it.name.split(/\s+/).map((w) => letters(w)[0] ?? '')]);
  // then any letter of the name, then any free letter; past 26 items the rest stay mouse-only
  for (const it of items) if (!out.has(it.id)) take(it.id, [...letters(it.name), ...'abcdefghijklmnopqrstuvwxyz']);
  return out;
}

/** What a key reads as on a button: "Delete" is "Del", "Escape" is "Esc". */
export const keyLabel = (k: string): string =>
  /^shift\+/i.test(k) ? `⇧${k.slice(6)}` : ({ delete: 'Del', escape: 'Esc', backspace: 'Del' } as Record<string, string>)[k.toLowerCase()] ?? k;

/** The key a keydown means for hotkeys: Mac keyboards send Backspace from the key labelled delete. */
export const normalizeKey = (k: string): string => {
  const l = k.toLowerCase();
  return l === 'backspace' ? 'delete' : l;
};

/**
 * Camera zoom for a key press: -1 zooms in (+, =, numpad +), 1 zooms out (-, _, numpad -), else 0.
 * Ctrl/Cmd don't matter, so the browser's own zoom shortcut zooms the game camera instead.
 */
export function zoomKey(ev: { key: string; code?: string }): -1 | 0 | 1 {
  if (ev.key === '+' || ev.key === '=' || ev.code === 'NumpadAdd') return -1;
  if (ev.key === '-' || ev.key === '_' || ev.code === 'NumpadSubtract') return 1;
  return 0;
}

/** Game speed keys: ] faster, [ slower (+ and - zoom). */
export const SPEED_KEYS: Record<string, number> = { ']': 2, '[': 0.5 };
