import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks } from './state.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
import { addBuilding, lowPower } from './entity.ts';
import { POWER_NAG, powerAlarm } from './power_alarm.ts';

describe('low power reminder', () => {
  let said: [number, string][] = [];
  beforeEach(() => {
    initWorld(7);
    for (const a of ais) a.on = false;
    said = [];
    hooks.notify = (t, m) => said.push([t, m]);
  });
  afterEach(() => { hooks.notify = () => {}; ais[1].on = true; });

  it('says nothing while power is enough', () => {
    powerAlarm();
    expect(said).toEqual([]);
  });

  it('warns a side short of power, then again every POWER_NAG seconds while it lasts, and stops once fixed', () => {
    const extra = [];
    for (let i = 0; i < 8 && !lowPower(0); i++) extra.push(addBuilding('factory', 0, 10 + i * 4, 50, false));
    expect(lowPower(0)).toBe(true);
    powerAlarm();
    expect(said.length).toBe(1);
    expect(said[0][0]).toBe(0);
    expect(said[0][1]).toMatch(/Low power .*Power Plant/);
    G.gameT += POWER_NAG - 1; powerAlarm();
    expect(said.length).toBe(1);
    G.gameT += 1; powerAlarm();
    expect(said.length).toBe(2);
    for (const e of extra) e.dead = true;
    G.gameT += POWER_NAG * 2; powerAlarm();
    expect(said.length).toBe(2);
  });
});
