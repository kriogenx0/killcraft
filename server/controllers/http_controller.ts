// HTTP routes: health checks and the built game files.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

export interface StatusSource {
  players: () => number;
  matches: () => number;
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

  async function serveFile(res: ServerResponse, path: string): Promise<boolean> {
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) return false; // no escaping the static folder
    try {
      const body = await readFile(file);
      const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
      res.end(body);
      return true;
    } catch {
      return false;
    }
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
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (await serveFile(res, path === '/' ? '/index.html' : path)) return;
    // unknown paths without an extension get the app (client-side routes)
    if (!extname(path) && (await serveFile(res, '/index.html'))) return;
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  };
}
