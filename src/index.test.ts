import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { loadConfig, type AgentConfig } from './config';
import { applyRemoteConfig, jitteredMs, makeTargetPicker, verifyManifest } from './index';

/** A config built from a clean environment (defaults), so tests don't inherit the runner's env. */
function baseCfg(): AgentConfig {
  const saved = process.env;
  process.env = {};
  try {
    return loadConfig();
  } finally {
    process.env = saved;
  }
}

// ---- applyRemoteConfig (the collector trust boundary) --------------------------------------------

test('applyRemoteConfig: clamps interval / ping / jitter from the server', () => {
  const cfg = baseCfg();
  assert.equal(applyRemoteConfig(cfg, { intervalSec: 1 }), true);
  assert.equal(cfg.intervalSec, 5);
  applyRemoteConfig(cfg, { intervalSec: 999_999 });
  assert.equal(cfg.intervalSec, 86_400);
  applyRemoteConfig(cfg, { pingCount: 999 });
  assert.equal(cfg.pingCount, 20);
  applyRemoteConfig(cfg, { scheduleJitterPct: 5 });
  assert.equal(cfg.scheduleJitterPct, 0.5);
  applyRemoteConfig(cfg, { scheduleJitterPct: -1 });
  assert.equal(cfg.scheduleJitterPct, 0);
});

test('applyRemoteConfig: validates server-pushed targets (drops flag-like)', () => {
  const cfg = baseCfg();
  const changed = applyRemoteConfig(cfg, { targets: ['-rf', '9.9.9.9', 'a b', '1.0.0.1'] });
  assert.equal(changed, true);
  assert.deepEqual(cfg.targets, ['9.9.9.9', '1.0.0.1']);
});

test('applyRemoteConfig: ignores an all-invalid target list (keeps env targets)', () => {
  const cfg = baseCfg();
  const before = [...cfg.targets];
  const changed = applyRemoteConfig(cfg, { targets: ['-rf', ' ', ';'] });
  assert.equal(changed, false);
  assert.deepEqual(cfg.targets, before);
});

test('applyRemoteConfig: declared speeds bounded and > 0', () => {
  const cfg = baseCfg();
  applyRemoteConfig(cfg, { declaredDownMbps: 2_000_000 });
  assert.equal(cfg.declaredDownMbps, 1_000_000);
  const noChange = applyRemoteConfig(cfg, { declaredUpMbps: -5 }); // not > 0 → ignored
  assert.equal(cfg.declaredUpMbps, null);
  assert.equal(noChange, false);
});

test('applyRemoteConfig: no-op when values already match / empty config', () => {
  const cfg = baseCfg();
  assert.equal(applyRemoteConfig(cfg, {}), false);
  assert.equal(applyRemoteConfig(cfg, { intervalSec: cfg.intervalSec }), false);
  assert.equal(applyRemoteConfig(cfg, { rotateTargets: cfg.rotateTargets }), false);
});

// ---- makeTargetPicker ----------------------------------------------------------------------------

test('makeTargetPicker: no rotation returns the live target list', () => {
  const cfg = baseCfg();
  cfg.rotateTargets = false;
  cfg.targets = ['1.1.1.1'];
  const pick = makeTargetPicker(cfg);
  assert.deepEqual(pick(), ['1.1.1.1']);
  cfg.targets = ['8.8.8.8', '9.9.9.9']; // picker reads cfg live
  assert.deepEqual(pick(), ['8.8.8.8', '9.9.9.9']);
});

test('makeTargetPicker: rotation slides a window over the pool and wraps', () => {
  const cfg = baseCfg();
  cfg.rotateTargets = true;
  cfg.targetPool = ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4'];
  cfg.targetsPerCycle = 2;
  const pick = makeTargetPicker(cfg);
  assert.deepEqual(pick(), ['1.1.1.1', '1.0.0.1']);
  assert.deepEqual(pick(), ['8.8.8.8', '8.8.4.4']);
  assert.deepEqual(pick(), ['1.1.1.1', '1.0.0.1']); // wrapped
});

test('makeTargetPicker: rotation with empty pool falls back to targets', () => {
  const cfg = baseCfg();
  cfg.rotateTargets = true;
  cfg.targetPool = [];
  cfg.targets = ['1.1.1.1'];
  assert.deepEqual(makeTargetPicker(cfg)(), ['1.1.1.1']);
});

// ---- jitteredMs ----------------------------------------------------------------------------------

test('jitteredMs: no jitter returns the base delay exactly', () => {
  assert.equal(jitteredMs(5000, 0), 5000);
  assert.equal(jitteredMs(5000, -1), 5000);
});

test('jitteredMs: stays within ±pct and never below the 1s floor', () => {
  for (let i = 0; i < 2000; i += 1) {
    const v = jitteredMs(10_000, 0.2);
    assert.ok(v >= 8000 && v <= 12_000, `within band: ${v}`);
  }
  for (let i = 0; i < 200; i += 1) {
    assert.ok(jitteredMs(500, 0.5) >= 1000, 'floor at 1000ms');
  }
});

// ---- verifyManifest (signed self-update) ---------------------------------------------------------

test('verifyManifest: accepts a correctly signed manifest', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  const m = { version: '0.3.0', url: 'https://x/agent', sha256: 'deadbeef' };
  const sigMsg = Buffer.from(`${m.version}.${m.url}.${m.sha256}`);
  const sig = sign(null, sigMsg, privateKey).toString('base64');
  assert.equal(verifyManifest({ ...m, sig }, pub), true);
});

test('verifyManifest: rejects a tampered field', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  const m = { version: '0.3.0', url: 'https://x/agent', sha256: 'deadbeef' };
  const sig = sign(null, Buffer.from(`${m.version}.${m.url}.${m.sha256}`), privateKey).toString('base64');
  assert.equal(verifyManifest({ ...m, url: 'https://evil/agent', sig }, pub), false);
});

test('verifyManifest: rejects missing fields and bad keys', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const pub = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  assert.equal(verifyManifest({ version: '1', url: 'u', sha256: 's' }, pub), false); // no sig
  assert.equal(verifyManifest({ version: '1', sig: 'x' }, pub), false); // missing url/sha
  assert.equal(verifyManifest({ version: '1', url: 'u', sha256: 's', sig: 'x' }, 'not-a-key'), false);
});
