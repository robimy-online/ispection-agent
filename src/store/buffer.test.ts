import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentStore } from './buffer';
import type { MeasurementSample } from '../types';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'isp-store-'));
}

const sample = (i: number): MeasurementSample => ({
  ts: new Date(i).toISOString(),
  target: `t${i}`,
  reachable: true,
  rttMs: i,
  lossPct: 0,
});

test('fresh store: empty defaults', () => {
  const dir = tmpDir();
  const s = new AgentStore(dir);
  assert.equal(s.agentId, null);
  assert.equal(s.pending(), 0);
  assert.equal(s.nextSeq(), 1); // first seq
  rmSync(dir, { recursive: true, force: true });
});

test('agentId + seq persist across instances', () => {
  const dir = tmpDir();
  const a = new AgentStore(dir);
  a.setAgentId(42);
  assert.equal(a.nextSeq(), 1);
  assert.equal(a.nextSeq(), 2);
  const b = new AgentStore(dir); // reopen
  assert.equal(b.agentId, 42);
  assert.equal(b.nextSeq(), 3, 'sequence continues, never reused');
  rmSync(dir, { recursive: true, force: true });
});

test('append / peekBatch / dropBatch', () => {
  const dir = tmpDir();
  const s = new AgentStore(dir);
  s.append([sample(1), sample(2), sample(3)]);
  assert.equal(s.pending(), 3);
  assert.deepEqual(s.peekBatch(2).map((x) => x.target), ['t1', 't2']);
  s.dropBatch(2);
  assert.equal(s.pending(), 1);
  assert.deepEqual(s.peekBatch(10).map((x) => x.target), ['t3']);
  rmSync(dir, { recursive: true, force: true });
});

test('samples persist across instances until dropped', () => {
  const dir = tmpDir();
  const a = new AgentStore(dir);
  a.append([sample(1), sample(2)]);
  const b = new AgentStore(dir);
  assert.equal(b.pending(), 2);
  rmSync(dir, { recursive: true, force: true });
});

test('cap: drops oldest past maxSamples and returns dropped count', () => {
  const dir = tmpDir();
  const s = new AgentStore(dir, 100); // min cap is 100
  let dropped = s.append(Array.from({ length: 100 }, (_, i) => sample(i)));
  assert.equal(dropped, 0);
  assert.equal(s.pending(), 100);
  dropped = s.append([sample(100), sample(101), sample(102)]);
  assert.equal(dropped, 3);
  assert.equal(s.pending(), 100);
  const batch = s.peekBatch(100);
  assert.equal(batch[batch.length - 1].target, 't102', 'newest retained');
  assert.equal(batch[0].target, 't3', 'oldest three dropped');
  rmSync(dir, { recursive: true, force: true });
});

test('cap: constructor trims an over-cap buffer left by an older build', () => {
  const dir = tmpDir();
  const big = new AgentStore(dir, 100_000);
  big.append(Array.from({ length: 250 }, (_, i) => sample(i)));
  const small = new AgentStore(dir, 100); // reopen with a smaller cap
  assert.equal(small.pending(), 100);
  assert.equal(small.peekBatch(100)[99].target, 't249', 'keeps the newest 100');
  rmSync(dir, { recursive: true, force: true });
});

test('maxSamples floor of 100 is enforced', () => {
  const dir = tmpDir();
  const s = new AgentStore(dir, 5); // below floor
  const dropped = s.append(Array.from({ length: 100 }, (_, i) => sample(i)));
  assert.equal(dropped, 0, 'floor raised to 100, so 100 fit');
  rmSync(dir, { recursive: true, force: true });
});

test('state files are written 0600 and no .tmp is left behind', () => {
  const dir = tmpDir();
  const s = new AgentStore(dir);
  s.setAgentId(7);
  s.append([sample(1)]);
  const metaMode = statSync(path.join(dir, 'meta.json')).mode & 0o777;
  const bufMode = statSync(path.join(dir, 'buffer.json')).mode & 0o777;
  assert.equal(metaMode, 0o600);
  assert.equal(bufMode, 0o600);
  assert.ok(!existsSync(path.join(dir, 'meta.json.tmp')));
  assert.ok(!existsSync(path.join(dir, 'buffer.json.tmp')));
  rmSync(dir, { recursive: true, force: true });
});

test('corrupt buffer file falls back to empty (no crash)', () => {
  const dir = tmpDir();
  const s0 = new AgentStore(dir); // creates dir
  void s0;
  require('node:fs').writeFileSync(path.join(dir, 'buffer.json'), '{ not json');
  const s = new AgentStore(dir);
  assert.equal(s.pending(), 0);
  rmSync(dir, { recursive: true, force: true });
});

test('meta round-trips as valid JSON on disk', () => {
  const dir = tmpDir();
  const s = new AgentStore(dir);
  s.setAgentId(99);
  const raw = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { agentId: number };
  assert.equal(raw.agentId, 99);
  rmSync(dir, { recursive: true, force: true });
});
