// Build step: write dist/sw.js, a service worker that keeps every built file so solo games work offline.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const SOURCE = new URL('./sw.js', import.meta.url);

export function offlineServiceWorker(): Plugin {
  return {
    name: 'killcraft-offline-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      // the campaign's saved maps too, so missions play offline
      const maps = readdirSync(new URL('../../public/campaign/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => `campaign/${f}`);
      const publicFiles = ['favicon.ico', 'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest', ...maps];
      const urls = ['/', ...[...files, ...publicFiles].map((f) => `/${f}`)];
      // the version changes whenever any built file changes, so each deploy installs a fresh cache
      const hash = createHash('sha256');
      for (const f of files.sort()) {
        const out = bundle[f];
        hash.update(f).update(out.type === 'chunk' ? out.code : out.source);
      }
      const source = readFileSync(SOURCE, 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('[/*__FILES__*/]', JSON.stringify(urls));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
