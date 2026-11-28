// Low power reminder: while a side uses more power than its plants make, its player is told so again
// every POWER_NAG seconds (Alex 2026-11-28: show messages regularly while power isn't enough).
import { G, say } from './state.ts';
import { power } from './entity.ts';
import { BUILDING } from '../data/building.ts';

/** seconds between low power reminders while the shortage lasts */
export const POWER_NAG = 40;

/** Remind each side that is short of power, at most once every POWER_NAG seconds. Run about once a second. */
export function powerAlarm(): void {
  if (G.visualOnly) return;
  G.powerT ??= [];
  for (let t = 0; t < G.teams; t++) {
    if (G.absent?.[t]) continue;
    const p = power(t);
    if (p.used <= p.made || G.gameT - (G.powerT[t] ?? -99) < POWER_NAG) continue;
    G.powerT[t] = G.gameT;
    say(t, `Low power (${p.used}/${p.made}): build a ${BUILDING.power.name}. Until then everything builds at half speed and defenses fire slower`);
  }
}
