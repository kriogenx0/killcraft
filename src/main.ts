import './styles/app.scss';
import { mountMenu } from './views/menu/menu_view.ts';
import { blockBrowserZoom } from './no_browser_zoom.ts';
import { blockSwipeNavigation } from './no_swipe_navigation.ts';
import { blockAutocomplete } from './no_autocomplete.ts';
import { registerServiceWorker } from './pwa/register.ts';
import { appVersion } from './app_version.ts';

blockBrowserZoom();
blockSwipeNavigation();
registerServiceWorker();

const root = document.querySelector<HTMLElement>('.view-game');
// the main menu loads the game (and three.js) only when one starts; a refresh mid-game loads it now
const ready = root ? mountMenu(root) : Promise.resolve();
blockAutocomplete();
const version = document.querySelector<HTMLElement>('.game-version');
if (version) {
  version.textContent = appVersion();
  version.title = `Built ${new Date(__APP_BUILT__).toString()}`;
}

// index.html shows a loader until now; reveal the menu (or the resumed game) on the next frame, once styles have applied
void ready.finally(() => requestAnimationFrame(() => {
  document.documentElement.classList.add('app-ready');
  const loader = document.querySelector('.app-loader');
  loader?.addEventListener('transitionend', () => loader.remove(), { once: true });
  setTimeout(() => loader?.remove(), 500);
}));
