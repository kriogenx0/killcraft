import { beforeEach, describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { MW } from './const.ts';
import { initWorld } from './world.ts';
import { addBuilding } from './entity.ts';
import { canPlaceType, placeBuilding } from './building.ts';
import { canStartSite } from './production.ts';
import { oilNear } from './economy.ts';
import { layoutFor } from '../data/map.ts';

/** The spot that puts a 2x2 derrick right in the middle of a well. */
const middleOf = ([wx, wy]: [number, number]): [number, number] => [wx - 1, wy - 1];

describe('Oil Derrick placement', () => {
  beforeEach(() => { G.reveal = true; });

  // A derrick used to need a building within 3 tiles, like everything else, and no well is that
  // close to a Town Hall: it could only be built on oil once other buildings had crept over to it.
  for (const teams of [2, 4])
    for (const seed of [1, 7, 42, 20261124])
      it(`goes on every well with only a Town Hall (${teams} players, map ${seed})`, () => {
        initWorld(seed, teams);
        // a creature standing on the pool blocks it like any unit would; that's not what this is about
        for (const e of G.ents) if (e.kind === 'unit' && e.team < 0) e.dead = true;
        for (const well of layoutFor(teams).oil)
          for (let team = 0; team < G.teams; team++) {
            const [tx, ty] = middleOf(well);
            expect(canPlaceType('derrick', tx, ty, team), `team ${team} on the well at ${well}`).toBe(true);
            // anywhere on the pool will do, not just the middle
            for (const [dx, dy] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) expect(canPlaceType('derrick', tx + dx, ty + dy, team)).toBe(true);
          }
      });

  it('is refused away from oil, and other buildings still need the base', () => {
    initWorld(1, 2);
    const [tx, ty] = middleOf(layoutFor(2).oil[0]);
    expect(oilNear(30, 4, 2)).toBe(0);
    expect(canPlaceType('derrick', 30, 4, 0)).toBe(false);
    expect(canPlaceType('power', tx, ty, 0)).toBe(false);
  });

  it('can be laid out on a well far from home and the site is built there', () => {
    initWorld(1, 2);
    const yard = G.ents.find((e) => e.type === 'yard' && e.team === 0)!;
    addBuilding('refinery', 0, yard.tx + 4, yard.ty, false); // a derrick needs a Refinery
    G.credits[0] = 5000;
    const [tx, ty] = middleOf(layoutFor(2).oil[2]); // one of the contested wells in the middle
    expect(canStartSite(0, 'derrick', tx, ty)).toBe(true);
    const site = placeBuilding(0, 'derrick', tx, ty, true);
    expect(site?.tx).toBe(tx);
    expect(oilNear(tx, ty, 2)).toBeGreaterThan(1000);
  });

  it('needs explored ground, like any site', () => {
    initWorld(1, 2);
    G.reveal = false;
    G.human[0] = true;
    G.sight[0].fill(0);
    const [tx, ty] = middleOf(layoutFor(2).oil[2]);
    expect(canPlaceType('derrick', tx, ty, 0)).toBe(false);
    for (let y = ty; y < ty + 2; y++) for (let x = tx; x < tx + 2; x++) G.sight[0][y * MW + x] = 1;
    expect(canPlaceType('derrick', tx, ty, 0)).toBe(true);
  });
});
