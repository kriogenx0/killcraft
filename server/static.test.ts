// The built game files: text goes out compressed when the browser accepts it, and comes back the same.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { startServer, type RunningServer } from './main.ts';

const dir = mkdtempSync(join(tmpdir(), 'killcraft-static-'));
const script = 'export const x = 1;\n'.repeat(2000);
let srv: RunningServer;
beforeAll(async () => {
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index-abc.js'), script);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Killcraft</title>');
  srv = await startServer({ port: 0, staticDir: dir });
});
afterAll(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });

function get(path: string, encoding?: string): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    request({ port: srv.port, path, headers: encoding ? { 'accept-encoding': encoding } : {} }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
    }).on('error', reject).end();
  });
}

it('sends scripts brotli-compressed, or gzipped, when the browser accepts it', async () => {
  const br = await get('/assets/index-abc.js', 'gzip, deflate, br');
  expect(br.headers['content-encoding']).toBe('br');
  expect(br.headers['cache-control']).toContain('immutable');
  expect(br.body.length).toBeLessThan(script.length / 10);
  expect(brotliDecompressSync(br.body).toString()).toBe(script);
  const gz = await get('/assets/index-abc.js', 'gzip');
  expect(gz.headers['content-encoding']).toBe('gzip');
  expect(gunzipSync(gz.body).toString()).toBe(script);
});

it('sends files as they are to a client that asks for no compression, and small files always', async () => {
  const plain = await get('/assets/index-abc.js');
  expect(plain.headers['content-encoding']).toBeUndefined();
  expect(plain.body.toString()).toBe(script);
  const page = await get('/', 'br');
  expect(page.headers['content-encoding']).toBeUndefined();
  expect(page.body.toString()).toContain('Killcraft');
});
