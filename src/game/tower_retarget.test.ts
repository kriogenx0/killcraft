import { beforeEach, describe, expect, it } from 'vitest';
import { G, hooks } from './state.ts';
import { MH, MW, STEP, TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit } from './entity.ts';
import { orderAttack } from './order.ts';

function run(seconds: number): void { for (let i = 0; i < seconds / STEP; i++) update(STEP); }
function openGround(len: number): [number, number] {
  for (let ty = 6; ty < MH - 6; ty++)
    for (let tx = 6; tx < MW - len - 6; tx++) {
      let ok = true;
      for (let y = ty - 4; y <= ty + 4 && ok; y++) for (let x = tx - 2; x <= tx + len + 2 && ok; x++) ok = !G.blk[y * MW + x];
      if (ok) return [(tx + 0.5) * TS, (ty + 0.5) * TS];
    }
  throw new Error('no open ground');
}

describe('a War Balloon right overhead', () => {
  beforeEach(() => {
    for (const a of ais) a.on = false;
    G.reveal = true;
    hooks.error = (e) => { throw e; };
    initWorld(1234);
    for (const e of G.ents) if (e.kind === 'unit') e.dead = true;
    G.ents = G.ents.filter((e) => !e.dead);
  });

  // Alex: a tower shot down one balloon, then ignored the next one bombing it from straight above
  for (const type of ['tower', 'pillbox', 'flak'] as const) {
    it(`a ${type} downs the first balloon, then the one bombing it from straight above`, () => {
      const [x, y] = openGround(6);
      const b = addBuilding(type, 0, Math.floor(x / TS), Math.floor(y / TS), false);
      b.hp = b.maxhp = 1e6;
      const first = addUnit('balloon', 1, b.x + 3 * TS, b.y);
      first.hp = 1;
      run(3);
      expect(first.dead).toBe(true);
      // the next one drifts in right over the tower and bombs it
      const next = addUnit('balloon', 1, b.x + 4, b.y - 3);
      orderAttack(next, b);
      run(8);
      expect(Math.hypot(next.x - b.x, next.y - b.y)).toBeLessThan(12);
      expect(next.hp).toBeLessThan(next.maxhp);
    });
  }

  it('riflemen shoot a balloon bombing them from straight above', () => {
    const [x, y] = openGround(6);
    const r = addUnit('rifleman', 0, x, y), b = addUnit('balloon', 1, x, y);
    r.hp = r.maxhp = 1e6;
    orderAttack(b, r);
    run(6);
    expect(b.hp).toBeLessThan(b.maxhp);
  });
});
