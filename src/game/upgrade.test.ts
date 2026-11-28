import { reachAge } from './age.testkit.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { dealDamage } from './combat.ts';
import { available, cancel, enqueue, lockedResearch, toggleHold, unitUpgradeNeeds, unlocksAt } from './production.ts';
import { refitTime, toggleRefit } from './refit.ts';
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

  it('researches at the Armory, one at a time in queue order, alongside research at the Hospital', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    expect(available(0, 'armory')).toEqual([]);
    addBuilding('armory', 0, 16, 50, false);
    expect(available(0, 'armory')).toEqual(['infWeapon1', 'infArmor1', 'vehWeapon1', 'vehArmor1']);
    Object.assign(G, { credits: [9000, 9000], wood: [9000, 9000], oil: [9000, 9000] });
    expect(enqueue(0, 'infWeapon1')).toBe(true);
    expect(enqueue(0, 'infArmor1')).toBe(true); // queues behind it
    expect(enqueue(0, 'infWeapon1')).toBe(false); // already queued
    addBuilding('hospital', 0, 19, 50, false);
    expect(enqueue(0, 'heal1')).toBe(true); // the Hospital researches at the same time
    run(30);
    expect(G.upg[0].infWeapon).toBe(1);
    expect(G.upg[0].infArmor).toBe(0); // one at a time
    expect(G.heal[0]).toBe(1);
    run(30);
    expect(G.upg[0].infArmor).toBe(1);
    // the next level waits for the Industrial age
    expect(G.era[0]).toBe(0);
    expect(available(0, 'armory')).toEqual(['vehWeapon1', 'vehArmor1']);
    reachAge(0, 1);
    expect(available(0, 'armory')).toContain('infWeapon2');
  });

  it("opens the second level with the Armory's first upgrade and the third with its second", () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    const armory = addBuilding('armory', 0, 16, 50, false);
    Object.assign(G, { credits: [20000, 20000], wood: [20000, 20000], oil: [20000, 20000] });
    for (const t of ['infWeapon1', 'infArmor1', 'vehWeapon1', 'vehArmor1'] as const) expect(enqueue(0, t, true)).toBe(true);
    run(110);
    expect(G.upg[0]).toEqual({ infWeapon: 1, infArmor: 1, vehWeapon: 1, vehArmor: 1 });
    // the Industrial age alone isn't enough: the Medieval Armory has to be upgraded
    G.era[0] = 1;
    expect(available(0, 'armory')).toEqual([]);
    expect(lockedResearch(0)).toEqual(['infWeapon2', 'infArmor2', 'vehWeapon2', 'vehArmor2']);
    expect(enqueue(0, 'infWeapon2')).toBe(false);
    expect(unlocksAt(0, 'armory', 1)).toEqual(['Rifled Barrels', 'Steel Helmets', 'High-Explosive Shells', 'Riveted Plate']);
    expect(toggleRefit(armory)).toBe(true);
    run(refitTime(armory) + 1);
    expect(armory.lvl).toBe(1);
    expect(available(0, 'armory')).toEqual(['infWeapon2', 'infArmor2', 'vehWeapon2', 'vehArmor2']);
    expect(lockedResearch(0)).toEqual([]);
    expect(enqueue(0, 'infWeapon2')).toBe(true);
    run(TECH.infWeapon2.t + 1);
    expect(G.upg[0].infWeapon).toBe(2);
    // Modern: the third level needs the second upgrade
    G.era[0] = 2;
    expect(available(0, 'armory')).not.toContain('infWeapon3');
    expect(lockedResearch(0)).toContain('infWeapon3');
    expect(toggleRefit(armory)).toBe(true);
    run(refitTime(armory) + 1);
    expect(available(0, 'armory')).toContain('infWeapon3');
  });

  it('a newly built Armory comes in its age and opens that round at once; a gated level shows only where an Armory stands', () => {
    reachAge(0, 1);
    expect(lockedResearch(0)).toEqual([]);
    addBuilding('armory', 0, 16, 50, false);
    expect(available(0, 'armory')).toEqual(['infWeapon1', 'infArmor1', 'vehWeapon1', 'vehArmor1']);
    Object.assign(G, { credits: [9000, 9000], wood: [9000, 9000], oil: [9000, 9000] });
    expect(enqueue(0, 'infWeapon1', true)).toBe(true);
    expect(enqueue(0, 'infWeapon2', true)).toBe(true);
  });

  it("the same goes for the Hospital's healing", () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    const hospital = addBuilding('hospital', 0, 16, 50, false);
    G.heal[0] = 1;
    G.era[0] = 1;
    expect(available(0, 'hospital')).not.toContain('heal2');
    expect(lockedResearch(0)).toContain('heal2');
    Object.assign(G, { credits: [9000, 9000], wood: [9000, 9000], oil: [9000, 9000] });
    toggleRefit(hospital);
    run(refitTime(hospital) + 1);
    expect(available(0, 'hospital')).toContain('heal2');
  });

  it('upgrading a Barracks, War Factory, Airfield or Arcane Circle opens the troops of its new age', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('power', 0, 10, 53, false);
    const barracks = addBuilding('barracks', 0, 13, 50, false);
    addBuilding('refinery', 0, 20, 56, false);
    const factory = addBuilding('factory', 0, 16, 56, false);
    const circle = addBuilding('magetower', 0, 16, 50, false);
    Object.assign(G, { credits: [20000, 20000], wood: [20000, 20000], oil: [20000, 20000] });
    G.era[0] = 1;
    expect(available(0, 'infantry')).not.toContain('rifleman');
    expect(unitUpgradeNeeds(0, 'rifleman')).toBe('barracks');
    expect(available(0, 'vehicle')).toEqual(['catapult']);
    expect(unitUpgradeNeeds(0, 'tank')).toBe('factory');
    expect(unlocksAt(0, 'factory', 1)).toContain('Battle Tank');
    toggleRefit(barracks);
    run(refitTime(barracks) + 1);
    expect(available(0, 'infantry')).toContain('rifleman');
    // spellcasters of the age also wait on the Arcane Circle
    expect(available(0, 'infantry')).not.toContain('stormcaller');
    expect(unitUpgradeNeeds(0, 'stormcaller')).toBe('magetower');
    toggleRefit(circle);
    run(refitTime(circle) + 1);
    expect(available(0, 'infantry')).toContain('stormcaller');
    toggleRefit(factory);
    run(refitTime(factory) + 1);
    expect(available(0, 'vehicle')).toContain('tank');
    // an Airfield built in the Industrial age comes ready for it
    addBuilding('airfield', 0, 24, 50, false);
    expect(available(0, 'air')).toContain('biplane');
    // the Harvester, the Modern ore gatherer, never waits on the War Factory
    G.era[0] = 2;
    expect(available(0, 'vehicle')).toContain('harvester');
    expect(available(0, 'vehicle')).not.toContain('heavy');
  });

  it('queues successive levels of one upgrade, pays on queueing, and refunds a cancel along with the levels above it', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('armory', 0, 16, 50, false);
    reachAge(0, 2);
    Object.assign(G, { credits: [9000, 9000], wood: [9000, 9000], oil: [9000, 9000] });
    const ore = G.credits[0];
    for (const t of ['infWeapon1', 'infWeapon2', 'infWeapon3'] as const) expect(enqueue(0, t, true)).toBe(true);
    expect(G.credits[0]).toBe(ore - TECH.infWeapon1.cost - TECH.infWeapon2.cost - TECH.infWeapon3.cost);
    expect(available(0, 'armory')).toEqual(['infWeapon1', 'infWeapon2', 'infWeapon3', 'infArmor1', 'vehWeapon1', 'vehArmor1']);
    // calling off level 2 drops level 3 too, and gives back both
    expect(cancel(0, 'infWeapon2')).toBe(true);
    expect(G.prod[0].armory.map((it) => it.type)).toEqual(['infWeapon1']);
    expect(G.credits[0]).toBe(ore - TECH.infWeapon1.cost);
    expect(available(0, 'armory')).toContain('infWeapon2');
    // a level held back holds the one queued on top of it, but not other tracks
    enqueue(0, 'infWeapon2', true);
    enqueue(0, 'vehArmor1', true);
    toggleHold(0, 'infWeapon1');
    run(45);
    expect(G.upg[0].vehArmor).toBe(1);
    expect(G.upg[0].infWeapon).toBe(0);
    toggleHold(0, 'infWeapon1');
    run(70);
    expect(G.upg[0].infWeapon).toBe(2);
    expect(G.prod[0].armory).toEqual([]);
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
