// Bounty on the leader: a catch-up rule so a side that pulls far ahead becomes a target. Every few
// seconds the side whose army and buildings are worth clearly more than anyone else's is marked as
// the leader, and destroying its units or buildings pays the attacker part of their price.
// Tuning lives in data/economy.ts.
import { G, hooks, say, type Ent } from './state.ts';
import { UNIT, isUnitType } from '../data/unit.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import { BOUNTY_LEAD, BOUNTY_SHARE } from '../data/economy.ts';
import { teamColors } from '../data/team.ts';

const priceOf = (e: Ent): number => (isUnitType(e.type) ? UNIT[e.type].cost : e.kind === 'bld' ? BUILDING[e.type as BldType].cost : 0);

/** Gold price of everything each side has standing. */
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

/** Pay the attacker its bounty when something of the leader's is destroyed. */
export function payBounty(victim: Ent, by: Ent | null): void {
  if (!by || by.team < 0 || victim.team !== G.leader || by.team === victim.team) return;
  const gold = Math.round(priceOf(victim) * BOUNTY_SHARE);
  if (gold <= 0) return;
  G.credits[by.team] += gold;
  hooks.bounty(by.team, gold);
}
