// The old domain answers with a permanent redirect to the new one, keeping invite links intact.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { request } from 'node:http';
import { startServer, type RunningServer } from './main.ts';

let srv: RunningServer;
beforeAll(async () => {
  srv = await startServer({ port: 0, staticDir: '/nonexistent', redirectHosts: ['killcraft.kriogenx.com'], canonicalOrigin: 'https://killcraft.games' });
});
afterAll(() => srv.close());

function get(path: string, host: string): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    request({ port: srv.port, path, headers: { host } }, (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, location: res.headers.location }); })
      .on('error', reject).end();
  });
}

it('sends the old domain to the new one with path and query', async () => {
  expect(await get('/game/abc123?x=1', 'killcraft.kriogenx.com')).toEqual({ status: 301, location: 'https://killcraft.games/game/abc123?x=1' });
  expect(await get('/', 'KILLCRAFT.kriogenx.com:443')).toEqual({ status: 301, location: 'https://killcraft.games/' });
});

it('serves the new domain and health checks normally', async () => {
  expect((await get('/status', 'killcraft.games')).status).toBe(200);
  expect((await get('/health', 'killcraft.kriogenx.com')).status).toBe(200);
});
