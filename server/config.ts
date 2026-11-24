// Server settings. Environment variables are read here and nowhere else.
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  /** built frontend to serve (the Vite dist folder) */
  staticDir: string;
  /** ms a match keeps going with both players disconnected before it's dropped (tests make it short) */
  abandonAfter?: number;
  /** hosts that answer every page with a permanent redirect to canonicalOrigin (old domains) */
  redirectHosts?: string[];
  /** where redirectHosts send people, e.g. https://killcraft.games */
  canonicalOrigin?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.SERVER_PORT ?? env.PORT ?? 8081),
    staticDir: env.STATIC_DIR ?? fileURLToPath(new URL('../dist', import.meta.url)),
    redirectHosts: (env.REDIRECT_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    canonicalOrigin: env.CANONICAL_ORIGIN?.replace(/\/+$/, '') || undefined,
  };
}
