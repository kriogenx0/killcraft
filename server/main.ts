// Game server: serves the built game, a lobby, and live matches over WebSockets.
import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadConfig, type Config } from './config.ts';
import { LobbyService } from './services/lobby_service.ts';
import { MatchService } from './services/match_service.ts';
import { SocketController } from './controllers/socket_controller.ts';
import { httpController } from './controllers/http_controller.ts';

const MAX_MESSAGE = 16 * 1024;

export interface RunningServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

export function startServer(config: Config): Promise<RunningServer> {
  // services and controllers reference each other through these late-bound callbacks
  let sockets: SocketController | null = null;
  const matches = new MatchService({
    send: (id, msg) => sockets?.send(id, msg),
    sendRaw: (id, json) => sockets?.sendRaw(id, json),
    finished: (id) => lobby.finished(id),
  }, config.rejoinGrace);
  const lobby = new LobbyService({
    paired: (a, b, game) => matches.start(a, b, game),
    changed: () => sockets?.broadcastLobby(),
    live: () => matches.live(),
  });
  sockets = new SocketController(lobby, matches);

  const server = createServer(httpController(config.staticDir, { players: () => lobby.players.size, matches: () => matches.count }));
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE });
  wss.on('connection', (ws) => sockets?.connect(ws));

  return new Promise((resolve) => {
    server.listen(config.port, () => {
      const addr = server.address(), port = typeof addr === 'object' && addr ? addr.port : config.port;
      resolve({
        server,
        port,
        close: () => new Promise<void>((done) => {
          matches.stopAll();
          for (const c of wss.clients) c.terminate();
          wss.close();
          server.close(() => done());
        }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  startServer(config).then(({ port }) => console.log(`Killcraft server on http://localhost:${port} (serving ${config.staticDir})`));
}
