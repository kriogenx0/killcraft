// Server settings. Environment variables are read here and nowhere else.
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  /** built frontend to serve (the Vite dist folder) */
  staticDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.SERVER_PORT ?? env.PORT ?? 8081),
    staticDir: env.STATIC_DIR ?? fileURLToPath(new URL('../dist', import.meta.url)),
  };
}
