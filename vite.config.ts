import { defineConfig } from 'vitest/config';
import { offlineServiceWorker } from './src/pwa/sw_plugin.ts';
import { buildCommit } from './src/build_version.ts';

export default defineConfig({
  plugins: [offlineServiceWorker()],
  // shown small in a corner of the main menu, so it's clear which deploy is running
  define: {
    __APP_COMMIT__: JSON.stringify(buildCommit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: Number(process.env.PORT ?? 8000),
    strictPort: true,
    // the game server (make dev starts it) handles the lobby and online matches
    proxy: { '/ws': { target: `ws://localhost:${process.env.SERVER_PORT ?? 8081}`, ws: true } },
  },
  preview: { port: Number(process.env.PORT ?? 8000), strictPort: true },
  build: { sourcemap: true },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
