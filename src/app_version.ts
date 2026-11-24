// The deployed version for the main menu; the values come from Vite's define (src/app_globals.d.ts).

/** e.g. "e56dfd8 · 24 Nov 2026 20:41", or "dev" when nothing is known about the build. */
export function appVersion(): string {
  const built = new Date(__APP_BUILT__);
  const when = Number.isNaN(built.getTime()) ? '' : built.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const parts = [import.meta.env.DEV ? 'dev' : '', __APP_COMMIT__, when].filter(Boolean);
  return parts.join(' · ');
}
