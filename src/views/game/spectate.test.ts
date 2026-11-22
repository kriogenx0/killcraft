import { afterEach, describe, expect, it } from 'vitest';
import { G, type Ent } from '../../game/state.ts';
import { V, ownSelected, spectating } from './view_state.ts';

const ent = (team: number): Ent => ({ id: team + 1, team, dead: false, kind: 'unit' } as Ent);

describe('spectating', () => {
  afterEach(() => { G.demo = false; V.sel = []; V.team = 0; });

  it('lets a player order only their own selection', () => {
    V.sel = [ent(0), ent(1)];
    expect(ownSelected().map((e) => e.team)).toEqual([0]);
  });

  it('gives a spectator nothing to order, whatever is selected', () => {
    G.demo = true;
    V.sel = [ent(0), ent(1)];
    expect(spectating()).toBe(true);
    expect(ownSelected()).toEqual([]);
  });
});
