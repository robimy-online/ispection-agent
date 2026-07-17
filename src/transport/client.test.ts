import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import type { PeerCertificate } from 'node:tls';
import { spkiPinChecker } from './client';

// A real SPKI DER to pin against (contents don't matter, only the hash).
const der = (generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer);
const pin = createHash('sha256').update(der).digest('base64');
const certWith = (pubkey?: Buffer): PeerCertificate => ({ pubkey } as unknown as PeerCertificate);

test('spkiPinChecker: matching leaf key passes (returns undefined)', () => {
  assert.equal(spkiPinChecker(pin)('host', certWith(der)), undefined);
});

test('spkiPinChecker: mismatched key returns an Error', () => {
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const err = spkiPinChecker(pin)('host', certWith(other));
  assert.ok(err instanceof Error);
  assert.match(err.message, /pin mismatch/i);
});

test('spkiPinChecker: missing peer key returns an Error (fails closed)', () => {
  const err = spkiPinChecker(pin)('host', certWith(undefined));
  assert.ok(err instanceof Error);
});
