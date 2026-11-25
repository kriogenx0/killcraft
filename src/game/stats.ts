// Each side's record of the match, for the end screen: units trained, lost and killed, what it
// gathered and spent, when it reached each age, and its upgrade levels. The engine keeps the running
// counts in G.stats; summarize() turns them into what the end screen shows (the server sends that
// to online players, whose own copy of the game doesn't decide kills or income).
import { G, allied, type Ent } from './state.ts';
import { UPGRADE_TRACKS, type UpgradeTrack } from '../data/era.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import { UNIT, type UnitType } from '../data/unit.ts';

export type StatRes = 'ore' | 'wood' | 'oil' | 'aether';
export const STAT_RES: StatRes[] = ['ore', 'wood', 'oil', 'aether'];
export type ResTally = Record<StatRes, number>;

/** The running counts for one side (kept in G.stats, so a saved game keeps them). */
export interface SideStats {
  /** units trained (starting Workers and free ones from a Refinery not counted) */
  trained: number;
  /** of those, fighting units (not Workers, Harvesters or Medics): the Gate of Hell's leader rule counts them (data/hell.ts) */
  fighters?: number;
  /** this side's units destroyed */
  lost: number;
  /** enemy units this side destroyed */
  killed: number;
  /** structures this side finished (wall segments not counted) */
  built: number;
  /** enemy structures this side destroyed */
  razed: number;
  /** most fighting units on the field at once */
  peakArmy: number;
  /** resources brought home */
  got: ResTally;
  /** stock at the start, to work out what was spent */
  start: ResTally;
  /** game seconds each age was reached (index = age; age 0 at 0) */
  ages: number[];
}

/** What the end screen shows for one side. */
export interface SideSummary {
  team: number;
  trained: number;
  lost: number;
  killed: number;
  built: number;
  razed: number;
  peakArmy: number;
  gathered: ResTally;
  spent: ResTally;
  ages: number[];
  upg: Record<UpgradeTrack, number>;
  heal: number;
  /** game seconds it was knocked out, if it was */
  out?: number;
}

const tally = (): ResTally => ({ ore: 0, wood: 0, oil: 0, aether: 0 });
const stockOf = (t: number): ResTally => ({ ore: G.credits[t] ?? 0, wood: G.wood[t] ?? 0, oil: G.oil[t] ?? 0, aether: G.aether[t] ?? 0 });

/** Fresh counts for every side, taking each side's stock now as its starting stock. Called by initWorld. */
export function resetStats(): void {
  G.stats = Array.from({ length: G.teams }, (_, t) => ({
    trained: 0, lost: 0, killed: 0, built: 0, razed: 0, peakArmy: 0, got: tally(), start: stockOf(t), ages: [0],
  }));
}

/** Take each side's stock as its starting stock again: the first step calls this, after any handicap bonus is applied. */
export function markStartStock(): void {
  for (let t = 0; t < G.teams; t++) { const s = of(t); if (s) s.start = stockOf(t); }
}

/** One side's counts (a game saved before stats existed starts counting now). */
function of(team: number): SideStats | null {
  if (team < 0 || team >= G.teams || G.visualOnly) return null;
  G.stats ??= [];
  return (G.stats[team] ??= { trained: 0, lost: 0, killed: 0, built: 0, razed: 0, peakArmy: 0, got: tally(), start: stockOf(team), ages: [0] });
}

export function noteTrained(team: number, type?: UnitType): void {
  const s = of(team);
  if (!s) return;
  s.trained++;
  const d = type ? UNIT[type] : null;
  if (d?.weapon && !d.haul) s.fighters = (s.fighters ?? 0) + 1;
}

export function noteBuilt(b: Ent): void {
  const s = of(b.team);
  if (s && !BUILDING[b.type as BldType]?.wall) s.built++;
}

export function noteGathered(team: number, kind: StatRes, amount: number): void {
  const s = of(team);
  if (s && amount > 0) s.got[kind] += amount;
}

/** Something was destroyed by damage from `by` (if known). */
export function noteKill(victim: Ent, by: Ent | null): void {
  const unit = victim.kind === 'unit', bld = victim.kind === 'bld';
  if (!unit && !bld) return;
  const v = of(victim.team);
  if (v && unit) v.lost++;
  if (!by || victim.team < 0 || !(by.team >= 0) || allied(by.team, victim.team)) return;
  const k = of(by.team);
  if (!k) return;
  if (unit) k.killed++;
  else if (!BUILDING[victim.type as BldType]?.wall) k.razed++;
}

/** Called about once a second: ages reached and the size of each army. */
export function sampleStats(): void {
  const army = new Array<number>(G.teams).fill(0);
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'unit' || e.team < 0 || e.team >= G.teams) continue;
    const d = UNIT[e.type as UnitType];
    if (d?.weapon && e.type !== 'worker' && !d.haul) army[e.team]++;
  }
  for (let t = 0; t < G.teams; t++) {
    const s = of(t);
    if (!s) continue;
    s.peakArmy = Math.max(s.peakArmy, army[t]);
    const era = G.era[t] ?? 0;
    for (let a = s.ages.length; a <= era; a++) s.ages[a] = Math.round(G.gameT);
  }
}

/** Every seated side's record as the game stands, for the end screen. */
export function summarize(): SideSummary[] {
  const out: SideSummary[] = [];
  for (let t = 0; t < G.teams; t++) {
    if (G.absent?.[t]) continue;
    const s = of(t) ?? { trained: 0, lost: 0, killed: 0, built: 0, razed: 0, peakArmy: 0, got: tally(), start: tally(), ages: [0] };
    const now = stockOf(t), spent = tally(), gathered = tally();
    for (const r of STAT_RES) {
      gathered[r] = Math.round(s.got[r]);
      spent[r] = Math.max(0, Math.round(s.start[r] + s.got[r] - now[r]));
    }
    const ages = s.ages.slice();
    for (let a = ages.length; a <= (G.era[t] ?? 0); a++) ages[a] = Math.round(G.gameT);
    const upg = Object.fromEntries(UPGRADE_TRACKS.map((k) => [k, G.upg[t]?.[k] ?? 0])) as Record<UpgradeTrack, number>;
    const out_ = G.outLog?.find((o) => o.team === t);
    out.push({
      team: t, trained: s.trained, lost: s.lost, killed: s.killed, built: s.built, razed: s.razed, peakArmy: s.peakArmy,
      gathered, spent, ages, upg, heal: G.heal[t] ?? 0, ...(out_ ? { out: Math.round(out_.t) } : {}),
    });
  }
  return out;
}
