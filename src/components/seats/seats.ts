// The list of seats in a match: one row per side, with its colour, who it is (you, an ally, an enemy,
// another player), and a choice of computer difficulty or Closed. Used by the new game screen and by
// the online game room.
import { AI_LEVEL, MODES, seatOrder, type Mode } from '../../data/setup.ts';
import { teamColors } from '../../data/team.ts';

/** One seat as the list shows it. */
export interface SeatView {
  team: number;
  /** what fills it: a person (named), a computer at a difficulty, open for a person to join, or closed */
  kind: 'person' | 'computer' | 'open' | 'closed';
  /** the person's name */
  name?: string;
  /** the computer's difficulty */
  level?: string;
  /** the seat can be changed (by you, or by the host) */
  editable: boolean;
  /** offer "Open (for a player)" in the choices (online rooms) */
  openable?: boolean;
  /** it's you */
  you?: boolean;
}

/** "Team 1" / "Team 2" in a team game, else nothing. */
export const sideLabel = (mode: Mode, team: number): string => (mode === '2v2' ? `Team ${MODES[mode].ally[team] + 1}` : '');

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

function choiceList(s: SeatView): string {
  const opts = [
    ...(s.openable ? [['open', 'Open for a player']] : []),
    ...Object.entries(AI_LEVEL).map(([v, l]) => [v, `Computer: ${l.name}`]),
    ['closed', 'Closed'],
  ];
  const cur = s.kind === 'computer' ? s.level : s.kind;
  return opts.map(([v, label]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`).join('');
}

/** The seats as HTML rows; each editable seat has a select named `seat-<team>`. */
export function seatRows(mode: Mode, seats: SeatView[], me = 0): string {
  const byTeam = new Map(seats.map((s) => [s.team, s]));
  const allyOf = MODES[mode].ally;
  return seatOrder(mode).map((t) => {
    const s = byTeam.get(t);
    if (!s) return '';
    const c = teamColors(t);
    const role = s.you ? 'You' : mode === '2v2' ? (allyOf[t] === allyOf[me] ? 'Ally' : 'Enemy') : c.name;
    const side = sideLabel(mode, t);
    const label = `<span class="seat-label"><span class="seat-swatch" style="background:${c.m}"></span><span class="seat-role">${role}</span>${side ? `<small class="seat-side">${side}</small>` : ''}</span>`;
    let control: string;
    if (s.editable && s.kind !== 'person') control = `<select class="seat-select" name="seat-${t}" aria-label="${esc(`${c.name} seat`)}">${choiceList(s)}</select>`;
    else if (s.kind === 'person') control = `<span class="seat-name">${esc(s.name ?? 'Player')}</span>`;
    else if (s.kind === 'computer') control = `<span class="seat-name">Computer: ${AI_LEVEL[s.level as keyof typeof AI_LEVEL]?.name ?? 'Normal'}</span>`;
    else control = `<span class="seat-name seat-name--muted">${s.kind === 'open' ? 'Open for a player' : 'Closed'}</span>`;
    return `<div class="seat seat--${s.kind}${mode === '2v2' && t === seatOrder(mode)[2] ? ' seat--new-side' : ''}">${label}${control}</div>`;
  }).join('');
}
