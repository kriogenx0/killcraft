import { beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { MH, MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, kill } from './entity.ts';
import { available } from './production.ts';
import { aboard, missing, wingOf } from './carrier.ts';
import { CARRIER_REACH, CARRIER_REBUILD, UNIT } from '../data/unit.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP; i++) update(STEP);
}

const MID = { x: (MW / 2) * TS, y: (MH / 2) * TS };

/** A Carrier with a tough foe parked within reach of its wing, out of reach of its own guns. */
function standoff(): [Ent, Ent] {
  const c = addUnit('carrier', 0, MID.x, MID.y), foe = addUnit('tank', 1, MID.x + 6 * TS, MID.y);
  c.stance = 'tend';
  foe.stance = 'tend';
  foe.frozenT = 1e9; // locked in place
  foe.hp = foe.maxhp = 100000;
  return [c, foe];
}

describe('the Sky Battleship', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    G.reveal = true;
    hooks.error = (e) => { throw e; };
    initWorld(1234);
    for (const e of G.ents) if (e.kind === 'unit') e.dead = true;
    G.ents = G.ents.filter((e) => !e.dead);
  });

  it('is a slow, costly Modern Airfield unit; its Hornets are never trained', () => {
    expect(UNIT.carrier.era).toBe(2);
    expect(UNIT.carrier.producer).toBe('air');
    expect(UNIT.carrier.t).toBeGreaterThanOrEqual(60);
    expect(UNIT.hornet.hatched && UNIT.hornet.summoned).toBe(true);
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard');
    if (!yard) throw new Error('no yard');
    addBuilding('airfield', 0, yard.tx + 4, yard.ty, false);
    G.era[0] = 2;
    expect(available(0, 'air')).toContain('carrier');
    expect(available(0, 'air')).not.toContain('hornet');
  });

  it('launches its Hornets one after another at a foe within reach, and they fight it', () => {
    const [c, foe] = standoff();
    expect(Math.hypot(foe.x - c.x, foe.y - c.y)).toBeLessThan(CARRIER_REACH * TS);
    run(1);
    expect(wingOf(c).length).toBeGreaterThan(0);
    expect(wingOf(c).length).toBeLessThan(UNIT.carrier.hangar ?? 0);
    run(5);
    expect(wingOf(c)).toHaveLength(UNIT.carrier.hangar ?? 0);
    expect(aboard(c)).toBe(0);
    for (const h of wingOf(c)) expect(h.team).toBe(0);
    expect(foe.hp).toBeLessThan(foe.maxhp);
  });

  it('takes its Hornets back aboard when the fight is over', () => {
    const [c, foe] = standoff();
    run(6);
    const lost = G.stats[0]?.lost ?? 0;
    foe.dead = true;
    run(10);
    expect(wingOf(c)).toHaveLength(0);
    expect(aboard(c)).toBe(UNIT.carrier.hangar);
    expect(G.stats[0]?.lost ?? 0).toBe(lost);
  });

  it('rebuilds a lost Hornet very slowly, one at a time', () => {
    const [c, foe] = standoff();
    run(6);
    const wing = wingOf(c);
    kill(wing[0]); kill(wing[1]);
    foe.dead = true;
    run(10);
    expect(missing(c)).toBe(2);
    expect(aboard(c)).toBe(2);
    run(CARRIER_REBUILD - 12);
    expect(aboard(c)).toBe(2);
    run(4);
    expect(aboard(c)).toBe(3);
    run(CARRIER_REBUILD);
    expect(aboard(c)).toBe(4);
    expect(missing(c)).toBe(0);
  });

  it('brings its Hornets down with it', () => {
    const [c] = standoff();
    run(6);
    const wing = wingOf(c);
    expect(wing.length).toBeGreaterThan(0);
    kill(c);
    run(0.5);
    for (const h of wing) expect(h.dead).toBe(true);
  });
});
