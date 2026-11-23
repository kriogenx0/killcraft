// Building upgrades: reaching an age doesn't restyle a side's buildings. Each one is upgraded on
// its own, for a price and some time, to take on the new age's look, with a little more health
// and a little more of whatever it does.
import { G, bldDef, say, type Ent } from './state.ts';
import { UPGRADE_BONUS, UPGRADE_HP, UPGRADE_MIN_TIME, UPGRADE_SHARE, UPGRADE_TIME, BUILDING, isWall, type BldType } from '../data/building.ts';
import { ERA } from '../data/era.ts';

/** The age a building's look and stats belong to. */
export const lvlOf = (b: Ent): number => b.lvl ?? 0;

/** Output multiplier from a building's upgrades (power, production speed, mill and derrick output, guns). */
export const refitBonus = (b: Ent | null | undefined): number => (b && b.kind === 'bld' ? 1 + UPGRADE_BONUS * lvlOf(b) : 1);

/** Full health of a building type at an upgrade level. */
export const bldHp = (type: BldType, lvl: number): number => Math.round(BUILDING[type].hp * (1 + UPGRADE_HP * lvl));

const round10 = (n: number): number => Math.round(n / 10) * 10;

/** What upgrading this building costs. */
export const refitPrice = (b: Ent): { ore: number; wood: number } => {
  const d = bldDef(b);
  return { ore: Math.max(50, round10(d.cost * UPGRADE_SHARE)), wood: round10((d.wood ?? 0) * UPGRADE_SHARE) };
};

/** Seconds an upgrade takes at full power. */
export const refitTime = (b: Ent): number => Math.max(UPGRADE_MIN_TIME, bldDef(b).t * UPGRADE_TIME);

/** Is this building behind its side's age? (Walls are a different structure each age, so they don't upgrade.) */
export const behind = (b: Ent): boolean => b.kind === 'bld' && !b.dead && b.done && !isWall(b.type) && lvlOf(b) < (G.era[b.team] ?? 0);

export const canRefit = (b: Ent): boolean => behind(b) && b.upT == null;

/** Start upgrading a building, paying in full; a second call cancels it with a full refund. */
export function toggleRefit(b: Ent): boolean {
  const p = refitPrice(b);
  if (b.upT != null) {
    G.credits[b.team] += p.ore;
    G.wood[b.team] += p.wood;
    b.upT = undefined;
    return true;
  }
  if (!canRefit(b)) return false;
  if (G.credits[b.team] < p.ore || G.wood[b.team] < p.wood) { say(b.team, G.credits[b.team] < p.ore ? 'Not enough ore' : 'Not enough wood'); return false; }
  G.credits[b.team] -= p.ore;
  G.wood[b.team] -= p.wood;
  b.upT = 0;
  return true;
}

/** Work on an upgrade under way; half speed on low power. */
export function updRefit(b: Ent, dt: number, slow: boolean): void {
  if (b.upT == null) return;
  b.upT += ((slow ? 0.5 : 1) * dt) / refitTime(b);
  if (b.upT < 1) return;
  b.upT = undefined;
  b.lvl = lvlOf(b) + 1;
  const max = bldHp(b.type as BldType, b.lvl);
  b.hp += max - b.maxhp;
  b.maxhp = max;
  say(b.team, `${bldDef(b).name} upgraded to the ${ERA[b.lvl]?.name ?? ''} age`);
}
