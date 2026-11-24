// Install the offline service worker (production builds only; the dev server serves files live),
// and make sure an open tab picks up a new deploy: Safari keeps tabs and home-screen apps alive for days.
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

  // a new version took over: reload straight away on the menus, or offer it mid-game
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // the first install, not an update
    if (onMenus()) { reloading = true; location.reload(); return; }
    showReloadPrompt();
  });
}

/** the start screen or the lobby is showing, so reloading loses nothing */
function onMenus(): boolean {
  return !!document.querySelector('.game-start.ui-modal--open, .view-lobby.ui-modal--open');
}

function showReloadPrompt(): void {
  if (document.querySelector('.update-prompt')) return;
  const b = document.createElement('button');
  b.className = 'update-prompt';
  b.type = 'button';
  b.textContent = 'New version of Killcraft. Tap to reload';
  b.addEventListener('click', () => location.reload());
  document.body.append(b);
}
