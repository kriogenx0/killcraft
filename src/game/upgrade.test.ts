import { beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { dealDamage } from './combat.ts';
import { available, enqueue } from './production.ts';
import { TECH, TECH_TYPES, UPGRADE_TRACKS, ERA } from '../data/era.ts';

// these tests time production exactly: switch off the leader's handicaps (one side always ends up far ahead here)
vi.mock('../data/economy.ts', async (orig) => ({ ...(await orig<typeof import('../data/economy.ts')>()), LEADER_SPEED: 1, LEADER_PLANTS: 1 }));

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP; i++) update(STEP);
}

describe('Armory upgrades', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    G.reveal = true;
    G.demo = true;
    hooks.error = (e) => { throw e; };
    initWorld(1234);
  });

  it('has one level of every track in every age', () => {
    for (const track of UPGRADE_TRACKS) {
      const levels = TECH_TYPES.filter((t) => TECH[t].upg?.track === track);
      expect(levels.map((t) => TECH[t].upg?.level)).toEqual([1, 2, 3]);
      expect(levels.map((t) => TECH[t].era)).toEqual(ERA.map((_, i) => i));
    }
  });

  it('researches at the Armory, one level at a time, alongside research at the yard', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    expect(available(0, 'armory')).toEqual([]);
    addBuilding('armory', 0, 16, 50, false);
    expect(available(0, 'armory')).toEqual(['infWeapon1', 'infArmor1', 'vehWeapon1', 'vehArmor1']);
    Object.assign(G, { credits: [9000, 9000], wood: [9000, 9000], oil: [9000, 9000] });
    expect(enqueue(0, 'infWeapon1')).toBe(true);
    expect(enqueue(0, 'infArmor1')).toBe(false); // one at a time
    addBuilding('hospital', 0, 19, 50, false);
    expect(enqueue(0, 'heal1')).toBe(true); // the Hospital researches at the same time
    run(30);
    expect(G.upg[0].infWeapon).toBe(1);
    expect(G.heal[0]).toBe(1);
    // the next level waits for the World War age
    expect(G.era[0]).toBe(0);
    expect(available(0, 'armory')).toEqual(['infArmor1', 'vehWeapon1', 'vehArmor1']);
    G.era[0] = 1;
    expect(available(0, 'armory')).toContain('infWeapon2');
  });

  it('upgraded weapons hit harder and upgraded armor takes less, only for the matching side', () => {
    const sw = addUnit('swordsman', 0, 20 * TS, 50 * TS), foe = addUnit('swordsman', 1, 21 * TS, 50 * TS), tank = addUnit('tank', 1, 22 * TS, 52 * TS);
    const hurt = (src: typeof sw, t: typeof sw) => { const before = t.hp; dealDamage(t, 20, src); const d = before - t.hp; t.hp = t.maxhp; return d; };
    expect(hurt(sw, foe)).toBeCloseTo(20);
    G.upg[0].infWeapon = 2;
    expect(hurt(sw, foe)).toBeCloseTo(24);
    expect(hurt(sw, tank)).toBeCloseTo(24);
    G.upg[1].infArmor = 1;
    expect(hurt(sw, foe)).toBeCloseTo(24 * 0.9);
    expect(hurt(sw, tank)).toBeCloseTo(24); // infantry armor doesn't cover tanks
    G.upg[1].vehArmor = 3;
    expect(hurt(sw, tank)).toBeCloseTo(24 * 0.7);
  });
});
