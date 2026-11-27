// Unicorns: rare, happy scenery. A few wander the open meadows, each under its own rainbow. Like
// the cows (cows.ts) they take no part in the game and can't be caught or hurt, and every screen
// works them out the same from the map's seed: a unicorn's path is a slow loop round its meadow,
// a pure function of game time, so they need no stepping and stay in step online for free.
import { G } from './state.ts';
import { MH, MW } from './const.ts';
import { mulberry32 } from '../util/math.ts';
import { layoutFor } from '../data/map.ts';
import { lairsFor } from './creatures.ts';
import { meadow } from './cows.ts';

/** How many unicorns a map gets (fewer if it has too little open meadow). */
export const UNICORNS = 3;
/** How far (tiles) a unicorn wanders from the middle of its meadow. */
export const UNICORN_ROAM = 1.8;
/** Unicorns keep this far (tiles) from every Town Hall, lair and each other. */
const CLEAR_OF_BASES = 14, CLEAR_OF_LAIRS = 6, APART = 14;

export interface Unicorn { hx: number; hy: number; wx: number; wy: number; px: number; py: number; size: number }

export const unicorns: { list: Unicorn[]; seed: number; teams: number } = { list: [], seed: -1, teams: 0 };

/** Place the unicorns for the current map. Same seed and map, same unicorns, on every screen. */
export function initUnicorns(): void {
  const rnd = mulberry32(G.seed ^ 0x0ac0d), layout = layoutFor(G.teams, G.small);
  const avoid: [number, number, number][] = [
    ...layout.yards.map(([x, y]): [number, number, number] => [x + 1, y + 1, CLEAR_OF_BASES]),
    ...lairsFor(G.seed).map(([[x, y]]): [number, number, number] => [x, y, CLEAR_OF_LAIRS]),
  ];
  const spots: [number, number][] = [];
  for (let y = 4; y < MH - 4; y++)
    for (let x = 4; x < MW - 4; x++)
      if (avoid.every(([ax, ay, r]) => Math.hypot(x - ax, y - ay) >= r) && meadow(x, y, 3)) spots.push([x, y]);
  Object.assign(unicorns, { list: [], seed: G.seed, teams: G.teams });
  for (let tries = 0; tries < 40 && unicorns.list.length < UNICORNS && spots.length; tries++) {
    const [x, y] = spots[Math.floor(rnd() * spots.length)];
    if (unicorns.list.some((u) => Math.hypot(u.hx - x - 0.5, u.hy - y - 0.5) < APART)) continue;
    unicorns.list.push({ hx: x + 0.5, hy: y + 0.5, wx: 0.05 + rnd() * 0.04, wy: 0.07 + rnd() * 0.05, px: rnd() * 6.3, py: rnd() * 6.3, size: 0.9 + rnd() * 0.2 });
  }
}

/** Where a unicorn is at game time `t` (tiles), and which way it faces. */
export function unicornAt(u: Unicorn, t: number): { x: number; y: number; face: number } {
  const x = u.hx + Math.sin(t * u.wx + u.px) * UNICORN_ROAM, y = u.hy + Math.sin(t * u.wy + u.py) * UNICORN_ROAM;
  const dx = Math.cos(t * u.wx + u.px) * u.wx, dy = Math.cos(t * u.wy + u.py) * u.wy;
  return { x, y, face: Math.atan2(dy, dx) };
}

/** The unicorns for the current map (placing them first if the map changed). */
export function currentUnicorns(): Unicorn[] {
  if (unicorns.seed !== G.seed || unicorns.teams !== G.teams) initUnicorns();
  return unicorns.list;
}
