import { beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
import { applyCommand, parseCommand } from './command.ts';

describe('commands', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    initWorld(7);
  });

  it('rejects malformed or out-of-range commands', () => {
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand({ c: 'move', ids: [1], tx: -1, ty: 3 })).toBeNull();
    expect(parseCommand({ c: 'move', ids: 'all', tx: 1, ty: 3 })).toBeNull();
    expect(parseCommand({ c: 'build', type: '__proto__' })).toBeNull();
    expect(parseCommand({ c: 'explode' })).toBeNull();
    expect(parseCommand({ c: 'move', ids: [1, 2], tx: 5, ty: 6, amove: true })).toEqual({ c: 'move', ids: [1, 2], tx: 5, ty: 6 });
    expect(parseCommand({ c: 'attack', ids: [1], target: 'x' })).toBeNull();
    expect(parseCommand({ c: 'attack', ids: [1], target: 2 })).toEqual({ c: 'attack', ids: [1], target: 2 });
    expect(parseCommand({ c: 'patrol', ids: [1], tx: 4, ty: 5 })).toEqual({ c: 'patrol', ids: [1], tx: 4, ty: 5 });
    expect(parseCommand({ c: 'stance', ids: [1], stance: 'berserk' })).toBeNull();
    expect(parseCommand({ c: 'stance', ids: [1], stance: 'passive' })).toEqual({ c: 'stance', ids: [1], stance: 'passive' });
  });

  it("never lets a team order the other team's units", () => {
    const enemy = G.ents.filter((e) => e.team === 1 && e.kind === 'unit');
    applyCommand(0, { c: 'move', ids: enemy.map((e) => e.id), tx: 2, ty: 2});
    for (const e of enemy) expect(e.order).toBeNull();
    const own = G.ents.filter((e) => e.team === 0 && e.kind === 'unit');
    applyCommand(0, { c: 'move', ids: own.map((e) => e.id), tx: 2, ty: 2});
    for (const e of own) expect(e.order?.t).toBe('move');
  });

  it("can't scrap or repair the other team's buildings", () => {
    const yard = G.ents.find((e) => e.team === 1 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    yard.hp = 100;
    applyCommand(0, { c: 'repair', id: yard.id });
    expect(yard.repairing).toBe(false);
    applyCommand(0, { c: 'scrap', id: yard.id });
    expect(yard.dead).toBe(false);
  });
});

describe('army rally point', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    initWorld(7);
  });

  it('points every producer at one spot, sends the army but not the Workers, and new producers join it', async () => {
    const { addBuilding, addUnit } = await import('./entity.ts');
    const { producers } = await import('./rally.ts');
    const { TS } = await import('./const.ts');
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard')!;
    const bx = yard.tx + 5, by = yard.ty;
    const barracks = addBuilding('barracks', 0, bx, by, false);
    barracks.done = true; barracks.prog = 1;
    const foot = addUnit('swordsman', 0, (bx + 1) * TS, (by + 4) * TS);
    const worker = G.ents.find((e) => e.team === 0 && e.type === 'worker')!;
    const workerOrder = worker.order;
    expect(parseCommand({ c: 'muster', x: 400, y: 500 })).toEqual({ c: 'muster', x: 400, y: 500 });
    // older clients still send `send`; it's ignored
    expect(parseCommand({ c: 'muster', x: 400, y: 500, send: true })).toEqual({ c: 'muster', x: 400, y: 500 });
    expect(parseCommand({ c: 'muster', x: -5, y: 500 })).toBeNull();
    const footOrder = foot.order;
    applyCommand(0, { c: 'muster', x: 400, y: 500 });
    expect(producers(0).length).toBeGreaterThan(0);
    expect(G.rally[0]).toEqual({ x: 400, y: 500 });
    for (const b of producers(0)) expect(b.rally).toEqual({ x: 400, y: 500 });
    // troops already out stay put
    expect(foot.order).toBe(footOrder);
    expect(worker.order).toBe(workerOrder);
    // the other side's producers are untouched
    expect(G.rally[1]).toBeNull();
    // a Factory finished later sends its troops to the same spot
    const { joinRally } = await import('./rally.ts');
    const factory = addBuilding('factory', 0, bx, by + 6, false);
    factory.done = true;
    joinRally(factory);
    expect(factory.rally).toEqual({ x: 400, y: 500 });
  });
});
