// Install the offline service worker (production builds only; the dev server serves files live),
// and make sure an open tab picks up a new deploy: Safari keeps tabs and home-screen apps alive for days.
//
// A new version never reloads the page by itself while something is going on: a match, the lobby (a
// deploy restarts the server, so the lobby is reconnecting right then), or the new game screen. It
// waits until the player is on the start screen, and even there it reloads only when nobody is
// looking (the tab is hidden) or when the player picks Play (see `takeUpdate`).
let pending = false;

/** A new version is waiting to be loaded. */
export function updatePending(): boolean {
  return pending;
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // updateViaCache 'none': always fetch sw.js itself from the server, never from the HTTP cache
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
      const check = () => { reg.update().catch(() => { /* offline */ }); };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      window.addEventListener('focus', check);
      window.addEventListener('online', check);
      setInterval(check, 5 * 60_000);
    }).catch(() => {});
  });

  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || pending) return; // the first install, not an update
    pending = true;
    if (onStartScreen() && document.visibilityState === 'hidden') location.reload();
  });
  // the tab went to the background on the start screen: load the new version where nobody sees it
  document.addEventListener('visibilitychange', () => {
    if (pending && document.visibilityState === 'hidden' && onStartScreen()) location.reload();
  });
}

/**
 * The player picked something on the start screen with a new version waiting: go there on the new
 * version instead (`to` is the address that opens it). The old page can't load the game's code any
 * more (the deploy replaced those files), so this beats failing a moment later. True if it navigated.
 */
export function takeUpdate(to: string): boolean {
  if (!pending) return false;
  location.href = to;
  return true;
}

/** only the start screen is showing, so loading the new version loses nothing */
function onStartScreen(): boolean {
  return !!document.querySelector('.game-start.ui-modal--open') && !document.querySelector('.view-game--loading');
}
