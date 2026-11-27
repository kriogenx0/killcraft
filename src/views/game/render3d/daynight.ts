// Day and night (Alex, 2026-11-27): the light runs through dawn, day, dusk and night as the game
// goes on. The sun rises in the east, crosses the sky (so shadows swing round and shorten toward
// noon) and sets in the west; at night a pale moon takes over the shadows. Night stays readable: a
// cool blue moonlight and a bright sky light, never pitch dark. Purely visual: every player sees the
// same hour because it follows the game clock (G.gameT), and nothing in the game rules changes.
import * as THREE from 'three';
import { lerp } from '../../../util/math.ts';
import { MOODS, WINTER, type Mood } from './mood.ts';

/** Length of one whole day and night, in game seconds. */
export const DAY_LENGTH = 20 * 60;
/** Where in the day a game starts (0 = first light, see KEYS): early morning. */
export const START_HOUR = 0.07;
/** The sun is up from SUNRISE through SUNSET (share of the day, wrapping past 1); the moon the rest. */
const SUNRISE = 0.975, SUNSET = 0.615;

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

const DAWN: Mood = {
  name: 'dawn', sun: '#ffb48a', sunI: 1.5, bearing: 1.5, height: 0.15,
  sky: '#b9b8e0', ground: '#4a4438', hemiI: 0.75, zenith: '#4d5f9c', horizon: '#f2b8a0', glow: '#ff9870', envI: 0.45,
  haze: '#8e88a8', water: '#2c4f78', exposure: 1.1,
};
const DUSK: Mood = {
  name: 'dusk', sun: '#ff8a50', sunI: 1.6, bearing: -1.5, height: 0.15,
  sky: '#b4a8d8', ground: '#5a4636', hemiI: 0.75, zenith: '#3d4a88', horizon: '#f0a070', glow: '#ff7a40', envI: 0.45,
  haze: '#8a6e88', water: '#283f6a', exposure: 1.12,
};
/** Moonlight: dim, blue-white, and a strong cool sky light so troops stay easy to pick out. */
const NIGHT: Mood = {
  name: 'night', sun: '#a8c0ff', sunI: 0.95, bearing: 1.0, height: 0.9,
  sky: '#7d92c8', ground: '#2a3040', hemiI: 0.95, zenith: '#101a38', horizon: '#34406a', glow: '#8ea8e0', envI: 0.35,
  haze: '#1c2440', water: '#1a2c4c', exposure: 1.18,
};
/** The moment the light swaps from sun to moon (and back): dim, so the swap isn't noticed. */
const TWILIGHT: Mood = { ...NIGHT, name: 'twilight', sun: '#8a90c8', sunI: 0.2, sky: '#9a98d0', hemiI: 1.05, exposure: 1.18 };

const [MORNING, MIDDAY, AFTERNOON, EVENING] = MOODS;

/** The light at points through the day (0 = first light). */
function keys(snow: boolean): [number, Mood][] {
  const day = (m: Mood) => (snow ? { ...WINTER, name: m.name } : m);
  return [
    [0, DAWN],
    [0.07, day(MORNING)],
    [0.25, day(MIDDAY)],
    [0.42, day(AFTERNOON)],
    [0.52, day(EVENING)],
    [0.585, DUSK],
    [SUNSET, TWILIGHT],
    [0.68, NIGHT],
    [0.92, NIGHT],
    [SUNRISE, TWILIGHT],
    [1, DAWN],
  ];
}

const live: Mood = { ...MIDDAY };
const ca = new THREE.Color(), cb = new THREE.Color();
const mix = (a: string, b: string, t: number) => ca.set(a).lerp(cb.set(b), t).getHexString();

/** Where in the day it is at a game time: 0..1 (0 = first light). `?tod=` pins it in tests. */
export function hourAt(gameT: number): number {
  return (((START_HOUR + gameT / DAY_LENGTH) % 1) + 1) % 1;
}

export function phaseOf(h: number): Phase {
  if (h < 0.06 || h >= SUNRISE) return 'dawn';
  if (h < 0.55) return 'day';
  if (h < 0.66) return 'dusk';
  return 'night';
}

/**
 * The light at an hour: colours and strengths blended between the nearest keys, the sun (or moon)
 * placed along its arc. Returns one shared object, rewritten on every call. `env` is the key whose
 * sky to reflect (reflections are rebuilt only when that changes).
 */
export function lightAt(h: number, snow: boolean): { mood: Mood; env: Mood } {
  const ks = keys(snow);
  let i = 0;
  while (i < ks.length - 2 && h >= ks[i + 1][0]) i++;
  const [ta, a] = ks[i], [tb, b] = ks[i + 1], t = tb > ta ? (h - ta) / (tb - ta) : 0;
  live.name = t < 0.5 ? a.name : b.name;
  live.sun = `#${mix(a.sun, b.sun, t)}`; live.sunI = lerp(a.sunI, b.sunI, t);
  live.sky = `#${mix(a.sky, b.sky, t)}`; live.ground = `#${mix(a.ground, b.ground, t)}`; live.hemiI = lerp(a.hemiI, b.hemiI, t);
  live.zenith = `#${mix(a.zenith, b.zenith, t)}`; live.horizon = `#${mix(a.horizon, b.horizon, t)}`; live.glow = `#${mix(a.glow, b.glow, t)}`;
  live.envI = lerp(a.envI, b.envI, t);
  live.haze = `#${mix(a.haze, b.haze, t)}`; live.water = `#${mix(a.water, b.water, t)}`; live.exposure = lerp(a.exposure, b.exposure, t);
  // the sun climbs from the east (bearing +90°) through the south at noon to the west; the moon
  // takes a lower, flatter path the same way round
  const sunUp = h >= SUNRISE || h < SUNSET;
  const span = sunUp ? (1 - SUNRISE) + SUNSET : SUNRISE - SUNSET;
  const u = sunUp ? ((h - SUNRISE + 1) % 1) / span : (h - SUNSET) / span;
  live.bearing = sunUp ? Math.PI / 2 - u * Math.PI : 1.1 - u * 2.2;
  // never quite on the horizon: a light that low stretches shadows across the whole screen
  live.height = sunUp ? 0.28 + 0.8 * Math.sin(u * Math.PI) : 0.55 + 0.4 * Math.sin(u * Math.PI);
  return { mood: live, env: t < 0.5 ? a : b };
}

/** `?tod=dawn|morning|noon|afternoon|dusk|night` or a share of the day (0..1): pin the hour for screenshots. */
export function pinnedHour(v: string | null): number | null {
  if (v === null) return null;
  const named: Record<string, number> = { dawn: 0.015, morning: 0.1, noon: 0.25, afternoon: 0.42, evening: 0.53, dusk: 0.575, night: 0.8 };
  if (v in named) return named[v];
  const n = Number(v);
  return Number.isFinite(n) && v !== '' ? ((n % 1) + 1) % 1 : null;
}
