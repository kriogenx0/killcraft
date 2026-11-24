import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { STEP } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, kill } from './entity.ts';
import { applyCommand, parseCommand } from './command.ts';
import { REVIVE_PRICE, canRevive, fallenAllies } from './revive.ts';
import { layoutFor } from '../data/map.ts';

const run = (seconds: number) => { for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP); };
const own = (team: number, kind?: 'unit' | 'bld') => G.ents.filter((e) => !e.dead && e.team === team && (!kind || e.kind === kind));
const yard = (team: number) => own(team, 'bld').find((e) => e.type === 'yard');

/** 2v2: Blue (0) and Green (2) against Red (1) and Gold (3). */
beforeEach(() => {
  initWorld(1, 4, { ally: [0, 1, 0, 1] });
  G.demo = true;
  for (const a of ais) a.on = false;
});

afterEach(() => {
  initWorld(1);
  ais[0].on = false;
  ais[1].on = true;
});

/** Green loses everything: Town Hall, Workers and ore. */
function beatGreen(): void {
  for (const e of own(2)) kill(e);
  G.credits[2] = 0;
}

describe('reviving a fallen teammate', () => {
  it('keeps a beaten teammate in the game while the team can still rebuild', () => {
    beatGreen();
    addBuilding('barracks', 2, layoutFor(4).yards[2][0] + 5, layoutFor(4).yards[2][1], false);
    run(6);
    expect(G.over).toBe(false);
    // what's left of Green's base still stands, waiting for a revive
    expect(own(2, 'bld').map((e) => e.type)).toEqual(['barracks']);
    expect(fallenAllies(0)).toEqual([2]);
  });

  it('gives the teammate a new Town Hall and two Workers at their corner, paid by the reviver', () => {
    beatGreen();
    run(4);
    G.credits[0] = 5000; G.wood[0] = 1000;
    applyCommand(0, { c: 'revive', team: 2 });
    const hall = yard(2);
    expect(hall?.done).toBe(true);
    const [hx, hy] = layoutFor(4).yards[2];
    expect(Math.abs(hall!.tx - hx) + Math.abs(hall!.ty - hy)).toBeLessThan(6);
    expect(own(2, 'unit').map((u) => u.type)).toEqual(['worker', 'worker']);
    expect(G.credits[0]).toBe(5000 - REVIVE_PRICE.ore);
    expect(G.wood[0]).toBe(1000 - REVIVE_PRICE.wood);
    expect(G.outLog.some((o) => o.team === 2)).toBe(false);
    run(5);
    expect(G.over).toBe(false);
  });

  it("can't be done for an enemy, for yourself, without the price, or without a Town Hall", () => {
    beatGreen();
    G.credits[0] = G.credits[1] = 5000; G.wood[0] = G.wood[1] = 1000;
    expect(canRevive(1, 2)).toBe(false); // Red isn't Green's teammate
    expect(canRevive(2, 2)).toBe(false);
    G.credits[0] = REVIVE_PRICE.ore - 1;
    expect(canRevive(0, 2)).toBe(false);
    G.credits[0] = 5000;
    expect(canRevive(0, 2)).toBe(true);
    kill(yard(0)!);
    expect(canRevive(0, 2)).toBe(false);
    expect(canRevive(0, 1)).toBe(false); // Red still has its Town Hall
  });

  it('the team loses only when none of it can rebuild', () => {
    beatGreen();
    run(4);
    expect(G.over).toBe(false);
    for (const e of own(0)) kill(e);
    G.credits[0] = 0;
    run(8);
    expect(G.over).toBe(true);
    expect(G.winner === 1 || G.winner === 3).toBe(true);
  });

  it('a computer teammate revives as soon as it can pay', () => {
    beatGreen();
    run(2);
    ais[0].on = true;
    G.credits[0] = 4000; G.wood[0] = 800;
    run(6);
    expect(yard(2)?.done).toBe(true);
  });

  it('checks the command from the network', () => {
    expect(parseCommand({ c: 'revive', team: 2 })).toEqual({ c: 'revive', team: 2 });
    expect(parseCommand({ c: 'revive', team: 9 })).toBeNull();
    expect(parseCommand({ c: 'revive', team: '2' })).toBeNull();
  });
});
