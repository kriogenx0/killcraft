// Starts the real server and plays the opening of a match with two WebSocket clients.
import { START_CREDITS } from '../src/data/map.ts';
import { BUILDING } from '../src/data/building.ts';
import { TS } from '../src/game/const.ts';
import { TYPES } from '../src/net/snapshot.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startServer, type RunningServer } from './main.ts';
import type { ServerMsg, SnapMsg } from '../src/net/protocol.ts';

let srv: RunningServer;

beforeAll(async () => {
  srv = await startServer({ port: 0, staticDir: '/nonexistent', abandonAfter: 1500 });
});
afterAll(async () => {
  await srv.close();
});

interface Client { ws: WebSocket; msgs: ServerMsg[]; next: (k: ServerMsg['k'], match?: (m: ServerMsg) => boolean) => Promise<ServerMsg> }

function connect(name: string): Promise<Client> {
  const ws = new WebSocket(`ws://localhost:${srv.port}/ws`), msgs: ServerMsg[] = [];
  const waiters: { k: string; match?: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMsg;
    msgs.push(m);
    for (const w of [...waiters]) if (w.k === m.k && (!w.match || w.match(m))) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const next: Client['next'] = (k, match) => new Promise((resolve, reject) => {
    const hit = msgs.find((m) => m.k === k && (!match || match(m)));
    if (hit) { msgs.splice(msgs.indexOf(hit), 1); resolve(hit); return; }
    waiters.push({ k, match, resolve });
    setTimeout(() => reject(new Error(`timed out waiting for ${k}`)), 8000);
  });
  return new Promise((resolve) => ws.on('open', () => { ws.send(JSON.stringify({ k: 'hello', name })); resolve({ ws, msgs, next }); }));
}

describe('game server', () => {
  it('answers health and status checks', async () => {
    const health = await fetch(`http://localhost:${srv.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('OK');
    const status = await fetch(`http://localhost:${srv.port}/status`);
    expect(status.status).toBe(200);
    expect((await status.json()).lobby).toBe('ok');
  });

  it('sums up the lobby for the main menu', async () => {
    const a = await connect('Hana');
    await a.next('welcome');
    a.ws.send(JSON.stringify({ k: 'create' }));
    await a.next('lobby', (m) => m.k === 'lobby' && !!m.hosting);
    const res = await fetch(`http://localhost:${srv.port}/lobby`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.online).toBeGreaterThanOrEqual(1);
    expect(body.games.some((g: { host: string }) => g.host === 'Hana')).toBe(true);
    expect(Array.isArray(body.live)).toBe(true);
    a.ws.close();
  });

  it('matches two players, runs their commands, and the computer plays a side whose player dropped', async () => {
    const a = await connect('Alice'), b = await connect('<b>Bob</b>');
    await a.next('welcome');
    a.ws.send(JSON.stringify({ k: 'quick' }));
    await a.next('lobby', (m) => m.k === 'lobby' && m.waiting === 'quick');
    b.ws.send(JSON.stringify({ k: 'quick' }));
    const startA = await a.next('start'), startB = await b.next('start');
    if (startA.k !== 'start' || startB.k !== 'start') throw new Error('expected start');
    expect([startA.team, startB.team].sort()).toEqual([0, 1]);
    expect(startA.seed).toBe(startB.seed);
    expect(startA.opponent).toBe('bBobb'); // names are cleaned of markup

    const first = (await a.next('snap')) as SnapMsg;
    expect(first.credits).toBe(START_CREDITS);
    const own = first.ents.filter((r) => r[2] === startA.team);
    expect(own.length).toBeGreaterThan(0);
    // the enemy base starts far away, under fog
    expect(first.ents.some((r) => r[2] === 1 - startA.team)).toBe(false);

    // structures are placed first, then build on site: try spots round the yard until one takes
    const yard = own.find((r) => TYPES[r[1]] === 'yard');
    if (!yard) throw new Error('no yard');
    const [yx, yy] = [Math.floor(yard[3] / TS) - 1, Math.floor(yard[4] / TS) - 1];
    for (const [dx, dy] of [[3, -2], [-2, 0], [0, -2], [0, 3], [3, 3], [-2, 3]])
      a.ws.send(JSON.stringify({ k: 'cmd', cmd: { c: 'place', type: 'power', tx: yx + dx, ty: yy + dy } }));
    a.ws.send(JSON.stringify({ k: 'cmd', cmd: { c: 'place', type: 'nuke', tx: yx, ty: yy } })); // ignored
    const later = (await a.next('snap', (m) => m.k === 'snap' && m.credits < START_CREDITS)) as SnapMsg;
    const sites = later.ents.filter((r) => r[2] === startA.team && TYPES[r[1]] === 'power');
    expect(sites.length).toBeGreaterThan(0);
    expect(later.credits).toBe(START_CREDITS - sites.length * BUILDING.power.cost);
    expect(sites.every((r) => r[10] < 100)).toBe(true); // still going up

    b.ws.close();
    // a dropped player doesn't lose: the computer takes their side and the match goes on
    expect(await a.next('notice')).toMatchObject({ msg: expect.stringContaining('computer is playing') });
    const t0 = ((await a.next('snap')) as SnapMsg).t;
    await new Promise((r) => setTimeout(r, 3000)); // longer than abandonAfter: someone is still here
    expect(a.msgs.some((m) => m.k === 'end')).toBe(false);
    a.msgs.length = 0;
    const t1 = ((await a.next('snap')) as SnapMsg).t;
    expect(t1).toBeGreaterThan(t0 + 2);
    // only a surrender (or a destroyed base) ends it
    a.ws.send(JSON.stringify({ k: 'resign' }));
    expect(await a.next('end')).toMatchObject({ k: 'end', winner: startB.team, reason: 'resigned' });
    a.ws.close();
  }, 20000);

  it('drops a match once nobody at all is connected', async () => {
    const a = await connect('Eve'), b = await connect('Fay');
    await a.next('welcome');
    a.ws.send(JSON.stringify({ k: 'quick' }));
    await a.next('lobby', (m) => m.k === 'lobby' && m.waiting === 'quick');
    b.ws.send(JSON.stringify({ k: 'quick' }));
    const startA = await a.next('start');
    if (startA.k !== 'start') throw new Error('expected start');
    await a.next('snap');
    const before = srv.matches();
    a.ws.close();
    b.ws.close();
    await new Promise((r) => setTimeout(r, 2500));
    expect(srv.matches()).toBe(before - 1);
    const a2 = await connect('Eve');
    await a2.next('welcome');
    a2.ws.send(JSON.stringify({ k: 'rejoin', game: startA.game, key: startA.key }));
    expect(await a2.next('nogame')).toMatchObject({ k: 'nogame' });
    a2.ws.close();
  }, 20000);

  it('lets a player who refreshed rejoin their match with its key', async () => {
    const a = await connect('Cat'), b = await connect('Dan');
    await a.next('welcome');
    a.ws.send(JSON.stringify({ k: 'quick' }));
    await a.next('lobby', (m) => m.k === 'lobby' && m.waiting === 'quick');
    b.ws.send(JSON.stringify({ k: 'quick' }));
    const startA = await a.next('start'), startB = await b.next('start');
    if (startA.k !== 'start' || startB.k !== 'start') throw new Error('expected start');
    expect(startB.key).toBeTruthy();
    const before = (await b.next('snap')) as SnapMsg;
    const mine = (s: SnapMsg) => s.ents.filter((r) => r[2] === startB.team).length;

    b.ws.close();
    await a.next('notice', (m) => m.k === 'notice' && m.msg.includes('lost connection'));
    // Dan never gave an order: whatever his side does now, the computer did
    await new Promise((r) => setTimeout(r, 4000));
    const b2 = await connect('Dan');
    await b2.next('welcome');
    // a wrong key gets nothing
    b2.ws.send(JSON.stringify({ k: 'rejoin', game: startB.game, key: 'nope' }));
    expect(await b2.next('nogame')).toMatchObject({ k: 'nogame' });
    b2.ws.send(JSON.stringify({ k: 'rejoin', game: startB.game, key: startB.key }));
    expect(await b2.next('start')).toMatchObject({ team: startB.team, seed: startB.seed, game: startB.game, opponent: 'Cat', resumed: true });
    expect(await a.next('notice', (m) => m.k === 'notice' && m.msg.endsWith('is back.'))).toMatchObject({ msg: 'Dan is back.' });
    expect(await b2.next('notice')).toMatchObject({ msg: expect.stringContaining('computer played your side') });
    const snap = (await b2.next('snap')) as SnapMsg;
    expect(snap.ents.some((r) => r[2] === startB.team)).toBe(true);
    expect(snap.credits !== before.credits || mine(snap) > mine(before)).toBe(true);
    // well past the grace period, the match is still on
    await new Promise((r) => setTimeout(r, 2000));
    expect(a.msgs.some((m) => m.k === 'end')).toBe(false);

    b2.ws.send(JSON.stringify({ k: 'resign' }));
    expect(await a.next('end')).toMatchObject({ winner: startA.team, reason: 'resigned' });
    a.ws.close();
    b2.ws.close();
  }, 20000);

  it('shows who is online and starts a match from an accepted challenge', async () => {
    const a = await connect('Ann'), b = await connect('Ben');
    const aWelcome = await a.next('welcome'), bWelcome = await b.next('welcome');
    if (aWelcome.k !== 'welcome' || bWelcome.k !== 'welcome') throw new Error('expected welcome');
    const lobby = await a.next('lobby', (m) => m.k === 'lobby' && m.players.some((p) => p.name === 'Ben'));
    if (lobby.k !== 'lobby') throw new Error('expected lobby');
    expect(lobby.players[0]).toMatchObject({ id: aWelcome.id, name: 'Ann', status: 'idle' });

    a.ws.send(JSON.stringify({ k: 'invite', to: bWelcome.id }));
    await b.next('lobby', (m) => m.k === 'lobby' && m.invites.some((i) => i.id === aWelcome.id));
    b.ws.send(JSON.stringify({ k: 'decline', from: aWelcome.id }));
    expect(await a.next('notice')).toMatchObject({ msg: 'Ben declined your challenge.' });

    a.ws.send(JSON.stringify({ k: 'invite', to: bWelcome.id }));
    await b.next('lobby', (m) => m.k === 'lobby' && m.invites.length === 1);
    b.ws.send(JSON.stringify({ k: 'accept', from: aWelcome.id }));
    expect(await a.next('start')).toMatchObject({ team: 0, opponent: 'Ben' });
    expect(await b.next('start')).toMatchObject({ team: 1, opponent: 'Ann' });
    a.ws.close();
    b.ws.close();
  }, 20000);

  it('lists matches under way and lets anyone watch one, seeing both sides', async () => {
    const a = await connect('Eve'), b = await connect('Fay'), w = await connect('Gus');
    await a.next('welcome');
    a.ws.send(JSON.stringify({ k: 'create' }));
    const hosting = await a.next('lobby', (m) => m.k === 'lobby' && !!m.hosting);
    if (hosting.k !== 'lobby' || !hosting.hosting) throw new Error('expected hosting');
    const game = hosting.hosting;
    b.ws.send(JSON.stringify({ k: 'join', game }));
    await a.next('start');
    await b.next('start');
    const listed = await w.next('lobby', (m) => m.k === 'lobby' && m.live.some((g) => g.id === game));
    if (listed.k !== 'lobby') throw new Error('expected lobby');
    expect(listed.live.find((g) => g.id === game)).toMatchObject({ players: ['Eve', 'Fay'], watchers: 0 });

    // the invite link of a started game offers to watch it
    w.ws.send(JSON.stringify({ k: 'join', game }));
    expect(await w.next('error')).toMatchObject({ live: { id: game, players: ['Eve', 'Fay'] } });

    w.ws.send(JSON.stringify({ k: 'watch', game }));
    expect(await w.next('spectate')).toMatchObject({ k: 'spectate', game, players: ['Eve', 'Fay'] });
    const snap = (await w.next('snap')) as SnapMsg;
    // everything on the map, both bases, and both sides' stock
    expect(snap.ents.some((r) => r[2] === 0)).toBe(true);
    expect(snap.ents.some((r) => r[2] === 1)).toBe(true);
    expect(snap.sides).toHaveLength(2);
    expect(snap.sides?.[1].credits).toBe(START_CREDITS);
    // a spectator can't give orders
    w.ws.send(JSON.stringify({ k: 'cmd', cmd: { c: 'place', type: 'power', tx: 10, ty: 10 } }));

    // the lobby shows the watcher, and the match ending reaches them
    const c = await connect('Hal');
    await c.next('lobby', (m) => m.k === 'lobby' && m.live.some((g) => g.id === game && g.watchers === 1) && m.players.some((p) => p.name === 'Gus' && p.status === 'watching'));
    a.ws.send(JSON.stringify({ k: 'resign' }));
    expect(await w.next('end')).toMatchObject({ winner: 1, reason: 'resigned' });
    await c.next('lobby', (m) => m.k === 'lobby' && !m.live.some((g) => g.id === game));
    w.ws.send(JSON.stringify({ k: 'watch', game }));
    expect(await w.next('error', (m) => m.k === 'error' && !m.live)).toMatchObject({ msg: 'That game has ended.' });
    for (const x of [a, b, w, c]) x.ws.close();
  }, 20000);

  it('plays a 2v2 from a game room: two people as allies against two computers', async () => {
    const a = await connect('Ivy'), b = await connect('Jon'), w = await connect('Kim');
    await a.next('welcome');
    a.ws.send(JSON.stringify({ k: 'create' }));
    const hosting = await a.next('lobby', (m) => m.k === 'lobby' && !!m.room);
    if (hosting.k !== 'lobby' || !hosting.room) throw new Error('expected a room');
    const game = hosting.room.id;
    a.ws.send(JSON.stringify({ k: 'room', mode: '2v2' }));
    a.ws.send(JSON.stringify({ k: 'room', seat: 1, pick: 'easy' }));
    a.ws.send(JSON.stringify({ k: 'room', seat: 2, pick: 'open' }));
    a.ws.send(JSON.stringify({ k: 'room', seat: 3, pick: 'hard' }));
    await a.next('lobby', (m) => m.k === 'lobby' && m.room?.mode === '2v2' && m.room.seats[3]?.level === 'hard');
    // the friend takes the open seat beside the host, and the room is full: it starts
    b.ws.send(JSON.stringify({ k: 'join', game }));
    const startA = await a.next('start'), startB = await b.next('start');
    if (startA.k !== 'start' || startB.k !== 'start') throw new Error('expected start');
    expect(startA).toMatchObject({ team: 0, teams: 4, ally: [0, 1, 0, 1], names: ['Ivy', 'Computer (Easy)', 'Jon', 'Computer (Hard)'], opponent: 'Computer (Easy) & Computer (Hard)' });
    expect(startB.team).toBe(2);

    // allies see each other's bases from the start
    const snap = (await a.next('snap', (m) => m.k === 'snap' && m.ents.some((r) => r[2] === 2))) as SnapMsg;
    expect(snap.ents.some((r) => r[2] === 2 && TYPES[r[1]] === 'yard')).toBe(true);
    // the computer plays only its own seats: Jon's side waits for Jon
    await new Promise((r) => setTimeout(r, 1500));
    b.msgs.length = 0;
    expect(((await b.next('snap')) as SnapMsg).credits).toBe(START_CREDITS);

    const listed = await w.next('lobby', (m) => m.k === 'lobby' && m.live.some((g) => g.id === game));
    if (listed.k !== 'lobby') throw new Error('expected lobby');
    expect(listed.live.find((g) => g.id === game)?.title).toBe('Ivy & Jon vs Computer (Easy) & Computer (Hard)');
    w.ws.send(JSON.stringify({ k: 'watch', game }));
    expect(await w.next('spectate')).toMatchObject({ teams: 4, ally: [0, 1, 0, 1] });
    expect(((await w.next('snap')) as SnapMsg).sides).toHaveLength(4);

    // one ally surrendering knocks out only their side; the other plays on
    b.ws.send(JSON.stringify({ k: 'resign' }));
    expect(await b.next('end')).toMatchObject({ reason: 'resigned' });
    expect(await a.next('notice', (m) => m.k === 'notice' && m.msg.includes('surrendered'))).toMatchObject({ msg: 'Jon surrendered.' });
    await new Promise((r) => setTimeout(r, 2000));
    expect(a.msgs.some((m) => m.k === 'end')).toBe(false);
    a.msgs.length = 0;
    const later = (await a.next('snap')) as SnapMsg;
    expect(later.ents.some((r) => r[2] === 2)).toBe(false);
    a.ws.send(JSON.stringify({ k: 'resign' }));
    expect(await a.next('end')).toMatchObject({ reason: 'resigned' });
    expect(await w.next('end')).toMatchObject({ reason: 'resigned' });
    for (const x of [a, b, w]) x.ws.close();
  }, 30000);
});
