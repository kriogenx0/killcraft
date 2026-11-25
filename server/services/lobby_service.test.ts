import { describe, expect, it, vi } from 'vitest';
import { LobbyService, type Player, type RoomStart } from './lobby_service.ts';

function setup() {
  const pairs: [Player, Player, string?][] = [], rooms: RoomStart[] = [];
  const lobby = new LobbyService({ paired: (a, b, g) => pairs.push([a, b, g]), started: (r) => rooms.push(r), changed: vi.fn() });
  for (const id of ['a', 'b', 'c']) lobby.add(id, id.toUpperCase());
  return { lobby, pairs, rooms };
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
    // joining fills the seat; only the host starts the game
    expect(pairs).toEqual([]);
    expect(lobby.players.get('c')?.status).toBe('room');
    expect(lobby.begin('c')).toBe(false);
    expect(lobby.view('a')?.room?.ready).toBe(true);
    expect(lobby.begin('a')).toBe(true);
    expect(pairs.map(([x, y]) => [x.id, y.id])).toEqual([['a', 'c']]);
    expect(lobby.games()).toEqual([]);
  });

  it('lists a game again under the id its host asks for (a refresh keeps the invite link working)', () => {
    const { lobby, pairs } = setup();
    const id = lobby.create('a')!;
    lobby.remove('a');
    lobby.add('a2', 'A');
    expect(lobby.create('a2', id)).toBe(id);
    expect(lobby.hostOf(id)).toBe('a2');
    expect(lobby.create('b', id)).not.toBe(id); // taken: someone else gets a new id
    expect(lobby.create('c', 'not-an-id')).not.toBe('not-an-id');
    lobby.add('d', 'D');
    expect(lobby.join('d', id)).toBe(true);
    lobby.begin('a2');
    expect(pairs.map(([x, y, g]) => [x.id, y.id, g])).toEqual([['a2', 'd', id]]);
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

  it('sets up a 2v2 room: computers and closed seats, people fill open seats, the host starts it', () => {
    const { lobby, pairs, rooms } = setup();
    lobby.add('d', 'D');
    const id = lobby.create('a')!;
    expect(lobby.view('a')?.room).toMatchObject({ id, mode: '1v1', host: true, ready: false, seats: [{ kind: 'person', name: 'A', you: true }, { kind: 'open' }] });
    expect(lobby.configure('b', { mode: '2v2' })).toBe(false); // not the host
    expect(lobby.configure('a', { mode: '2v2' })).toBe(true);
    expect(lobby.configure('a', { seat: 2, pick: 'open' })).toBe(true); // a friend as the ally
    expect(lobby.configure('a', { seat: 3, pick: 'hard' })).toBe(true);
    expect(lobby.configure('a', { seat: 0, pick: 'easy' })).toBe(false); // the host's own seat
    expect(lobby.games()).toEqual([{ id, host: 'A', mode: '2v2', players: 1, free: 2 }]);
    // the first to join sits on the host's side
    expect(lobby.join('b', id)).toBe(true);
    expect(lobby.view('b')?.room?.seats.find((s) => s.you)?.team).toBe(2);
    expect(lobby.players.get('b')?.status).toBe('room');
    expect(lobby.begin('a')).toBe(false); // a seat is still open
    // someone leaving opens their seat again
    lobby.leave('b');
    expect(lobby.view('a')?.room?.seats[2]).toMatchObject({ kind: 'open' });
    lobby.join('b', id);
    // the last open seat filling doesn't start the game: the host does
    expect(lobby.join('c', id)).toBe(true);
    expect(rooms).toHaveLength(0);
    expect(lobby.join('d', id)).toBe(false); // full
    expect(lobby.begin('a')).toBe(true);
    expect(pairs).toEqual([]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].mode).toBe('2v2');
    expect(rooms[0].seats.map((s) => (s && typeof s === 'object' ? s.id : s))).toEqual(['a', 'c', 'b', 'hard']);
    expect(lobby.players.get('c')?.status).toBe('playing');
    expect(lobby.games()).toEqual([]);
  });

  it('lets the host pick the fog of war, which the room shows everyone and the match gets', () => {
    const { lobby, pairs, rooms } = setup();
    const id = lobby.create('a')!;
    expect(lobby.view('a')?.room?.fog).toBe('reveal');
    lobby.join('b', id);
    expect(lobby.configure('b', { fog: 'off' })).toBe(false); // not the host
    expect(lobby.configure('a', { fog: 'sometimes' })).toBe(false);
    expect(lobby.configure('a', { fog: 'regrow' })).toBe(true);
    expect(lobby.view('b')?.room?.fog).toBe('regrow');
    // two people one against one, but not the usual fog: started as a room so the fog goes with it
    expect(lobby.begin('a')).toBe(true);
    expect(pairs).toEqual([]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].fog).toBe('regrow');
  });

  it('lets the host start with computers and closed seats, but needs someone on the other side', () => {
    const { lobby, rooms } = setup();
    lobby.create('a');
    lobby.configure('a', { mode: '2v2' });
    lobby.configure('a', { seat: 1, pick: 'closed' });
    lobby.configure('a', { seat: 3, pick: 'closed' });
    expect(lobby.view('a')?.room?.ready).toBe(false);
    expect(lobby.begin('a')).toBe(false);
    lobby.configure('a', { seat: 3, pick: 'brutal' });
    expect(lobby.view('a')?.room?.ready).toBe(true);
    expect(lobby.begin('a')).toBe(true);
    expect(rooms[0].seats.map((s) => (s && typeof s === 'object' ? s.id : s))).toEqual(['a', null, 'normal', 'brutal']);
  });

  it('sends everyone in a room back to the lobby when the host leaves', () => {
    const { lobby } = setup();
    const id = lobby.create('a')!;
    lobby.configure('a', { mode: 'ffa' });
    lobby.configure('a', { seat: 2, pick: 'open' });
    lobby.join('b', id);
    expect(lobby.configure('a', { mode: '1v1' })).toBe(true); // b sits in seat 1, which 1v1 keeps
    lobby.configure('a', { mode: 'ffa' });
    lobby.remove('a');
    expect(lobby.players.get('b')?.status).toBe('idle');
    expect(lobby.view('b')?.room).toBeNull();
    expect(lobby.games()).toEqual([]);
  });
});
