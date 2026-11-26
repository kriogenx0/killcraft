import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { available, enqueue } from './production.ts';
import { cloakedFrom, deposits, drawingFrom, shardFor, shards, holderOf, isDrawing, syncWaygates, waygateLinked } from './aether.ts';
import { applySnapshot, encodeEnt, visibleTo } from '../net/snapshot.ts';
import { findPath, isJump } from './path.ts';
import { acquire, dealDamage, fire, MELEE_LAND, updProjs } from './combat.ts';
import type { WeaponType } from '../data/weapon.ts';
import { orderMove } from './order.ts';
import { START_YARDS } from '../data/map.ts';
import { AETHER_CARRY, AETHER_DRY, AETHER_PER_DEPOSIT, AETHER_RATE, AETHER_REGROW, CLOAK_DETECT } from '../data/aether.ts';
import { UNIT, UNIT_TYPES } from '../data/unit.ts';
import { TECH } from '../data/era.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

const errors: unknown[] = [];

beforeEach(() => {
  errors.length = 0;
  hooks.error = (e) => errors.push(e);
  G.reveal = true;
  G.demo = true;
  ais[0].on = false;
  ais[1].on = false;
  initWorld(1234);
});

afterEach(() => {
  ais[0].on = false;
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

/** Walk a unit up to its own Town Hall so it banks what it carries. */
function bringHome(u: Ent): void {
  const yard = G.ents.find((e) => !e.dead && e.team === u.team && e.type === 'yard');
  if (!yard) throw new Error('no yard');
  u.x = yard.x; u.y = yard.y + 2 * TS;
  u.order = null;
  run(1.1);
}

it('carries at most AETHER_CARRY per unit', () => {
  const d = deposits()[0], u = beside(d, 'swordsman', 0);
  const secs = AETHER_CARRY / AETHER_RATE + 10;
  run(secs);
  expect(u.ae).toBeCloseTo(AETHER_CARRY, 5);
  // drawn down by one load, and growing back slowly since
  expect(d.hp).toBeGreaterThanOrEqual(AETHER_PER_DEPOSIT - AETHER_CARRY);
  expect(d.hp).toBeLessThanOrEqual(AETHER_PER_DEPOSIT - AETHER_CARRY + AETHER_REGROW * secs + 0.01);
});

/** A unit standing right below a deposit. */
const beside = (d: Ent, type: 'swordsman' | 'rifleman', team: number): Ent => addUnit(type, team, d.x, d.y + TS);

describe('Aether', () => {
  it('puts two or three deposits in the middle ground, about as far from either base', () => {
    for (const seed of [1, 2, 3, 99, 1234, 4321]) {
      initWorld(seed);
      const ds = deposits();
      expect(ds.length).toBeGreaterThanOrEqual(2);
      expect(ds.length).toBeLessThanOrEqual(3);
      for (const d of ds) {
        expect(d.hp).toBe(AETHER_PER_DEPOSIT);
        const [a, b] = START_YARDS.map(([x, y]) => Math.hypot(d.tx - x - 1, d.ty - y - 1));
        expect(Math.min(a, b)).toBeGreaterThan(20);
        expect(Math.abs(a - b)).toBeLessThan(10);
        // something can stand next to it
        expect([[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => !G.blk[(d.ty + dy) * MW + d.tx + dx])).toBe(true);
      }
    }
  });

  it('hides hidden units and the Ward until a side finds Aether', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 12, 46, false);
    expect(available(0, 'infantry')).not.toContain('wraith');
    expect(available(0, 'tech')).not.toContain('ward');
    expect(enqueue(0, 'wraith')).toBe(false);
    const d = deposits()[0];
    const u = beside(d, 'swordsman', 0);
    run(3);
    expect(G.aetherFound[0]).toBe(false); // carried, not banked yet
    bringHome(u);
    expect(G.aetherFound[0]).toBe(true);
    expect(G.aetherFound[1]).toBe(false);
    expect(available(0, 'infantry')).toContain('wraith');
    expect(available(0, 'infantry')).not.toContain('hexblade'); // still the Medieval age
    expect(available(0, 'tech')).toContain('ward');
    expect(available(1, 'infantry')).not.toContain('wraith');
  });

  it('draws Aether only while one side holds a deposit, and runs dry, then slowly grows back', () => {
    const d = deposits()[0];
    const u = beside(d, 'swordsman', 0), v = beside(d, 'swordsman', 0); // a crowd draws no faster
    u.aeKeep = v.aeKeep = true; // carried home by hand here
    run(10.5);
    const carried = () => (u.ae ?? 0) + (v.ae ?? 0);
    expect(carried()).toBeCloseTo(AETHER_RATE * 10, -1);
    expect(carried()).toBeLessThanOrEqual(AETHER_RATE * 11);
    expect(G.aether[0]).toBe(0); // nothing counts until it's carried home
    bringHome(u); bringHome(v);
    expect(G.aether[0]).toBeCloseTo(AETHER_RATE * 10, -1);
    u.x = v.x = d.x; u.y = v.y = d.y + TS;
    // an enemy arrives: contested, nobody draws
    const foe = beside(d, 'swordsman', 1);
    foe.x += TS;
    expect(holderOf(d)).toBe(-1);
    const before = G.aether[0];
    for (let i = 0; i < 5 / STEP; i++) { foe.order = null; update(STEP); } // keep them from fighting
    if (holderOf(d) === -1) expect(G.aether[0]).toBe(before);
    foe.dead = true;
    // the rest, a load at a time
    for (let trip = 0; trip < 20 && d.hp >= AETHER_DRY; trip++) {
      run(AETHER_CARRY / AETHER_RATE + 1);
      for (const w of [u, v]) { const x = w.x, y = w.y; bringHome(w); w.x = x; w.y = y; }
    }
    // dry: nothing to draw, but it stays where the star fell and grows back
    expect(d.dead).toBe(false);
    expect(deposits()).not.toContain(d);
    expect(G.aether[0] + G.aether[1]).toBeGreaterThanOrEqual(AETHER_PER_DEPOSIT - 1);
    u.dead = v.dead = true;
    const dry = d.hp;
    run(60);
    expect(d.hp).toBeCloseTo(dry + AETHER_REGROW * 60, -1);
    expect(deposits()).toContain(d);
    expect(errors).toEqual([]);
  });

  it('shows a unit drawing Aether like an attack, offline and in snapshots', () => {
    const d = deposits()[0], u = beside(d, 'swordsman', 0), idle = addUnit('swordsman', 0, 5 * TS, 5 * TS);
    expect(isDrawing(u)).toBe(false);
    run(1.5);
    expect(isDrawing(u)).toBe(true);
    expect(drawingFrom(u)).toBe(d);
    expect(isDrawing(idle)).toBe(false);
    // the online client learns it from the snapshot flags
    const row = encodeEnt(u, true);
    u.drawT = 0;
    applySnapshot([row], [], () => {});
    expect(isDrawing(u)).toBe(true);
    // walking away stops the beam once the last draw fades
    u.x = 5 * TS; u.y = 8 * TS;
    run(2);
    expect(isDrawing(u)).toBe(false);
  });

  it('drops carried Aether when a carrier dies, and a Worker fetches it home', () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard') as Ent;
    const carrier = addUnit('swordsman', 0, yard.x + 6 * TS, yard.y - 4 * TS);
    carrier.ae = 30;
    dealDamage(carrier, 9999, null);
    expect(carrier.dead).toBe(true);
    const [s] = shards();
    expect(s).toBeDefined();
    expect(s.hp).toBeCloseTo(30, 0);
    expect(G.blk[s.ty * MW + s.tx]).toBe(0); // it doesn't block the way
    // an idle Worker nearby goes and picks it up, then takes it home and banks it
    for (const e of G.ents) if (e.kind === 'unit' && e.team === 0) e.order = null;
    const before = G.aether[0] ?? 0;
    addUnit('worker', 0, s.x - 3 * TS, s.y);
    let picked = false;
    for (let i = 0; i < 60 / STEP && (G.aether[0] ?? 0) <= before; i++) { update(STEP); picked ||= G.ents.some((e) => e.type === 'worker' && e.team === 0 && (e.ae ?? 0) > 0); } // the new Worker, or one of the side's own
    expect(picked).toBe(true);
    expect(shards()).toHaveLength(0);
    expect(G.aether[0]).toBeCloseTo(before + 30, 0);
    expect(errors).toEqual([]);
  });

  it('sends an Auto Worker that just banked a load out of its way for dropped Aether, then back to work', () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard') as Ent;
    for (const e of G.ents) if (e.kind === 'unit' && e.team === 0) e.dead = true; // only this Worker to go for it
    const carrier = addUnit('swordsman', 0, yard.x + 11 * TS, yard.y);
    carrier.ae = 20;
    dealDamage(carrier, 9999, null);
    expect(shards()).toHaveLength(1);
    // a Worker on its way home with ore: past the idle-fetch range, but within the detour range
    const w = addUnit('worker', 0, yard.x + 2.5 * TS, yard.y);
    w.carry = 30; w.cargo = 'ore';
    w.order = { t: 'harvest', st: 'ret', tx: w.x / TS | 0, ty: w.y / TS | 0, wait: 0, auto: true };
    const before = G.aether[0] ?? 0;
    let picked = false;
    for (let i = 0; i < 60 / STEP && (G.aether[0] ?? 0) <= before; i++) { update(STEP); picked ||= G.ents.some((e) => e.type === 'worker' && e.team === 0 && (e.ae ?? 0) > 0); } // the new Worker, or one of the side's own
    expect(picked).toBe(true);
    expect(G.aether[0]).toBeCloseTo(before + 20, 0);
    run(6);
    expect(w.order?.t).toBe('harvest'); // and back to gathering
    expect(errors).toEqual([]);
  });

  it('comes first: an idle Worker fetches dropped Aether from a way off, and only one goes', () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard') as Ent;
    for (const e of G.ents) if (e.kind === 'unit' && e.team === 0) e.dead = true;
    const carrier = addUnit('swordsman', 0, yard.x + 15 * TS, yard.y - 10 * TS);
    carrier.ae = 20;
    dealDamage(carrier, 9999, null);
    expect(shards()).toHaveLength(1);
    const a = addUnit('worker', 0, yard.x, yard.y + 3 * TS), b = addUnit('worker', 0, yard.x + TS, yard.y + 3 * TS);
    run(2);
    const going = [a, b].filter((w) => w.order?.t === 'move');
    expect(going).toHaveLength(1);
    const before = G.aether[0] ?? 0;
    for (let i = 0; i < 120 / STEP && (G.aether[0] ?? 0) <= before; i++) update(STEP);
    expect(G.aether[0]).toBeCloseTo(before + 20, 0);
  });

  it('leaves dropped Aether a side can\'t see, or that an armed enemy guards', () => {
    G.reveal = false;
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard') as Ent;
    for (const e of G.ents) if (e.kind === 'unit' && e.team === 0) e.order = null;
    const carrier = addUnit('swordsman', 1, yard.x + 7 * TS, yard.y);
    carrier.ae = 20;
    dealDamage(carrier, 9999, null);
    const [s] = shards();
    // nobody on side 0 sees it: it isn't sent to side 0, and a Worker with short sight doesn't go for it
    G.sight[0].fill(1);
    expect(visibleTo(s, 0)).toBe(false);
    G.sight[0][s.ty * MW + s.tx] = 2;
    expect(visibleTo(s, 0)).toBe(true);
    // seen, but with an enemy soldier standing over it a Worker keeps away
    const guard = addUnit('swordsman', 1, s.x + TS, s.y);
    guard.order = null;
    const w = addUnit('worker', 0, s.x - 4 * TS, s.y);
    expect(shardFor(w)).toBeNull();
    guard.dead = true;
    expect(shardFor(w)).toBe(s);
  });

  it('lets any unit that walks over dropped Aether pick it up, up to what it can carry', () => {
    const u = addUnit('swordsman', 1, 66 * TS, 26 * TS);
    u.ae = AETHER_CARRY - 10;
    const v = addUnit('knight', 0, 66 * TS, 26 * TS);
    v.ae = 25;
    dealDamage(v, 9999, null);
    run(0.1);
    expect(u.ae).toBeCloseTo(AETHER_CARRY, 0);
    expect(shards()[0]?.hp).toBeCloseTo(15, 0);
  });

  it('spends Aether on hidden units, and can\'t start one without it', () => {
    addBuilding('power', 0, 10, 50, false);
    addBuilding('barracks', 0, 12, 46, false);
    G.aetherFound[0] = true;
    G.aether[0] = 0;
    G.credits[0] = G.wood[0] = 5000;
    expect(enqueue(0, 'wraith')).toBe(false);
    G.aether[0] = 100;
    expect(enqueue(0, 'wraith')).toBe(true);
    run(UNIT.wraith.t + 2);
    expect(G.ents.some((e) => e.type === 'wraith' && e.team === 0)).toBe(true);
    expect(G.aether[0]).toBeCloseTo(100 - (UNIT.wraith.aether ?? 0), 0);
  });

  it('keeps hidden units close to their regular unit', () => {
    for (const t of UNIT_TYPES) {
      const d = UNIT[t];
      if (!d.aether || d.beast || d.magic || d.giant || d.hatches || d.hatched) continue; // creatures of myth, spellcasters, the Titan and the Mystery Egg are their own thing
      const base = UNIT[d.look ?? t];
      expect(d.look).toBeDefined();
      expect(d.era).toBeGreaterThanOrEqual(base.era);
      expect(d.hp).toBeLessThanOrEqual(base.hp * 1.15);
      expect(d.aether).toBeLessThanOrEqual(100);
    }
  });

  it('lets the Wraith Knight pierce armor that blunts a plain knight', () => {
    const blow = (type: 'knight' | 'wraith'): number => {
      const tank = addUnit('tank', 1, 20 * TS, 20 * TS), u = addUnit(type, 0, 20 * TS - 10, 20 * TS);
      fire(u, UNIT[type].weapon as WeaponType, tank);
      updProjs(MELEE_LAND); // the lance lands
      const lost = tank.maxhp - tank.hp;
      tank.dead = u.dead = true;
      return lost;
    };
    const knight = blow('knight'), wraith = blow('wraith');
    expect(wraith).toBeGreaterThan(knight * 1.5);
  });

  it('slows what a Hexblade hits, for a moment', () => {
    // two swordsmen walk side by side; one has just been hexed from far away
    const hex = addUnit('hexblade', 0, 67 * TS, 4 * TS), a = addUnit('swordsman', 1, 65 * TS, 22 * TS), b = addUnit('swordsman', 1, 70 * TS, 22 * TS);
    fire(hex, 'hexrifle', a);
    hex.dead = true;
    orderMove(a, 65, 37);
    orderMove(b, 70, 37);
    const y0 = a.y;
    for (let i = 0; i < 1 / STEP; i++) update(STEP);
    expect(a.y - y0).toBeLessThan((b.y - y0) * 0.7);
    run(1);
    const ya = a.y, yb = b.y;
    for (let i = 0; i < 0.5 / STEP; i++) update(STEP);
    expect(a.y - ya).toBeGreaterThan((b.y - yb) * 0.85); // back to full speed
  });

  it('hides a Phantom Jeep from enemies until it fires or they come close', () => {
    const jeep = addUnit('phantom', 0, 30 * TS, 20 * TS);
    const far = addUnit('rifleman', 1, 30 * TS + 3 * TS, 20 * TS);
    expect(cloakedFrom(jeep, 1)).toBe(true);
    expect(cloakedFrom(jeep, 0)).toBe(false);
    expect(acquire(far, 6)).not.toBe(jeep);
    const near = addUnit('rifleman', 1, 30 * TS + (CLOAK_DETECT - 0.5) * TS, 20 * TS);
    expect(cloakedFrom(jeep, 1)).toBe(false);
    near.dead = true;
    expect(cloakedFrom(jeep, 1)).toBe(true);
    jeep.shownT = G.gameT + 1;
    expect(cloakedFrom(jeep, 1)).toBe(false);
  });

  it('makes buildings take less damage after the Aether Ward', () => {
    const a = addBuilding('power', 0, 10, 50, false), b = addBuilding('power', 1, 50, 10, false);
    G.ward[1] = true;
    dealDamage(a, 100, null);
    dealDamage(b, 100, null);
    expect(a.maxhp - a.hp).toBe(100);
    expect(b.maxhp - b.hp).toBe(90);
    expect(TECH.ward.aether).toBeGreaterThan(0);
  });

  it('reveals the Aether structures once found, and allows only one pair of Waygates', () => {
    expect(available(0, 'structure')).not.toContain('shrine');
    G.aetherFound[0] = true;
    expect(available(0, 'structure')).toEqual(expect.arrayContaining(['shrine', 'wardstone']));
    expect(available(0, 'structure')).not.toContain('waygate'); // World War
    G.era[0] = 1;
    expect(available(0, 'structure')).toContain('waygate');
    addBuilding('waygate', 0, 10, 40, false);
    addBuilding('waygate', 0, 14, 40, false);
    expect(available(0, 'structure')).not.toContain('waygate');
  });

  it('heals units near a Star Shrine, machines included, but not the enemy', () => {
    addBuilding('shrine', 0, 20, 40, false);
    const tank = addUnit('tank', 0, 21 * TS, 43 * TS), foe = addUnit('tank', 1, 22 * TS, 43 * TS), far = addUnit('tank', 0, 40 * TS, 43 * TS);
    for (const u of [tank, foe, far]) u.hp = u.maxhp / 2;
    for (let t = 0; t < 10; t++) { for (const u of [tank, foe, far]) u.order = null; G.oreT = 0; update(STEP); }
    expect(tank.hp).toBeGreaterThan(tank.maxhp / 2);
    expect(foe.hp).toBeLessThanOrEqual(foe.maxhp / 2);
    expect(far.hp).toBe(far.maxhp / 2);
  });

  it('lets a Ward Stone see cloaked jeeps from afar', () => {
    const jeep = addUnit('phantom', 0, 30 * TS, 20 * TS);
    expect(cloakedFrom(jeep, 1)).toBe(true);
    const stone = addBuilding('wardstone', 1, 30, 25, false);
    expect(cloakedFrom(jeep, 1)).toBe(false);
    stone.dead = true;
    expect(cloakedFrom(jeep, 1)).toBe(true);
  });

  it('links two Waygates into a shortcut only their side can use', () => {
    G.portals = []; G.warp.fill(-1); G.warpTeam.fill(-1);
    // clear two spots far apart
    for (const [x0, y0] of [[8, 30], [50, 30]]) for (let y = y0 - 2; y < y0 + 5; y++) for (let x = x0 - 2; x < x0 + 5; x++) { G.terr[y * MW + x] = 0; G.blk[y * MW + x] = 0; }
    const a = addBuilding('waygate', 0, 8, 30, false);
    syncWaygates();
    expect(waygateLinked(a)).toBe(false);
    const b = addBuilding('waygate', 0, 50, 30, false);
    syncWaygates();
    expect(waygateLinked(a) && waygateLinked(b)).toBe(true);
    const [w] = G.waygates;
    const own = findPath(w.a[0], w.a[1] + 1, w.b[0], w.b[1] + 1, 0), theirs = findPath(w.a[0], w.a[1] + 1, w.b[0], w.b[1] + 1, 1);
    const jumps = (p: [number, number][]) => p.some((t, i) => i > 0 && isJump(p[i - 1], t));
    expect(jumps([[w.a[0], w.a[1] + 1], ...own])).toBe(true);
    expect(own.length).toBeLessThan(6);
    expect(jumps([[w.a[0], w.a[1] + 1], ...theirs])).toBe(false);
    // knock one down: the link is gone
    b.dead = true;
    syncWaygates();
    expect(G.waygates).toHaveLength(0);
    expect(G.warp[w.a[1] * MW + w.a[0]]).toBe(-1);
  });
});
