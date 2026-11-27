// Weather (data/weather.ts): passing rain, and the rare hailstorm or meteor shower that forms at the
// edge of the map and sweeps across it, hurting whatever is under it. The server runs it online and
// sends each client the storms in its snapshots (weatherSnap / applyWeatherSnap); a client only
// moves them on between snapshots and draws the falling stones the server tells it about.
import { G, hooks, isAir, say, tileOf, unitDef, type Ent, type Storm } from './state.ts';
import { MH, MW, TS } from './const.ts';
import type { WeatherMode } from '../data/setup.ts';
import {
  DODGE_AHEAD, DODGE_CLEAR, DODGE_MARGIN, HAIL_DPS, HAIL_TICK, METEOR_DMG, METEOR_FALL, METEOR_RATE, METEOR_SHARE, METEOR_SPLASH, METEOR_VS,
  RAIN_DOUSE, RAIN_FADE, RAIN_FIRST, RAIN_GAP, RAIN_LEN, STORM_AIM, STORM_FIRST, STORM_FORM, STORM_GAP, STORM_RADIUS, STORM_SPEED, type StormKind,
} from '../data/weather.ts';
import { armorOf, dealDamage } from './combat.ts';
import { applyElement } from './spells.ts';
import { burst, explosion } from './fx.ts';
import { edgeDist, nearestFree } from './path.ts';
import { orderMove } from './order.ts';
import { ais } from './ai.ts';
import { clamp } from '../util/math.ts';
import { applyWildfireSnap, sparkTrees, wildfireSnap } from './wildfire.ts';
import { STONE_CATCH } from '../data/wildfire.ts';

/**
 * The weather's own dice (mulberry32, its state kept in G.weather so a saved game carries on the same):
 * storms never take numbers from Math.random, so the rest of a seeded match plays out as it did before.
 */
function rnd(): number {
  const w = G.weather;
  w.dice = (w.dice + 0x6d2b79f5) | 0;
  let t = Math.imul(w.dice ^ (w.dice >>> 15), 1 | w.dice);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = ([a, b]: [number, number]): number => a + rnd() * (b - a);
const MID = { x: (MW * TS) / 2, y: (MH * TS) / 2 };

/** Set the weather going for a new match. */
export function initWeather(mode: WeatherMode, seed = G.seed): void {
  G.weather = { mode, rain: 0, raining: false, storms: [], nextId: 1, rainT: Infinity, stormT: Infinity, dice: (seed ^ 0x77ea7e) | 0 };
  if (mode !== 'off') G.weather.rainT = between(RAIN_FIRST);
  if (mode === 'storms') G.weather.stormT = between(STORM_FIRST);
}

/** Has the storm finished forming, so it hurts what's under it? */
export const biting = (s: Storm): boolean => s.age >= STORM_FORM;

/** Which way a storm comes from, as a player reads the map (north is up). */
function fromWhere(x: number, y: number): string {
  const a = Math.atan2(y - MID.y, x - MID.x), k = Math.round(a / (Math.PI / 4));
  return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][(k + 8) % 8];
}

/** A storm forms just inside the edge of the map and heads across it, past the middle. */
export function formStorm(kind: StormKind = rnd() < METEOR_SHARE ? 'meteor' : 'hail'): Storm {
  const r = STORM_RADIUS[kind] * TS, a = rnd() * Math.PI * 2;
  // on the map's edge, its middle a little inside so everyone sees it gather
  const reach = (MW * TS) / 2 - r * 0.4;
  const x = MID.x + Math.cos(a) * reach, y = MID.y + Math.sin(a) * reach;
  const aim = rnd() * Math.PI * 2, off = Math.sqrt(rnd()) * STORM_AIM * TS;
  const tx = MID.x + Math.cos(aim) * off, ty = MID.y + Math.sin(aim) * off, d = Math.hypot(tx - x, ty - y) || 1;
  const s: Storm = { id: G.weather.nextId++, kind, x, y, vx: ((tx - x) / d) * STORM_SPEED * TS, vy: ((ty - y) / d) * STORM_SPEED * TS, r, age: 0, acc: 0 };
  G.weather.storms.push(s);
  const what = kind === 'hail' ? 'A hailstorm' : 'A meteor shower', from = fromWhere(x, y);
  const ex = clamp(x, TS, (MW - 1) * TS), ey = clamp(y, TS, (MH - 1) * TS);
  for (let t = 0; t < G.teams; t++) {
    if (G.absent?.[t]) continue;
    say(t, `${what} is coming in from the ${from}! Keep your troops out from under it.`);
    hooks.alert(t, ex, ey);
  }
  return s;
}

/** Is this unit or building being pelted by hail right now? (Its many small hits aren't shown as numbers.) */
export const inHail = (e: Ent): boolean => G.weather?.storms.some((s) => s.kind === 'hail' && biting(s) && reachOf(s, e) <= s.r) ?? false;

/** Is this spot (px) under the storm? `pad` widens it (px). */
const under = (s: Storm, e: { x: number; y: number }, pad = 0): boolean => Math.hypot(e.x - s.x, e.y - s.y) <= s.r + pad;
/** Distance (px) from the storm's middle to the nearest part of an entity. */
const reachOf = (s: Storm, e: Ent): number => (e.kind === 'bld' ? edgeDist(s, e) : Math.hypot(e.x - s.x, e.y - s.y));

/** Advance the weather by one step. Online clients only move the storms on (the server sends the rest). */
export function updWeather(dt: number): void {
  const w = G.weather;
  if (!w) return;
  for (const s of w.storms) { s.x += s.vx * dt; s.y += s.vy * dt; s.age += dt; }
  if (G.visualOnly) return;
  // rain comes on and eases off gently; a hailstorm brings its own
  const wet = w.raining || w.storms.some((s) => s.kind === 'hail');
  w.rain = clamp(w.rain + (wet ? 1 : -1) * RAIN_FADE * dt, 0, 1);
  if (G.gameT >= w.rainT) {
    w.raining = !w.raining;
    w.rainT = G.gameT + between(w.raining ? RAIN_LEN : RAIN_GAP);
  }
  if (G.gameT >= w.stormT) {
    w.stormT = G.gameT + between(STORM_GAP);
    formStorm();
  }
  // gone once it has crossed the map and passed the far edge
  w.storms = w.storms.filter((s) => {
    const out = Math.hypot(s.x - MID.x, s.y - MID.y), away = (s.x - MID.x) * s.vx + (s.y - MID.y) * s.vy > 0;
    return !(away && out > (MW * TS) / 2 + s.r);
  });
  for (const s of w.storms) {
    if (!biting(s)) continue;
    if (s.kind === 'hail') pelt(s, dt);
    else stones(s, dt);
  }
  if (w.rain >= RAIN_DOUSE) for (const e of G.ents) if (e.burnT && e.burnT > G.gameT && !e.dead) e.burnT = 0;
  dodge(dt);
}

/** Hail: everything under the storm takes a little damage every tick. */
function pelt(s: Storm, dt: number): void {
  s.acc -= dt;
  if (s.acc > 0) return;
  s.acc += HAIL_TICK;
  for (const e of G.ents) {
    if (e.dead || (e.kind !== 'unit' && e.kind !== 'bld')) continue;
    if (reachOf(s, e) > s.r) continue;
    const dps = e.kind === 'bld' ? HAIL_DPS.building : isAir(e) ? HAIL_DPS.air : unitDef(e).cls === 'vehicle' ? HAIL_DPS.vehicle : HAIL_DPS.infantry;
    dealDamage(e, dps * HAIL_TICK, null, true, true);
  }
}

/** Meteor shower: stones fall at random spots under the storm. */
function stones(s: Storm, dt: number): void {
  s.acc += METEOR_RATE * dt;
  while (s.acc >= 1) {
    s.acc -= 1;
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * s.r;
    dropStone(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, s);
  }
}

/** A stone starts falling toward a spot (px), slanting in the way the storm drifts. Also how a client draws one the server dropped. */
export function dropStone(x: number, y: number, s?: { vx: number; vy: number }): void {
  const sp = Math.hypot(s?.vx ?? 0, s?.vy ?? 0), ux = sp ? s!.vx / sp : 1, uy = sp ? s!.vy / sp : 0;
  const lead = 3 * TS, sx = x - ux * lead, sy = y - uy * lead;
  G.projs.push({ kind: 'orb', weapon: 'meteor', sky: true, x: sx, y: sy, z: 14 * TS, z0: 14 * TS, gx: x, gy: y, tid: -1, dmg: METEOR_DMG, src: -1, team: -2, sp: lead / METEOR_FALL, d0: lead, tr: 0, a: 0, dead: false });
  if (!G.visualOnly) hooks.skyfall(x, y);
}

/** A falling stone lands: a fiery blast that hurts everything on the ground near it, any side's. */
export function stoneLands(x: number, y: number): void {
  explosion(x, y, METEOR_SPLASH);
  burst('debris', x, y, 10, 60, 180);
  if (G.visualOnly) return; // the server decides damage
  sparkTrees(x, y, METEOR_SPLASH, STONE_CATCH); // and now and then sets the woods alight
  for (const e of G.ents) {
    if (e.dead || (e.kind !== 'unit' && e.kind !== 'bld')) continue;
    const d = e.w ? edgeDist({ x, y }, e) : Math.max(0, Math.hypot(e.x - x, e.y - y) - unitDef(e).radius);
    if (d > METEOR_SPLASH) continue;
    const vs = METEOR_VS[armorOf(e)] ?? 1;
    if (vs <= 0) continue;
    dealDamage(e, METEOR_DMG * vs * (1 - 0.6 * (d / METEOR_SPLASH)), null, false, true);
    applyElement(e, 'fire', null);
  }
}

/** Seconds between the computer checking its troops against the storms. */
const DODGE_EVERY = 0.5;
let dodgeT = 0;

/** The computer moves its units out from under a storm, or out of its path, to the nearer side. */
function dodge(dt: number): void {
  dodgeT -= dt;
  if (dodgeT > 0) return;
  dodgeT = DODGE_EVERY;
  const storms = G.weather.storms;
  if (!storms.length) return;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || e.team < 0 || !ais[e.team]?.on || G.human[e.team]) continue;
    if ((e.dodgeT ?? 0) > G.gameT && e.order?.t === 'move') continue;
    for (const s of storms) {
      if (s.kind === 'meteor' && isAir(e)) continue; // stones fall past aircraft
      const pad = DODGE_MARGIN * TS;
      const soon = { x: s.x + s.vx * DODGE_AHEAD, y: s.y + s.vy * DODGE_AHEAD }, half = { x: s.x + s.vx * DODGE_AHEAD / 2, y: s.y + s.vy * DODGE_AHEAD / 2 };
      if (!under(s, e, pad) && Math.hypot(e.x - soon.x, e.y - soon.y) > s.r + pad && Math.hypot(e.x - half.x, e.y - half.y) > s.r + pad) continue;
      if (stepAside(e, s)) break;
    }
  }
}

/** Send a unit sideways out of the storm's path; false if there's nowhere to go. */
function stepAside(e: Ent, s: Storm): boolean {
  const sp = Math.hypot(s.vx, s.vy) || 1, px = -s.vy / sp, py = s.vx / sp;
  const side = (e.x - s.x) * px + (e.y - s.y) * py;
  const tryGo = (sign: number): boolean => {
    const need = s.r + DODGE_CLEAR * TS - sign * side;
    const gx = clamp(tileOf(e.x + px * sign * need), 0, MW - 1), gy = clamp(tileOf(e.y + py * sign * need), 0, MH - 1);
    // a spot still under the storm's path (the map edge cut it short) is no escape
    const at = { x: (gx + 0.5) * TS, y: (gy + 0.5) * TS };
    if (Math.abs((at.x - s.x) * px + (at.y - s.y) * py) < s.r) return false;
    const t = G.blk[gy * MW + gx] && !isAir(e) ? nearestFree(gx, gy, 4) : [gx, gy];
    if (!t) return false;
    orderMove(e, t[0], t[1]);
    if (e.order?.t === 'move') e.order.flee = true;
    e.dodgeT = G.gameT + (need / (unitDef(e).spd * TS)) + 1;
    return true;
  };
  const first = side >= 0 ? 1 : -1;
  return tryGo(first) || tryGo(-first);
}

/**
 * The weather as a snapshot sends it: rain (0..100) and each storm [id, kind (0 hail, 1 meteor), x, y, vx, vy, r, age*10],
 * and any burning trees (game/wildfire.ts) as [tile, seconds left * 10, ...].
 */
export interface WeatherSnap { rain: number; s: number[][]; f?: number[] }

export const weatherSnap = (): WeatherSnap => ({
  f: wildfireSnap(),
  rain: Math.round(G.weather.rain * 100),
  s: G.weather.storms.map((s) => [s.id, s.kind === 'meteor' ? 1 : 0, Math.round(s.x), Math.round(s.y), Math.round(s.vx * 10) / 10, Math.round(s.vy * 10) / 10, Math.round(s.r), Math.round(s.age * 10)]),
});

/** A client takes the server's weather. */
export function applyWeatherSnap(w: WeatherSnap | undefined): void {
  if (!w) return;
  const g = G.weather;
  g.rain = w.rain / 100;
  g.storms = w.s.map(([id, k, x, y, vx, vy, r, age]) => ({ id, kind: k ? 'meteor' : 'hail', x, y, vx, vy, r, age: age / 10, acc: 0 }));
  applyWildfireSnap(w.f);
}
