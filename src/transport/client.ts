import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import type { PeerCertificate } from 'node:tls';
import { URL } from 'node:url';

export interface HttpResponse {
  status: number;
  body: string;
}

export interface PostOptions {
  pinSpki?: string | null; // base64 sha256 of the server SPKI; enforced only over https
}

/**
 * checkServerIdentity that pins the leaf public key (SPKI SHA-256). Survives cert renewal
 * (unlike full-cert pinning). Runs after the default chain validation, so it only tightens trust.
 * Shared by the HTTP client and the WebSocket handshake so both channels pin consistently.
 */
export function spkiPinChecker(pinSpki: string): (host: string, cert: PeerCertificate) => Error | undefined {
  return (_host: string, cert: PeerCertificate): Error | undefined => {
    const der = cert.pubkey;
    if (!der) return new Error('No peer public key to pin');
    const pin = createHash('sha256').update(der).digest('base64');
    return pin === pinSpki ? undefined : new Error(`SPKI pin mismatch (got ${pin})`);
  };
}

/** POST a raw body over http/https, optionally pinning the server public key (SPKI SHA-256). */
export function postJson(
  urlStr: string,
  headers: Record<string, string>,
  body: Buffer,
  opts: PostOptions = {},
): Promise<HttpResponse> {
  const url = new URL(urlStr);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  const options: https.RequestOptions = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    headers: {
      'content-type': 'application/json',
      'content-length': String(body.length),
      ...headers,
    },
  };

  if (isHttps && opts.pinSpki) {
    options.checkServerIdentity = spkiPinChecker(opts.pinSpki);
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** GET JSON (no body) — used for the agent release check. */
export function getJson(urlStr: string, opts: PostOptions = {}): Promise<HttpResponse> {
  const url = new URL(urlStr);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const options: https.RequestOptions = {
    method: 'GET',
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
  };
  if (isHttps && opts.pinSpki) {
    options.checkServerIdentity = spkiPinChecker(opts.pinSpki);
  }
  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}
