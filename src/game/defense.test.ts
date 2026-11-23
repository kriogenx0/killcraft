import { beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { GRASS, MH, MW, STEP, TS } from './const.ts';
import { rebuildBlk } from './map.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, kill } from './entity.ts';
import { orderAttack, orderMove } from './order.ts';
import { findPath } from './path.ts';
import { canPlace, wallLine } from './building.ts';
import { startSite } from './production.ts';
import { parseCommand } from './command.ts';
import { BUILDING, BLD_TYPES, WALL_LINE_MAX, WALL_TYPES, isWall } from '../data/building.ts';
import { WEAPON } from '../data/weapon.ts';
import { ERA, LAST_ERA } from '../data/era.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP; i++) update(STEP);
}

/** A clear square of ground (top-left tile) away from both bases. */
function openSquare(n: number): [number, number] {
  for (let ty = 20; ty < MH - n - 2; ty++)
    for (let tx = 20; tx < MW - n - 2; tx++) {
      let ok = true;
      for (let y = ty - 1; y <= ty + n && ok; y++) for (let x = tx - 1; x <= tx + n && ok; x++) ok = !G.blk[y * MW + x] && !G.ore[y * MW + x];
      if (ok) return [tx, ty];
    }
  throw new Error('no open ground');
}

/** Clear a square of ground to plain grass (top-left tile), for tests that need more room than the map has free. */
function clearSquare(n: number): [number, number] {
  const tx = 24, ty = 24;
  for (let y = ty - 1; y <= ty + n; y++) for (let x = tx - 1; x <= tx + n; x++) { const i = y * MW + x; G.terr[i] = GRASS; G.blk[i] = 0; G.ore[i] = 0; }
  G.ents.filter((e) => !e.dead && e.w && e.tx + e.w >= tx - 1 && e.tx <= tx + n && e.ty + e.h >= ty - 1 && e.ty <= ty + n).forEach(kill);
  rebuildBlk();
  return [tx, ty];
}

beforeEach(() => {
  for (const a of ais) a.on = false;
  G.reveal = true;
  G.demo = true;
  hooks.error = (e) => { throw e; };
  initWorld(1234);
});

describe('walls', () => {
  it('come in wood, stone and concrete, getting tougher, and use no power', () => {
    expect(WALL_TYPES.map((t) => BUILDING[t].era)).toEqual([0, 0, 1]);
    for (let i = 1; i < WALL_TYPES.length; i++) expect(BUILDING[WALL_TYPES[i]].hp).toBeGreaterThan(BUILDING[WALL_TYPES[i - 1]].hp);
    for (const t of WALL_TYPES) { expect(BUILDING[t].power).toBe(0); expect(BUILDING[t].size).toBe(1); expect(BUILDING[t].oil ?? 0).toBe(0); }
    expect(BUILDING.palisade.wood).toBeGreaterThan(BUILDING.palisade.cost); // a palisade is mostly timber
  });

  it('snap a dragged line to a straight or diagonal run, capped in length', () => {
    expect(wallLine(5, 5, 9, 6)).toEqual([[5, 5], [6, 5], [7, 5], [8, 5], [9, 5]]);
    expect(wallLine(5, 5, 7, 7)).toEqual([[5, 5], [6, 6], [7, 7]]);
    expect(wallLine(5, 5, 5, 2)).toEqual([[5, 5], [5, 4], [5, 3], [5, 2]]);
    expect(wallLine(0, 0, 60, 0)).toHaveLength(WALL_LINE_MAX);
  });

  it('are laid as a line of sites, paying for every segment as it goes down', () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard') as Ent;
    G.credits[0] = 5000; G.wood[0] = 1000;
    const ore = G.credits[0], wood = G.wood[0], y = yard.ty - 2;
    // find a clear run of 5 just above the yard
    let x0 = -1;
    for (let x = yard.tx - 2; x <= yard.tx + 2 && x0 < 0; x++) if (wallLine(x, y, x + 4, y).every(([a, b]) => canPlace(a, b, 1, 0, false, true))) x0 = x;
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(startSite(0, 'palisade', x0, y, x0 + 4, y)).not.toBeNull();
    const walls = G.ents.filter((e) => e.type === 'palisade' && e.team === 0);
    expect(walls).toHaveLength(5);
    expect(ore - G.credits[0]).toBe(5 * BUILDING.palisade.cost);
    expect(wood - G.wood[0]).toBe(5 * (BUILDING.palisade.wood ?? 0));
    for (const w of walls) expect(G.blk[w.ty * MW + w.tx]).toBe(1);
    // the Workers build one segment after another
    expect(walls.every((w) => !w.done)).toBe(true);
    run(5 * BUILDING.palisade.t + 15);
    expect(walls.every((w) => w.done)).toBe(true);
  });

  it("don't count as base: nothing else can be built out beside them", () => {
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard') as Ent;
    // a wall at the edge of the wall radius
    const wx = yard.tx + yard.w + 7, wy = yard.ty;
    addBuilding('stonewall', 0, wx, wy, false);
    expect(canPlace(wx + 1, wy + 1, 1, 0)).toBe(false);
    expect(canPlace(wx + 4, wy, 1, 0, false, true)).toBe(false); // nor more walls past the radius
  });

  it('block movement until destroyed', () => {
    const [tx, ty] = openSquare(9);
    // a closed ring of concrete around a soldier
    for (let x = tx; x < tx + 9; x++) for (const y of [ty, ty + 8]) addBuilding('concretewall', 1, x, y, false);
    for (let y = ty + 1; y < ty + 8; y++) for (const x of [tx, tx + 8]) addBuilding('concretewall', 1, x, y, false);
    const u = addUnit('swordsman', 0, (tx + 4.5) * TS, (ty + 4.5) * TS);
    u.stance = 'passive';
    const path = findPath(tx + 4, ty + 4, tx + 12, ty + 4);
    expect(path.at(-1)).not.toEqual([tx + 12, ty + 4]); // can't get out
    orderMove(u, tx + 12, ty + 4);
    run(6);
    expect(u.x).toBeLessThan((tx + 8) * TS);
    // knock a hole in the wall and it can walk out
    kill(G.ents.find((e) => e.type === 'concretewall' && e.tx === tx + 8 && e.ty === ty + 4) as Ent);
    orderMove(u, tx + 12, ty + 4);
    run(8);
    expect(u.x).toBeGreaterThan((tx + 9) * TS);
  });

  /** A closed ring of enemy (team 1) palisade, 9 tiles across, with its top-left at (tx, ty). */
  function ring(tx: number, ty: number, gap = false): void {
    for (let x = tx; x < tx + 9; x++) for (const y of [ty, ty + 8]) addBuilding('palisade', 1, x, y, false);
    for (let y = ty + 1; y < ty + 8; y++) for (const x of [tx, tx + 8]) if (!(gap && x === tx + 8 && y === ty + 4)) addBuilding('palisade', 1, x, y, false);
    ringSize = G.ents.filter((e) => e.type === 'palisade').length;
  }
  /** Walls of the ring knocked down or hurt. */
  const damaged = (): number => {
    const ws = G.ents.filter((e) => e.type === 'palisade');
    return ws.filter((e) => e.dead || e.hp < e.maxhp).length + (ringSize - ws.length);
  };
  let ringSize = 0;

  it('are left alone by idle troops and turrets right beside them', () => {
    const [tx, ty] = openSquare(9);
    for (let y = ty; y < ty + 9; y++) addBuilding('palisade', 1, tx + 5, y, false);
    addUnit('swordsman', 0, (tx + 4.5) * TS, (ty + 4.5) * TS);
    addUnit('crossbowman', 0, (tx + 3.5) * TS, (ty + 2.5) * TS);
    addBuilding('pillbox', 0, tx + 2, ty + 6, false);
    run(15);
    expect(G.ents.filter((e) => e.type === 'palisade' && e.hp < e.maxhp)).toHaveLength(0);
  });

  it('are walked around when there is a way around', () => {
    const [tx, ty] = clearSquare(13);
    ring(tx + 2, ty + 2, true);
    const u = addUnit('swordsman', 0, (tx + 0.5) * TS, (ty + 6.5) * TS);
    orderMove(u, tx + 6, ty + 6); // the middle of the ring, through the gap on the far side
    run(20);
    expect(damaged()).toBe(0);
    expect(Math.hypot(u.x - (tx + 6.5) * TS, u.y - (ty + 6.5) * TS)).toBeLessThan(2 * TS);
  });

  it('get broken through when there is no other way to where a unit is going', () => {
    const [tx, ty] = clearSquare(13);
    ring(tx + 2, ty + 2);
    const u = addUnit('knight', 0, (tx + 0.5) * TS, (ty + 6.5) * TS);
    orderMove(u, tx + 6, ty + 6);
    run(70);
    expect(damaged()).toBeGreaterThan(0);
    expect(Math.hypot(u.x - (tx + 6.5) * TS, u.y - (ty + 6.5) * TS)).toBeLessThan(2 * TS);
  });

  it('get broken through to reach an enemy walled in', () => {
    const [tx, ty] = clearSquare(13);
    ring(tx + 2, ty + 2);
    const foe = addBuilding('power', 1, tx + 5, ty + 5, false); // unarmed, so the knight lives to reach it
    const u = addUnit('knight', 0, (tx + 0.5) * TS, (ty + 6.5) * TS);
    orderAttack(u, foe);
    run(80);
    expect(damaged()).toBeGreaterThan(0);
    expect(foe.hp).toBeLessThan(foe.maxhp);
  });

  it('get attacked when a unit is sent right onto one', () => {
    const [tx, ty] = openSquare(9);
    const w = addBuilding('palisade', 1, tx + 6, ty + 4, false);
    const u = addUnit('swordsman', 0, (tx + 1.5) * TS, (ty + 4.5) * TS);
    orderMove(u, tx + 6, ty + 4);
    run(10);
    expect(w.dead || w.hp < w.maxhp).toBe(true);
  });

  it('accept a dragged line in a place command, and reject a bad end', () => {
    expect(parseCommand({ c: 'place', type: 'palisade', tx: 3, ty: 4, ex: 8, ey: 4 })).toEqual({ c: 'place', type: 'palisade', tx: 3, ty: 4, ex: 8, ey: 4 });
    expect(parseCommand({ c: 'place', type: 'palisade', tx: 3, ty: 4, ex: -1, ey: 4 })).toBeNull();
    expect(parseCommand({ c: 'place', type: 'power', tx: 3, ty: 4 })).toEqual({ c: 'place', type: 'power', tx: 3, ty: 4 });
    expect(parseCommand({ c: 'place', type: 'nuke', tx: 3, ty: 4 })).toBeNull();
  });
});

describe('turrets', () => {
  it('each have a role, and every defensive weapon exists', () => {
    for (const t of BLD_TYPES) if (BUILDING[t].weapon) expect(WEAPON[BUILDING[t].weapon]).toBeDefined();
    const { pillboxmg, atmissile, turretcannon } = WEAPON;
    expect(pillboxmg.vs.none).toBeGreaterThan(pillboxmg.vs.heavy * 4); // anti-infantry
    expect(atmissile.vs.heavy).toBeGreaterThan(atmissile.vs.none * 4); // anti-armor
    expect(atmissile.dmg * atmissile.vs.heavy / atmissile.cd).toBeGreaterThan(turretcannon.dmg * turretcannon.vs.heavy / turretcannon.cd);
    expect(BUILDING.atturret.era).toBe(LAST_ERA);
    expect(ERA[BUILDING.pillbox.era]).toBeDefined();
  });

  it('pillbox mows down infantry', () => {
    const [tx, ty] = openSquare(8);
    addBuilding('pillbox', 0, tx, ty + 3, false);
    const foes = [0, 1, 2].map((i) => addUnit('swordsman', 1, (tx + 5.5) * TS, (ty + 2.5 + i) * TS));
    run(15);
    expect(foes.filter((f) => !f.dead).length).toBe(0);
  });

  it('missile turret cracks heavy tanks', () => {
    const [tx, ty] = openSquare(8);
    addBuilding('atturret', 0, tx, ty + 3, false);
    addBuilding('power', 0, tx + 1, ty, false);
    const tank = addUnit('heavy', 1, (tx + 6.5) * TS, (ty + 3.5) * TS);
    run(12);
    expect(tank.hp).toBeLessThan(tank.maxhp * 0.5);
  });
});

describe('Big Bertha', () => {
  const W = WEAPON.bertha;

  it('outranges everything, reloads slowly, and is mostly ore', () => {
    for (const [k, w] of Object.entries(WEAPON)) if (k !== 'bertha') expect(W.range).toBeGreaterThan(w.range * 2);
    expect(W.cd).toBeGreaterThan(5);
    const b = BUILDING.bertha;
    expect(b.cost).toBeGreaterThan(2000);
    expect(b.cost).toBeGreaterThan((b.wood ?? 0) * 10);
    expect(b.oil ?? 0).toBe(0);
    expect(isWall('bertha')).toBe(false);
  });

  function setup(dist: number): { gun: Ent; target: Ent; ty: number; tx: number } {
    const [tx, ty] = openSquare(3);
    // the gun sits far to the left of the target, on whatever ground is there
    const gun = addBuilding('bertha', 0, Math.max(0, tx - dist), ty, false);
    const target = addUnit('tank', 1, (tx + 1.5) * TS, (ty + 1.5) * TS);
    target.stance = 'passive';
    return { gun, target, tx, ty };
  }

  it('hits a target that stays put, seconds after firing', () => {
    const { gun, target } = setup(14);
    run(1);
    expect(G.projs.some((p) => p.weapon === 'bertha')).toBe(true);
    expect(target.hp).toBe(target.maxhp); // still in the air
    run(6);
    expect(target.hp).toBeLessThan(target.maxhp);
    expect(gun.dead).toBe(false);
  });

  it('misses a target that drives away while the shell is in the air', () => {
    const { target, tx, ty } = setup(14);
    for (let i = 0; i < 120 && !G.projs.some((p) => p.weapon === 'bertha'); i++) run(STEP);
    expect(G.projs.some((p) => p.weapon === 'bertha')).toBe(true);
    orderMove(target, Math.min(MW - 1, tx + 9), ty + 1);
    run(5);
    expect(target.hp).toBe(target.maxhp);
  });

  it("can't fire at anything right next to it", () => {
    const { gun } = setup(14);
    G.ents.filter((e) => e.kind === 'unit').forEach(kill);
    const close = addUnit('swordsman', 1, gun.x + 2 * TS, gun.y);
    close.stance = 'passive';
    run(3);
    expect(G.projs.some((p) => p.weapon === 'bertha')).toBe(false);
  });
});

describe('computer player', () => {
  it('puts up walls in a normal match, alongside its first defenses', () => {
    const errors: unknown[] = [];
    hooks.error = (e) => errors.push(e);
    ais[0].on = true; ais[1].on = true;
    initWorld(4321);
    const wallsOf = (t: number) => G.ents.filter((e) => !e.dead && e.team === t && isWall(e.type)).length;
    let most = [0, 0];
    for (let i = 0; i < 8 * 60 / STEP && !G.over; i++) {
      update(STEP);
      if (i % 60 === 0) most = most.map((m, t) => Math.max(m, wallsOf(t)));
    }
    expect(errors).toEqual([]);
    // no extra money: both sides wall in with what they earn
    for (const t of [0, 1]) expect(most[t], `team ${t} walls`).toBeGreaterThanOrEqual(4);
  }, 60_000);

  it('builds walls and several kinds of defenses over a long game', () => {
    const errors: unknown[] = [];
    hooks.error = (e) => errors.push(e);
    ais[0].on = true; ais[1].on = true;
    initWorld(4321);
    for (let i = 0; i < 12 * 60 / STEP && !G.over; i++) {
      update(STEP);
      if (i % 600 === 0) for (const t of [0, 1]) { G.credits[t] += 1500; G.wood[t] += 300; } // a rich game, to reach the late defenses
    }
    const built = new Set(G.ents.filter((e) => e.kind === 'bld').map((e) => e.type));
    expect(errors).toEqual([]);
    expect(WALL_TYPES.some((t) => built.has(t))).toBe(true);
    expect((['tower', 'turret', 'pillbox', 'atturret', 'bertha'] as const).filter((t) => built.has(t)).length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
