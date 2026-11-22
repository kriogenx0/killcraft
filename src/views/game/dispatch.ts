// Player actions: applied locally in solo games, sent to the server in online games.
import { applyCommand, type Command } from '../../game/command.ts';
import { net } from '../../net/client.ts';
import { V } from './view_state.ts';

export function dispatch(cmd: Command): void {
  if (V.online) net.send({ k: 'cmd', cmd });
  else applyCommand(V.team, cmd);
}

export const ids = (list: { id: number }[]): number[] => list.map((e) => e.id);
