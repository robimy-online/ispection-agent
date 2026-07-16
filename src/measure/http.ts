import { lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { MeasurementSample } from '../types';

/** DNS resolution time (ms) for a host; null on error. */
function resolveDns(hostname: string): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    lookup(hostname, (err) => resolve(err ? null : Date.now() - start));
  });
}

interface HttpTiming {
  ttfbMs: number | null; // time-to-first-byte; null on error/timeout
  tlsMs: number | null; // TLS handshake time (connect→secureConnect); null when non-HTTPS/error
}

/** TTFB + TLS handshake time for a single HTTP(S) request. */
function measureHttp(url: URL, timeoutMs = 8000): Promise<HttpTiming> {
  return new Promise((resolve) => {
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const start = Date.now();
    let tcpAt: number | null = null;
    let tlsMs: number | null = null;
    let done = false;
    const finish = (ttfbMs: number | null): void => {
      if (done) return;
      done = true;
      resolve({ ttfbMs, tlsMs });
    };
    const req = lib.request(
      {
        method: 'GET',
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        timeout: timeoutMs,
      },
      (res) => {
        res.once('data', () => finish(Date.now() - start)); // first byte
        res.on('end', () => finish(Date.now() - start)); // 204 / empty body
        res.resume();
      },
    );
    // TLS handshake = from TCP connect to secureConnect.
    req.on('socket', (socket) => {
      socket.on('connect', () => {
        tcpAt = Date.now();
      });
      socket.on('secureConnect', () => {
        if (tcpAt !== null) tlsMs = Date.now() - tcpAt;
      });
    });
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    req.on('error', () => finish(null));
    req.end();
  });
}

/** Application-level sample: DNS + TTFB for the target URL. */
export async function probeHttp(target: string): Promise<MeasurementSample> {
  const ts = new Date().toISOString();
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    url = new URL(`https://${target}`);
  }
  const dnsMs = await resolveDns(url.hostname);
  const { ttfbMs, tlsMs } = await measureHttp(url);
  const reachable = ttfbMs !== null;
  return {
    ts,
    target: url.hostname,
    reachable,
    rttMs: ttfbMs,
    lossPct: reachable ? 0 : 100,
    rttJitterMs: null,
    samples: 1,
    dnsMs,
    ttfbMs,
    tlsMs,
  };
}
