// Bounty on the leader: a catch-up rule so a side that pulls far ahead becomes a target. Every few
// seconds the side whose army and buildings are worth clearly more than anyone else's is marked as
// the leader. Destroying its units or buildings earns part of their price as loot: the unit that
// landed the blow carries it, and it counts once that unit brings it home (like Aether). Loot a
// turret earns, or a carrier drops when it dies, is left on the ground as ore for gatherers.
// Tuning lives in data/economy.ts.
import { G, hooks, say, type Ent } from './state.ts';
import { TS } from './const.ts';
import { AETHER_BANK_REACH } from '../data/aether.ts';
import { bankAt } from './haul.ts';
import { edgeDist } from './path.ts';
import { UNIT, isUnitType } from '../data/unit.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import { BOUNTY_LEAD, BOUNTY_SHARE } from '../data/economy.ts';
import { teamColors } from '../data/team.ts';

const priceOf = (e: Ent): number => (isUnitType(e.type) ? UNIT[e.type].cost : e.kind === 'bld' ? BUILDING[e.type as BldType].cost : 0);

/** Ore price of everything each side has standing. */
export function worth(): number[] {
  const w = new Array(G.teams).fill(0);
  for (const e of G.ents) if (!e.dead && e.team >= 0 && e.kind !== 'source') w[e.team] += priceOf(e);
  return w;
}

/** Work out who is in the lead (-1 if nobody is clearly ahead) and tell everyone when it changes. */
export function updLeader(): void {
  const w = worth(), order = w.map((v, t) => t).sort((a, b) => w[b] - w[a]);
  const [first, second] = order;
  const leader = w[first] > w[second] * BOUNTY_LEAD ? first : -1;
  if (leader === G.leader) return;
  G.leader = leader;
  if (leader < 0) return;
  for (let t = 0; t < G.teams; t++)
    say(t, t === leader ? 'You are in the lead: enemies earn a bounty for everything of yours they destroy' : `${teamColors(leader).name} leads: bounty on their units and buildings`);
}

/**
 * Something is about to be destroyed: if it's the leader's, the unit that destroyed it picks up the
 * bounty as loot. A building that destroyed it leaves the loot as ore where the victim falls.
 */
export function payBounty(victim: Ent, by: Ent | null): void {
  if (!by || by.team < 0 || victim.team !== G.leader || by.team === victim.team) return;
  const ore = Math.round(priceOf(victim) * BOUNTY_SHARE);
  if (ore <= 0) return;
  if (by.kind === 'unit' && !by.dead) by.loot = (by.loot ?? 0) + ore;
  else victim.carry += ore; // dropped with the victim's salvage
}

/** Loot counts once its carrier is near its own Construction Yard or a Refinery. */
export function bankLoot(): void {
  for (const u of G.ents) {
    if (u.dead || u.kind !== 'unit' || !u.loot) continue;
    const home = bankAt(u, ['yard', 'refinery']);
    if (!home || edgeDist(u, home) > AETHER_BANK_REACH * TS) continue;
    G.credits[u.team] += u.loot;
    hooks.gain(u.team, u.x, u.y, 'ore', u.loot, u.id);
    hooks.bounty(u.team, u.loot);
    say(u.team, `Bounty brought home: ${Math.round(u.loot)} ore`);
    u.loot = 0;
  }
}
