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
  /** matches running right now */
  matches: () => number;
  /** write running matches to disk for the next server (see MatchService.saveAll) */
  saveMatches: () => Promise<number>;
}

export function startServer(config: Config): Promise<RunningServer> {
  // services and controllers reference each other through these late-bound callbacks
  let sockets: SocketController | null = null;
  const matches = new MatchService({
    send: (id, msg) => sockets?.send(id, msg),
    sendRaw: (id, json) => sockets?.sendRaw(id, json),
    finished: (id) => lobby.finished(id),
  }, config.abandonAfter, config.matchDir);
  void matches.pruneSaved();
  const lobby = new LobbyService({
    paired: (a, b, game) => matches.start(a, b, game),
    changed: () => sockets?.broadcastLobby(),
    live: () => matches.live(),
  });
  sockets = new SocketController(lobby, matches);

  const server = createServer(httpController(config.staticDir, { players: () => lobby.players.size, matches: () => matches.count, lobby: () => lobby.summary() },
    { hosts: config.redirectHosts, to: config.canonicalOrigin }));
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE });
  wss.on('connection', (ws) => sockets?.connect(ws));

  return new Promise((resolve) => {
    server.listen(config.port, () => {
      const addr = server.address(), port = typeof addr === 'object' && addr ? addr.port : config.port;
      resolve({
        server,
        port,
        matches: () => matches.count,
        saveMatches: () => { sockets?.broadcastRestart(); return matches.saveAll(); },
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
  startServer(config).then((running) => {
    console.log(`Killcraft server on http://localhost:${running.port} (serving ${config.staticDir})`);
    // a deploy stops this server: keep the matches under way for the next one, then go
    let stopping = false;
    const stop = (signal: string) => {
      if (stopping) return;
      stopping = true;
      console.info(`${signal}: saving matches and shutting down`);
      running.saveMatches().catch((err) => console.error('saving matches failed', err))
        .then(() => running.close()).finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 8000).unref(); // Docker stops us for good after 10 seconds
    };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
  });
}
