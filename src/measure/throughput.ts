import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

/** Downloads from `target` for up to `maxMs` ms, counting bytes → Mbit/s. null on error. */
export function measureThroughput(target: string, maxMs = 10_000): Promise<number | null> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      resolve(null);
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const start = Date.now();
    let bytes = 0;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      const ms = Date.now() - start;
      resolve(bytes > 0 && ms > 0 ? (bytes * 8) / (ms / 1000) / 1e6 : null);
    };
    const req = lib.get(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        timeout: maxMs + 2000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.destroy();
          resolve(null);
          done = true;
          return;
        }
        res.on('data', (c: Buffer) => {
          bytes += c.length;
          if (Date.now() - start >= maxMs) {
            res.destroy();
            finish();
          }
        });
        res.on('end', finish);
        res.on('error', finish);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      finish();
    });
    req.on('error', () => {
      if (!done) {
        done = true;
        resolve(null);
      }
    });
  });
}
