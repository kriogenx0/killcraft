// WebSocket messages: parse and rate-limit what clients send, then call the services.
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { cleanName, type ClientMsg, type ServerMsg } from '../../src/net/protocol.ts';
import type { LobbyService } from '../services/lobby_service.ts';
import type { MatchService } from '../services/match_service.ts';

const MAX_PER_SECOND = 40;
const KICK_PER_SECOND = 200;

export class SocketController {
  private sockets = new Map<string, WebSocket>();

  private lobby: LobbyService;
  private matches: MatchService;

  constructor(lobby: LobbyService, matches: MatchService) {
    this.lobby = lobby;
    this.matches = matches;
  }

  send(playerId: string, msg: ServerMsg): void {
    const ws = this.sockets.get(playerId);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  /** Tell everyone in the lobby (not in a match) who is online, open games and their challenges. */
  broadcastLobby(): void {
    for (const p of this.lobby.players.values()) {
      if (p.status === 'playing') continue;
      const view = this.lobby.view(p.id);
      if (view) this.send(p.id, view);
    }
  }

  connect(ws: WebSocket): void {
    const id = randomUUID();
    let joined = false, windowStart = Date.now(), count = 0;
    this.sockets.set(id, ws);
    this.send(id, { k: 'welcome', id });

    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > KICK_PER_SECOND) { ws.close(1008, 'Too many messages'); return; }
      if (count > MAX_PER_SECOND) return;
      let msg: ClientMsg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.k === 'hello') {
        if (!joined) { joined = true; this.lobby.add(id, cleanName(msg.name)); }
        return;
      }
      if (!joined) return;
      switch (msg.k) {
        case 'quick': this.lobby.quick(id); break;
        case 'create': this.lobby.create(id); break;
        case 'join': if (!this.lobby.join(id, String(msg.game))) this.send(id, { k: 'error', msg: 'That game is no longer open.' }); break;
        case 'leave': this.lobby.leave(id); this.broadcastLobby(); break;
        case 'invite': if (!this.lobby.invite(id, String(msg.to))) this.send(id, { k: 'error', msg: "That player isn't available right now." }); break;
        case 'accept': if (!this.lobby.accept(id, String(msg.from))) this.send(id, { k: 'error', msg: 'That challenge is no longer open.' }); break;
        case 'decline': {
          const challenger = this.lobby.decline(id, String(msg.from)), me = this.lobby.players.get(id);
          if (challenger && me) this.send(challenger.id, { k: 'notice', msg: `${me.name} declined your challenge.` });
          break;
        }
        case 'cmd': this.matches.command(id, msg.cmd); break;
        case 'resign': this.matches.quit(id, 'resigned'); break;
        case 'rejoin': {
          const me = this.lobby.players.get(id);
          const opponent = me && me.status !== 'playing' ? this.matches.rejoin(me, String(msg.game), String(msg.key)) : null;
          if (opponent) this.lobby.playing(id, opponent.name);
          else this.send(id, { k: 'nogame' });
          break;
        }
      }
    });

    ws.on('close', () => {
      this.sockets.delete(id);
      if (!joined) return;
      // a dropped connection mid-match (usually a refresh) gets a while to rejoin before it counts as leaving
      this.matches.away(id);
      this.lobby.remove(id);
    });
  }
}
