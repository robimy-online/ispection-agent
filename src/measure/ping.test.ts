import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, ping } from './ping';

test('parse: Linux success (rtt min/avg/max/mdev)', () => {
  const out = [
    'PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.',
    '--- 8.8.8.8 ping statistics ---',
    '5 packets transmitted, 5 received, 0% packet loss, time 4005ms',
    'rtt min/avg/max/mdev = 10.100/12.300/15.000/1.200 ms',
  ].join('\n');
  const r = parse(out, 5);
  assert.equal(r.reachable, true);
  assert.equal(r.rttMs, 12.3); // avg
  assert.equal(r.jitterMs, 1.2); // mdev
  assert.equal(r.lossPct, 0);
  assert.equal(r.samples, 5);
});

test('parse: macOS success (round-trip stddev, 0.0% loss)', () => {
  const out = [
    '--- 8.8.8.8 ping statistics ---',
    '5 packets transmitted, 5 packets received, 0.0% packet loss',
    'round-trip min/avg/max/stddev = 10.100/12.300/15.000/1.200 ms',
  ].join('\n');
  const r = parse(out, 5);
  assert.equal(r.reachable, true);
  assert.equal(r.rttMs, 12.3);
  assert.equal(r.jitterMs, 1.2);
  assert.equal(r.lossPct, 0);
});

test('parse: Windows success ((0% loss) + Average = Nms)', () => {
  const out = [
    'Ping statistics for 8.8.8.8:',
    '    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),',
    'Approximate round trip times in milli-seconds:',
    '    Minimum = 10ms, Maximum = 15ms, Average = 12ms',
  ].join('\n');
  const r = parse(out, 4);
  assert.equal(r.reachable, true);
  assert.equal(r.rttMs, 12);
  assert.equal(r.lossPct, 0);
});

test('parse: 100% packet loss → unreachable', () => {
  const out = '5 packets transmitted, 0 received, 100% packet loss, time 4000ms';
  const r = parse(out, 5);
  assert.equal(r.reachable, false);
  assert.equal(r.rttMs, null);
  assert.equal(r.lossPct, 100);
});

test('parse: partial loss keeps reachable + rtt', () => {
  const out = [
    '5 packets transmitted, 3 received, 40% packet loss, time 4004ms',
    'rtt min/avg/max/mdev = 20.0/30.0/45.0/8.0 ms',
  ].join('\n');
  const r = parse(out, 5);
  assert.equal(r.reachable, true);
  assert.equal(r.lossPct, 40);
  assert.equal(r.rttMs, 30);
  assert.equal(r.jitterMs, 8);
});

test('ping: invalid/flag-like target returns DOWN without executing ping', async () => {
  const r = await ping('-rf', 5);
  assert.deepEqual(r, { reachable: false, rttMs: null, lossPct: 100, jitterMs: null, samples: 5 });
  const r2 = await ping('8.8.8.8; reboot', 3);
  assert.equal(r2?.reachable, false);
});
