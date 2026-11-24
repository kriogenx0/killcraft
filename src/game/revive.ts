// Reviving a fallen teammate (Alex, 2026-11-24): in a team game, a side with a Town Hall can pay to
// give an ally that has lost theirs a new Town Hall and two Workers, back at the ally's home corner.
// Purpose: a team that keeps one base standing can bring a beaten partner back into the fight.
import { G, allied, isAir, say, tileOf } from './state.ts';
import { MW, MH, TS, GRASS } from './const.ts';
import { layoutFor, START_UNITS } from '../data/map.ts';
import { BUILDING } from '../data/building.ts';
import { teamColors } from '../data/team.ts';
import { addBuilding, addUnit } from './entity.ts';
import { nearPortal } from './map.ts';

/** What it costs the reviving side: about two thirds of a Town Hall. */
export const REVIVE_PRICE = { ore: 2000, wood: 300 } as const;

const YARD = BUILDING.yard.size;
/** How far from the home corner to look for open ground, then from the reviver's own Town Hall. */
const SEARCH = 14;

/** A side in this match whose seat is filled. */
const seated = (team: number): boolean => team >= 0 && team < G.teams && !G.absent?.[team];

const hasHall = (team: number): boolean => G.ents.some((e) => !e.dead && e.team === team && e.type === 'yard');

/** A side that has no Town Hall (finished or rising) and so can be given one by an ally. */
export const needsRevive = (team: number): boolean => seated(team) && !hasHall(team);

/** The allies `team` could revive right now, whether or not it can pay. */
export const fallenAllies = (team: number): number[] =>
  Array.from({ length: G.teams }, (_, t) => t).filter((t) => t !== team && allied(t, team) && needsRevive(t));

export const canPayRevive = (team: number): boolean => G.credits[team] >= REVIVE_PRICE.ore && G.wood[team] >= REVIVE_PRICE.wood;

/** Can `by` revive `target` now: allies, `by` has a finished Town Hall and the price, `target` has none. */
export function canRevive(by: number, target: number): boolean {
  return !G.over && seated(by) && by !== target && allied(by, target) && needsRevive(target) &&
    G.ents.some((e) => !e.dead && e.team === by && e.type === 'yard' && e.done) && canPayRevive(by);
}

/** Open ground for a whole Town Hall: grass, nothing built, no units standing there. */
function open(tx: number, ty: number): boolean {
  if (tx < 1 || ty < 1 || tx + YARD > MW - 1 || ty + YARD > MH - 1) return false;
  for (let y = ty; y < ty + YARD; y++) for (let x = tx; x < tx + YARD; x++) {
    const i = y * MW + x;
    if (G.blk[i] || G.terr[i] !== GRASS || nearPortal(x, y)) return false;
  }
  return !G.ents.some((e) => !e.dead && e.kind === 'unit' && !isAir(e) && tileOf(e.x) >= tx && tileOf(e.x) < tx + YARD && tileOf(e.y) >= ty && tileOf(e.y) < ty + YARD);
}

/** The nearest open spot to a tile, ring by ring. */
function spotNear(cx: number, cy: number): [number, number] | null {
  for (let r = 0; r <= SEARCH; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (open(cx + dx, cy + dy)) return [cx + dx, cy + dy];
      }
  return null;
}

/** Where the new Town Hall goes: the fallen side's own corner if there's room, else beside the reviver's Town Hall. */
export function reviveSpot(by: number, target: number): [number, number] | null {
  const home = layoutFor(G.teams).yards[target];
  const own = G.ents.find((e) => !e.dead && e.team === by && e.type === 'yard' && e.done);
  return (home && spotNear(home[0], home[1])) ?? (own ? spotNear(own.tx, own.ty) : null);
}

/** Free tiles next to the Town Hall for the Workers to stand on. */
function workerTiles(tx: number, ty: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 1; r <= 3 && out.length < n; r++)
    for (let y = ty - r; y < ty + YARD + r && out.length < n; y++)
      for (let x = tx - r; x < tx + YARD + r && out.length < n; x++) {
        if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
        const i = y * MW + x;
        if (!G.blk[i] && G.terr[i] === GRASS && !out.some(([a, b]) => a === x && b === y)) out.push([x, y]);
      }
  return out;
}

/**
 * `by` pays REVIVE_PRICE and `target` gets a finished Town Hall (in its own age) and two Workers.
 * A side that was knocked out is back in the game. Returns false if it isn't allowed or there's no room.
 */
export function revive(by: number, target: number): boolean {
  if (!canRevive(by, target)) return false;
  const spot = reviveSpot(by, target);
  if (!spot) { say(by, 'No open ground for a Town Hall'); return false; }
  G.credits[by] -= REVIVE_PRICE.ore;
  G.wood[by] -= REVIVE_PRICE.wood;
  const [tx, ty] = spot;
  for (let y = ty; y < ty + YARD; y++) for (let x = tx; x < tx + YARD; x++) G.ore[y * MW + x] = 0;
  addBuilding('yard', target, tx, ty, false);
  const face = Math.atan2(MH / 2 - ty, MW / 2 - tx);
  workerTiles(tx, ty, START_UNITS.length).forEach(([x, y], i) => {
    const u = addUnit(START_UNITS[i], target, (x + 0.5) * TS, (y + 0.5) * TS);
    u.face = u.tface = face;
  });
  // back in the game: forget that it was knocked out
  if (G.outLog) G.outLog = G.outLog.filter((o) => o.team !== target);
  const who = teamColors(target).name, helper = teamColors(by).name;
  for (let t = 0; t < G.teams; t++) {
    if (t === target) say(t, `${helper} revived you: a new Town Hall and two Workers`);
    else if (t === by) say(t, `You revived ${who}`);
    else if (allied(t, by)) say(t, `${helper} revived ${who}`);
    else say(t, `${who} is back in the game`);
  }
  return true;
}
