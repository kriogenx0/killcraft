// Browser connection to the game server.
import type { ClientMsg, ServerMsg } from './protocol.ts';

export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<(m: ServerMsg) => void>();
  private closeHandlers = new Set<() => void>();

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Connect to the server on this page's host. Rejects with a readable message if it can't. */
  connect(name: string): Promise<void> {
    if (this.connected) { this.send({ k: 'hello', name }); return Promise.resolve(); }
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.close(); // still connecting under another name: drop that socket
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => { this.send({ k: 'hello', name }); resolve(); };
      ws.onerror = () => reject(new Error("Can't reach the game server. Check your connection and try again."));
      ws.onclose = () => {
        if (this.ws !== ws) return; // an old socket we replaced (a name change): not a lost connection
        this.ws = null;
        for (const h of this.closeHandlers) h();
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        for (const h of this.handlers) h(msg);
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.connected) this.ws?.send(JSON.stringify(msg));
  }

  onMessage(h: (m: ServerMsg) => void): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onClose(h: () => void): () => void {
    this.closeHandlers.add(h);
    return () => this.closeHandlers.delete(h);
  }

  /** Close on purpose: this isn't a lost connection, so the close handlers don't run. */
  close(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}

export const net = new NetClient();
