import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

/** POSTs `bytes` bytes to `target`, timing the transfer → Mbit/s. null on error. */
export function measureUpload(target: string, bytes = 8_000_000, maxMs = 15_000): Promise<number | null> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      resolve(null);
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const payload = Buffer.alloc(bytes, 0x61); // fixed buffer — contents don't matter, only size/time
    const start = Date.now();
    const req = lib.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: { 'content-type': 'application/octet-stream', 'content-length': payload.length },
        timeout: maxMs + 2000,
      },
      (res) => {
        res.on('data', () => undefined); // drain
        res.on('end', () => {
          const ms = Date.now() - start;
          const ok = res.statusCode !== undefined && res.statusCode < 400;
          resolve(ok && ms > 0 ? (payload.length * 8) / (ms / 1000) / 1e6 : null);
        });
        res.on('error', () => resolve(null));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end(payload);
  });
}
