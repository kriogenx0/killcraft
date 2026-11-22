// Turns a batch of match results into a Markdown balance report.
import type { MatchResult, TeamStats } from './match.ts';
import { priceOf } from './match.ts';
import { ERA } from '../data/era.ts';
import { TEAM } from '../data/team.ts';

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');
const mmss = (s: number | null | undefined) => (s == null || !Number.isFinite(s) ? '–' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '–');
const sumInto = (into: Record<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v; };

function table(head: string[], rows: (string | number)[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map((_, i) => (i ? ' ---: ' : ' --- ')).join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function report(results: MatchResult[]): string {
  const n = results.length, teams = results[0]?.teams ?? 4, sides = results.flatMap((r) => r.stats);
  const decided = results.filter((r) => r.winner >= 0);
  const out: string[] = [];
  out.push(`# Balance report: ${n} matches, ${teams} computer players`);
  out.push('');
  const lengths = results.map((r) => r.length);
  out.push(`- Decided: ${decided.length} (${pct(decided.length, n)}); time limit reached: ${results.filter((r) => r.timedOut).length}; draws: ${n - decided.length - results.filter((r) => r.timedOut).length}`);
  out.push(`- Match length: median ${mmss(quantile(lengths, 0.5))}, 10th–90th percentile ${mmss(quantile(lengths, 0.1))}–${mmss(quantile(lengths, 0.9))}`);
  out.push(`- First kill between sides: median ${mmss(quantile(results.flatMap((r) => (r.firstBlood == null ? [] : [r.firstBlood])), 0.5))}`);
  const errs = results.reduce((a, r) => a + r.errors, 0);
  if (errs) out.push(`- Engine errors caught: ${errs}`);

  out.push('', '## Win rate by starting corner', '');
  out.push(table(['Side', 'Wins', 'Win rate', 'Avg place', 'Knocked out (median)'], Array.from({ length: teams }, (_, t) => {
    const mine = sides.filter((s) => s.team === t), outs = mine.flatMap((s) => (s.outAt == null ? [] : [s.outAt]));
    return [TEAM[t]?.name ?? `Team ${t}`, decided.filter((r) => r.winner === t).length, pct(decided.filter((r) => r.winner === t).length, decided.length), f1(mean(mine.map((s) => s.place))), mmss(quantile(outs, 0.5))];
  })));

  out.push('', '## Ages', '');
  out.push(table(['Age', 'Sides that got there', 'Reached (median)', '10th–90th', 'Winners there at the end'], ERA.map((era, a) => {
    if (!a) return [era.name, '100%', '0:00', '–', '100%'];
    const at = sides.flatMap((s) => (s.ageAt[a] == null ? [] : [s.ageAt[a] as number]));
    const winners = decided.map((r) => r.stats[r.winner]);
    return [era.name, pct(at.length, sides.length), mmss(quantile(at, 0.5)), `${mmss(quantile(at, 0.1))}–${mmss(quantile(at, 0.9))}`, pct(winners.filter((s) => s.ageAt[a] != null).length, winners.length)];
  })));
  const heal = [1, 2, 3].map((h) => sides.flatMap((s) => (s.healAt[h] == null ? [] : [s.healAt[h] as number])));
  out.push('', `Healing research: level 1 by ${pct(heal[0].length, sides.length)} of sides (median ${mmss(quantile(heal[0], 0.5))}), level 2 by ${pct(heal[1].length, sides.length)}, level 3 by ${pct(heal[2].length, sides.length)}.`);

  out.push('', '## Economy (per side)', '');
  const perMin = sides.map((s) => s.income / Math.max(1, (s.outAt ?? results.find((r) => r.stats.includes(s))?.length ?? 1) / 60));
  out.push(table(['', 'Median', '10th', '90th'], [
    ['Gold harvested per minute alive', ...[0.5, 0.1, 0.9].map((q) => Math.round(quantile(perMin, q)))],
    ['Gold harvested in total', ...[0.5, 0.1, 0.9].map((q) => Math.round(quantile(sides.map((s) => s.income), q)))],
    ['Average gold in the bank', ...[0.5, 0.1, 0.9].map((q) => Math.round(quantile(sides.map((s) => s.avgBank), q)))],
    ['Average wood in store', ...[0.5, 0.1, 0.9].map((q) => Math.round(quantile(sides.map((s) => s.avgWood), q)))],
    ['Average oil in store', ...[0.5, 0.1, 0.9].map((q) => Math.round(quantile(sides.map((s) => s.avgOil), q)))],
    ['Peak bank', ...[0.5, 0.1, 0.9].map((q) => Math.round(quantile(sides.map((s) => s.peakBank), q)))],
    ['Largest army', ...[0.5, 0.1, 0.9].map((q) => Math.round(quantile(sides.map((s) => s.peakArmy), q)))],
  ]));

  // what each type built, killed and was worth
  const built: Record<string, number> = {}, lost: Record<string, number> = {}, kills: Record<string, number> = {}, value: Record<string, number> = {};
  for (const s of sides) { sumInto(built, s.built); sumInto(lost, s.lost); sumInto(kills, s.killsBy); sumInto(value, s.killValueBy); }
  const types = Object.keys({ ...built, ...kills }).sort((a, b) => (built[b] ?? 0) * priceOf(b) - (built[a] ?? 0) * priceOf(a));
  out.push('', '## Units and structures', '');
  out.push('Prices count gold, wood and oil together. Value traded is the price of everything a type destroyed, divided by what was spent building that type. Above 1 means it more than paid for itself.', '');
  out.push(table(['Type', 'Built per side', 'Share of spending', 'Lost', 'Kills', 'Kills each', 'Value traded'], (() => {
    const spentAll = types.reduce((a, t) => a + (built[t] ?? 0) * priceOf(t), 0);
    return types.map((t) => {
      const b = built[t] ?? 0, cost = b * priceOf(t);
      return [t, f1(b / sides.length), pct(cost, spentAll), lost[t] ?? 0, kills[t] ?? 0, b ? f1((kills[t] ?? 0) / b) : '–', cost ? (value[t] ?? 0) / cost >= 10 ? Math.round((value[t] ?? 0) / cost) : f1((value[t] ?? 0) / cost) : '–'];
    });
  })()));

  // what winners did differently from everyone else
  if (decided.length) {
    const winners = decided.map((r) => r.stats[r.winner]), others = decided.flatMap((r) => r.stats.filter((s) => s.team !== r.winner));
    const share = (group: TeamStats[]) => {
      const spend: Record<string, number> = {};
      let total = 0;
      for (const s of group) for (const [k, v] of Object.entries(s.built)) { spend[k] = (spend[k] ?? 0) + v * priceOf(k); total += v * priceOf(k); }
      return (k: string) => (total ? (spend[k] ?? 0) / total : 0);
    };
    const w = share(winners), o = share(others);
    out.push('', '## What winners spent on, compared with everyone else', '');
    out.push(table(['Type', 'Winners', 'Others', 'Difference'], types
      .map((t) => [t, w(t), o(t)] as [string, number, number])
      .filter(([, a, b]) => a + b > 0.01)
      .sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]))
      .map(([t, a, b]) => [t, `${(a * 100).toFixed(1)}%`, `${(b * 100).toFixed(1)}%`, `${a > b ? '+' : ''}${((a - b) * 100).toFixed(1)} pts`])));
    out.push('', `Winners harvested a median ${Math.round(quantile(winners.map((s) => s.income), 0.5))} gold; first knocked out sides harvested ${Math.round(quantile(decided.flatMap((r) => r.stats.filter((s) => s.place === teams)).map((s) => s.income), 0.5))}.`);
  }
  // how much does an early lead decide the match?
  if (decided.length) {
    out.push('', '## Does an early lead snowball?', '');
    out.push('The leader at a checkpoint has the most gold harvested so far plus army on the field. Even odds would be 1 in ' + teams + '.', '');
    const rows: (string | number)[][] = [];
    for (const min of [5, 10, 15, 20]) {
      const at = decided.filter((r) => r.length > min * 60 + 30 && r.stats.every((s) => s.timeline.some((p) => p.t === min * 60)));
      if (at.length < 5) continue;
      let leaderWins = 0, lastWins = 0;
      for (const r of at) {
        const score = r.stats.map((s) => { const p = s.timeline.find((q) => q.t === min * 60); return p ? p.income + p.army : 0; });
        const lead = score.indexOf(Math.max(...score)), last = score.indexOf(Math.min(...score));
        if (r.winner === lead) leaderWins++;
        if (r.winner === last) lastWins++;
      }
      rows.push([`${min}:00`, at.length, pct(leaderWins, at.length), pct(lastWins, at.length)]);
    }
    out.push(table(['Checkpoint', 'Matches still going', 'Leader went on to win', 'Last place went on to win'], rows));
  }
  return out.join('\n');
}
