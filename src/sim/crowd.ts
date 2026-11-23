// Measures how often moving units walk into each other: every step, each pair of ground units
// overlapping by more than BUMP px where at least one of them is walking counts as a bump.
// Used by the steering test and by `node src/sim/crowd.ts [matches] [seconds]`.
import { G, isAir, unitDef } from '../game/state.ts';
import { STEP } from '../game/const.ts';
import { ais } from '../game/ai.ts';
import { initWorld, update } from '../game/world.ts';
import { shoved } from '../game/move.ts';
import { mulberry32 } from '../util/math.ts';

/** Overlap (px) of two bodies that counts as walking into someone. */
export const BUMP = 0;

export interface Crowding {
  /** bumping pairs per second of walking, summed over all walking units */
  bumpRate: number;
  /** px walking units were shoved by collisions, per second walked */
  shove: number;
  /** seconds walked by all units */
  walked: number;
}

/** Bumps among the ground units right now, and how many of them are walking. */
export function bumpsNow(): { bumps: number; walking: number } {
  const us = G.ents.filter((e) => !e.dead && e.kind === 'unit' && !isAir(e)).sort((a, b) => a.x - b.x);
  const rad = us.map((u) => unitDef(u).radius);
  let bumps = 0;
  for (let i = 0; i < us.length; i++)
    for (let j = i + 1; j < us.length; j++) {
      const dx = us[j].x - us[i].x;
      if (dx > 40) break;
      if (!us[i].moving && !us[j].moving) continue;
      if (rad[i] + rad[j] - Math.hypot(dx, us[j].y - us[i].y) > BUMP) bumps++;
    }
  return { bumps, walking: us.filter((u) => u.moving).length };
}

export function crowding(seed: number, seconds: number, teams = 4): Crowding {
  const prevRandom = Math.random;
  Math.random = mulberry32(seed ^ 0x5eed);
  G.headless = true; G.demo = true; G.reveal = false; G.viewer = -1; G.human = [];
  initWorld(seed, teams);
  G.viewer = -1;
  for (let t = 0; t < G.teams; t++) ais[t].on = true;
  let bumps = 0, walked = 0;
  shoved.px = 0;
  try {
    while (!G.over && G.gameT < seconds) {
      update(STEP);
      const b = bumpsNow();
      bumps += b.bumps * STEP;
      walked += b.walking * STEP;
    }
  } finally {
    Math.random = prevRandom;
  }
  return { bumpRate: bumps / Math.max(1, walked), shove: shoved.px / Math.max(1, walked), walked };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2] ?? 2), secs = Number(process.argv[3] ?? 600);
  for (let s = 0; s < n; s++) {
    const seed = 1 + s * 7919, c = crowding(seed, secs);
    console.log(`seed ${seed}: shoved ${c.shove.toFixed(2)} px per second walked, ${(c.bumpRate * 100).toFixed(2)} bumps per 100 s, over ${Math.round(c.walked)}s walked`);
  }
}
