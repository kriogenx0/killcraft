// Setting up a match and advancing the simulation by one fixed step.
import { G, hooks, unitDef } from './state.ts';
import { TS } from './const.ts';
import { START_YARDS, ORE_SOURCES, START_CREDITS, START_WOOD, START_OIL, START_UNITS } from '../data/map.ts';
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
import { emptyProduction, updProduction } from './production.ts';
import { ais, aiThink, resetAi } from './ai.ts';

const FOG_INTERVAL = 0.2;
const AI_INTERVAL = 1;
const ORE_INTERVAL = 1;

export function initWorld(seed: number): void {
  Object.assign(G, {
    ents: [], projs: [], fx: [], decals: [], nextId: 1, gameT: 0, over: false, winner: -1,
    alertT: [-99, -99], lastAlert: null, fogT: 0, aiT: 0, endT: 0, oreT: 0,
    credits: [START_CREDITS, START_CREDITS], wood: [START_WOOD, START_WOOD], oil: [START_OIL, START_OIL], era: [START_ERA, START_ERA], heal: [0, 0], prod: [emptyProduction(), emptyProduction()],
  });
  G.byId.clear();
  for (const s of G.sight) s.fill(0);
  resetAi();
  generateMap(seed);
  for (const [x, y] of ORE_SOURCES) addSource(x, y);
  START_YARDS.forEach(([x, y], team) => {
    addBuilding('yard', team, x, y, false);
    START_UNITS.forEach((type, i) => {
      const u = addUnit(type, team, (x + 3.5 + (i % 2)) * TS, (y + 1 + Math.floor(i / 2)) * TS);
      u.face = u.tface = team === 0 ? -Math.PI / 4 : (Math.PI * 3) / 4;
    });
  });
  rebuildBlk();
  updFog();
}

/** A side is still in the game while it has a building or an armed unit. */
const alive = (team: number) => G.ents.some((e) => !e.dead && e.team === team && (e.kind === 'bld' || (e.kind === 'unit' && !!unitDef(e).weapon)));

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
  for (const team of [0, 1]) updProduction(team, dt);
  updProjs(dt);
  separate();
  updFx(dt);
  if (G.ents.some((e) => e.dead)) {
    G.ents = G.ents.filter((e) => {
      if (e.dead) G.byId.delete(e.id);
      return !e.dead;
    });
  }
  G.oreT -= dt;
  if (G.oreT <= 0) { G.oreT = ORE_INTERVAL; regrowOre(); collect(ORE_INTERVAL); }
  G.fogT -= dt;
  if (G.fogT <= 0) { G.fogT = FOG_INTERVAL; updFog(); }
  G.aiT -= dt;
  if (G.aiT <= 0) {
    G.aiT = AI_INTERVAL;
    ais.forEach((a, team) => {
      if (!a.on) return;
      try { aiThink(team); } catch (err) { hooks.error(err); }
    });
  }
  G.endT -= dt;
  if (G.endT <= 0 && G.gameT > 3 && !G.over) {
    G.endT = 1;
    const a = [alive(0), alive(1)];
    if (!a[0] || !a[1]) { G.over = true; G.winner = a[0] ? 0 : 1; }
  }
}
