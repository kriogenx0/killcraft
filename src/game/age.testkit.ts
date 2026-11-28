// Test helper: put a side in an age with every building it has upgraded to match, since a
// building's upgrade opens the next round of what it offers (production.ts unitGates, techGate).
import { G } from './state.ts';

export function reachAge(team: number, era: number): void {
  G.era[team] = era;
  for (const e of G.ents) if (e.team === team && e.kind === 'bld') e.lvl = Math.max(e.lvl ?? 0, era);
}
