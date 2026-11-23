import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { G, hooks, isHarvester } from './state.ts';
import { MW, STEP, TREE, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, power } from './entity.ts';
import { orderHarvest, orderHaul } from './order.ts';
import { available, cancel, enqueue, placeReady, readyStructure } from './production.ts';
import { canPlace, scrap } from './building.ts';
import { oilLeft, oilRate, salvageOf, treesNear, woodRate } from './economy.ts';
import { dealDamage } from './combat.ts';
import { OIL_WELLS } from '../data/map.ts';
import { TREE_WOOD } from '../data/economy.ts';
import { START_CREDITS, START_UNITS } from '../data/map.ts';
import { UNIT } from '../data/unit.ts';
import { BUILDING, SCRAP_SHARE } from '../data/building.ts';
import { HEAL_RATE, HOSPITAL_HEAL } from '../data/era.ts';
import { mulberry32 } from '../util/math.ts';

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

  it('pays the whole price up front and places a finished structure', () => {
    expect(available(0, 'structure')).toEqual(['power', 'mill', 'palisade', 'stonewall']);
    expect(enqueue(0, 'power')).toBe(true);
    expect(G.credits[0]).toBe(START_CREDITS - BUILDING.power.cost);
    run(10);
    expect(readyStructure(0)).toBe('power');
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    // first free spot next to the yard (units standing there block placement)
    const spots = [[3, -2], [-2, 0], [0, -2], [0, 3], [3, 3], [-2, 3]].map(([dx, dy]) => [yard.tx + dx, yard.ty + dy]);
    const spot = spots.find(([x, y]) => canPlace(x, y, 2, 0));
    expect(spot).toBeDefined();
    const b = placeReady(0, spot?.[0] ?? 0, spot?.[1] ?? 0);
    expect(b?.type).toBe('power');
    run(2);
    expect(power(0).made).toBeGreaterThan(0);
    expect(available(0, 'structure')).toContain('refinery');
  });

  it('starts in the Medieval age with medieval troops only', () => {
    expect(G.era).toEqual([0, 0]);
    for (const t of START_UNITS) expect(UNIT[t].era).toBe(0);
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    expect(available(0, 'infantry')).toEqual(['swordsman', 'crossbowman', 'knight', 'worker']);
    expect(available(0, 'infantry')).not.toContain('harvester');
    expect(available(0, 'structure')).not.toContain('turret');
    expect(enqueue(0, 'rifleman')).toBe(false);
  });

  it('finds oil, builds the Engine Works to reach World War, and pays oil for Modern', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    addBuilding('refinery', 0, 6, 46, false);
    expect(available(0, 'structure')).toContain('derrick');
    expect(available(0, 'structure')).not.toContain('works'); // needs oil first
    expect(available(0, 'tech')).toEqual([]);
    addBuilding('derrick', 0, 16, 50, false);
    expect(available(0, 'structure')).toContain('works');
    const works = addBuilding('works', 0, 19, 50, true);
    expect(available(0, 'structure')).not.toContain('works'); // one at a time
    expect(G.era[0]).toBe(0);
    run(5);
    expect(works.done).toBe(true);
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
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    G.credits[0] = 5000;
    expect(enqueue(0, 'heal1')).toBe(false); // needs a Hospital
    addBuilding('hospital', 0, 16, 50, false);
    expect(enqueue(0, 'heal2')).toBe(false); // needs the first level, and World War
    expect(enqueue(0, 'heal1')).toBe(true);
    expect(enqueue(0, 'heal1')).toBe(false); // one research at a time
    run(30);
    expect(G.heal[0]).toBe(1);
    expect(available(0, 'hospital')).toEqual([]);
    G.era[0] = 1;
    expect(available(0, 'hospital')).toEqual(['heal2']);
    const s = addUnit('swordsman', 0, 20 * TS, 50 * TS), foe = addUnit('swordsman', 1, 20 * TS, 60 * TS);
    s.hp = foe.hp = 10;
    run(10);
    expect(s.hp - 10).toBeCloseTo(s.maxhp * HEAL_RATE[1] * HOSPITAL_HEAL * 10, 0);
    expect(foe.hp - 10).toBeCloseTo(foe.maxhp * HEAL_RATE[0] * 10, 0);
  });

  it('heals faster with a Hospital, which also lets the Barracks train Medics', () => {
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

  it('stalls without credits instead of going into debt', () => {
    G.credits[0] = 50;
    enqueue(0, 'power');
    run(20);
    expect(G.credits[0]).toBeGreaterThanOrEqual(0);
    expect(readyStructure(0)).toBeNull();
  });

  it('cuts wood with a lumber mill next to trees, and none without', () => {
    // find a free 2x2 spot by the woods and one in the open
    let woods: [number, number] | null = null, open: [number, number] | null = null;
    for (let y = 2; y < 60 && (!woods || !open); y++)
      for (let x = 2; x < 60; x++) {
        let free = true;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (G.blk[(y + dy) * MW + x + dx]) free = false;
        if (!free) continue;
        const n = treesNear(x, y, 2);
        if (!woods && n >= 10) woods = [x, y];
        if (!open && n === 0) open = [x, y];
      }
    if (!woods || !open) throw new Error('no test spots');
    addBuilding('mill', 0, open[0], open[1], false);
    expect(woodRate(0)).toBe(0);
    addBuilding('mill', 0, woods[0], woods[1], false);
    expect(woodRate(0)).toBeGreaterThan(0);
    G.wood[0] = 0;
    run(10);
    // the mill fills its own store; nothing is banked until a Worker carries it home
    const mill = G.ents.find((e) => e.type === 'mill' && e.tx === woods[0] && e.ty === woods[1]);
    if (!mill) throw new Error('no mill');
    expect(mill.carry).toBeGreaterThan(woodRate(0) * 8);
    expect(G.wood[0]).toBe(0);
    const w = addUnit('worker', 0, mill.x, mill.y + 2 * TS);
    const before = mill.carry;
    orderHaul(w, mill);
    run(120);
    expect(G.wood[0]).toBeGreaterThan(before * 0.9);
    expect(w.cargo).toBe('wood');
  });

  it('pumps oil from a well until it runs dry, and nothing away from a well', () => {
    const [wx, wy] = OIL_WELLS[0];
    G.oil[0] = 0;
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
    expect(far.carry).toBe(0); // only the derrick on the well pumps
    expect(oilLeft(d)).toBeCloseTo(start - d.carry, 0);
    // drain it: the well never refills
    G.oilField.fill(0);
    const before = d.carry;
    run(5);
    expect(d.carry).toBe(before);
    expect(oilRate(0)).toBe(0);
    // a Worker carries the store to the Construction Yard
    const w = addUnit('worker', 0, d.x, d.y + 2 * TS);
    orderHaul(w, d);
    run(150);
    expect(d.carry).toBeLessThan(1);
    expect(G.oil[0]).toBeCloseTo(before, 0);
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

  it('scrapping a building refunds nothing but leaves ore on the ground to carry home', () => {
    const b = addBuilding('barracks', 0, 20, 40, false);
    const before = { ore: G.credits[0], wood: G.wood[0] }, groundBefore = G.ore.reduce((a, v) => a + v, 0);
    scrap(b);
    expect(b.dead).toBe(true);
    expect(G.credits[0]).toBe(before.ore);
    expect(G.wood[0]).toBe(before.wood);
    expect(G.ore.reduce((a, v) => a + v, 0) - groundBefore).toBeCloseTo(BUILDING.barracks.cost * SCRAP_SHARE, -1);
  });

  it("won't start an order it can't pay for in full, and refunds all of it on cancel", () => {
    addBuilding('power', 0, 10, 50, false);
    G.credits[0] = 5000;
    G.wood[0] = (BUILDING.barracks.wood ?? 0) - 1;
    expect(enqueue(0, 'barracks')).toBe(false);
    expect(G.credits[0]).toBe(5000);
    G.wood[0] = BUILDING.barracks.wood ?? 0;
    expect(enqueue(0, 'barracks')).toBe(true);
    expect(G.wood[0]).toBe(0);
    expect(G.credits[0]).toBe(5000 - BUILDING.barracks.cost);
    run(4); // part built
    cancel(0, 'barracks');
    expect(G.wood[0]).toBe(BUILDING.barracks.wood ?? 0);
    expect(G.credits[0]).toBe(5000);
  });

  it('turns ore into credits with the two free Workers', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('refinery', 0, 6, 46, true);
    G.credits[0] = 0;
    run(90);
    expect(G.ents.filter((e) => e.team === 0 && e.type === 'worker')).toHaveLength(2);
    expect(G.ents.some((e) => e.team === 0 && e.type === 'harvester')).toBe(false);
    expect(G.credits[0]).toBeGreaterThan(1000);
  });

  it('gives a free Harvester instead in the Modern age, and still trains Workers to haul', () => {
    G.era[0] = 2;
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 13, 50, false);
    addBuilding('refinery', 0, 6, 46, true);
    run(20);
    expect(G.ents.filter((e) => e.team === 0 && e.type === 'harvester')).toHaveLength(1);
    expect(G.ents.some((e) => e.team === 0 && e.type === 'worker')).toBe(false);
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
    addBuilding('refinery', 0, 6, 46, true);
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
    expect(three.credits).toBeGreaterThan(one.credits * 2);
  });
});

describe('a computer-vs-computer match', () => {
  it('builds bases, harvests and fights without errors', () => {
    ais[0].on = true;
    ais[1].on = true;
    initWorld(99);
    // gatherers lost to raids don't count against harvesting
    const raided = [0, 0], income = [0, 0], prev = { ...hooks };
    onTestFinished(() => { Object.assign(hooks, prev); });
    hooks.killedBy = (v) => { if (isHarvester(v)) raided[v.team]++; };
    hooks.income = (team, a) => { income[team] += a; };
    run(360); // room for the lumber mill and the wood that research needs
    expect(errors).toEqual([]);
    // someone researches past the Medieval age (a slow economy can take a few more minutes)
    for (let i = 0; i < 8 && !G.over && G.era.every((e) => e === 0); i++) run(30);
    expect(Math.max(...G.era)).toBeGreaterThan(0);
    for (const team of [0, 1]) {
      if (G.over && G.winner !== team) continue;
      const types = G.ents.filter((e) => e.team === team).map((e) => e.type);
      expect(types).toContain('refinery');
      expect(income[team]).toBeGreaterThan(0);
      if (!raided[team]) expect(G.ents.some((e) => e.team === team && isHarvester(e))).toBe(true);
    }
    // nothing may stand inside a wall or building
    for (const u of G.ents.filter((e) => e.kind === 'unit')) expect(G.blk[Math.floor(u.y / TS) * MW + Math.floor(u.x / TS)]).toBe(0);
  });
});
