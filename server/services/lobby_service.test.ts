import { describe, expect, it, vi } from 'vitest';
import { LobbyService, type Player } from './lobby_service.ts';

function setup() {
  const pairs: [Player, Player][] = [];
  const lobby = new LobbyService({ paired: (a, b) => pairs.push([a, b]), changed: vi.fn() });
  for (const id of ['a', 'b', 'c']) lobby.add(id, id.toUpperCase());
  return { lobby, pairs };
}

describe('lobby', () => {
  it('pairs two quick-match players, the first to wait plays first', () => {
    const { lobby, pairs } = setup();
    lobby.quick('a');
    expect(pairs).toHaveLength(0);
    expect(lobby.players.get('a')?.status).toBe('quick');
    lobby.quick('b');
    expect(pairs.map(([x, y]) => [x.id, y.id])).toEqual([['a', 'b']]);
    expect(lobby.players.get('a')?.status).toBe('playing');
    expect(lobby.players.get('b')?.status).toBe('playing');
  });

  it('never pairs a player with themselves', () => {
    const { lobby, pairs } = setup();
    lobby.quick('a');
    lobby.quick('a');
    expect(pairs).toHaveLength(0);
  });

  it('lists hosted games and lets someone else join', () => {
    const { lobby, pairs } = setup();
    lobby.create('a');
    const [game] = lobby.games();
    expect(game.host).toBe('A');
    expect(lobby.join('a', game.id)).toBe(false);
    expect(lobby.join('c', game.id)).toBe(true);
    expect(pairs.map(([x, y]) => [x.id, y.id])).toEqual([['a', 'c']]);
    expect(lobby.games()).toEqual([]);
  });

  it('removes a game when its host leaves or disconnects', () => {
    const { lobby } = setup();
    lobby.create('a');
    lobby.leave('a');
    expect(lobby.games()).toEqual([]);
    lobby.create('b');
    lobby.remove('b');
    expect(lobby.games()).toEqual([]);
    lobby.quick('c');
    lobby.remove('c');
    lobby.add('d', 'D');
    lobby.quick('d');
    expect(lobby.players.get('d')?.status).toBe('quick');
  });

  it('returns players to the lobby when their match ends', () => {
    const { lobby } = setup();
    lobby.quick('a');
    lobby.quick('b');
    lobby.finished('a');
    expect(lobby.players.get('a')?.status).toBe('idle');
  });
});
