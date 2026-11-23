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
    expect(parseCommand({ c: 'attack', ids: [1], target: 2 })).toBeNull();
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
