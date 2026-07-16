import type { AgentConfig } from '../config';
import type { AgentKeys } from '../crypto/keys';

/**
 * Agent → server channel (/agent-live). Pushes state changes immediately, without waiting for a batch.
 * Handshake signed with Ed25519 over `agentId.ts` (verified server-side).
 * Uses the global WebSocket (Node 22+) — no extra dependencies.
 */
export class AgentLive {
  private ws?: WebSocket;
  private reconnectDelay = 1000;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly keys: AgentKeys,
    private readonly agentId: number,
  ) {}

  connect(): void {
    const ts = String(Date.now());
    const sig = encodeURIComponent(this.keys.sign(Buffer.from(`${this.agentId}.${ts}`)));
    const base = this.cfg.ingestUrl.replace(/^http/, 'ws');
    const url = `${base}/agent-live?agentId=${this.agentId}&ts=${ts}&sig=${sig}`;
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
      };
      this.ws.onclose = () => this.scheduleReconnect();
      this.ws.onerror = () => this.ws?.close();
    } catch {
      this.scheduleReconnect();
    }
  }

  pushStatus(status: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event: 'status', data: { status } }));
    }
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }
}
