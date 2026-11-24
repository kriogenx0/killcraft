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

  sendRaw(playerId: string, json: string): void {
    const ws = this.sockets.get(playerId);
    if (ws && ws.readyState === ws.OPEN) ws.send(json);
  }

  /** Tell everyone connected that the server is restarting (a deploy). */
  broadcastRestart(): void {
    for (const id of this.sockets.keys()) this.send(id, { k: 'restarting' });
  }

  /** Tell everyone in the lobby (not in a match or watching one) who is online, open games and their challenges. */
  broadcastLobby(): void {
    for (const p of this.lobby.players.values()) {
      if (p.status === 'playing' || p.status === 'watching') continue;
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
        case 'create': {
          const want = typeof msg.game === 'string' && !this.matches.has(msg.game) ? msg.game : undefined;
          this.lobby.create(id, want);
          break;
        }
        case 'join': {
          const game = String(msg.game);
          if (this.lobby.join(id, game)) break;
          // a match already under way can be watched instead
          const live = this.matches.live().find((g) => g.id === game);
          if (live) { this.send(id, { k: 'error', msg: `That game has already started: ${live.players.join(' vs ')}.`, live }); break; }
          const why = this.lobby.hostOf(game) === id ? "That's your own game. Send the link to a friend."
            : this.lobby.hostOf(game) ? "Couldn't join that game right now."
            : 'That game is no longer open. Ask your friend for a new link, or create your own game.';
          this.send(id, { k: 'error', msg: why });
          break;
        }
        case 'watch': {
          const me = this.lobby.players.get(id);
          const players = me && me.status !== 'playing' ? this.matches.watch(id, String(msg.game)) : null;
          if (players) this.lobby.watching(id, players.join(' vs '));
          else this.send(id, { k: 'error', msg: 'That game has ended.' });
          break;
        }
        case 'unwatch': if (this.matches.unwatch(id)) this.lobby.finished(id); break;
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
          if (!me || me.status === 'playing') { this.send(id, { k: 'nogame' }); break; }
          void this.matches.rejoin(me, String(msg.game), String(msg.key)).then((opponent) => {
            if (opponent) this.lobby.playing(id, opponent.name);
            else this.send(id, { k: 'nogame' });
          });
          break;
        }
      }
    });

    ws.on('close', () => {
      this.sockets.delete(id);
      if (!joined) return;
      // a dropped connection mid-match (usually a refresh) gets a while to rejoin before it counts as leaving
      this.matches.away(id);
      this.matches.unwatch(id);
      this.lobby.remove(id);
    });
  }
}
