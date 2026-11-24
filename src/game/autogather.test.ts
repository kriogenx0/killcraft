// Idle Workers gather on their own, going for whatever the side needs most, and leave the
// player's own orders alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { MW, STEP, TREE, TS } from './const.ts';
import { ais } from './ai.ts';
import { rebuildBlk } from './map.ts';
import { orderMove } from './order.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, kill } from './entity.ts';
import { IDLE_GRACE, jobOf, pickResource } from './autogather.ts';
import { OIL_WELLS } from '../data/map.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

const errors: unknown[] = [];
let yard: Ent;

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261124));
  errors.length = 0;
  hooks.error = (e) => errors.push(e);
  G.reveal = true;
  G.demo = true;
  initWorld(1234);
  ais[0].on = false;
  ais[1].on = false;
  const y = G.ents.find((e) => e.team === 0 && e.type === 'yard');
  if (!y) throw new Error('no yard');
  yard = y;
  // a wood by the Town Hall, so wood is on offer too
  for (let ty = yard.ty - 2; ty < yard.ty + 4; ty++) for (let tx = yard.tx + 7; tx < yard.tx + 10; tx++) { G.terr[ty * MW + tx] = TREE; G.treeWood[ty * MW + tx] = 150; }
  rebuildBlk();
  for (const w of G.ents.filter((e) => e.type === 'worker')) kill(w);
});

afterEach(() => {
  vi.restoreAllMocks();
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
  expect(errors).toEqual([]);
});

const workers = (n: number): Ent[] => Array.from({ length: n }, (_, i) => addUnit('worker', 0, yard.x + (i - n / 2) * TS * 0.6, yard.y + 3 * TS));

describe('idle Workers', () => {
  it('go and gather on their own after a moment, bringing it home', () => {
    const ws = workers(2);
    G.credits[0] = 1000; G.wood[0] = 1000;
    run(IDLE_GRACE * 0.5);
    expect(ws.every((w) => !w.order)).toBe(true); // a short pause first, in case the player has plans
    const ore = G.credits[0], wood = G.wood[0];
    run(60);
    expect(ws.every((w) => jobOf(w))).toBe(true);
    expect(G.credits[0] + G.wood[0]).toBeGreaterThan(ore + wood + 100);
  });

  it('send more hands to the wood when wood runs low, and to the ore when ore does', () => {
    const ws = workers(4);
    G.credits[0] = 5000; G.wood[0] = 0;
    run(IDLE_GRACE + 1);
    const onWood = () => ws.filter((w) => jobOf(w) === 'wood').length;
    expect(onWood()).toBeGreaterThanOrEqual(3);
    // now short of ore with wood to spare: as they drop their loads off, they move over
    G.credits[0] = 0; G.wood[0] = 5000;
    run(60);
    expect(onWood()).toBeLessThanOrEqual(1);
    expect(ws.filter((w) => jobOf(w) === 'ore').length).toBeGreaterThanOrEqual(3);
  });

  it('go for what queued orders are waiting on', () => {
    const [w] = workers(1);
    G.credits[0] = 5000; G.wood[0] = 500;
    expect(pickResource(w, ['ore', 'wood'])).not.toBe('wood');
    // a structure queued that the side can't pay the wood for yet
    G.prod[0].structure.push({ type: 'barracks', prog: 0, spent: 0, paid: false, ready: false, hold: false });
    G.wood[0] = 0;
    expect(pickResource(w, ['ore', 'wood'])).toBe('wood');
  });

  it('with nothing short, split between ore and wood rather than all on one', () => {
    const ws = workers(6);
    G.credits[0] = 5000; G.wood[0] = 5000;
    run(IDLE_GRACE + 1);
    const ore = ws.filter((w) => jobOf(w) === 'ore').length, wood = ws.filter((w) => jobOf(w) === 'wood').length;
    expect(ore + wood).toBe(6);
    expect(ore).toBeGreaterThanOrEqual(2);
    expect(wood).toBeGreaterThanOrEqual(2);
  });

  it("keep the player's own orders, and don't switch a job the player gave", () => {
    const [mover, digger] = workers(2);
    G.credits[0] = 5000; G.wood[0] = 0;
    orderMove(mover, yard.tx - 6, yard.ty + 6);
    digger.order = { t: 'harvest', st: 'go', tx: yard.tx, ty: yard.ty + 4, wait: 0 };
    run(1);
    expect(mover.order?.t).toBe('move');
    run(40);
    expect(jobOf(digger)).toBe('ore'); // short of wood, but the player put it on the ore
    expect(digger.order?.t === 'harvest' && digger.order.auto).toBeFalsy();
  });

  it('holding a load, take it home first and then carry on gathering', () => {
    const [w] = workers(1);
    G.credits[0] = 5000; G.wood[0] = 0;
    w.carry = 100; w.cargo = 'ore'; // stopped halfway through digging
    const ore = G.credits[0];
    run(IDLE_GRACE + 30);
    expect(G.credits[0]).toBeGreaterThanOrEqual(ore + 100);
    expect(jobOf(w)).toBe('wood');
  });

  it("don't crowd a slow Oil Derrick: one Worker hauls from it, and never stands there holding oil", () => {
    const [wx, wy] = OIL_WELLS[0];
    const d = addBuilding('derrick', 0, wx - 1, wy - 1, false);
    d.carry = 300;
    const ws = workers(4);
    G.credits[0] = 5000; G.wood[0] = 5000; G.oil[0] = 0;
    run(IDLE_GRACE + 1);
    expect(ws.filter((w) => jobOf(w) === 'oil')).toHaveLength(1);
    // watch the Workers: nobody holding oil stays put at the derrick
    const still = new Map<Ent, number>();
    let worst = 0;
    for (let i = 0; i < 120 / STEP; i++) {
      update(STEP);
      for (const w of ws) {
        const near = Math.hypot(w.x - d.x, w.y - d.y) < 3 * TS;
        const t = near && w.carry > 0 && w.cargo === 'oil' ? (still.get(w) ?? 0) + STEP : 0;
        still.set(w, t);
        worst = Math.max(worst, t);
      }
    }
    expect(worst).toBeLessThan(5);
    expect(G.oil[0]).toBeGreaterThan(250);
  });
});
