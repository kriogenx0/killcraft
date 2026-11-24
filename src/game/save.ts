// Save and restore a whole game in progress, so a solo game survives a page refresh. The saved
// form is a structured clone (IndexedDB stores it as is): entities keep pointing at the same
// objects, and typed arrays, Maps and Sets come back as they were.
import { G } from './state.ts';
import { ais } from './ai.ts';

/** Parts of G that are per-process settings or short-lived effects, not the game itself. */
const SKIP = new Set<string>(['headless', 'visualOnly', 'fx', 'vis']);

export interface SavedWorld {
  /** bumped when the saved shape changes, so an old save is ignored rather than half-loaded */
  v: number;
  g: Record<string, unknown>;
  ais: typeof ais;
}

/** Bumped when saves stop fitting: 2 is the 96×96 map, so a game saved on the old 64×64 map isn't restored. */
export const SAVE_VERSION = 2;

/** A copy of the game as it stands (structured-cloneable; clone it before keeping it in memory). */
export function captureWorld(): SavedWorld {
  const g: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(G)) if (!SKIP.has(k)) g[k] = v;
  return { v: SAVE_VERSION, g, ais };
}

const isTyped = (v: unknown): v is Uint8Array | Int8Array | Int16Array | Int32Array | Float32Array => ArrayBuffer.isView(v) && !(v instanceof DataView);

/** Put a saved game back in place. Typed arrays are copied into the existing ones, which other modules may hold. */
export function restoreWorld(s: SavedWorld): boolean {
  if (!s || s.v !== SAVE_VERSION || !s.g) return false;
  const live = G as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(s.g)) {
    if (SKIP.has(k) || !(k in G)) continue;
    const cur = live[k];
    if (isTyped(cur) && isTyped(v) && cur.length === v.length) cur.set(v as never);
    else live[k] = v;
  }
  G.fx = [];
  G.vis = G.sight[G.viewer] ?? G.sight[0];
  ais.length = 0;
  ais.push(...s.ais);
  return true;
}
