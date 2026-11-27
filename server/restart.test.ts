// A deploy restarts the server: a match under way is saved on the way down and carried on by the next one.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startServer, type RunningServer } from './main.ts';
import type { ServerMsg, SnapMsg } from '../src/net/protocol.ts';

interface Client { ws: WebSocket; next: (k: ServerMsg['k'], match?: (m: ServerMsg) => boolean) => Promise<ServerMsg> }

function connect(port: number, name: string): Promise<Client> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`), msgs: ServerMsg[] = [];
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
  return new Promise((resolve) => ws.on('open', () => { ws.send(JSON.stringify({ k: 'hello', name })); resolve({ ws, next }); }));
}

const servers: RunningServer[] = [];
let dir = '';
afterAll(async () => {
  for (const s of servers) await s.close().catch(() => {});
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('a deploy in the middle of a match', () => {
  it('saves the match as the server stops, and the next server carries it on when the players return', async () => {
    dir = await mkdtemp(join(tmpdir(), 'killcraft-matches-'));
    const first = await startServer({ port: 0, staticDir: '/nonexistent', matchDir: dir });
    servers.push(first);
    const a = await connect(first.port, 'Alice'), b = await connect(first.port, 'Bob');
    await a.next('welcome');
    a.ws.send(JSON.stringify({ k: 'quick' }));
    await a.next('lobby', (m) => m.k === 'lobby' && m.waiting === 'quick');
    b.ws.send(JSON.stringify({ k: 'quick' }));
    const start = await a.next('start');
    if (start.k !== 'start') throw new Error('expected start');
    // let the match run a little
    const before = (await a.next('snap', (m) => m.k === 'snap' && m.t >= 1.5)) as SnapMsg;

    // the deploy: the old server saves its match and goes away
    expect(await first.saveMatches()).toBe(1);
    await a.next('restarting'); // players are told, so a lost game says why
    await first.close();
    expect(await readdir(dir)).toEqual([`${start.game}.match`]);

    // the new server knows nothing until Alice comes back with her key
    const second = await startServer({ port: 0, staticDir: '/nonexistent', matchDir: dir });
    servers.push(second);
    expect(second.matches()).toBe(0);
    const back = await connect(second.port, 'Alice');
    await back.next('welcome');
    back.ws.send(JSON.stringify({ k: 'rejoin', game: start.game, key: start.key }));
    const resumed = await back.next('start');
    expect(resumed).toMatchObject({ k: 'start', team: start.team, game: start.game, resumed: true, opponent: 'Bob' });
    const after = (await back.next('snap')) as SnapMsg;
    expect(after.t).toBeGreaterThanOrEqual(before.t); // the same match, not a new one
    expect(second.matches()).toBe(1);
    expect(await readdir(dir)).toEqual([]); // picked up, so the file is gone

    // a wrong key, or a game nobody saved, still gets "no game"
    const stranger = await connect(second.port, 'Eve');
    await stranger.next('welcome');
    stranger.ws.send(JSON.stringify({ k: 'rejoin', game: start.game, key: 'nope' }));
    await stranger.next('nogame');
    stranger.ws.send(JSON.stringify({ k: 'rejoin', game: '../../etc/passwd', key: start.key }));
    await stranger.next('nogame');
    for (const c of [a, b, back, stranger]) c.ws.close();
  }, 30_000);

  it('pauses a match to disk when every player leaves, and the first one back picks it up', async () => {
    const parked = await mkdtemp(join(tmpdir(), 'killcraft-parked-'));
    const srv = await startServer({ port: 0, staticDir: '/nonexistent', matchDir: parked, abandonAfter: 1000 });
    servers.push(srv);
    try {
      const a = await connect(srv.port, 'Alice'), b = await connect(srv.port, 'Bob');
      await a.next('welcome');
      a.ws.send(JSON.stringify({ k: 'quick' }));
      await a.next('lobby', (m) => m.k === 'lobby' && m.waiting === 'quick');
      b.ws.send(JSON.stringify({ k: 'quick' }));
      const start = await a.next('start');
      if (start.k !== 'start') throw new Error('expected start');
      const before = (await a.next('snap', (m) => m.k === 'snap' && m.t >= 1)) as SnapMsg;
      a.ws.close(); b.ws.close();
      // everyone is gone: after a moment the match leaves memory for the disk instead of ending
      await new Promise((r) => setTimeout(r, 2500));
      expect(srv.matches()).toBe(0);
      expect(await readdir(parked)).toEqual([`${start.game}.match`]);

      const back = await connect(srv.port, 'Alice');
      await back.next('welcome');
      back.ws.send(JSON.stringify({ k: 'rejoin', game: start.game, key: start.key }));
      expect(await back.next('start')).toMatchObject({ k: 'start', team: start.team, game: start.game, resumed: true, opponent: 'Bob' });
      const after = (await back.next('snap')) as SnapMsg;
      expect(after.t).toBeGreaterThanOrEqual(before.t);
      expect(srv.matches()).toBe(1);
      expect(await readdir(parked)).toEqual([]);
      back.ws.close();
    } finally { await rm(parked, { recursive: true, force: true }); }
  }, 30_000);
});
