// Starts the real server and plays the opening of a match with two WebSocket clients.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startServer, type RunningServer } from './main.ts';
import type { ServerMsg, SnapMsg } from '../src/net/protocol.ts';

let srv: RunningServer;

beforeAll(async () => {
  srv = await startServer({ port: 0, staticDir: '/nonexistent' });
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

  it('matches two players, runs their commands, and ends when one leaves', async () => {
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
    expect(first.credits).toBe(3000);
    const own = first.ents.filter((r) => r[2] === startA.team);
    expect(own.length).toBeGreaterThan(0);
    // the enemy base starts far away, under fog
    expect(first.ents.some((r) => r[2] === 1 - startA.team)).toBe(false);

    a.ws.send(JSON.stringify({ k: 'cmd', cmd: { c: 'build', type: 'power' } }));
    a.ws.send(JSON.stringify({ k: 'cmd', cmd: { c: 'build', type: 'nuke' } })); // ignored
    const later = (await a.next('snap', (m) => m.k === 'snap' && m.credits < 3000)) as SnapMsg;
    expect(later.prod.structure[0]?.type).toBe('power');

    b.ws.close();
    const end = await a.next('end');
    expect(end).toMatchObject({ k: 'end', winner: startA.team, reason: 'left' });
    a.ws.close();
  }, 20000);
});
