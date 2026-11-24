// Picking a game back up after a page refresh. A game in progress lives at /game/<id>: solo games
// (and AI vs AI) are saved to IndexedDB every few seconds, and online games keep the key the server
// gave for rejoining the match. Loading that address puts you back where you were.
import type { SavedWorld } from '../../game/save.ts';
import type { CamRig } from './camera_rig.ts';

const DB = 'killcraft', STORE = 'games', DB_VERSION = 1;
/** saved solo games kept (older ones are dropped) */
const KEEP = 3;
const ONLINE_KEY = 'killcraft.rejoin.';

export interface SavedView {
  team: number;
  speed: number;
  paused: boolean;
  cam: CamRig;
}

export interface SavedGame {
  id: string;
  savedAt: number;
  world: SavedWorld;
  view: SavedView;
}

// ---- the address ----

/** The game id in the address (/game/<id>), if this page is showing one. */
export function gameIdFromUrl(): string | null {
  const m = /^\/game\/([\w-]{1,64})\/?$/.exec(location.pathname);
  return m ? m[1] : null;
}

/** Put the game in the address, so a refresh comes back to it (and Back leaves it). */
export function enterGameUrl(id: string): void {
  const path = `/game/${id}`;
  if (location.pathname === path) return;
  try { history.pushState({ game: id }, '', path); } catch { /* the address just doesn't change */ }
}

/** Back to the plain address: the start screen. */
export function leaveGameUrl(): void {
  try { history.replaceState(null, '', '/'); } catch { /* ignore */ }
}

// ---- online: the key for rejoining a match ----

export function rememberOnline(id: string, key: string): void {
  try { localStorage.setItem(ONLINE_KEY + id, key); } catch { /* private mode: a refresh ends the game */ }
}

export function onlineKey(id: string): string | null {
  try { return localStorage.getItem(ONLINE_KEY + id); } catch { return null; }
}

// ---- solo: saved games in IndexedDB ----

let dbp: Promise<IDBDatabase> | null = null;
/** the open database, once it is: saves then start at once, which matters when the page is closing */
let opened: IDBDatabase | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, DB_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => { opened = req.result; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function done(req: IDBRequest | IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    if (req instanceof IDBTransaction) { req.oncomplete = () => resolve(); req.onerror = req.onabort = () => reject(req.error); }
    else { req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }
  });
}

/** Open the save database ahead of time, so the first save (and one made as the page closes) doesn't wait for it. */
export function openSaves(): void {
  db().catch(() => {});
}

/** Save a game. The copy is taken right away (IndexedDB clones it as put is called), so the game can carry on. */
export async function saveGame(g: SavedGame): Promise<void> {
  const tx = (opened ?? (await db())).transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(g);
  await done(tx);
}

export async function loadGame(id: string): Promise<SavedGame | null> {
  const req = (await db()).transaction(STORE).objectStore(STORE).get(id);
  await done(req);
  return (req.result as SavedGame | undefined) ?? null;
}

/** The game is over: forget its save and its online key. */
export async function forgetGame(id: string): Promise<void> {
  try { localStorage.removeItem(ONLINE_KEY + id); } catch { /* ignore */ }
  const tx = (await db()).transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await done(tx);
}

/** Keep only the newest few saves (each new game makes one). */
export async function pruneGames(): Promise<void> {
  const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
  const req = store.getAll();
  await done(req);
  const old = (req.result as SavedGame[]).sort((a, b) => b.savedAt - a.savedAt).slice(KEEP);
  if (!old.length) return;
  const tx = (await db()).transaction(STORE, 'readwrite');
  for (const g of old) tx.objectStore(STORE).delete(g.id);
  await done(tx);
}
