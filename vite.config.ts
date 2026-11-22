import { defineConfig } from 'vitest/config';

export default defineConfig({
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
