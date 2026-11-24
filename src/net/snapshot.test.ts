import { afterEach, describe, expect, it } from 'vitest';
import { G } from '../game/state.ts';
import { initWorld } from '../game/world.ts';
import { addBuilding } from '../game/entity.ts';
import { applySnapshot, decodeOre, encodeEnt, encodeOre, type EntRow } from './snapshot.ts';

afterEach(() => { G.visualOnly = false; initWorld(1); });

describe('following a server game', () => {
  it('never makes two entities with one id when a new one comes into view', () => {
    // the server's world: a Barracks with id 7, a Town Hall with id 8
    initWorld(1);
    const barracks = addBuilding('barracks', 0, 10, 10, false), yard = addBuilding('yard', 1, 20, 20, false);
    barracks.id = 7; yard.id = 8;
    barracks.hp = 300;
    const rows: EntRow[] = [encodeEnt(barracks, false)];
    const both: EntRow[] = [encodeEnt(barracks, false), encodeEnt(yard, false)];
    // the client: an empty world whose own id counter has reached 8 by chance
    Object.assign(G, { ents: [], visualOnly: true, nextId: 8 });
    G.byId.clear();
    applySnapshot(rows, [], () => {});
    G.nextId = 7; // the client's counter lands on a server id in use
    applySnapshot(both, [], () => {}); // the Town Hall comes into view
    applySnapshot(both, [], () => {});
    const ids = G.ents.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(G.ents).toHaveLength(2);
    expect(G.byId.get(7)?.hp).toBe(300);
  });

  it('sends the ground ore compactly and the client gets every tile back exactly', () => {
    initWorld(3);
    G.ore[0] = 1; G.ore[G.ore.length - 1] = 500; // both ends of the map
    const server = G.ore.slice(), msg = encodeOre();
    expect(msg.length).toBeLessThan((G.ore.byteLength * 4) / 3 / 2); // well under half the whole map
    G.ore.fill(7); // the client's stale copy
    decodeOre(msg);
    expect(G.ore).toEqual(server);
  });
});
