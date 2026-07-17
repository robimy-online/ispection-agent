import http from 'node:http';
import https from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';
import { URL } from 'node:url';
import type { AgentConfig } from '../config';
import type { AgentKeys } from '../crypto/keys';
import { spkiPinChecker } from './client';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/**
 * Agent → server live channel (/agent-live). Pushes state changes immediately, without waiting
 * for the next batch. The handshake runs over http/https.request so it honours the SAME SPKI pin
 * and CA validation as the ingest channel (the global WebSocket can't be pinned without a
 * dependency, so we drive the Upgrade ourselves and frame outbound messages by hand).
 *
 * Send-only for application data (status frames); inbound frames are parsed only enough to answer
 * ping and react to close. Auth (agentId.ts, Ed25519-signed) is sent in the Upgrade headers and,
 * for backward compatibility with the current collector, mirrored in the query string.
 */
export class AgentLive {
  private socket?: Socket;
  private open = false;
  private reconnectDelay = 1000;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly keys: AgentKeys,
    private readonly agentId: number,
  ) {}

  connect(): void {
    this.open = false;
    const ts = String(Date.now());
    const sig = this.keys.sign(Buffer.from(`${this.agentId}.${ts}`));
    let base: URL;
    try {
      base = new URL(this.cfg.ingestUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    const isHttps = base.protocol === 'https:';
    const lib = isHttps ? https : http;
    const pin = this.cfg.insecure ? null : this.cfg.pinSpki;
    const wsKey = randomBytes(16).toString('base64');
    const basePath = base.pathname.replace(/\/+$/, '');
    // Query params kept for the current server contract; headers are the forward-compatible form.
    const path = `${basePath}/agent-live?agentId=${this.agentId}&ts=${ts}&sig=${encodeURIComponent(sig)}`;

    const options: https.RequestOptions = {
      method: 'GET',
      hostname: base.hostname,
      port: base.port || (isHttps ? 443 : 80),
      path,
      timeout: 15_000,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': wsKey,
        'Sec-WebSocket-Version': '13',
        'x-agent-id': String(this.agentId),
        'x-timestamp': ts,
        'x-signature': sig,
        'x-agent-version': this.cfg.version,
      },
    };
    if (isHttps && pin) options.checkServerIdentity = spkiPinChecker(pin);

    const req = lib.request(options);

    req.on('upgrade', (res, socket: Socket) => {
      const accept = createHash('sha1').update(wsKey + WS_GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== accept) {
        socket.destroy();
        this.scheduleReconnect();
        return;
      }
      this.socket = socket;
      this.open = true;
      this.reconnectDelay = 1000;
      socket.setTimeout(0);
      socket.on('data', (buf: Buffer) => this.onData(buf));
      socket.on('close', () => {
        this.open = false;
        this.scheduleReconnect();
      });
      socket.on('error', () => {
        this.open = false;
        socket.destroy();
      });
    });

    // Server answered without upgrading (e.g. 401/404) → treat as a failed connect.
    req.on('response', (res) => {
      res.resume();
      this.scheduleReconnect();
    });
    req.on('timeout', () => req.destroy(new Error('ws handshake timeout')));
    req.on('error', () => this.scheduleReconnect());
    req.end();
  }

  pushStatus(status: string): void {
    if (!this.open || !this.socket) return;
    const payload = Buffer.from(JSON.stringify({ event: 'status', data: { status } }));
    try {
      this.socket.write(encodeFrame(OP_TEXT, payload));
    } catch {
      this.open = false;
    }
  }

  /** Minimal inbound handling: answer ping, react to close. App-level frames are ignored. */
  private onData(buf: Buffer): void {
    if (buf.length < 2) return;
    const opcode = buf[0] & 0x0f;
    if (opcode === OP_CLOSE) {
      this.scheduleReconnect();
    } else if (opcode === OP_PING && this.open && this.socket) {
      try {
        this.socket.write(encodeFrame(OP_PONG, Buffer.alloc(0)));
      } catch {
        /* socket gone — reconnect logic will handle it */
      }
    }
  }

  private scheduleReconnect(): void {
    this.open = false;
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        /* already gone */
      }
      this.socket = undefined;
    }
    if (this.reconnectTimer) return; // a reconnect is already pending — don't stack them
    // Jitter (±50%) so a whole fleet dropped by a collector restart doesn't reconnect in lockstep.
    const delay = Math.round(this.reconnectDelay * (0.5 + Math.random()));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }
}

/** Encodes a single client→server frame (FIN=1, client mask required by RFC 6455). */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | len]);
  } else if (len < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const mask = randomBytes(4);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}
