// The end-of-game stats table: one column per side (allies side by side), rows grouped into ages,
// units, resources and upgrades. Built from stats.ts summaries: the local engine's in a solo game, the
// server's in an online one.
import { G, allied } from '../../game/state.ts';
import { ERA } from '../../data/era.ts';
import { teamColors } from '../../data/team.ts';
import { STAT_RES, type SideSummary, type StatRes } from '../../game/stats.ts';
import { formatTime } from './hud.ts';

const RES_LABEL: Record<StatRes, string> = { ore: 'Ore', wood: 'Wood', oil: 'Oil', aether: 'Aether' };

/** 12345 → "12.3k": keeps four columns readable on a phone. */
export const compact = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : n.toLocaleString('en-US');

const lvl = (n: number): string => (n > 0 ? `Lvl ${n}` : '—');

interface Row {
  label: string;
  cell: (s: SideSummary) => string;
  /** a number to pick out the best side by (more is better) */
  score?: (s: SideSummary) => number;
}

/**
 * Fill `el` with the stats table, or hide it when there are none (an online game from an older server).
 * `name` gives each side's label (a player's name or its color).
 */
export function renderEndStats(el: HTMLElement, sides: SideSummary[] | null | undefined, name: (team: number) => string, winner: number): void {
  el.replaceChildren();
  el.hidden = !sides?.length;
  if (!sides?.length) return;
  // allies next to each other, the winners first
  const order = sides.slice().sort((a, b) => {
    const wa = winner >= 0 && allied(a.team, winner) ? 0 : 1, wb = winner >= 0 && allied(b.team, winner) ? 0 : 1;
    return wa - wb || (G.ally[a.team] ?? a.team) - (G.ally[b.team] ?? b.team) || a.team - b.team;
  });
  const num = (f: (s: SideSummary) => number): Pick<Row, 'cell' | 'score'> => ({ cell: (s) => compact(f(s)), score: f });
  const time = (t: number | undefined) => (t == null ? '—' : formatTime(t));
  const any = (f: (s: SideSummary) => number) => order.some((s) => f(s) > 0);

  const sections: [string, Row[]][] = [
    ['Ages', [
      { label: 'Age reached', cell: (s) => ERA[s.ages.length - 1]?.name ?? '—', score: (s) => s.ages.length },
      ...ERA.slice(1).map((e, i): Row => ({ label: e.name, cell: (s) => time(s.ages[i + 1]) })),
      ...(order.some((s) => s.out != null) ? [{ label: 'Knocked out', cell: (s: SideSummary) => time(s.out) }] : []),
    ]],
    ['Units', [
      { label: 'Trained', ...num((s) => s.trained) },
      { label: 'Lost', cell: (s) => compact(s.lost) },
      { label: 'Enemy units killed', ...num((s) => s.killed) },
      { label: 'Largest army', ...num((s) => s.peakArmy) },
      { label: 'Buildings built', ...num((s) => s.built) },
      { label: 'Buildings destroyed', ...num((s) => s.razed) },
    ]],
    ['Resources', STAT_RES.filter((r) => r !== 'aether' || any((s) => s.gathered.aether + s.spent.aether)).flatMap((r): Row[] => [
      { label: `${RES_LABEL[r]} gathered`, ...num((s) => s.gathered[r]) },
      { label: `${RES_LABEL[r]} spent`, cell: (s) => compact(s.spent[r]) },
    ])],
    ['Upgrades', [
      { label: 'Infantry weapons', cell: (s) => lvl(s.upg.infWeapon), score: (s) => s.upg.infWeapon },
      { label: 'Infantry armor', cell: (s) => lvl(s.upg.infArmor), score: (s) => s.upg.infArmor },
      { label: 'Vehicle weapons', cell: (s) => lvl(s.upg.vehWeapon), score: (s) => s.upg.vehWeapon },
      { label: 'Vehicle armor', cell: (s) => lvl(s.upg.vehArmor), score: (s) => s.upg.vehArmor },
      { label: 'Healing', cell: (s) => lvl(s.heal), score: (s) => s.heal },
    ]],
  ];

  const table = document.createElement('table');
  table.className = 'end-stats';
  const head = table.createTHead().insertRow();
  head.append(Object.assign(document.createElement('th'), { scope: 'col' }));
  for (const s of order) {
    const th = document.createElement('th'), c = teamColors(s.team);
    th.scope = 'col';
    th.className = 'end-stats-side';
    th.style.setProperty('--side', c.m);
    th.textContent = name(s.team);
    if (winner >= 0 && allied(s.team, winner)) th.classList.add('end-stats-side--won');
    head.append(th);
  }
  for (const [title, rows] of sections) {
    const body = table.createTBody();
    const sec = body.insertRow(), th = document.createElement('th');
    th.scope = 'colgroup';
    th.colSpan = order.length + 1;
    th.className = 'end-stats-section';
    th.textContent = title;
    sec.append(th);
    for (const row of rows) {
      const tr = body.insertRow(), label = document.createElement('th');
      label.scope = 'row';
      label.textContent = row.label;
      tr.append(label);
      // the best side on this row stands out (when there's a clear one)
      const scores = row.score ? order.map(row.score) : [], top = Math.max(0, ...scores);
      const best = top > 0 && scores.filter((v) => v === top).length < order.length ? top : null;
      order.forEach((s, i) => {
        const td = tr.insertCell();
        td.textContent = row.cell(s);
        if (best != null && scores[i] === best) td.classList.add('end-stats-best');
      });
    }
  }
  el.append(table);
}
