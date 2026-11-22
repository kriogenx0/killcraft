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
    expect(lobby.view('a')?.hosting).toBe(game.id); // for the invite link
    expect(lobby.view('c')?.hosting).toBeNull();
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

  it('lists who is online, you first, then free players, then players in a match', () => {
    const { lobby } = setup();
    lobby.add('d', 'D');
    lobby.quick('c');
    lobby.quick('d');
    const view = lobby.view('b');
    expect(view?.you).toBe('b');
    expect(view?.online).toBe(4);
    expect(view?.players.map((p) => [p.id, p.status, p.opponent])).toEqual([
      ['b', 'idle', undefined], ['a', 'idle', undefined], ['c', 'playing', 'D'], ['d', 'playing', 'C'],
    ]);
  });

  it('lets a player challenge another, who can accept', () => {
    const { lobby, pairs } = setup();
    lobby.create('a');
    expect(lobby.invite('a', 'b')).toBe(true);
    expect(lobby.games()).toEqual([]); // challenging replaces the hosted game
    expect(lobby.view('a')?.inviting).toBe('b');
    expect(lobby.view('b')?.invites).toEqual([{ id: 'a', name: 'A' }]);
    expect(lobby.accept('c', 'a')).toBe(false); // not challenged
    expect(lobby.accept('b', 'a')).toBe(true);
    expect(pairs.map(([x, y]) => [x.id, y.id])).toEqual([['a', 'b']]);
    expect(lobby.view('a')?.inviting).toBeNull();
  });

  it('drops challenges that are declined, cancelled, or whose players leave or start playing', () => {
    const { lobby } = setup();
    lobby.invite('a', 'b');
    expect(lobby.decline('b', 'a')?.id).toBe('a');
    expect(lobby.view('b')?.invites).toEqual([]);

    lobby.invite('a', 'b');
    lobby.leave('a');
    expect(lobby.accept('b', 'a')).toBe(false);

    lobby.invite('a', 'b');
    lobby.remove('b');
    expect(lobby.view('a')?.inviting).toBeNull();

    lobby.add('d', 'D');
    lobby.invite('a', 'c');
    lobby.quick('c');
    lobby.quick('d'); // c is now in a match
    expect(lobby.view('a')?.inviting).toBeNull();
    expect(lobby.invite('a', 'c')).toBe(false);
  });
});
