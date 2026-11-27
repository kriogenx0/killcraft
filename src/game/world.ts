// Setting up a match and advancing the simulation by one fixed step.
import type { FogMode, WeatherMode } from '../data/setup.ts';
import { isWall } from '../data/building.ts';
import { G, allied, hooks, say, unitDef, type Tile } from './state.ts';
import { markStartStock, resetStats, sampleStats } from './stats.ts';
import { GRASS, MW, MH, TS } from './const.ts';
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
import { bankAether, drawAether, regrowAether, pickUpShards, placeAether, shrineHeal, syncWaygates } from './aether.ts';
import { initCows } from './cows.ts';
import { beastDied, captureBeasts, placeCreatures, respawnBeasts, satyrSong } from './creatures.ts';
import { noUpgrades } from './upgrade.ts';
import { available, emptyProduction, priceOf, updProduction, type Price } from './production.ts';
import { refitPrice } from './refit.ts';
import { teamColors } from '../data/team.ts';
import { ais, aiThink, resetAi } from './ai.ts';
import { AI_LEVEL } from '../data/setup.ts';
import { isUnitType, type UnitType } from '../data/unit.ts';
import { bankLoot, updLeader } from './bounty.ts';
import { onGate, placeGate, updHell } from './hell.ts';
import { applyGround, applyThings, type LockedMap } from './map_lock.ts';
import { initWeather, updWeather } from './weather.ts';

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
  /** fog of war; Off is G.reveal, which the caller sets */
  fog?: FogMode;
  /** rain and storms (default Storms) */
  weather?: WeatherMode;
  /** the latest age a side may research (default Modern, so every age); campaign missions cap it */
  maxEra?: number;
  /** units, buildings and research nobody may use (campaign missions) */
  ban?: readonly string[];
  /** a winter map (looks only) */
  snow?: boolean;
  /** false: no creature lairs (campaign missions before 8; cows, sheep and unicorns stay) */
  wild?: boolean;
  /** false: no Gate of Hell (campaign missions) */
  gate?: boolean;
  /** false: no Aether deposits (campaign missions before 8) */
  aether?: boolean;
  /** a small map: the land is a square this many tiles across (campaign missions) */
  small?: number;
  /** the oil wells, instead of the layout's (campaign mission 4: one hidden patch) */
  oilWells?: Tile[] | null;
  /** each side on its own island (campaign mission 5) */
  islands?: boolean;
  /**
   * Enemy sides get no town: just these units, in small groups across the map (campaign mission 1,
   * Alex: "Don't go against a town yet. Just random units"). The side is beaten when they're all gone.
   */
  scatter?: readonly UnitType[];
  /** no Town Halls at all: the player starts with `units` only (campaign mission 6) */
  noTown?: boolean;
  /** a campaign mission's saved map (game/map_lock.ts): used instead of what the generator makes */
  locked?: LockedMap | null;
}

/** Start a match on a seeded map. `teams` is 2 (one against one) or 4 (one base per corner: a free-for-all, or two sides of two with `ally`). */
export function initWorld(seed: number, teams = 2, start: StartOptions = {}): void {
  const share = start.share ?? 1, units = start.units ?? START_UNITS;
  const n = teams > 2 ? 4 : 2, each = <T>(f: () => T): T[] => Array.from({ length: n }, f);
  Object.assign(G, {
    ents: [], projs: [], fx: [], decals: [], nextId: 1, gameT: 0, over: false, winner: -1, outLog: [], aiLog: [],
    alertT: each(() => -99), lastAlert: null, fog: start.fog ?? 'reveal', maxEra: start.maxEra ?? 2, banned: [...(start.ban ?? [])], snow: !!start.snow, small: start.small ?? 0, oilWells: start.oilWells ?? null, islands: !!start.islands, wild: start.wild ?? true, mission: null, leader: -1, fogT: 0, aiT: 0, endT: 0, oreT: 0, teams: n,
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
  const locked = start.locked && applyGround(start.locked) ? start.locked : null;
  const wild = start.wild ?? true, gate = start.gate ?? wild;
  if (gate) placeGate();
  else G.hell = { gate: false, spawnT: 0, raidT: Infinity, archT: Infinity, prey: -1, burst: 0, burstT: 0, stay: 0, stir: false };
  const { yards, ore } = layoutFor(n, G.small);
  for (const [x, y] of ore) if (!gate || !onGate(x, y)) addSource(x, y); // the Gate of Hell stands in for the middle field's rock
  const scattered = (team: number) => !!start.scatter?.length && G.ally[team] !== G.ally[0];
  yards.forEach(([x, y], team) => {
    if (G.absent[team]) return;
    if (scattered(team)) { scatterUnits(team, start.scatter ?? [], [[x + 1, y + 1], ...ore.slice(2)]); return; }
    if (!start.noTown) addBuilding('yard', team, x, y, false);
    // the starting Workers face the middle of the map (an army with no town stands where the Town Hall would, five abreast)
    const face = Math.atan2(MH / 2 - y, MW / 2 - x), cols = start.noTown ? 5 : 2, x0 = start.noTown ? x - 1 : x + 3.5;
    units.forEach((type, i) => {
      const u = addUnit(type, team, (x0 + (i % cols)) * TS, (y + 1 + Math.floor(i / cols)) * TS);
      u.face = u.tface = face;
    });
  });
  rebuildBlk();
  placeAether(G.seed, start.aether ?? true);
  rebuildBlk();
  if (wild) placeCreatures(G.seed);
  else { G.tamed = Array.from({ length: n }, () => []); G.respawns = []; }
  if (locked) {
    // the saved map as it was locked, whatever the placement code does today
    applyGround(locked);
    applyThings(locked, Array.from({ length: n }, (_, t) => t).filter((t) => !G.absent[t] && scattered(t)));
  }
  rebuildBlk();
  initCows();
  initWeather(start.weather ?? 'storms');
  updFog();
}

/** Put a side's units in small groups at these spots (round-robin), each on open ground by its spot. */
function scatterUnits(team: number, units: readonly UnitType[], spots: Tile[]): void {
  const taken = new Set<number>();
  units.forEach((type, k) => {
    const [sx, sy] = spots[k % spots.length];
    let best = -1, bd = Infinity;
    // the nearest open grass to the spot that nobody stands on, a little away from ore rocks
    for (let y = Math.max(1, sy - 6); y < Math.min(MH - 1, sy + 7); y++)
      for (let x = Math.max(1, sx - 6); x < Math.min(MW - 1, sx + 7); x++) {
        const i = y * MW + x, d = Math.hypot(x - sx, y - sy);
        if (d < 2 || taken.has(i) || G.terr[i] !== GRASS) continue;
        if (d < bd) { bd = d; best = i; }
      }
    if (best < 0) return;
    taken.add(best);
    const u = addUnit(type, team, (best % MW + 0.5) * TS, (Math.floor(best / MW) + 0.5) * TS);
    u.face = u.tface = Math.random() * Math.PI * 2;
  });
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
  for (const line of Object.values(G.prod[team])) for (const it of line) if (it.paid && !it.free) add(priceOf(it.type));
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
  updWeather(dt);
  separate();
  updFx(dt);
  if (G.ents.some((e) => e.dead)) {
    G.ents = G.ents.filter((e) => {
      if (e.dead) { G.byId.delete(e.id); if (e.kind === 'unit') beastDied(e); }
      return !e.dead;
    });
  }
  G.oreT -= dt;
  if (G.oreT <= 0) { G.oreT = ORE_INTERVAL; regrowOre(); updLeader(); sampleStats(); collect(ORE_INTERVAL); drawAether(ORE_INTERVAL); regrowAether(ORE_INTERVAL); bankAether(); bankLoot(); shrineHeal(ORE_INTERVAL); syncWaygates(); captureBeasts(ORE_INTERVAL); respawnBeasts(); satyrSong(ORE_INTERVAL); updHell(); }
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
