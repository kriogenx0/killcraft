// Medics see to their own side's wounded first, and patch up a teammate's units when none of their own need it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks } from './state.ts';
import { STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit } from './entity.ts';
import { applyCommand } from './command.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261126));
  hooks.error = (e) => { throw e; };
  G.demo = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const a of ais) a.on = false;
});

/** Four players, 0 and 2 against 1 and 3; a quiet spot beside player 0's base. */
function setup() {
  initWorld(7, 4, { ally: [0, 1, 0, 1] });
  for (const a of ais) a.on = false;
  for (const e of G.ents) if (e.type === 'worker') e.dead = true; // they'd patch the troops up
  const home = G.ents.find((e) => e.team === 0 && e.type === 'yard');
  if (!home) throw new Error('no yard');
  return { x: home.x + 5 * TS, y: home.y + 5 * TS };
}

describe('medics', () => {
  it("heal a teammate's wounded when none of their own are hurt", () => {
    const p = setup();
    const m = addUnit('medic', 0, p.x, p.y), friend = addUnit('swordsman', 2, p.x + 3 * TS, p.y);
    friend.hp = 20;
    run(10);
    expect(friend.hp).toBeGreaterThan(20 + 30);
    expect(m.dead).toBe(false);
  });

  it("never heal the enemy's", () => {
    const p = setup();
    addUnit('medic', 0, p.x, p.y);
    const foe = addUnit('swordsman', 1, p.x + 3 * TS, p.y);
    foe.stance = 'passive';
    foe.hp = 20;
    run(6);
    expect(foe.hp).toBeLessThan(20 + 15);
  });

  it('see to their own wounded before a teammate who is worse off', () => {
    const p = setup();
    const m = addUnit('medic', 0, p.x, p.y);
    const friend = addUnit('swordsman', 2, p.x + 3 * TS, p.y), mine = addUnit('swordsman', 0, p.x - 3 * TS, p.y);
    friend.hp = 10;
    mine.hp = 40;
    run(1);
    expect(m.order?.t === 'heal' && m.order.tgt).toBe(mine.id);
  });

  it("leave a teammate's unit for one of their own who gets hurt", () => {
    const p = setup();
    const m = addUnit('medic', 0, p.x, p.y);
    const friend = addUnit('swordsman', 2, p.x + 3 * TS, p.y), mine = addUnit('swordsman', 0, p.x - 3 * TS, p.y);
    friend.hp = 10;
    run(1);
    expect(m.order?.t === 'heal' && m.order.tgt).toBe(friend.id);
    mine.hp = 40;
    run(1);
    expect(m.order?.t === 'heal' && m.order.tgt).toBe(mine.id);
  });

  it("on patrol, turn from a teammate's unit to their own", () => {
    const p = setup();
    const m = addUnit('medic', 0, p.x, p.y);
    const friend = addUnit('swordsman', 2, p.x + 3 * TS, p.y), mine = addUnit('swordsman', 0, p.x - 3 * TS, p.y);
    friend.hp = 10;
    applyCommand(0, { c: 'patrol', ids: [m.id], tx: Math.floor(p.x / TS), ty: Math.floor(p.y / TS) + 6 });
    run(1);
    expect(m.order?.t === 'move' && m.order.sub).toBe(friend.id);
    mine.hp = 40;
    run(1);
    expect(m.order?.t === 'move' && m.order.sub).toBe(mine.id);
  });
});
