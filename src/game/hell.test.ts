import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addUnit } from './entity.ts';
import { acquire, dealDamage } from './combat.ts';
import { demonPrey, demons, gateCentre, onBrink, onGate, spawnDemon, updHell } from './hell.ts';
import { addBuilding } from './entity.ts';
import { BRINK_AFTER, RESCUE_COOLDOWN, RESCUE_DRAKES } from '../data/hell.ts';
import { wildBeasts } from './creatures.ts';
import { visibleTo } from '../net/snapshot.ts';
import { ARCHFIEND_FIRST, BURST_GAP, DEMON_CAP, GATE_OPENS, GATE_SIZE, GATE_TILE, LEADER_TRAINED, RAID_SIZE, RAID_WARNING, WANDER_EVERY, WANDER_SIZE, WANDER_STAY } from '../data/hell.ts';
import { layoutFor, START_YARDS } from '../data/map.ts';
import { UNIT } from '../data/unit.ts';
import { noteTrained } from './stats.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

const errors: unknown[] = [];

beforeEach(() => {
  errors.length = 0;
  hooks.error = (e) => errors.push(e);
  G.reveal = true;
  G.demo = true;
  ais[0].on = false;
  ais[1].on = false;
  initWorld(1234);
  for (const b of wildBeasts()) { b.dead = true; G.byId.delete(b.id); }
  G.ents = G.ents.filter((e) => !e.dead);
  G.hell.spawnT = Infinity; // demons only where a test puts them
});

afterEach(() => {
  ais[0].on = false;
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
});

/** Give a side `n` trained fighters on its books and some troops on the field. */
function army(team: number, n: number, troops: number, type: 'swordsman' | 'knight' = 'swordsman'): Ent[] {
  for (let i = 0; i < n; i++) noteTrained(team, 'swordsman');
  const [x, y] = START_YARDS[team];
  return Array.from({ length: troops }, (_, i) => addUnit(type, team, (x + 5 + (i % 4)) * TS, (y + (team ? 5 : -4) + Math.floor(i / 4)) * TS));
}

describe('the Gate of Hell', () => {
  it('stands in the middle of every map, in place of the middle ore rock, and nothing walks through it', () => {
    for (const teams of [2, 4]) {
      initWorld(77, teams);
      expect(G.hell.gate).toBe(true);
      const mid = layoutFor(teams).ore.filter(([x, y]) => onGate(x, y));
      expect(mid).toHaveLength(1);
      expect(G.ents.some((e) => e.type === 'source' && onGate(e.tx, e.ty))).toBe(false);
      for (let y = GATE_TILE[1]; y < GATE_TILE[1] + GATE_SIZE; y++) for (let x = GATE_TILE[0]; x < GATE_TILE[0] + GATE_SIZE; x++) expect(G.blk[y * MW + x]).toBe(1);
      // the middle field still has its ore round the gate
      let ore = 0;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) ore += G.ore[(GATE_TILE[1] + 1 + dy) * MW + GATE_TILE[0] + 1 + dx];
      expect(ore).toBeGreaterThan(5000);
    }
  });

  it('stands empty most of the time: now and then a few demons come out, prowl a while and go back in', () => {
    initWorld(1234);
    run(GATE_OPENS - 2);
    expect(demons()).toHaveLength(0);
    run(4 + BURST_GAP * 3);
    const out = demons();
    expect(out.length).toBeGreaterThanOrEqual(WANDER_SIZE[0]);
    expect(out.length).toBeLessThanOrEqual(WANDER_SIZE[1]);
    for (const d of out) {
      expect(d.team).toBe(-1);
      expect(UNIT[d.type as keyof typeof UNIT].demon).toBe(true);
      expect(Math.hypot(d.x - gateCentre().x, d.y - gateCentre().y)).toBeLessThan(5 * TS);
    }
    run(WANDER_STAY + 15);
    expect(demons()).toHaveLength(0); // back in the gate, leaving no bodies
    expect(G.decals.filter((d) => d.kind === 'corpse')).toHaveLength(0);
    // and it stays empty until the next time
    run(WANDER_EVERY[0] - WANDER_STAY - 30);
    expect(demons()).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it('lets a pack out just before each raid, and the survivors go back in after', () => {
    army(0, LEADER_TRAINED, 6, 'knight');
    for (const u of G.ents) if (u.team === 0) u.stance = 'passive';
    updHell();
    expect(G.hell.prey).toBe(0);
    G.hell.raidT = G.gameT + RAID_WARNING + 2;
    run(1.5);
    expect(demons()).toHaveLength(0);
    run(RAID_WARNING);
    const pack = demons();
    expect(pack.length).toBeGreaterThanOrEqual(RAID_SIZE[0]);
    expect(pack.length).toBeLessThanOrEqual(DEMON_CAP);
    run(2);
    for (const d of pack) if (!d.dead) expect(d.demon?.raid).toBe(0);
    // the leader stops being the leader: the pack goes home, waits a little, and goes back in
    if (G.stats[0]) G.stats[0].fighters = 0;
    run(2);
    for (const d of pack) if (!d.dead) expect(d.demon?.raid).toBe(-1);
    run(90);
    expect(demons()).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it('has no leader until a side has trained 20 fighting units; then it is the strongest army', () => {
    army(0, LEADER_TRAINED - 1, 12, 'knight');
    army(1, LEADER_TRAINED + 5, 4);
    expect(demonPrey()).toBe(1); // only side 1 has trained enough, though side 0 is stronger
    noteTrained(0, 'worker'); // Workers don't count
    expect(demonPrey()).toBe(1);
    noteTrained(0, 'knight');
    expect(demonPrey()).toBe(0);
    updHell();
    expect(G.hell.prey).toBe(0);
    expect(G.hell.archT).toBe(G.gameT + ARCHFIEND_FIRST);
  });

  it('leaves passers-by alone while it waits by the gate, and fights back when attacked', () => {
    const d = spawnDemon('fiend'), c = gateCentre();
    d.x = d.demon!.hx = c.x; d.y = d.demon!.hy = c.y + 2.5 * TS;
    const w = addUnit('worker', 0, c.x + 1.2 * TS, c.y + 2.5 * TS), sword = addUnit('swordsman', 0, c.x - 1.2 * TS, c.y + 2.5 * TS);
    sword.stance = 'engage';
    run(5);
    expect(w.hp).toBe(w.maxhp);
    expect(sword.hp).toBe(sword.maxhp);
    // troops passing by don't pick a fight with it either
    expect(acquire(sword, 6)).toBeNull();
    dealDamage(d, 10, sword);
    run(4);
    expect(sword.hp).toBeLessThan(sword.maxhp);
    expect(w.hp).toBe(w.maxhp);
    expect(errors).toEqual([]);
  });

  it('raids the leader now and then, going for its base and leaving the other side be', () => {
    army(0, LEADER_TRAINED, 6, 'knight');
    for (const u of G.ents) if (u.team === 0 && u.type === 'knight') u.stance = 'passive';
    army(1, LEADER_TRAINED, 2);
    const ds = [spawnDemon('imp'), spawnDemon('imp'), spawnDemon('fiend')];
    updHell();
    expect(G.hell.prey).toBe(0);
    expect(G.hell.raidT).toBeGreaterThan(G.gameT + 30); // not straight away
    G.hell.raidT = G.gameT;
    updHell();
    for (const d of ds) expect(d.demon?.raid).toBe(0);
    const yard = G.ents.find((e) => e.team === 0 && e.type === 'yard') as Ent;
    const hp0 = yard.hp, theirs = G.ents.filter((e) => e.team === 1).map((e) => [e, e.hp] as const);
    run(60);
    const hurt = G.ents.filter((e) => e.team === 0 && e.hp < e.maxhp).length + (yard.hp < hp0 ? 1 : 0);
    expect(hurt).toBeGreaterThan(0);
    for (const [e, hp] of theirs) expect(e.hp).toBe(hp);
    expect(errors).toEqual([]);
  });

  it('can be fought by the side it raids, and sends the giant Archfiend out now and then', () => {
    const d = spawnDemon('imp');
    d.demon!.raid = 0;
    const sword = addUnit('swordsman', 0, d.x + 3 * TS, d.y), other = addUnit('swordsman', 1, d.x - 3 * TS, d.y);
    expect(acquire(sword, 4)).toBe(d); // the side it's raiding takes it on
    expect(acquire(other, 4)).toBeNull(); // the others may let it pass
    other.dead = true;
    army(0, LEADER_TRAINED, 3);
    updHell();
    G.hell.archT = G.hell.raidT = G.gameT; // it climbs out with a raid
    updHell();
    expect(demons().filter((x) => x.type === 'archfiend')).toHaveLength(1);
    G.hell.archT = G.hell.raidT = G.gameT;
    updHell();
    expect(demons().filter((x) => x.type === 'archfiend')).toHaveLength(1); // one at a time
  });

  it('rescues a side making its last stand: demons, flyers among them, fly to its base and fight its attackers', () => {
    G.gameT = BRINK_AFTER + 1;
    const [x1, y1] = START_YARDS[1];
    const yard = G.ents.find((e) => e.team === 1 && e.type === 'yard') as Ent;
    const hall = addBuilding('power', 1, x1 + 5, y1 + 4, false);
    expect(onBrink(1)).toBe(false);
    yard.dead = true; G.byId.delete(yard.id); G.ents = G.ents.filter((e) => !e.dead); // its Town Hall has fallen
    const raiders = Array.from({ length: 5 }, (_, i) => addUnit('swordsman', 0, (x1 + 2 + i) * TS, (y1 + 1) * TS));
    for (const r of raiders) r.stance = 'passive'; // stand there, so the demons have someone to find
    expect(onBrink(1)).toBe(true);
    expect(onBrink(0)).toBe(false);
    updHell();
    const pack = demons();
    expect(pack.length).toBeGreaterThanOrEqual(4);
    expect(pack.filter((d) => d.type === 'drake')).toHaveLength(RESCUE_DRAKES);
    for (const d of pack) expect(d.demon?.aid).toBe(1);
    // side 0 takes the rescuers on; side 1 leaves them be
    const guard = addUnit('swordsman', 1, hall.x, hall.y + 2 * TS);
    for (const d of pack) expect(acquire(guard, 80, true)).not.toBe(d);
    guard.stance = 'passive'; // only the demons fight here
    // not again straight away
    updHell();
    expect(demons()).toHaveLength(pack.length);
    run(70);
    expect(raiders.some((r) => r.dead || r.hp < r.maxhp)).toBe(true);
    expect(hall.hp).toBe(hall.maxhp);
    expect(guard.hp).toBe(guard.maxhp);
    expect(G.hell.rescued?.[1]).toBeLessThan(G.gameT - 60);
    expect(G.gameT - (G.hell.rescued?.[1] ?? 0)).toBeLessThan(RESCUE_COOLDOWN);
    expect(errors).toEqual([]);
  });

  it('keeps demons hidden in the fog of war for online players', () => {
    G.reveal = false;
    const d = spawnDemon('imp');
    G.sight[0].fill(0);
    expect(visibleTo(d, 0)).toBe(false);
    G.sight[0][Math.floor(d.y / TS) * MW + Math.floor(d.x / TS)] = 2;
    expect(visibleTo(d, 0)).toBe(true);
  });
});
