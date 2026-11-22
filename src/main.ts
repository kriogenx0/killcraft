import './styles/app.scss';
import { mountGameView } from './views/game/game_view.ts';

const root = document.querySelector<HTMLElement>('.view-game');
if (root) mountGameView(root);
