import { describe, expect, it } from 'vitest';
import { G } from './state.ts';
import { MW, MH } from './const.ts';
import { initWorld } from './world.ts';
import { buildZone, canPlaceType, tileFree } from './building.ts';
import { nearPortal } from './map.ts';
import { BUILDING, BUILD_RADIUS, type BldType } from '../data/building.ts';

/**
 * The zone drawn while placing must say exactly what the game allows: a site has to touch it, and
 * every tile under the site must be open (inside the zone, open is what the zone says).
 */
describe('Build zone', () => {
  for (const reveal of [true, false])
    for (const type of ['power', 'barracks', 'derrick', 'palisade', 'turret'] as BldType[])
      it(`matches canPlaceType for ${type}${reveal ? '' : ' on a half-explored map'}`, () => {
        initWorld(7, 2);
        G.reveal = reveal;
        // units on a tile block it too, but they come and go: the zone leaves them out
        for (const e of G.ents) if (e.kind === 'unit') e.dead = true;
        const zone = buildZone(type, 0, new Uint8Array(MW * MH)), s = BUILDING[type].size;
        let allowed = 0;
        for (let ty = 0; ty + s <= MH; ty++)
          for (let tx = 0; tx + s <= MW; tx++) {
            let touches = false, open = true;
            for (let y = ty; y < ty + s; y++) for (let x = tx; x < tx + s; x++) { const z = zone[y * MW + x]; touches ||= z > 0; open &&= z ? z === 2 : tileFree(x, y, 0) && !nearPortal(x, y); }
            const ok = canPlaceType(type, tx, ty, 0);
            if (ok) allowed++;
            expect(ok, `${type} at ${tx},${ty}`).toBe(touches && open);
          }
        expect(allowed).toBeGreaterThan(0);
      });

  it(`reaches ${BUILD_RADIUS} tiles from a building, 30% past the old 3`, () => {
    expect(BUILD_RADIUS).toBe(4);
    initWorld(7, 2);
    G.reveal = true;
    for (const e of G.ents) if (e.kind === 'unit' || (e.kind === 'bld' && e.team === 0 && e.type !== 'yard')) e.dead = true;
    const yard = G.ents.find((e) => !e.dead && e.team === 0 && e.type === 'yard')!;
    const zone = buildZone('power', 0, new Uint8Array(MW * MH));
    const row = yard.ty;
    expect(zone[row * MW + yard.tx + yard.w + BUILD_RADIUS - 1]).toBeGreaterThan(0);
    expect(zone[row * MW + yard.tx + yard.w + BUILD_RADIUS]).toBe(0);
  });
});
