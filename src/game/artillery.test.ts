// The Artillery Tank: a World War self-propelled howitzer that outranges defenses, must dig in to
// fire, and can't shell anything right beside it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { GRASS, MH, MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { rebuildBlk } from './map.ts';
import { orderAttack, orderMove } from './order.ts';
import { edgeDist } from './path.ts';
import { available } from './production.ts';
import { UNIT } from '../data/unit.ts';
import { WEAPON } from '../data/weapon.ts';
import { BUILDING } from '../data/building.ts';

const run = (seconds: number) => { for (let i = 0; i < seconds / STEP; i++) update(STEP); };
let shots: Ent[] = [];
const prevFired = hooks.fired;

beforeEach(() => {
  G.reveal = true;
  G.demo = true;
  ais[0].on = ais[1].on = false;
  initWorld(1234);
  G.ents = [];
  G.byId.clear();
  G.projs = [];
  G.terr.fill(GRASS);
  G.elev.fill(0);
  G.ore.fill(0);
  rebuildBlk();
  // a Town Hall and plenty of power each, far off, so neither side counts as beaten and towers fire at full rate
  for (let t = 0; t < 2; t++) {
    addBuilding('yard', t, MW - 5, t ? MH - 5 : 2, false);
    for (let i = 0; i < 4; i++) addBuilding('power', t, 2 + i * 3, t ? MH - 4 : 2, false);
  }
  rebuildBlk();
  shots = [];
  hooks.fired = (s) => { if (s.type === 'artillery') shots.push(s); };
});

afterEach(() => {
  hooks.fired = prevFired;
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

describe('the Artillery Tank', () => {
  it('comes from the War Factory in the World War age', () => {
    addBuilding('factory', 0, 20, 20, false);
    G.era[0] = 0;
    expect(available(0, 'vehicle')).not.toContain('artillery');
    G.era[0] = 1;
    expect(available(0, 'vehicle')).toContain('artillery');
  });

  it('outranges every defense of its age', () => {
    const r = WEAPON.howitzer.range;
    for (const d of Object.values(BUILDING)) if (d.weapon && d.weapon !== 'bertha') expect(r).toBeGreaterThan(WEAPON[d.weapon].range);
    expect(r).toBeLessThan(WEAPON.bertha.range);
    expect(UNIT.artillery.deploy).toBeGreaterThan(0);
  });

  it('must stop and dig in before it fires', () => {
    const y = MH / 2 * TS, gun = addUnit('artillery', 0, 30 * TS, y);
    const tower = addBuilding('tower', 1, 38, MH / 2, false);
    rebuildBlk();
    orderAttack(gun, tower);
    run(UNIT.artillery.deploy! * 0.6);
    expect(shots.length).toBe(0);
    run(UNIT.artillery.deploy!);
    expect(shots.length).toBeGreaterThan(0);
  });

  it('never fires on the move', () => {
    const y = MH / 2 * TS, gun = addUnit('artillery', 0, 30 * TS, y);
    gun.stance = 'skirmish';
    addUnit('gunner', 1, 38 * TS, y + 4 * TS).stance = 'passive';
    orderMove(gun, 30, MH / 2 + 12);
    for (let i = 0; i < 4 / STEP && gun.order; i++) { update(STEP); if (gun.moving) expect(shots.length).toBe(0); }
  });

  it('shells a Watchtower from beyond its reach and takes no damage', () => {
    const tower = addBuilding('tower', 1, 40, MH / 2, false);
    const gun = addUnit('artillery', 0, 52 * TS, (MH / 2 + 0.5) * TS);
    rebuildBlk();
    orderAttack(gun, tower);
    run(40);
    expect(tower.hp).toBeLessThan(tower.maxhp * 0.5);
    expect(gun.hp).toBe(gun.maxhp);
  });

  it('backs off from a target too close to shell, then fires', () => {
    const plant = addBuilding('power', 1, 30, MH / 2, false);
    const gun = addUnit('artillery', 0, 33 * TS, (MH / 2 + 1) * TS);
    rebuildBlk();
    expect(edgeDist(gun, plant)).toBeLessThan(WEAPON.howitzer.minRange! * TS);
    orderAttack(gun, plant);
    run(12);
    expect(edgeDist(gun, plant)).toBeGreaterThanOrEqual(WEAPON.howitzer.minRange! * TS);
    expect(shots.length).toBeGreaterThan(0);
  });
});
