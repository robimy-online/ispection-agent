import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config';

/** Load config against a clean, controlled environment (no leakage from the runner's env). */
function load(overrides: Record<string, string> = {}): ReturnType<typeof loadConfig> {
  const saved = process.env;
  process.env = { ...overrides };
  try {
    return loadConfig();
  } finally {
    process.env = saved;
  }
}

test('defaults are applied on an empty environment', () => {
  const c = load();
  assert.equal(c.ingestUrl, 'https://ispection.robimy.online/api');
  assert.deepEqual(c.targets, ['1.1.1.1', '8.8.8.8']);
  assert.equal(c.intervalSec, 30);
  assert.equal(c.pingCount, 5);
  assert.equal(c.maxBatch, 500);
  assert.equal(c.maxBuffer, 50_000);
  assert.equal(c.insecure, false);
  assert.equal(c.pinSpki, null);
  assert.equal(c.updateMode, 'notify');
});

test('ingestUrl strips trailing slashes', () => {
  assert.equal(load({ INGEST_URL: 'https://h/api///' }).ingestUrl, 'https://h/api');
});

test('TARGETS: invalid/flag-like entries are dropped, valid kept', () => {
  assert.deepEqual(load({ TARGETS: '-rf,8.8.8.8,a b,1.1.1.1' }).targets, ['8.8.8.8', '1.1.1.1']);
});

test('TARGETS: falls back to defaults when nothing valid remains', () => {
  assert.deepEqual(load({ TARGETS: '-rf, ; , |' }).targets, ['1.1.1.1', '8.8.8.8']);
});

test('intervalSec: clamped and NaN-safe', () => {
  assert.equal(load({ INGEST_INTERVAL_SEC: '0' }).intervalSec, 5);
  assert.equal(load({ INGEST_INTERVAL_SEC: '-9' }).intervalSec, 5);
  assert.equal(load({ INGEST_INTERVAL_SEC: '999999' }).intervalSec, 86_400);
  assert.equal(load({ INGEST_INTERVAL_SEC: 'abc' }).intervalSec, 30);
  assert.equal(load({ INGEST_INTERVAL_SEC: '' }).intervalSec, 30);
  assert.equal(load({ INGEST_INTERVAL_SEC: '45' }).intervalSec, 45);
});

test('pingCount / maxBatch / maxBuffer / uploadBytes are clamped', () => {
  assert.equal(load({ PING_COUNT: '999' }).pingCount, 20);
  assert.equal(load({ PING_COUNT: '0' }).pingCount, 1);
  assert.equal(load({ INGEST_MAX_BATCH: '0' }).maxBatch, 1);
  assert.equal(load({ INGEST_MAX_BATCH: '99999' }).maxBatch, 10_000);
  assert.equal(load({ BUFFER_MAX: '5' }).maxBuffer, 100);
  assert.equal(load({ UPLOAD_BYTES: '-1' }).uploadBytes, 0);
  assert.equal(load({ UPLOAD_BYTES: '999999999' }).uploadBytes, 100_000_000);
});

test('insecure + pinSpki flags', () => {
  const c = load({ INGEST_INSECURE: 'true', INGEST_PIN_SPKI: 'abc==' });
  assert.equal(c.insecure, true);
  assert.equal(c.pinSpki, 'abc==');
  assert.equal(load({ INGEST_INSECURE: 'yes' }).insecure, false); // only exact 'true'
});

test('scheduleJitterPct is clamped to [0, 0.5]', () => {
  assert.equal(load({ SCHEDULE_JITTER_PCT: '5' }).scheduleJitterPct, 0.5);
  assert.equal(load({ SCHEDULE_JITTER_PCT: '-1' }).scheduleJitterPct, 0);
  assert.equal(load({ SCHEDULE_JITTER_PCT: '0.25' }).scheduleJitterPct, 0.25);
});

test('portProbes: parsed and host-validated', () => {
  const c = load({ PORT_PROBES: '1.1.1.1:443, 8.8.8.8:53, -bad:80, host.com:22, x:0, y:70000' });
  assert.deepEqual(c.portProbes, [
    { host: '1.1.1.1', port: 443 },
    { host: '8.8.8.8', port: 53 },
    { host: 'host.com', port: 22 },
  ]);
});

test('targetPool: invalid entries filtered', () => {
  const c = load({ TARGET_POOL: '1.1.1.1,-x,9.9.9.9' });
  assert.deepEqual(c.targetPool, ['1.1.1.1', '9.9.9.9']);
});

test('tracerouteTarget defaults to the first valid target', () => {
  assert.equal(load({ TARGETS: '9.9.9.9,1.1.1.1' }).tracerouteTarget, '9.9.9.9');
  assert.equal(load({ TRACEROUTE_TARGET: 'a.example.com', TARGETS: '9.9.9.9' }).tracerouteTarget, 'a.example.com');
});

test('updateMode parsing', () => {
  assert.equal(load({ UPDATE_MODE: 'off' }).updateMode, 'off');
  assert.equal(load({ UPDATE_MODE: 'AUTO' }).updateMode, 'auto');
  assert.equal(load({ UPDATE_MODE: 'garbage' }).updateMode, 'notify');
});
