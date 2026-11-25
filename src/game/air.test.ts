import { beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { MH, MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { orderAttack, orderMove } from './order.ts';
import { canAttack } from './combat.ts';
import { available } from './production.ts';
import { UNIT, type UnitType } from '../data/unit.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP; i++) update(STEP);
}

/** A row of open ground long enough for a duel. */
function openGround(len: number): [number, number] {
  for (let ty = 3; ty < MH - 3; ty++)
    for (let tx = 3; tx < MW - len - 3; tx++) {
      let ok = true;
      for (let y = ty - 2; y <= ty + 2 && ok; y++) for (let x = tx - 2; x <= tx + len + 2 && ok; x++) ok = !G.blk[y * MW + x];
      if (ok) return [(tx + 0.5) * TS, (ty + 0.5) * TS];
    }
  throw new Error('no open ground');
}

function duel(a: UnitType, b: UnitType, seconds = 30, gap = 4): [Ent, Ent] {
  const [x, y] = openGround(gap + 1);
  const u = addUnit(a, 0, x, y), v = addUnit(b, 1, x + gap * TS, y);
  orderAttack(u, v);
  orderAttack(v, u);
  run(seconds);
  return [u, v];
}

describe('the air war', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    G.reveal = true;
    hooks.error = (e) => { throw e; };
    initWorld(1234);
    for (const e of G.ents) if (e.kind === 'unit') e.dead = true;
    G.ents = G.ents.filter((e) => !e.dead);
  });

  it('swords, cannons and catapults can’t reach aircraft; bows, guns and rockets can', () => {
    const [x, y] = openGround(4), heli = addUnit('helicopter', 1, x, y);
    for (const t of ['swordsman', 'knight', 'tank', 'heavy', 'catapult'] as UnitType[]) expect(canAttack(addUnit(t, 0, x, y), heli)).toBe(false);
    for (const t of ['crossbowman', 'rifleman', 'rocket', 'jeep', 'biplane', 'helicopter'] as UnitType[]) expect(canAttack(addUnit(t, 0, x, y), heli)).toBe(true);
    // a balloon drops bombs: it can't fight other aircraft
    expect(canAttack(addUnit('balloon', 0, x, y), heli)).toBe(false);
  });

  it('a swordsman can’t touch a balloon bombing it', () => {
    const [balloon, sword] = duel('balloon', 'swordsman', 40, 2);
    expect(sword.dead).toBe(true);
    expect(balloon.hp).toBe(balloon.maxhp);
  });

  it('crossbowmen bring down a balloon', () => {
    const [x, y] = openGround(4);
    const b = addUnit('balloon', 1, x + 3 * TS, y);
    const xs = [0, 1, 2].map((i) => addUnit('crossbowman', 0, x, y + (i - 1) * 14));
    for (const u of xs) orderAttack(u, b);
    run(40);
    expect(b.dead).toBe(true);
  });

  it('planes shoot down War Balloons, ordered or on their own', () => {
    for (const t of ['biplane', 'fighter'] as UnitType[]) {
      const [x, y] = openGround(6);
      const ordered = addUnit('balloon', 1, x + 5 * TS, y), plane = addUnit(t, 0, x, y);
      orderAttack(plane, ordered);
      run(40);
      expect(ordered.dead).toBe(true);
      // an idle plane goes for a balloon that drifts into sight
      const [x2, y2] = openGround(6);
      const near = addUnit('balloon', 1, x2 + 4 * TS, y2), idle = addUnit(t, 0, x2, y2);
      run(40);
      expect(near.dead).toBe(true);
      plane.dead = idle.dead = true;
    }
  });

  it('a helicopter beats a battle tank that can’t shoot back', () => {
    const [heli, tank] = duel('helicopter', 'tank', 40);
    expect(tank.dead).toBe(true);
    expect(heli.hp).toBe(heli.maxhp);
  });

  it('a squad of rocket soldiers shoots down a helicopter', () => {
    const [x, y] = openGround(6);
    const heli = addUnit('helicopter', 1, x + 5 * TS, y);
    const rs = [0, 1, 2].map((i) => addUnit('rocket', 0, x, y + (i - 1) * 14));
    for (const u of rs) orderAttack(u, heli);
    orderAttack(heli, rs[0]);
    run(30);
    expect(heli.dead).toBe(true);
    expect(rs.filter((u) => !u.dead).length).toBeGreaterThan(0);
  });

  it('a flak cannon downs a biplane and ignores tanks', () => {
    const [x, y] = openGround(6);
    const f = addBuilding('flak', 0, Math.floor(x / TS), Math.floor(y / TS) - 1, false);
    const plane = addUnit('biplane', 1, x + 4 * TS, y), tank = addUnit('tank', 1, x + 3 * TS, y + TS);
    run(20);
    expect(plane.dead).toBe(true);
    expect(tank.hp).toBe(tank.maxhp);
    expect(f.dead).toBe(false);
  });

  it('aircraft fly straight over buildings', () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    const from = { x: yard.x - 5 * TS, y: yard.y }, to = { tx: Math.floor(yard.x / TS) + 5, ty: Math.floor(yard.y / TS) };
    const heli = addUnit('helicopter', 0, from.x, from.y);
    orderMove(heli, to.tx, to.ty);
    let crossed = false;
    for (let i = 0; i < 6 / STEP; i++) {
      update(STEP);
      if (Math.abs(heli.x - yard.x) < TS && Math.abs(heli.y - yard.y) < TS) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(Math.hypot(heli.x - (to.tx + 0.5) * TS, heli.y - (to.ty + 0.5) * TS)).toBeLessThan(TS);
  });

  it('the Airfield builds balloons first, then biplanes and helicopters with each age', () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    addBuilding('airfield', 0, yard.tx + 4, yard.ty, false);
    for (const [era, want] of [[1, ['balloon', 'biplane']], [2, ['balloon', 'biplane', 'helicopter', 'drone', 'fighter', 'striker']]] as const) {
      G.era[0] = era;
      expect(available(0, 'air')).toEqual(want);
    }
  });

  it('prices aircraft by what they are made of and burn', () => {
    // a balloon is silk, wicker and a wood fire: no oil
    expect(UNIT.balloon.wood ?? 0).toBeGreaterThan(0);
    expect(UNIT.balloon.oil ?? 0).toBe(0);
    // a biplane is a wood-and-canvas frame with an engine that burns oil
    expect(UNIT.biplane.wood ?? 0).toBeGreaterThan(0);
    expect(UNIT.biplane.oil ?? 0).toBeGreaterThan(0);
    // a helicopter is all metal and burns oil: no wood
    expect(UNIT.helicopter.wood ?? 0).toBe(0);
    expect(UNIT.helicopter.oil ?? 0).toBeGreaterThan(0);
    expect(UNIT.helicopter.cost).toBeGreaterThan(0);
  });

  describe('jets', () => {
    it('fighters only hit aircraft; strike jets only hit the ground', () => {
      const [x, y] = openGround(4), heli = addUnit('helicopter', 1, x, y), tank = addUnit('tank', 1, x, y + TS);
      const f = addUnit('fighter', 0, x, y), s = addUnit('striker', 0, x, y);
      expect(canAttack(f, heli)).toBe(true);
      expect(canAttack(f, tank)).toBe(false);
      expect(canAttack(s, tank)).toBe(true);
      expect(canAttack(s, heli)).toBe(false);
    });

    it('a jet can’t hover: with nothing to do it circles near where it is', () => {
      const [x, y] = openGround(4), f = addUnit('fighter', 0, x, y);
      let moved = 0, far = 0, px = f.x, py = f.y;
      for (let i = 0; i < 10 / STEP; i++) {
        update(STEP);
        moved += Math.hypot(f.x - px, f.y - py); px = f.x; py = f.y;
        far = Math.max(far, Math.hypot(f.x - x, f.y - y));
      }
      expect(moved).toBeGreaterThan(40 * TS);
      expect(far).toBeLessThan(12 * TS);
    });

    it('a jet sent somewhere gets there and circles over it', () => {
      const [x, y] = openGround(4), s = addUnit('striker', 0, x, y);
      s.stance = 'passive';
      const gx = Math.floor(x / TS) + 20, gy = Math.floor(y / TS);
      orderMove(s, gx, gy);
      run(8);
      expect(s.order).toBe(null);
      expect(s.moving).toBe(true);
      expect(Math.hypot(s.x - (gx + 0.5) * TS, s.y - (gy + 0.5) * TS)).toBeLessThan(10 * TS);
    });

    it('a fighter shoots down a helicopter and drones', () => {
      const [x0, y0] = openGround(7);
      const heli = addUnit('helicopter', 1, x0, y0), f = addUnit('fighter', 0, x0 + 6 * TS, y0);
      orderAttack(heli, f); orderAttack(f, heli);
      run(30);
      expect(heli.dead).toBe(true);
      expect(f.dead).toBe(false);
      const [x, y] = openGround(6), fighter = addUnit('fighter', 0, x, y);
      const drones = [0, 1, 2].map((i) => addUnit('drone', 1, x + 6 * TS, y + (i - 1) * 20));
      for (const d of drones) orderAttack(d, fighter);
      run(40);
      expect(drones.every((d) => d.dead)).toBe(true);
    });

    it('a strike jet makes bombing runs that wreck a building', () => {
      const yard = G.ents.find((e) => e.team === 1 && e.type === 'yard');
      if (!yard) throw new Error('no yard');
      const s = addUnit('striker', 0, yard.x - 12 * TS, yard.y);
      orderAttack(s, yard);
      let drops = 0;
      hooks.fired = (src) => { if (src === s) drops++; };
      run(30);
      expect(drops).toBeGreaterThan(2);
      expect(yard.hp).toBeLessThan(yard.maxhp * 0.5);
    });
  });
});
