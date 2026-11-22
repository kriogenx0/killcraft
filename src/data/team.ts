export interface TeamColors {
  name: string;
  /** main, dark and light shades */
  m: string;
  d: string;
  l: string;
}

export const TEAM: TeamColors[] = [
  { name: 'Blue', m: '#2f6fe0', d: '#14337a', l: '#9cc2ff' },
  { name: 'Red', m: '#d33a2c', d: '#6e140c', l: '#ffa090' },
];

const NEUTRAL: TeamColors = { name: 'Neutral', m: '#999', d: '#555', l: '#ddd' };

export const teamColors = (team: number): TeamColors => TEAM[team] ?? NEUTRAL;

/** The human player's team. */
export const PLAYER = 0;
