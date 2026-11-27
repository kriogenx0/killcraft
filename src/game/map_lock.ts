// Locked campaign maps (Alex, 2026-11-27: "Lock in campaign maps so they are always the same").
// Each mission's map is saved as data (public/campaign/<id>.json, written by `npm run campaign-maps`):
// the ground, heights, ore, oil, trees and portals, and where the ore rocks, Aether deposits, creature
// lairs and scattered enemies are. A mission builds its map from that data instead of the generator,
// so a change to map generation never changes a campaign map.
import { G, type Ent, type Portal } from './state.ts';
import { MW, MH, TS } from './const.ts';
import { addSource, addUnit } from './entity.ts';
import { addAether } from './aether.ts';
import { addBeast } from './creatures.ts';
import type { UnitType } from '../data/unit.ts';

/** Bumped if the saved shape changes. */
export const LOCK_VERSION = 1;

export interface LockedThing { type: string; team: number; x: number; y: number; hp?: number; face?: number }

export interface LockedMap {
  v: number;
  seed: number;
  /**
   * Per-tile layers, run-length coded as [value, count, value, count, ...] (most of a map is runs of
   * plain grass, no ore, no oil). Heights are kept in thousandths of a tile.
   */
  terr: number[]; elev: number[]; ore: number[]; oilField: number[]; treeWood: number[]; warp: number[]; warpTeam: number[];
  portals: Portal[];
  /** ore rocks, Aether deposits, wild creatures, and enemy units placed on the map (not the starting bases) */
  things: LockedThing[];
}

const LAYERS = ['terr', 'elev', 'ore', 'oilField', 'treeWood', 'warp', 'warpTeam'] as const;
/** how each layer's values are stored (heights to a thousandth, the rest as they are, rounded) */
const SCALE: Record<(typeof LAYERS)[number], number> = { terr: 1, elev: 1000, ore: 1, oilField: 1, treeWood: 1, warp: 1, warpTeam: 1 };

function encode(a: ArrayLike<number>, scale: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length;) {
    const v = Math.round(a[i] * scale);
    let n = 1;
    while (i + n < a.length && Math.round(a[i + n] * scale) === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

function decode(rle: number[], scale: number, into: { length: number; [i: number]: number }): boolean {
  let i = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) for (let n = 0; n < rle[k + 1] && i < into.length; n++) into[i++] = rle[k] / scale;
  return i === into.length;
}

/** Is this an entity the map places (rather than a side's starting base)? */
const placed = (e: Ent, scatterTeams: readonly number[]): boolean =>
  e.kind === 'source' || !!e.wild || (e.kind === 'unit' && scatterTeams.includes(e.team));

/** The map as it stands, to lock. `scatterTeams` are sides whose units the map places (no town). */
export function captureMap(scatterTeams: readonly number[] = []): LockedMap {
  const out = { v: LOCK_VERSION, seed: G.seed, portals: structuredClone(G.portals), things: [] as LockedThing[] } as unknown as LockedMap;
  for (const k of LAYERS) (out as unknown as Record<string, number[]>)[k] = encode(G[k], SCALE[k]);
  for (const e of G.ents) {
    if (e.dead || !placed(e, scatterTeams)) continue;
    out.things.push({ type: e.type, team: e.team, x: Math.round(e.x * 100) / 100, y: Math.round(e.y * 100) / 100, ...(e.type === 'aether' ? { hp: e.hp } : {}), ...(e.kind === 'unit' ? { face: Math.round(e.face * 100) / 100 } : {}) });
  }
  return out;
}

/** Lay a locked map's ground over the generated one. False if it doesn't fit (another version or map size). */
export function applyGround(m: LockedMap): boolean {
  if (!m || m.v !== LOCK_VERSION) return false;
  const ok = LAYERS.every((k) => G[k].length === MW * MH && Array.isArray(m[k]) && decode(m[k], SCALE[k], G[k]));
  if (!ok) return false;
  G.seed = m.seed;
  G.portals = structuredClone(m.portals);
  return true;
}

/** Swap the generated map's rocks, deposits, creatures and scattered enemies for the locked ones. */
export function applyThings(m: LockedMap, scatterTeams: readonly number[]): void {
  const gone = G.ents.filter((e) => placed(e, scatterTeams));
  for (const e of gone) G.byId.delete(e.id);
  G.ents = G.ents.filter((e) => !gone.includes(e));
  for (const t of m.things) {
    const tx = Math.floor(t.x / TS), ty = Math.floor(t.y / TS);
    if (t.type === 'source') addSource(tx, ty);
    else if (t.type === 'aether') addAether(tx, ty, t.hp);
    else {
      const u = t.team < 0 ? addBeast(t.type as UnitType, t.x, t.y) : addUnit(t.type as UnitType, t.team, t.x, t.y);
      if (t.face != null) u.face = u.tface = t.face;
    }
  }
}
