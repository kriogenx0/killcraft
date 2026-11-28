import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { G, hooks, isAir, isHarvester } from './state.ts';
import { MW, STEP, TREE, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, kill, power } from './entity.ts';
import { orderHarvest, orderHaul } from './order.ts';
import { available, cancel, enqueue, sitesOf, startSite } from './production.ts';
import { advanceSite, canPlace, scrap } from './building.ts';
import { OIL_TRICKLE } from '../data/economy.ts';
import { oilLeft, oilRate, salvageOf, treesNear, woodNear } from './economy.ts';
import { nearestTree } from './chop.ts';
import { applyCommand } from './command.ts';
import { dealDamage } from './combat.ts';
import { OIL_WELLS } from '../data/map.ts';
import { TREE_WOOD, WOOD_LOAD } from '../data/economy.ts';
import { START_CREDITS, START_UNITS, START_WOOD } from '../data/map.ts';
import { UNIT } from '../data/unit.ts';
import { BUILDING, SCRAP_SHARE } from '../data/building.ts';
import { HEAL_RATE, HOSPITAL_HEAL, TECH } from '../data/era.ts';
import { mulberry32 } from '../util/math.ts';

// these tests time production exactly: switch off the leader's handicaps (one side always ends up far ahead here)
vi.mock('../data/economy.ts', async (orig) => ({ ...(await orig<typeof import('../data/economy.ts')>()), LEADER_SPEED: 1, LEADER_PLANTS: 1 }));

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

const errors: unknown[] = [];

beforeEach(() => {
  // the computer players, harvesters and combat roll dice: seed them so every run plays out the same
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261122));
  errors.length = 0;
  hooks.error = (e) => errors.push(e);
  G.reveal = true;
  G.demo = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  ais[0].on = false;
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

describe('production', () => {
  beforeEach(() => {
    ais[0].on = false;
    ais[1].on = false;
    initWorld(1234);
  });

  it('starts each side with a construction yard, starting units and credits', () => {
    for (const team of [0, 1]) {
      expect(G.ents.filter((e) => e.team === team && e.type === 'yard')).toHaveLength(1);
      expect(G.ents.some((e) => e.team === team && e.kind === 'unit')).toBe(true);
      expect(G.credits[team]).toBe(START_CREDITS);
    }
  });

  it('places a structure first, pays for it then, and builds it on site', () => {
    expect(available(0, 'structure')).toEqual(['power', 'mill', 'camp', 'yard', 'palisade', 'stonewall']);
    expect(enqueue(0, 'power')).toBe(false); // structures don't queue: they start when placed
    expect(G.credits[0]).toBe(START_CREDITS);
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    // free spots next to the yard (units standing there block placement)
    const spots = [[3, -2], [-2, 0], [0, -2], [0, 3], [3, 3], [-2, 3], [3, 0], [-2, -2]].map(([dx, dy]) => [yard.tx + dx, yard.ty + dy]).filter(([x, y]) => canPlace(x, y, 2, 0));
    expect(spots.length).toBeGreaterThanOrEqual(2);
    const a = startSite(0, 'power', spots[0][0], spots[0][1]);
    expect(a?.type).toBe('power');
    expect(a?.done).toBe(false);
    expect(G.credits[0]).toBe(START_CREDITS - BUILDING.power.cost);
    // a second one goes up at the same time
    const b = startSite(0, 'power', spots[1][0], spots[1][1]);
    expect(b).not.toBeNull();
    expect(sitesOf(0, 'power')).toHaveLength(2);
    // the two starting Workers go to build them, one each
    expect(G.ents.filter((e) => e.type === 'worker' && e.team === 0 && e.order?.t === 'heal').map((e) => e.order?.t === 'heal' && e.order.tgt).sort()).toEqual([a?.id, b?.id].sort());
    const made = power(0).made; // the yard's own
    run(BUILDING.power.t / 2);
    expect(a?.done).toBe(false);
    expect(a?.prog).toBeGreaterThan(0.4);
    expect(a?.hp).toBeLessThan(a?.maxhp ?? 0);
    expect(power(0).made).toBe(made);
    run(BUILDING.power.t / 2 + 6); // plus the walk over
    expect(a?.done && b?.done).toBe(true);
    expect(a?.hp).toBe(a?.maxhp);
    expect(power(0).made).toBeGreaterThan(made);
    expect(available(0, 'structure')).toContain('refinery');
  });

  it('refunds the whole price when a site is cancelled', () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    const spot = [[3, -2], [-2, 0], [0, -2], [0, 3], [3, 3], [-2, 3]].map(([dx, dy]) => [yard.tx + dx, yard.ty + dy]).find(([x, y]) => canPlace(x, y, 2, 0));
    const site = startSite(0, 'mill', spot?.[0] ?? 0, spot?.[1] ?? 0);
    expect(site).not.toBeNull();
    expect(G.credits[0]).toBeLessThan(START_CREDITS);
    run(2);
    expect(cancel(0, 'mill')).toBe(true);
    expect(site?.dead).toBe(true);
    expect(G.credits[0]).toBe(START_CREDITS);
    expect(G.wood[0]).toBe(START_WOOD);
  });

  it('starts in the Medieval age with medieval troops only', () => {
    expect(G.era).toEqual([0, 0]);
    for (const t of START_UNITS) expect(UNIT[t].era).toBe(0);
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    expect(available(0, 'infantry')).toEqual(['swordsman', 'crossbowman', 'knight', 'guardian', 'worker']);
    addBuilding('magetower', 0, 16, 50, false);
    expect(available(0, 'infantry')).toEqual(['swordsman', 'crossbowman', 'knight', 'guardian', 'worker', 'mage', 'tidecaller']);
    expect(available(0, 'infantry')).not.toContain('harvester');
    expect(available(0, 'structure')).not.toContain('turret');
    expect(enqueue(0, 'rifleman')).toBe(false);
  });

  it('finds oil, builds the Engine Works to research Industrial, and pays oil for Modern', () => {
    addBuilding('power', 0, 10, 82, false);
    addBuilding('barracks', 0, 13, 82, false);
    addBuilding('refinery', 0, 6, 78, false);
    expect(available(0, 'structure')).toContain('derrick');
    expect(available(0, 'structure')).not.toContain('works'); // needs oil first
    expect(available(0, 'tech')).toEqual([]);
    addBuilding('derrick', 0, 16, 82, false);
    expect(available(0, 'structure')).toContain('works');
    const works = addBuilding('works', 0, 19, 82, true);
    expect(available(0, 'structure')).not.toContain('works'); // one at a time
    expect(G.era[0]).toBe(0);
    // idle Workers nearby take the site up by themselves
    run(BUILDING.works.t + 10);
    expect(works.done).toBe(true);
    // the Engine Works only opens the research: the age itself is researched at the Town Hall
    expect(G.era[0]).toBe(0);
    expect(available(0, 'infantry')).not.toContain('rifleman');
    expect(available(0, 'tech')).toContain('age1');
    expect(available(0, 'tech')).not.toContain('age2');
    G.credits[0] = 5000; G.wood[0] = 5000;
    expect(enqueue(0, 'age1')).toBe(true);
    run(TECH.age1.t + 5);
    expect(G.era[0]).toBe(1);
    expect(available(0, 'structure')).not.toContain('works');
    expect(available(0, 'infantry')).toContain('rifleman');
    expect(available(0, 'infantry')).not.toContain('rocket');
    expect(available(0, 'structure')).toContain('turret');
    // Modern: oil and nothing else
    expect(available(0, 'tech')).toContain('age2');
    G.credits[0] = 0; G.wood[0] = 0; G.oil[0] = 5000;
    expect(enqueue(0, 'age2')).toBe(true);
    run(65);
    expect(G.era[0]).toBe(2);
    expect(available(0, 'infantry')).toContain('rocket');
  });

  it('slowly heals infantry and knights but not vehicles', () => {
    for (const e of G.ents) if (e.type === 'worker') e.dead = true; // they'd patch the troops up
    const k = addUnit('knight', 0, 20 * TS, 50 * TS), h = addUnit('harvester', 0, 24 * TS, 50 * TS);
    k.hp = k.maxhp / 2; h.hp = h.maxhp / 2;
    run(10);
    expect(h.hp).toBe(h.maxhp / 2);
    const gained = k.hp - k.maxhp / 2;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeCloseTo(k.maxhp * HEAL_RATE[0] * 10, 0);
    run(600);
    expect(k.hp).toBe(k.maxhp);
  });

  it('researches faster healing at the Hospital, one level at a time', () => {
    for (const e of G.ents) if (e.type === 'worker') e.dead = true; // they'd patch the troops up
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    G.credits[0] = 5000;
    expect(enqueue(0, 'heal1')).toBe(false); // needs a Hospital
    addBuilding('hospital', 0, 16, 50, false);
    expect(enqueue(0, 'heal2')).toBe(false); // needs the first level, and Industrial
    expect(enqueue(0, 'heal1')).toBe(true);
    expect(enqueue(0, 'heal1')).toBe(false); // one research at a time
    run(30);
    expect(G.heal[0]).toBe(1);
    expect(available(0, 'hospital')).toEqual(['mech']);
    G.era[0] = 1;
    expect(available(0, 'hospital')).toEqual(['heal2', 'mech']);
    const s = addUnit('swordsman', 0, 20 * TS, 50 * TS), foe = addUnit('swordsman', 1, 20 * TS, 60 * TS);
    s.hp = foe.hp = 10;
    run(10);
    expect(s.hp - 10).toBeCloseTo(s.maxhp * HEAL_RATE[1] * HOSPITAL_HEAL * 10, 0);
    expect(foe.hp - 10).toBeCloseTo(foe.maxhp * HEAL_RATE[0] * 10, 0);
  });

  it('heals faster with a Hospital, which also lets the Barracks train Medics', () => {
    for (const e of G.ents) if (e.type === 'worker') e.dead = true; // they'd patch the troops up
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    expect(available(0, 'infantry')).not.toContain('medic');
    expect(available(0, 'structure')).toContain('hospital');
    const k = addUnit('knight', 0, 20 * TS, 50 * TS);
    k.hp = 10;
    run(10);
    const slow = k.hp - 10;
    addBuilding('hospital', 0, 16, 50, false);
    expect(available(0, 'infantry')).toContain('medic');
    k.hp = 10;
    run(10);
    expect(k.hp - 10).toBeCloseTo(slow * HOSPITAL_HEAL, 0);
  });

  it('sends a medic to patch up a wounded ally nearby', () => {
    const s = addUnit('swordsman', 0, 20 * TS, 50 * TS), m = addUnit('medic', 0, 24 * TS, 50 * TS);
    s.hp = 20;
    run(8);
    expect(m.order?.t === 'heal' || s.hp >= s.maxhp).toBe(true);
    expect(s.hp).toBeGreaterThan(20 + s.maxhp * HEAL_RATE[0] * 8 + 15);
    run(20);
    expect(s.hp).toBe(s.maxhp);
    expect(m.order).toBeNull();
  });

  it('a medic heals from a few tiles back instead of walking up to its patient', () => {
    const s = addUnit('swordsman', 0, 20 * TS, 50 * TS), m = addUnit('medic', 0, 26 * TS, 50 * TS);
    s.hp = 20;
    run(10);
    expect(s.hp).toBeGreaterThan(20 + 15);
    expect(Math.hypot(m.x - s.x, m.y - s.y)).toBeGreaterThan(2.5 * TS);
  });

  it('a medic on patrol heals the wounded it passes, then carries on along its beat', () => {
    const m = addUnit('medic', 0, 20 * TS, 50 * TS), s = addUnit('swordsman', 0, 26 * TS, 53 * TS);
    s.hp = 20;
    applyCommand(0, { c: 'patrol', ids: [m.id], tx: 32, ty: 50 });
    expect(m.order?.t === 'move' && !!m.order.pat).toBe(true);
    run(12);
    expect(s.hp).toBeGreaterThan(20 + 30);
    expect(m.order?.t === 'move' && !!m.order.pat).toBe(true);
    run(40);
    expect(s.hp).toBeGreaterThan(s.maxhp - 1);
    expect(m.order?.t === 'move' && !!m.order.pat && m.order.sub === null).toBe(true);
  });

  it('a medic heals flying units too', () => {
    const f = addUnit('griffin', 0, 22 * TS, 50 * TS), m = addUnit('medic', 0, 25 * TS, 50 * TS);
    f.hp = 40;
    run(8);
    expect(f.hp).toBeGreaterThan(40 + 20);
    expect(m.dead).toBe(false);
  });

  it('a medic repairs vehicles only once Field Mechanics is researched, on patrol too', () => {
    for (const e of G.ents) if (e.type === 'worker') e.dead = true; // they'd patch the tank up
    const tank = addUnit('tank', 0, 26 * TS, 53 * TS), m = addUnit('medic', 0, 20 * TS, 50 * TS);
    tank.hp = 100;
    applyCommand(0, { c: 'patrol', ids: [m.id], tx: 32, ty: 50 });
    run(12);
    expect(tank.hp).toBe(100); // a Medic can't fix a machine yet
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    addBuilding('hospital', 0, 16, 50, false);
    Object.assign(G, { credits: [5000, 5000], wood: [5000, 5000] });
    expect(available(0, 'hospital')).toContain('mech');
    expect(enqueue(0, 'mech')).toBe(true);
    run(TECH.mech.t + 2);
    expect(G.mech[0]).toBe(true);
    expect(G.mech[1]).toBe(false);
    expect(available(0, 'hospital')).not.toContain('mech');
    run(15);
    expect(tank.hp).toBeGreaterThan(100 + 20);
    expect(m.order?.t === 'move' && !!m.order.pat).toBe(true);
    run(140);
    expect(tank.hp).toBeGreaterThan(tank.maxhp - 1);
  });

  it('stalls without credits instead of going into debt', () => {
    G.credits[0] = 50;
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    expect(startSite(0, 'power', (yard?.tx ?? 0) + 3, (yard?.ty ?? 0) - 2)).toBeNull();
    run(20);
    expect(G.credits[0]).toBeGreaterThanOrEqual(0);
    expect(sitesOf(0)).toHaveLength(0);
  });

  it('Workers chop trees by the mill, and wood only counts once they drop it off', () => {
    // a free 2x2 spot by the woods
    let woods: [number, number] | null = null;
    for (let y = 2; y < 60 && !woods; y++)
      for (let x = 2; x < 60 && !woods; x++) {
        let free = true;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (G.blk[(y + dy) * MW + x + dx]) free = false;
        if (free && treesNear(x, y, 2) >= 10) woods = [x, y];
      }
    if (!woods) throw new Error('no test spot');
    const mill = addBuilding('mill', 0, woods[0], woods[1], false);
    G.wood[0] = 0;
    run(10);
    expect(G.wood[0]).toBe(0); // a mill cuts nothing by itself
    const w = addUnit('worker', 0, mill.x, mill.y + 2 * TS);
    const standing = woodNear(mill);
    orderHaul(w, mill);
    let carried = 0, chopped = false;
    for (let t = 0; t < 60; t++) {
      run(1);
      carried = Math.max(carried, w.cargo === 'wood' ? w.carry : 0);
      if (w.order?.t === 'harvest' && w.order.st === 'gather') {
        chopped = true;
        // it stands right by the tree it's chopping
        expect(G.terr[w.order.ty * MW + w.order.tx]).toBe(TREE);
        expect(Math.hypot(w.x - (w.order.tx + 0.5) * TS, w.y - (w.order.ty + 0.5) * TS)).toBeLessThan(TS * 1.6);
      }
    }
    expect(chopped).toBe(true);
    expect(carried).toBeGreaterThan(0);
    expect(G.wood[0]).toBeGreaterThan(WOOD_LOAD); // several loads dropped off at the mill
    expect(woodNear(mill)).toBeLessThan(standing);
  });

  it('chops a tree a Worker is sent to, and carries the wood to the Construction Yard without a mill', () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    const w = addUnit('worker', 0, yard.x, yard.y + 2 * TS);
    const tree = nearestTree(w, yard.tx, yard.ty, 20);
    if (tree === null) throw new Error('no tree');
    G.wood[0] = 0;
    applyCommand(0, { c: 'harvest', ids: [w.id], tx: tree % MW, ty: (tree / MW) | 0 });
    expect(w.order?.t === 'harvest' && w.order.res).toBe('wood');
    run(90);
    expect(G.wood[0]).toBeGreaterThan(0);
  });

  it('pumps oil from a well into its tank until it runs dry, then only trickles; Workers carry the tank home', () => {
    const [wx, wy] = OIL_WELLS[0];
    G.oil[0] = 0;
    for (const e of G.ents) if (e.type === 'worker') e.dead = true; // nobody hauls it off: idle Workers would
    const far = addBuilding('derrick', 0, 30, 4, false);
    expect(oilLeft(far)).toBe(0);
    const d = addBuilding('derrick', 0, wx - 1, wy - 1, false);
    const start = oilLeft(d);
    expect(start).toBeGreaterThan(1000);
    run(10);
    // pumped into the derrick's own store, not the bank
    expect(G.oil[0]).toBe(0);
    expect(d.carry).toBeGreaterThan(20);
    expect(d.carry).toBeLessThan(40);
    expect(far.carry).toBeCloseTo(OIL_TRICKLE * 10, 0); // away from a well: only the trickle
    expect(oilLeft(d)).toBeCloseTo(start - d.carry, 0);
    // drain it: the well never refills, but still seeps a little into the tank
    G.oilField.fill(0);
    const before = d.carry;
    run(5);
    expect(d.carry).toBeCloseTo(before + OIL_TRICKLE * 5, 1);
    expect(oilRate(0)).toBeCloseTo(OIL_TRICKLE * 2); // both derricks now just trickle
    // a Worker carries the store to the Town Hall
    const w = addUnit('worker', 0, d.x, d.y + 2 * TS);
    orderHaul(w, d);
    run(150);
    expect(d.carry).toBeLessThan(OIL_TRICKLE * 20);
    expect(G.oil[0]).toBeGreaterThan(before);
  });

  it('cuts trees down, and they slowly grow back', () => {
    const tree = G.terr.findIndex((t) => t === TREE);
    G.treeWood[tree] = 0;
    run(10);
    expect(G.treeWood[tree]).toBeGreaterThan(0);
    expect(G.treeWood[tree]).toBeLessThan(TREE_WOOD);
  });

  it('leaves ore behind where a unit or building is destroyed', () => {
    const tank = addUnit('tank', 0, 30.5 * TS, 20.5 * TS);
    const oreAround = () => { let n = 0; for (let y = 18; y <= 23; y++) for (let x = 28; x <= 33; x++) n += G.ore[y * MW + x]; return n; };
    const before = oreAround();
    dealDamage(tank, 99999, null);
    expect(tank.dead).toBe(true);
    expect(oreAround() - before).toBeCloseTo(salvageOf(tank), -1);
    expect(salvageOf(tank)).toBeGreaterThan(0);
  });

  it('scrapping a building pays half its price back into the bank, less if damaged', () => {
    const b = addBuilding('barracks', 0, 20, 40, false);
    const before = { ore: G.credits[0], wood: G.wood[0] }, groundBefore = G.ore.reduce((a, v) => a + v, 0);
    scrap(b);
    expect(b.dead).toBe(true);
    expect(G.credits[0] - before.ore).toBe(Math.round(BUILDING.barracks.cost * SCRAP_SHARE));
    expect(G.wood[0] - before.wood).toBe(Math.round((BUILDING.barracks.wood ?? 0) * SCRAP_SHARE));
    expect(G.ore.reduce((a, v) => a + v, 0)).toBe(groundBefore); // nothing left on the ground
    const hurt = addBuilding('barracks', 0, 20, 50, false);
    hurt.hp = hurt.maxhp / 2;
    const ore = G.credits[0];
    scrap(hurt);
    expect(G.credits[0] - ore).toBe(Math.round(BUILDING.barracks.cost * SCRAP_SHARE * 0.5));
  });

  it("won't start an order it can't pay for in full, and refunds all of it on cancel", () => {
    addBuilding('power', 0, 10, 82, false);
    G.credits[0] = 5000;
    G.wood[0] = (BUILDING.barracks.wood ?? 0) - 1;
    expect(startSite(0, 'barracks', 13, 82)).toBeNull();
    expect(G.credits[0]).toBe(5000);
    G.wood[0] = BUILDING.barracks.wood ?? 0;
    expect(startSite(0, 'barracks', 13, 82)).not.toBeNull();
    expect(G.wood[0]).toBe(0);
    expect(G.credits[0]).toBe(5000 - BUILDING.barracks.cost);
    run(4); // part built
    cancel(0, 'barracks');
    expect(G.wood[0]).toBe(BUILDING.barracks.wood ?? 0);
    expect(G.credits[0]).toBe(5000);
  });

  it("queues a player's order it can't pay for yet, and starts it once it can", () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    for (const w of G.ents.filter((e) => e.team === 0 && e.type === 'worker')) kill(w); // no income meanwhile
    addUnit('harvester', 0, 4 * TS, 60 * TS); // a unit that earns nothing, so the side isn't out of the game
    const cost = UNIT.swordsman.cost;
    G.credits[0] = cost - 1;
    expect(enqueue(0, 'swordsman')).toBe(false); // the computer's orders still need the money now
    expect(enqueue(0, 'swordsman', true)).toBe(true);
    expect(enqueue(0, 'swordsman', true)).toBe(true);
    const q = G.prod[0].infantry;
    expect(q.map((x) => x.paid)).toEqual([false, false]);
    expect(G.credits[0]).toBe(cost - 1); // nothing taken while it waits
    run(UNIT.swordsman.t + 1);
    expect(q[0].prog).toBe(0);
    expect(G.ents.some((e) => e.team === 0 && e.type === 'swordsman')).toBe(false);
    // cancelling a waiting order costs nothing and gives nothing back
    expect(cancel(0, 'swordsman')).toBe(true);
    expect(q).toHaveLength(1);
    expect(G.credits[0]).toBe(cost - 1);
    G.credits[0] = cost + 5;
    run(STEP);
    expect(q[0].paid).toBe(true);
    expect(G.credits[0]).toBe(5); // paid in full the moment it could start
    run(UNIT.swordsman.t + 1);
    expect(G.ents.some((e) => e.team === 0 && e.type === 'swordsman')).toBe(true);
    expect(q).toHaveLength(0);
  });

  it("lays out a player's site it can't pay for yet; Workers build it once it's paid", () => {
    addBuilding('power', 0, 10, 82, false);
    G.credits[0] = 5000;
    G.wood[0] = 0;
    expect(startSite(0, 'barracks', 13, 82)).toBeNull(); // the computer stops where the money runs out
    const site = startSite(0, 'barracks', 13, 82, 13, 82, true);
    expect(site?.unpaid).toBe(true);
    expect(G.credits[0]).toBe(5000);
    advanceSite(site!, 0.5);
    expect(site?.prog).toBe(0); // no building before it's paid for
    G.wood[0] = BUILDING.barracks.wood ?? 0;
    run(STEP);
    expect(site?.unpaid).toBe(false);
    expect(G.credits[0]).toBe(5000 - BUILDING.barracks.cost);
    expect(G.wood[0]).toBe(0);
    // an unpaid site called off gives nothing back
    G.wood[0] = 0;
    const other = startSite(0, 'barracks', 17, 82, 17, 82, true);
    expect(other?.unpaid).toBe(true);
    const ore = G.credits[0];
    cancel(0, 'barracks');
    expect(other?.dead).toBe(true);
    expect(G.credits[0]).toBe(ore);
    expect(G.wood[0]).toBe(0);
  });

  it('a site it cannot pay for keeps its Worker gathering; once paid, the Worker goes to build it', () => {
    addBuilding('power', 0, 10, 82, false);
    const w = G.ents.find((e) => e.team === 0 && e.type === 'worker')!;
    for (const o of G.ents) if (o !== w && o.team === 0 && o.type === 'worker') kill(o);
    orderHarvest(w, 6, 46);
    G.credits[0] = 5000;
    G.wood[0] = 0;
    const site = startSite(0, 'barracks', 13, 82, 13, 82, true)!;
    expect(site.unpaid).toBe(true);
    run(2);
    expect(w.order?.t).toBe('harvest'); // not pulled off to stand by the site
    G.wood[0] = BUILDING.barracks.wood ?? 0;
    run(STEP);
    expect(site.unpaid).toBe(false);
    expect(w.order?.t === 'heal' && w.order.tgt).toBe(site.id);
  });

  it('waiting sites are paid for in the order they went down', () => {
    addBuilding('power', 0, 10, 82, false);
    G.credits[0] = 0;
    G.wood[0] = 0;
    const big = startSite(0, 'barracks', 13, 82, 13, 82, true)!;
    const small = startSite(0, 'power', 17, 82, 17, 82, true)!;
    expect(big.unpaid && small.unpaid).toBe(true);
    // enough for the second but not the first: it waits its turn
    G.credits[0] = BUILDING.power.cost;
    G.wood[0] = BUILDING.power.wood ?? 0;
    run(STEP);
    expect(small.unpaid).toBe(true);
    G.credits[0] = BUILDING.barracks.cost + BUILDING.power.cost;
    G.wood[0] = (BUILDING.barracks.wood ?? 0) + (BUILDING.power.wood ?? 0);
    run(STEP);
    expect(big.unpaid).toBe(false);
    expect(small.unpaid).toBe(false);
  });

  it('turns ore into credits with the two free Workers', () => {
    addBuilding('power', 0, 10, 50, false);
    const workers = G.ents.filter((e) => e.team === 0 && e.type === 'worker').length;
    advanceSite(addBuilding('refinery', 0, 6, 46, true), 1);
    G.credits[0] = 0;
    run(90);
    expect(G.ents.filter((e) => e.team === 0 && e.type === 'worker')).toHaveLength(workers + 2);
    expect(G.ents.some((e) => e.team === 0 && e.type === 'harvester')).toBe(false);
    expect(G.credits[0]).toBeGreaterThan(1000);
  });

  it('gives a free Harvester instead in the Modern age, and still trains Workers to haul', () => {
    G.era[0] = 2;
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    const workers = G.ents.filter((e) => e.team === 0 && e.type === 'worker').length;
    advanceSite(addBuilding('refinery', 0, 6, 46, true), 1);
    run(20);
    expect(G.ents.filter((e) => e.team === 0 && e.type === 'harvester')).toHaveLength(1);
    expect(G.ents.filter((e) => e.team === 0 && e.type === 'worker')).toHaveLength(workers); // none come with it
    expect(available(0, 'infantry')).toContain('worker');
  });

  it('heals Workers like other people', () => {
    const w = addUnit('worker', 0, 20 * TS, 50 * TS);
    w.hp = w.maxhp / 2;
    run(10);
    expect(w.hp).toBeGreaterThan(w.maxhp / 2);
  });
});

describe('harvesters sharing a field', () => {
  function incomeWith(harvesters: number, seconds: number): { credits: number; clashes: number } {
    for (const a of ais) a.on = false;
    initWorld(1234);
    addBuilding('power', 0, 10, 50, false);
    G.era[0] = 2; // Modern: the refinery brings one harvester
    for (const w of G.ents.filter((e) => e.type === 'worker')) kill(w); // only harvesters dig here
    advanceSite(addBuilding('refinery', 0, 6, 46, true), 1);
    run(2);
    for (let i = 1; i < harvesters; i++) orderHarvest(addUnit('harvester', 0, (8 + i) * TS, 49.5 * TS), 14, 54);
    G.credits[0] = 0;
    let clashes = 0;
    for (let t = 0; t < seconds; t += 0.5) {
      run(0.5);
      const tiles = G.ents
        .filter((e) => e.type === 'harvester' && e.order?.t === 'harvest' && e.order.st === 'gather')
        .map((e) => (e.order?.t === 'harvest' ? `${e.order.tx},${e.order.ty}` : ''));
      clashes += tiles.length - new Set(tiles).size;
    }
    return { credits: G.credits[0], clashes };
  }

  it('never scoop the same tile, so more harvesters bring in more', () => {
    const one = incomeWith(1, 120), three = incomeWith(3, 120);
    expect(three.clashes).toBe(0);
    // three share the field nearest the drop-off, so each brings in a little less than one alone
    expect(three.credits).toBeGreaterThan(one.credits * 1.8);
  });
});

describe('a computer-vs-computer match', () => {
  it('builds bases, harvests and fights without errors', () => {
    ais[0].on = true;
    ais[1].on = true;
    initWorld(99);
    // gatherers lost to raids don't count against harvesting
    const raided = [0, 0], refineriesLost = [0, 0], income = [0, 0], prev = { ...hooks };
    onTestFinished(() => { Object.assign(hooks, prev); });
    hooks.killedBy = (v) => { if (isHarvester(v)) raided[v.team]++; if (v.type === 'refinery') refineriesLost[v.team]++; };
    hooks.income = (team, a) => { income[team] += a; };
    run(360); // room for the lumber mill and the wood that research needs
    expect(errors).toEqual([]);
    // someone researches past the Medieval age (a slow economy can take a few more minutes)
    for (let i = 0; i < 8 && !G.over && G.era.every((e) => e === 0); i++) run(30);
    expect(Math.max(...G.era)).toBeGreaterThan(0);
    for (const team of [0, 1]) {
      if (G.over && G.winner !== team) continue;
      const types = G.ents.filter((e) => e.team === team).map((e) => e.type);
      // built a refinery (it may since have been destroyed in the fighting)
      if (!refineriesLost[team]) expect(types).toContain('refinery');
      expect(income[team]).toBeGreaterThan(0);
      if (!raided[team]) expect(G.ents.some((e) => e.team === team && isHarvester(e))).toBe(true);
    }
    // nothing on the ground may stand inside a wall or building (fliers pass over them)
    for (const u of G.ents.filter((e) => e.kind === 'unit' && !isAir(e))) expect(G.blk[Math.floor(u.y / TS) * MW + Math.floor(u.x / TS)]).toBe(0);
  }, 45_000);
});
