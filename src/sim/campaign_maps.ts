// Lock the campaign maps (Alex: "Lock in campaign maps so they are always the same"): build each
// mission's map once and save it to public/campaign/<id>.json, which the game loads instead of
// generating the map. Run `npm run campaign-maps` only to make a NEW mission's map, or on purpose to
// redo one: it overwrites the saved maps that exist (pass mission ids to redo only those).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { G } from '../game/state.ts';
import { initWorld } from '../game/world.ts';
import { captureMap } from '../game/map_lock.ts';
import { MISSIONS, missionWorld } from '../data/campaign.ts';
import { matchOf, START_ARMY, START_RESOURCES } from '../data/setup.ts';
import { mulberry32 } from '../util/math.ts';

const dir = new URL('../../public/campaign/', import.meta.url);
mkdirSync(dir, { recursive: true });
const only = process.argv.slice(2);
G.headless = true;
for (const m of MISSIONS) {
  const file = new URL(`${m.id}.json`, dir);
  if (only.length ? !only.includes(m.id) : existsSync(file)) { console.log(`${m.id}: kept`); continue; }
  Math.random = mulberry32(m.setup.seed ?? 1); // scattered enemies face a random way: the same way every time
  const s = m.setup, { teams, ally, absent } = matchOf(s, false);
  initWorld(s.seed ?? 1, teams, { share: START_RESOURCES[s.resources].share, units: START_ARMY[s.army].units, ally, absent, ...missionWorld(m) });
  const scatterTeams = m.scatter ? Array.from({ length: G.teams }, (_, t) => t).filter((t) => G.ally[t] !== G.ally[0]) : [];
  const map = captureMap(scatterTeams);
  writeFileSync(file, JSON.stringify(map));
  console.log(`${m.id}: saved (${map.things.length} placed, ${Math.round(JSON.stringify(map).length / 1024)} KB)`);
}
