import './styles/app.scss';
import { mountGameView } from './views/game/game_view.ts';
import { blockBrowserZoom } from './no_browser_zoom.ts';

blockBrowserZoom();

const root = document.querySelector<HTMLElement>('.view-game');
if (root) mountGameView(root);

// index.html shows a loader until now; reveal the game on the next frame, once styles have applied
requestAnimationFrame(() => {
  document.documentElement.classList.add('app-ready');
  const loader = document.querySelector('.app-loader');
  loader?.addEventListener('transitionend', () => loader.remove(), { once: true });
  setTimeout(() => loader?.remove(), 500);
});
