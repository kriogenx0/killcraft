// Performance logging: the server's own readings, and browsers reporting slow frames.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { request } from 'node:http';
import { startServer, type RunningServer } from './main.ts';
import { PerfMonitor, parseClientPerf } from './services/perf_monitor.ts';

const good = { fps: 22, quality: 2, from: 1, units: 140, online: true, w: 390, h: 844, dpr: 3, gpu: 'Apple GPU', mobile: true, ver: 'abc1234' };

it('logs a reading while matches run, and warns when a match falls behind', () => {
  const lines: string[] = [], warns: string[] = [];
  const perf = { steps: 600, stepAvg: 9.5, stepMax: 80, snapMs: 40, lostMs: 1200, ents: 400 };
  const mon = new PerfMonitor({ matches: () => [{ id: 'abcdef12-3456', people: 4, perf }], players: () => 4 }, (l) => lines.push(l), (l) => warns.push(l));
  const p = mon.sample();
  expect(p.matches).toBe(1);
  expect(lines[0]).toMatch(/^perf: 1 matches, 4 players, cpu \d+% of \d+ cores/);
  expect(lines[0]).toContain('busiest match abcdef12: step 9.50 ms avg, 80.0 ms max, 400 entities, 4 people, 1.2 s behind');
  expect(warns[0]).toMatch(/^SLOW server: .*steps take 9\.5 ms on average.*had a 80 ms step.*ran 1\.2 s slow/);
});

it('stays quiet with no matches and nothing slow', () => {
  const lines: string[] = [];
  new PerfMonitor({ matches: () => [], players: () => 0 }, (l) => lines.push(l), (l) => lines.push(l)).sample();
  expect(lines).toEqual([]);
});

it('takes only well-formed browser reports, and caps how many it logs', () => {
  expect(parseClientPerf(good)).toEqual(good);
  expect(parseClientPerf({ ...good, fps: 'fast' })).toBeNull();
  expect(parseClientPerf({ ...good, gpu: 'Mali<script>' })?.gpu).toBe('Maliscript');
  const warns: string[] = [];
  const mon = new PerfMonitor({ matches: () => [], players: () => 0 }, () => {}, (l) => warns.push(l));
  for (let i = 0; i < 40; i++) mon.client(good, 'Mozilla/5.0');
  expect(warns.length).toBe(30);
  expect(warns[0]).toContain('SLOW client: 22 fps, graphics level 1 -> 2, 140 units, online, 390x844@3x, phone, gpu "Apple GPU"');
});

let srv: RunningServer;
beforeAll(async () => { srv = await startServer({ port: 0, staticDir: '/nonexistent' }); });
afterAll(() => srv.close());

function call(method: string, path: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ port: srv.port, path, method, headers: { 'content-type': 'application/json' } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

it('accepts reports at /perf and answers with the server reading', async () => {
  expect((await call('POST', '/perf', JSON.stringify(good))).status).toBe(204);
  expect((await call('POST', '/perf', '{"fps":')).status).toBe(400);
  expect((await call('POST', '/perf', 'x'.repeat(5000))).status).not.toBe(204);
  const r = await call('GET', '/perf');
  expect(r.status).toBe(200);
  expect(JSON.parse(r.body)).toMatchObject({ matches: 0, players: 0 });
});
