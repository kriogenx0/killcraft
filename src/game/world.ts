// Setting up a match and advancing the simulation by one fixed step.
import { isWall } from '../data/building.ts';
import { G, allied, hooks, say, unitDef } from './state.ts';
import { markStartStock, resetStats, sampleStats } from './stats.ts';
import { MW, MH, TS } from './const.ts';
import { layoutFor, START_CREDITS, START_WOOD, START_OIL, START_UNITS } from '../data/map.ts';
import { START_ERA } from '../data/era.ts';
import { generateMap, rebuildBlk } from './map.ts';
import { addBuilding, addSource, addUnit, kill } from './entity.ts';
import { refreshHealRates, updUnit } from './unit.ts';
import { updBld } from './building.ts';
import { updProjs } from './combat.ts';
import { separate } from './move.ts';
import { updFx } from './fx.ts';
import { updFog } from './fog.ts';
import { regrowOre } from './ore.ts';
import { collect, dropSalvage } from './economy.ts';
import { bankAether, drawAether, pickUpShards, placeAether, shrineHeal, syncWaygates } from './aether.ts';
import { initCows } from './cows.ts';
import { beastDied, captureBeasts, placeCreatures, respawnBeasts, satyrSong, unicornCleanse } from './creatures.ts';
import { noUpgrades } from './upgrade.ts';
import { available, emptyProduction, priceOf, updProduction, type Price } from './production.ts';
import { refitPrice } from './refit.ts';
import { teamColors } from '../data/team.ts';
import { ais, aiThink, resetAi } from './ai.ts';
import { AI_LEVEL } from '../data/setup.ts';
import { isUnitType, type UnitType } from '../data/unit.ts';
import { bankLoot, updLeader } from './bounty.ts';

const FOG_INTERVAL = 0.2;
const ORE_INTERVAL = 1;

export interface StartOptions {
  /** starting ore and wood, as a share of the normal amount */
  share?: number;
  /** the units each side starts with beside its yard */
  units?: readonly UnitType[];
  /** each team's side (2v2: [0, 1, 0, 1]); every team is its own side if left out */
  ally?: readonly number[];
  /** teams whose slot is closed: their corner stays empty */
  absent?: readonly boolean[];
}

/** Start a match on a seeded map. `teams` is 2 (one against one) or 4 (one base per corner: a free-for-all, or two sides of two with `ally`). */
export function initWorld(seed: number, teams = 2, start: StartOptions = {}): void {
  const share = start.share ?? 1, units = start.units ?? START_UNITS;
  const n = teams > 2 ? 4 : 2, each = <T>(f: () => T): T[] => Array.from({ length: n }, f);
  Object.assign(G, {
    ents: [], projs: [], fx: [], decals: [], nextId: 1, gameT: 0, over: false, winner: -1, outLog: [],
    alertT: each(() => -99), lastAlert: null, leader: -1, fogT: 0, aiT: 0, endT: 0, oreT: 0, teams: n,
    ally: Array.from({ length: n }, (_, t) => start.ally?.[t] ?? t), absent: Array.from({ length: n }, (_, t) => !!start.absent?.[t]),
    credits: each(() => Math.round(START_CREDITS * share)), wood: each(() => Math.round(START_WOOD * share)), oil: each(() => START_OIL), era: each(() => START_ERA), heal: each(() => 0), rally: each(() => null), upg: each(noUpgrades), prod: each(emptyProduction),
  });
  while (G.sight.length < n) G.sight.push(new Uint8Array(MW * MH));
  G.sight.length = n;
  G.byId.clear();
  resetStats();
  for (const s of G.sight) s.fill(0);
  resetAi(n);
  generateMap(seed);
  const { yards, ore } = layoutFor(n);
  for (const [x, y] of ore) addSource(x, y);
  yards.forEach(([x, y], team) => {
    if (G.absent[team]) return;
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
  initCows();
  updFog();
}

/** A side is still in the game while it has a building (walls don't count) or an armed unit. */
export const alive = (team: number) => G.ents.some((e) => !e.dead && e.team === team && ((e.kind === 'bld' && !isWall(e.type)) || (e.kind === 'unit' && !!unitDef(e).weapon)));

/** Seconds the last buildings burn before the match is called. */
const FALL_SECONDS = 2.5;

/**
 * What the side has in hand plus everything it could get back by calling off orders it has paid for:
 * queued research and troops, unfinished building sites and upgrades under way all refund in full.
 */
function fundsWithRefunds(team: number): Price {
  const f: Price = { ore: G.credits[team], wood: G.wood[team], oil: G.oil[team], aether: G.aether[team] ?? 0 };
  const add = (p: Partial<Price>) => { f.ore += p.ore ?? 0; f.wood += p.wood ?? 0; f.oil += p.oil ?? 0; f.aether += p.aether ?? 0; };
  for (const line of Object.values(G.prod[team])) for (const it of line) if (it.paid) add(priceOf(it.type));
  for (const e of G.ents) {
    if (e.dead || e.team !== team || e.kind !== 'bld') continue;
    if (!e.done && !e.unpaid) add(priceOf(e.type as Parameters<typeof priceOf>[0]));
    else if (e.done && e.upT != null) add(refitPrice(e));
  }
  return f;
}

/**
 * A side that has lost (Alex's rule): it has no Town Hall, no units at all (counting units it has paid
 * for and is training), and it can't train a Worker, either because it has no Barracks left or because
 * it can't pay for one, even by cancelling orders. A side that keeps its Town Hall stays in the game.
 */
export function stranded(team: number): boolean {
  if (G.ents.some((e) => !e.dead && e.team === team && (e.kind === 'unit' || (e.type === 'yard' && e.done)))) return false;
  if (Object.values(G.prod[team]).some((line) => line.some((it) => it.paid && isUnitType(it.type)))) return false;
  if (!available(team, 'infantry').includes('worker')) return true;
  const p = priceOf('worker'), f = fundsWithRefunds(team);
  return f.ore < p.ore || f.wood < p.wood || f.oil < p.oil || f.aether < p.aether;
}

/** Every building a stranded side still has blows up, and the side is out of the game. */
function fall(team: number): boolean {
  const left = G.ents.filter((e) => !e.dead && e.team === team && e.kind === 'bld');
  if (!left.length) return false;
  const why = `no Town Hall, no units and ${available(team, 'infantry').includes('worker') ? 'no ore for a Worker' : 'nothing that trains Workers'}`;
  knockOut(team, `its base blew up: ${why}`);
  for (const e of left) { kill(e); dropSalvage(e); }
  for (let t = 0; t < G.teams; t++) say(t, t === team ? `Your base is lost: ${why}` : `${teamColors(team).name}'s base has fallen: ${why}`);
  return true;
}

/** A side in a team game that can't rebuild but has a teammate who can: say so once. */
function down(team: number): void {
  if (G.outLog?.some((o) => o.team === team)) return;
  knockOut(team, 'no Town Hall, no units and no way to train a Worker');
  const who = teamColors(team).name;
  for (let t = 0; t < G.teams; t++) {
    if (t === team) say(t, 'You are down: no Town Hall and no units. A teammate can revive you from their Town Hall');
    else if (allied(t, team)) say(t, `${who} is down: select your Town Hall and press Revive ${who}`);
    else say(t, `${who} is down`);
  }
}

/** A player gave up: everything their side has is destroyed and it's out of the game. */
export function surrender(team: number): void {
  knockOut(team, 'surrendered');
  for (const e of G.ents) if (!e.dead && e.team === team) kill(e);
  for (let t = 0; t < G.teams; t++) if (t !== team) say(t, `${teamColors(team).name} surrendered.`);
}

/** Note the first time a side is out of the game, and why. */
function knockOut(team: number, why: string): void {
  if (!G.outLog) G.outLog = []; // a game saved before the log existed
  if (!G.outLog.some((o) => o.team === team)) G.outLog.push({ team, t: G.gameT, why });
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** How each side that went out of the game went out, in order: for the end screen and server logs. */
export const outReasons = (name: (team: number) => string = (t) => teamColors(t).name): string[] =>
  (G.outLog ?? []).map((o) => `${name(o.team)} was knocked out at ${clock(o.t)}: ${o.why}.`);

export function update(dt: number): void {
  if (G.gameT === 0) markStartStock();
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
  if (G.oreT <= 0) { G.oreT = ORE_INTERVAL; regrowOre(); updLeader(); sampleStats(); collect(ORE_INTERVAL); drawAether(ORE_INTERVAL); bankAether(); bankLoot(); shrineHeal(ORE_INTERVAL); syncWaygates(); captureBeasts(ORE_INTERVAL); respawnBeasts(); satyrSong(ORE_INTERVAL); unicornCleanse(); }
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
    // stranded sides go up in flames; give the explosions a moment before calling the match
    let fell = false;
    const playing = Array.from({ length: G.teams }, (_, t) => t).filter((t) => !G.absent?.[t]);
    const beaten = playing.filter(stranded);
    for (const t of beaten) {
      // a team loses only when none of it can rebuild: while a teammate still can, a beaten side
      // holds on (what's left of its base stands) and that teammate can revive it (revive.ts)
      if (playing.some((a) => !beaten.includes(a) && a !== t && allied(a, t))) down(t);
      else if (fall(t)) fell = true;
    }
    if (fell) { G.endT = FALL_SECONDS; return; }
    const left = playing.filter(alive);
    for (const t of playing) if (!left.includes(t)) knockOut(t, 'no buildings and no fighting units left');
    // the match is over when one side is left (in a team game, allies win together)
    if (left.every((t) => allied(t, left[0]))) { G.over = true; G.winner = left[0] ?? -1; }
  }
}
