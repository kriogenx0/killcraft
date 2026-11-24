import { beforeEach, describe, expect, it } from 'vitest';
import { G, type Ent } from './state.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { applyCommand } from './command.ts';
import { addBuilding, addUnit } from './entity.ts';
import { TS } from './const.ts';
import { enqueue } from './production.ts';
import { army, producers } from './rally.ts';

const dist = (u: Ent, x: number, y: number) => Math.hypot(u.x - x, u.y - y);

describe('rally army leaves Workers alone', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    initWorld(7);
  });

  it("never sends existing or newly trained Workers to the rally point, and the Town Hall isn't a rally producer", () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard')!;
    const barracks = addBuilding('barracks', 0, yard.tx + 5, yard.ty, false);
    barracks.done = true; barracks.prog = 1;
    const foot = addUnit('swordsman', 0, (yard.tx + 6) * TS, (yard.ty + 4) * TS);
    // far from base, so anything that heads there shows
    const rx = Math.min(G.ents[0].x + 40 * TS, 60 * TS), ry = yard.y;
    const workersBefore = G.ents.filter((e) => e.team === 0 && e.type === 'worker');
    const start = new Map(workersBefore.map((w) => [w.id, dist(w, rx, ry)]));
    applyCommand(0, { c: 'muster', x: rx, y: ry, send: true });
    expect(producers(0)).not.toContain(yard);
    expect(yard.rally).toBeFalsy();
    expect(army(0)).toContain(foot);
    expect(army(0).some((u) => u.type === 'worker')).toBe(false);
    expect(foot.order?.t).toBe('move');
    G.credits[0] = G.wood[0] = 99999;
    enqueue(0, 'worker');
    enqueue(0, 'worker');
    for (let i = 0; i < 60 * 30; i++) update(1 / 30);
    const workers = G.ents.filter((e) => !e.dead && e.team === 0 && e.type === 'worker');
    expect(workers.length).toBeGreaterThan(workersBefore.length);
    for (const w of workers) {
      expect(w.order?.t).not.toBe('move');
      // none has walked out to the rally point
      expect(dist(w, rx, ry)).toBeGreaterThan(Math.min(start.get(w.id) ?? 1e9, dist(barracks, rx, ry)) - 4 * TS);
    }
  });
});
