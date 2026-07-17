import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentStatus, probeTarget } from './probe';
import type { MeasurementSample } from '../types';

const s = (over: Partial<MeasurementSample>): MeasurementSample => ({
  ts: '2026-07-17T00:00:00.000Z',
  target: 't',
  reachable: true,
  rttMs: 10,
  lossPct: 0,
  ...over,
});

test('agentStatus: empty set is ok', () => {
  assert.equal(agentStatus([]), 'ok');
});

test('agentStatus: all reachable, no loss → ok', () => {
  assert.equal(agentStatus([s({}), s({ target: 'b' })]), 'ok');
});

test('agentStatus: every sample unreachable → down', () => {
  assert.equal(agentStatus([s({ reachable: false, rttMs: null, lossPct: 100 })]), 'down');
});

test('agentStatus: some unreachable → degraded', () => {
  assert.equal(agentStatus([s({}), s({ reachable: false, rttMs: null, lossPct: 100 })]), 'degraded');
});

test('agentStatus: loss ≥ 5% → degraded, < 5% → ok', () => {
  assert.equal(agentStatus([s({ lossPct: 5 })]), 'degraded');
  assert.equal(agentStatus([s({ lossPct: 4.9 })]), 'ok');
});

test('probeTarget: invalid/flag-like target returns DOWN without shelling out', async () => {
  // isValidHost rejects before ping/traceroute exec, so this is hermetic (no network, no process spawn).
  const r = await probeTarget('-rf', 3);
  assert.equal(r.reachable, false);
  assert.equal(r.lossPct, 100);
  assert.equal(r.target, '-rf');
  assert.equal(r.rttMs, null);
});
