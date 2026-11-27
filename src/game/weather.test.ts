import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks } from './state.ts';
import { MH, MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit } from './entity.ts';
import { wildBeasts } from './creatures.ts';
import { biting, formStorm, initWeather, weatherSnap, applyWeatherSnap } from './weather.ts';
import { STORM_FORM, STORM_SPEED } from '../data/weather.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

/** Park a storm over a spot (px), standing still, already biting. */
function stormAt(kind: 'hail' | 'meteor', x: number, y: number) {
  const s = formStorm(kind);
  Object.assign(s, { x, y, vx: 0, vy: 0, age: STORM_FORM });
  return s;
}

beforeEach(() => {
  hooks.error = (e) => { throw e; };
  G.demo = true;
  ais[0].on = false;
  ais[1].on = false;
  initWorld(4321);
  for (const b of wildBeasts()) { b.dead = true; G.byId.delete(b.id); }
  G.ents = G.ents.filter((e) => !e.dead);
  G.hell.spawnT = Infinity;
  G.weather.stormT = Infinity;
  G.weather.rainT = Infinity;
});

afterEach(() => {
  ais[1].on = true;
  G.demo = false;
});

describe('weather', () => {
  it('Off never rains or storms; Rain never storms', () => {
    initWeather('off');
    expect(G.weather.rainT).toBe(Infinity);
    expect(G.weather.stormT).toBe(Infinity);
    initWeather('rain');
    expect(G.weather.rainT).toBeLessThan(Infinity);
    expect(G.weather.stormT).toBe(Infinity);
    initWeather('storms');
    expect(G.weather.stormT).toBeGreaterThanOrEqual(420);
  });

  it('a storm forms at the edge, harmless at first, and crosses the map', () => {
    const s = formStorm('hail');
    expect(biting(s)).toBe(false);
    const mid = { x: (MW * TS) / 2, y: (MH * TS) / 2 };
    const d0 = Math.hypot(s.x - mid.x, s.y - mid.y);
    expect(d0).toBeGreaterThan(MW * TS * 0.3);
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(STORM_SPEED * TS, 3);
    run(STORM_FORM + 1);
    expect(biting(s)).toBe(true);
    // heads in across the map, and is gone once it has passed the far side
    expect(Math.hypot(s.x - mid.x, s.y - mid.y)).toBeLessThan(d0);
    run(200);
    expect(G.weather.storms).toHaveLength(0);
  });

  it('hail hurts what is under it, not what is beside it', () => {
    const x = 40 * TS, y = 40 * TS;
    const under = addUnit('swordsman', 0, x, y), clear = addUnit('swordsman', 0, x + 12 * TS, y);
    stormAt('hail', x, y);
    run(3);
    expect(under.hp).toBeLessThan(under.maxhp);
    expect(clear.hp).toBe(clear.maxhp);
  });

  it('a meteor shower drops burning stones on the ground below', () => {
    const x = 40 * TS, y = 40 * TS;
    const crowd = Array.from({ length: 12 }, (_, i) => addUnit('swordsman', 1, x + ((i % 4) - 1.5) * TS, y + (Math.floor(i / 4) - 1) * TS));
    stormAt('meteor', x, y);
    run(1);
    expect(G.projs.some((p) => p.sky)).toBe(true);
    run(12);
    expect(crowd.some((u) => u.dead || u.hp < u.maxhp)).toBe(true);
  });

  it('the computer moves its troops out of a storm', () => {
    ais[1].on = true;
    const x = 40 * TS, y = 40 * TS;
    const u = addUnit('swordsman', 1, x, y);
    const s = stormAt('hail', x, y);
    run(1);
    expect(u.order?.t).toBe('move');
    run(10);
    expect(Math.hypot(u.x - s.x, u.y - s.y)).toBeGreaterThan(s.r);
  });

  it('heavy rain puts out fires', () => {
    const u = addUnit('swordsman', 0, 40 * TS, 40 * TS);
    u.burnT = G.gameT + 9;
    G.weather.raining = true;
    G.weather.rain = 1;
    run(0.2);
    expect(u.burnT).toBe(0);
  });

  it('a client takes the storms from the snapshot', () => {
    formStorm('meteor');
    const snap = JSON.parse(JSON.stringify(weatherSnap()));
    G.weather.storms = [];
    applyWeatherSnap(snap);
    expect(G.weather.storms).toHaveLength(1);
    expect(G.weather.storms[0].kind).toBe('meteor');
  });
});
