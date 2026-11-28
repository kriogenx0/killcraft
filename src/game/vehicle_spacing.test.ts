// Tanks keep their hulls apart: nose to tail they need more room than side by side.
import { describe, expect, it } from 'vitest';
import { G, unitDef, type Ent } from './state.ts';
import { GRASS, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { groupMove, orderMove } from './order.ts';
import { bodyRadius } from './move.ts';

function field(): void {
  initWorld(1234);
  for (const a of ais) a.on = false;
  G.ents = []; G.byId.clear(); G.terr.fill(GRASS); G.ore.fill(0); G.portals = []; G.waygates = []; G.warp.fill(-1); G.warpTeam.fill(-1);
  addBuilding('power', 0, 1, 61, false);
  addBuilding('power', 1, 61, 1, false);
  rebuildBlk();
}

/** The closest any two come over `secs`, as a share of the room their hulls need between them. */
function closest(us: Ent[], secs: number): number {
  let w = Infinity;
  for (let t = 0; t < secs; t += STEP) {
    update(STEP);
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      const dx = us[j].x - us[i].x, dy = us[j].y - us[i].y;
      w = Math.min(w, Math.hypot(dx, dy) / (bodyRadius(us[i], dx, dy) + bodyRadius(us[j], dx, dy)));
    }
  }
  return w;
}

describe('vehicle spacing', () => {
  it('a tank reaches further nose to tail than to the side', () => {
    field();
    const t = addUnit('tank', 0, 10 * TS, 10 * TS);
    t.face = 0;
    expect(bodyRadius(t, 1, 0)).toBeGreaterThan(unitDef(t).radius * 1.3);
    expect(bodyRadius(t, 0, 1)).toBe(unitDef(t).radius);
  });

  it('two tanks sent to the same spot, or driving at each other, never overlap', () => {
    field();
    const a = addUnit('tank', 0, 10.5 * TS, 28.5 * TS), b = addUnit('heavy', 0, 10.5 * TS, 33.5 * TS);
    orderMove(a, 25, 30); orderMove(b, 25, 30);
    expect(closest([a, b], 12)).toBeGreaterThan(0.95);
    field();
    const c = addUnit('tank', 0, 10.5 * TS, 30.5 * TS), d = addUnit('tank', 0, 30.5 * TS, 30.5 * TS);
    orderMove(c, 30, 30); orderMove(d, 10, 30);
    expect(closest([c, d], 12)).toBeGreaterThan(0.95);
  });

  it('a column of tanks in formation keeps a gap between them', () => {
    field();
    const us = [0, 1, 2, 3, 4, 5].map((i) => addUnit(i % 2 ? 'heavy' : 'tank', 0, (20.5 + (i % 3)) * TS, (30.5 + Math.floor(i / 3)) * TS));
    groupMove(us, 40, 31, false, true);
    expect(closest(us, 15)).toBeGreaterThan(0.85);
  });
});
