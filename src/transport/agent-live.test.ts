import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame } from './agent-live';

interface Decoded {
  fin: boolean;
  opcode: number;
  masked: boolean;
  len: number;
  payload: Buffer;
}

/** Server-side decode of a client frame: read header, then unmask the payload (RFC 6455). */
function decode(frame: Buffer): Decoded {
  const fin = (frame[0] & 0x80) !== 0;
  const opcode = frame[0] & 0x0f;
  const masked = (frame[1] & 0x80) !== 0;
  let len = frame[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    len = frame.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    len = Number(frame.readBigUInt64BE(2));
    off = 10;
  }
  const mask = frame.subarray(off, off + 4);
  off += 4;
  const body = frame.subarray(off, off + len);
  const payload = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) payload[i] = body[i] ^ mask[i & 3];
  return { fin, opcode, masked, len, payload };
}

const OP_TEXT = 0x1;
const OP_PONG = 0xa;

test('encodeFrame: small text frame is FIN + masked and round-trips', () => {
  const payload = Buffer.from('{"event":"status","data":{"status":"down"}}');
  const d = decode(encodeFrame(OP_TEXT, payload));
  assert.equal(d.fin, true);
  assert.equal(d.opcode, OP_TEXT);
  assert.equal(d.masked, true, 'client frames MUST be masked');
  assert.equal(d.len, payload.length);
  assert.deepEqual(d.payload, payload);
});

test('encodeFrame: empty pong control frame', () => {
  const d = decode(encodeFrame(OP_PONG, Buffer.alloc(0)));
  assert.equal(d.opcode, OP_PONG);
  assert.equal(d.len, 0);
  assert.equal(d.masked, true);
});

test('encodeFrame: 16-bit length path (126..65535)', () => {
  const payload = Buffer.alloc(200, 0x41);
  const frame = encodeFrame(OP_TEXT, payload);
  assert.equal(frame[1] & 0x7f, 126, 'uses the 16-bit length marker');
  assert.deepEqual(decode(frame).payload, payload);
});

test('encodeFrame: 64-bit length path (>= 65536)', () => {
  const payload = Buffer.alloc(70_000, 0x42);
  const frame = encodeFrame(OP_TEXT, payload);
  assert.equal(frame[1] & 0x7f, 127, 'uses the 64-bit length marker');
  const d = decode(frame);
  assert.equal(d.len, 70_000);
  assert.deepEqual(d.payload, payload);
});

test('encodeFrame: payload bytes are actually masked on the wire', () => {
  const payload = Buffer.from('AAAAAAAA'); // repeated byte → obvious if unmasked
  const frame = encodeFrame(OP_TEXT, payload);
  const onWire = frame.subarray(6, 6 + payload.length); // after 2-byte header + 4-byte mask
  // With a random non-zero mask this is overwhelmingly not equal to the plaintext.
  assert.notDeepEqual(onWire, payload);
  assert.deepEqual(decode(frame).payload, payload); // but decodes back
});
