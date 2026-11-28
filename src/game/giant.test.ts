// The Titan: one per side, revealed by Aether, a ground-shaking blow that hits everything around it.
import { reachAge } from './age.testkit.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { atLimit, available, enqueue } from './production.ts';
import { fire, updProjs } from './combat.ts';
import { UNIT } from '../data/unit.ts';

beforeEach(() => {
  G.reveal = true;
  G.demo = true;
  ais[0].on = ais[1].on = false;
  initWorld(1234);
  G.ents = [];
  G.projs = [];
});

afterEach(() => {
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

describe('the Titan', () => {
  it('is the biggest and toughest unit a side can train', () => {
    for (const [t, d] of Object.entries(UNIT)) {
      if (t === 'giant' || d.demon) continue; // the Archfiend out of the Gate of Hell is nobody's to train
      expect(UNIT.giant.hp).toBeGreaterThan(d.hp);
      expect(UNIT.giant.cost).toBeGreaterThanOrEqual(d.cost);
      expect(UNIT.giant.radius).toBeGreaterThan(d.radius * 1.5); // dwarfs even the Cyborg Colossus
    }
  });

  it('needs Aether and the Industrial age, and only one at a time', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 12, 46, false);
    reachAge(0, 1);
    expect(available(0, 'infantry')).not.toContain('giant');
    G.aetherFound[0] = true;
    expect(available(0, 'infantry')).toContain('giant');
    G.credits[0] = 99999; G.wood[0] = 9999; G.aether[0] = 999;
    expect(enqueue(0, 'giant', true)).toBe(true);
    expect(atLimit(0, 'giant')).toBe(true);
    expect(enqueue(0, 'giant', true)).toBe(false);
    G.prod[0].infantry = [];
    const t = addUnit('giant', 0, 20 * TS, 30 * TS);
    expect(atLimit(0, 'giant')).toBe(true);
    t.dead = true;
    expect(atLimit(0, 'giant')).toBe(false);
  });

  it('swings its club in a wide sweep: foes in front are hit, not what is behind it', () => {
    const y = 30 * TS, titan = addUnit('giant', 0, 20 * TS, y);
    const a = addUnit('swordsman', 1, 20 * TS + 40, y), side = addUnit('swordsman', 1, 20 * TS + 5, y + 60), behind = addUnit('swordsman', 1, 20 * TS - 60, y);
    fire(titan, 'quake', a);
    expect(titan.atkT).toBeGreaterThan(0.5); // a slow swing you can see
    updProjs(0.2);
    expect(a.hp).toBe(a.maxhp); // still winding up
    for (let i = 0; i < 120 && G.projs.length; i++) updProjs(1 / 60);
    expect(a.hp).toBeLessThan(a.maxhp);
    expect(side.hp).toBeLessThan(side.maxhp);
    expect(behind.hp).toBe(behind.maxhp);
  });
});
