// Setting up a match and advancing the simulation by one fixed step.
import { isWall } from '../data/building.ts';
import { G, hooks, unitDef } from './state.ts';
import { MW, MH, TS } from './const.ts';
import { layoutFor, START_CREDITS, START_WOOD, START_OIL, START_UNITS } from '../data/map.ts';
import { START_ERA } from '../data/era.ts';
import { generateMap, rebuildBlk } from './map.ts';
import { addBuilding, addSource, addUnit } from './entity.ts';
import { refreshHealRates, updUnit } from './unit.ts';
import { updBld } from './building.ts';
import { updProjs } from './combat.ts';
import { separate } from './move.ts';
import { updFx } from './fx.ts';
import { updFog } from './fog.ts';
import { regrowOre } from './ore.ts';
import { collect } from './economy.ts';
import { bankAether, drawAether, pickUpShards, placeAether, shrineHeal, syncWaygates } from './aether.ts';
import { beastDied, captureBeasts, placeCreatures, respawnBeasts } from './creatures.ts';
import { noUpgrades } from './upgrade.ts';
import { emptyProduction, updProduction } from './production.ts';
import { ais, aiThink, resetAi } from './ai.ts';
import { AI_LEVEL } from '../data/setup.ts';
import type { UnitType } from '../data/unit.ts';
import { bankLoot, updLeader } from './bounty.ts';

const FOG_INTERVAL = 0.2;
const ORE_INTERVAL = 1;

export interface StartOptions {
  /** starting ore and wood, as a share of the normal amount */
  share?: number;
  /** the units each side starts with beside its yard */
  units?: readonly UnitType[];
}

/** Start a match on a seeded map. `teams` is 2 (one against one) or 4 (free-for-all, one base per corner). */
export function initWorld(seed: number, teams = 2, start: StartOptions = {}): void {
  const share = start.share ?? 1, units = start.units ?? START_UNITS;
  const n = teams > 2 ? 4 : 2, each = <T>(f: () => T): T[] => Array.from({ length: n }, f);
  Object.assign(G, {
    ents: [], projs: [], fx: [], decals: [], nextId: 1, gameT: 0, over: false, winner: -1,
    alertT: each(() => -99), lastAlert: null, leader: -1, fogT: 0, aiT: 0, endT: 0, oreT: 0, teams: n,
    credits: each(() => Math.round(START_CREDITS * share)), wood: each(() => Math.round(START_WOOD * share)), oil: each(() => START_OIL), era: each(() => START_ERA), heal: each(() => 0), upg: each(noUpgrades), prod: each(emptyProduction),
  });
  while (G.sight.length < n) G.sight.push(new Uint8Array(MW * MH));
  G.sight.length = n;
  G.byId.clear();
  for (const s of G.sight) s.fill(0);
  resetAi(n);
  generateMap(seed);
  const { yards, ore } = layoutFor(n);
  for (const [x, y] of ore) addSource(x, y);
  yards.forEach(([x, y], team) => {
    addBuilding('yard', team, x, y, false);
    // the starting Workers face the middle of the map
    const face = Math.atan2(MH / 2 - y, MW / 2 - x);
    units.forEach((type, i) => {
      const u = addUnit(type, team, (x + 3.5 + (i % 2)) * TS, (y + 1 + Math.floor(i / 2)) * TS);
      u.face = u.tface = face;
    });
  });
  rebuildBlk();
  placeAether(G.seed);
  rebuildBlk();
  placeCreatures(G.seed);
  rebuildBlk();
  updFog();
}

/** A side is still in the game while it has a building (walls don't count) or an armed unit. */
export const alive = (team: number) => G.ents.some((e) => !e.dead && e.team === team && ((e.kind === 'bld' && !isWall(e.type)) || (e.kind === 'unit' && !!unitDef(e).weapon)));

export function update(dt: number): void {
  G.gameT += dt;
  refreshHealRates();
  for (const e of G.ents) {
    if (e.dead) continue;
    try {
      if (e.kind === 'unit') updUnit(e, dt);
      else if (e.kind === 'bld') updBld(e, dt);
    } catch (err) {
      hooks.error(err);
      e.order = null;
      e.path = null;
    }
  }
  pickUpShards();
  for (let team = 0; team < G.teams; team++) updProduction(team, dt);
  updProjs(dt);
  separate();
  updFx(dt);
  if (G.ents.some((e) => e.dead)) {
    G.ents = G.ents.filter((e) => {
      if (e.dead) { G.byId.delete(e.id); if (e.kind === 'unit') beastDied(e); }
      return !e.dead;
    });
  }
  G.oreT -= dt;
  if (G.oreT <= 0) { G.oreT = ORE_INTERVAL; regrowOre(); updLeader(); collect(ORE_INTERVAL); drawAether(ORE_INTERVAL); bankAether(); bankLoot(); shrineHeal(ORE_INTERVAL); syncWaygates(); captureBeasts(ORE_INTERVAL); respawnBeasts(); }
  G.fogT -= dt;
  if (G.fogT <= 0) { G.fogT = FOG_INTERVAL; updFog(); }
  // each computer player thinks as often as its difficulty allows
  ais.forEach((a, team) => {
    if (!a.on || team >= G.teams) return; // sides left over from a bigger match sit out
    a.thinkT -= dt;
    if (a.thinkT > 0) return;
    a.thinkT = AI_LEVEL[a.level].think;
    try { aiThink(team); } catch (err) { hooks.error(err); }
  });
  G.endT -= dt;
  if (G.endT <= 0 && G.gameT > 3 && !G.over) {
    G.endT = 1;
    const left = Array.from({ length: G.teams }, (_, t) => t).filter(alive);
    if (left.length <= 1) { G.over = true; G.winner = left[0] ?? -1; }
  }
}
