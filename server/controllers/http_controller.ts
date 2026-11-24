// HTTP routes: health checks and the built game files.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { LobbySummary } from '../../src/net/protocol.ts';

const brotli = promisify(brotliCompress), gz = promisify(gzip);
/** Text files are sent compressed (the game's script is about a megabyte, a quarter of that compressed). */
const PACK = new Set(['.html', '.js', '.css', '.map', '.json', '.svg', '.webmanifest', '.txt']);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

export interface StatusSource {
  players: () => number;
  matches: () => number;
  /** who's online, open games and matches to watch, for the main menu (no connection or name needed) */
  lobby?: () => LobbySummary;
}

export interface RedirectOptions {
  /** hosts (no port) that are moved for good */
  hosts?: string[];
  /** the origin they move to, e.g. https://killcraft.games */
  to?: string;
}

export function httpController(staticDir: string, status: StatusSource, redirect: RedirectOptions = {}) {
  const root = normalize(staticDir + sep);
  const moved = new Set(redirect.hosts ?? []);

  // compressed copies, made on first request: the built files don't change while the server runs
  const packed = new Map<string, Promise<Buffer>>();
  const pack = (file: string, body: Buffer, enc: 'br' | 'gzip'): Promise<Buffer> => {
    const key = `${enc}:${file}`;
    let p = packed.get(key);
    if (!p) {
      p = enc === 'br' ? brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } }) : gz(body, { level: 9 });
      packed.set(key, p);
      p.catch(() => packed.delete(key));
    }
    return p;
  };

  async function serveFile(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) return false; // no escaping the static folder
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return false;
    }
    const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    const headers: Record<string, string> = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache };
    if (PACK.has(extname(file)) && body.length > 1024) {
      const accept = String(req.headers['accept-encoding'] ?? ''), enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
      headers.vary = 'Accept-Encoding';
      if (enc) {
        try {
          body = await pack(file, body, enc);
          headers['content-encoding'] = enc;
        } catch { /* send it as it is */ }
      }
    }
    res.writeHead(200, headers);
    res.end(body);
    return true;
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('OK'); return; }
    // an old domain: send people (and invite links, path and query intact) to the new one
    const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (redirect.to && moved.has(host)) {
      res.writeHead(301, { location: redirect.to + (req.url ?? '/'), 'cache-control': 'public, max-age=86400' });
      res.end();
      return;
    }
    if (path === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ lobby: 'ok', players: status.players(), matches: status.matches() }));
      return;
    }
    if (path === '/lobby' && status.lobby) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(status.lobby()));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (await serveFile(req, res, path === '/' ? '/index.html' : path)) return;
    // unknown paths without an extension get the app (client-side routes)
    if (!extname(path) && (await serveFile(req, res, '/index.html'))) return;
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  };
}
