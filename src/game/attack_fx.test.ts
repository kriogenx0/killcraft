// Every armed unit's attack shows: something visible lands on the target in the very frame its
// health drops (a tracer, a sword arc, an impact), never before or after.
import { beforeEach, describe, expect, it } from 'vitest';
import { G, type Ent } from './state.ts';
import { TS } from './const.ts';
import { ais } from './ai.ts';
import { initWorld } from './world.ts';
import { addUnit } from './entity.ts';
import { canAttack, fire, updProjs } from './combat.ts';
import { updFx } from './fx.ts';
import { UNIT, UNIT_TYPES, type UnitType } from '../data/unit.ts';
import { WEAPON, type WeaponType } from '../data/weapon.ts';

const FRAME = 1 / 60;
const TARGETS: UnitType[] = ['rifleman', 'tank', 'helicopter'];

beforeEach(() => {
  G.reveal = true;
  G.demo = false;
  G.headless = false;
  ais[0].on = ais[1].on = false;
  initWorld(4321);
  G.ents = [];
  G.fx = [];
  G.projs = [];
});

/** Fire once; returns the visuals near the target in the frame it was hurt, and how long that took. */
function strike(type: UnitType): { near: number; t: number; tracer: boolean } {
  const x = 30 * TS, y = 30 * TS, w = UNIT[type].weapon as WeaponType;
  let tgt: Ent | null = null;
  for (const tt of TARGETS) {
    const cand = addUnit(tt, 1, x + Math.max(10, WEAPON[w].range * TS * 0.7), y);
    if (!tgt && canAttack(addUnit(type, 0, x, y), cand)) tgt = cand; else cand.dead = true;
  }
  if (!tgt) throw new Error(`${type} can't hit anything`);
  G.vis.fill(2);
  const u = G.ents.find((e) => e.team === 0 && !e.dead)!;
  const hp0 = tgt.hp;
  const near = () => G.fx.filter((p) => Math.hypot(p.x - tgt.x, p.y - tgt.y) < 40 && p.life === 0 && p.kind !== 'tracer').length;
  fire(u, w, tgt);
  for (let t = 0; t < 6; t += FRAME) {
    if (tgt.hp < hp0) return { near: near(), t, tracer: G.fx.some((p) => p.kind === 'tracer') };
    updFx(FRAME);
    updProjs(FRAME);
  }
  return { near: 0, t: Infinity, tracer: false };
}

describe('attack visuals', () => {
  for (const type of UNIT_TYPES.filter((t) => UNIT[t].weapon)) {
    it(`${type}: the hit shows the moment it lands`, () => {
      const r = strike(type), w = WEAPON[UNIT[type].weapon as WeaponType];
      expect(r.t).toBeLessThan(6);
      expect(r.near).toBeGreaterThan(0);
      if (w.proj === 'bullet') expect(r.tracer).toBe(true);
    });
  }
});
