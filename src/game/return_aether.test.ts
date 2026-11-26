// Return Aether: on by default, a unit carrying Aether walks it home and banks it before taking orders.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { STEP, TS } from './const.ts';
import { ais, aiThink } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit } from './entity.ts';
import { applyCommand } from './command.ts';
import { deposits } from './aether.ts';
import { applySnapshot, encodeEnt } from '../net/snapshot.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

beforeEach(() => {
  hooks.error = (e) => { throw e; };
  G.reveal = true;
  G.demo = true;
  ais[0].on = false;
  ais[1].on = false;
  initWorld(1234);
});

afterEach(() => {
  ais[0].on = false;
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

const yardOf = (team: number): Ent => G.ents.find((e) => !e.dead && e.team === team && e.type === 'yard') as Ent;

/** A unit of `team` a third of the way from its Town Hall to and the first deposit, carrying some Aether. */
function carrier(team = 0, ae = 20): Ent {
  const y = yardOf(team), d = deposits()[0];
  const u = addUnit('swordsman', team, y.x + (d.x - y.x) * 0.3, y.y + (d.y - y.y) * 0.3);
  u.ae = ae;
  return u;
}

it('is on by default: a unit carrying Aether walks it home and banks it, ignoring a move order', () => {
  const u = carrier(), d = deposits()[0], start = G.aether[0];
  applyCommand(0, { c: 'move', ids: [u.id], tx: Math.floor(d.x / TS), ty: Math.floor(d.y / TS) + 2 });
  const before = Math.hypot(u.x - yardOf(0).x, u.y - yardOf(0).y);
  run(2);
  expect(u.aeRun).toBe(true);
  expect(Math.hypot(u.x - yardOf(0).x, u.y - yardOf(0).y)).toBeLessThan(before);
  for (let t = 0; t < 60 && G.aether[0] === start; t += 0.5) run(0.5);
  expect(G.aether[0]).toBeCloseTo(start + 20, 5);
  expect(u.ae).toBe(0);
  run(0.1);
  expect(u.aeRun).toBe(false);
  // then it carries on with the order it was given meanwhile
  expect(u.order?.t).toBe('move');
  let closest = Infinity;
  for (let t = 0; t < 90; t += 0.5) { run(0.5); closest = Math.min(closest, Math.hypot(u.x - d.x, u.y - d.y)); }
  expect(closest).toBeLessThan(4 * TS);
  // where it filled up and, full, took that home too
  expect(u.aeRun || G.aether[0] > start + 20).toBe(true);
});

it('switched off, the unit keeps its Aether and follows orders', () => {
  const u = carrier(), d = deposits()[0];
  applyCommand(0, { c: 'aether', ids: [u.id], on: false });
  expect(u.aeKeep).toBe(true);
  applyCommand(0, { c: 'move', ids: [u.id], tx: Math.floor(d.x / TS), ty: Math.floor(d.y / TS) + 2 });
  run(40);
  expect(u.aeRun).toBeFalsy();
  expect(u.ae).toBeGreaterThanOrEqual(20); // kept, and drawing more at the deposit
  expect(Math.hypot(u.x - d.x, u.y - d.y)).toBeLessThan(5 * TS);
  // switched back on: home it goes once it's full
  u.ae = 40;
  applyCommand(0, { c: 'aether', ids: [u.id], on: true });
  expect(u.aeKeep).toBeUndefined();
  run(2);
  expect(u.aeRun).toBe(true);
});

it('waits at a deposit its side holds until it carries a full load', () => {
  const d = deposits()[0], u = addUnit('swordsman', 0, d.x, d.y + TS);
  run(5);
  expect(u.ae).toBeGreaterThan(0);
  expect(u.aeRun).toBeFalsy();
  expect(Math.hypot(u.x - d.x, u.y - d.y)).toBeLessThan(2 * TS);
});

it('the computer keeps fighters with Aether in a fight, and sends them home once it is quiet', () => {
  ais[1].on = true;
  const u = carrier(1);
  aiThink(1);
  expect(u.aeKeep).toBeUndefined();
  const foe = addUnit('swordsman', 0, u.x + 3 * TS, u.y);
  aiThink(1);
  expect(u.aeKeep).toBe(true);
  foe.dead = true;
  aiThink(1);
  expect(u.aeKeep).toBeUndefined();
});

it('online, the HUD sees a unit has Return Aether off', () => {
  const u = carrier();
  u.aeKeep = true;
  const row = encodeEnt(u, true);
  u.aeKeep = undefined;
  applySnapshot([row], [], () => {});
  expect(u.aeKeep).toBe(true);
  expect(u.ae).toBe(20);
});
