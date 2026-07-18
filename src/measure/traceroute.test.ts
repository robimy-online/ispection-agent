import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, traceroute } from './traceroute';

test('parse: numeric Linux traceroute — private hops masked, latency kept', () => {
  const out = [
    'traceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 60 byte packets',
    ' 1  192.168.1.1  1.234 ms',
    ' 2  10.0.0.1  5.678 ms',
    ' 3  * ',
    ' 4  8.8.8.8  12.000 ms',
  ].join('\n');
  const hops = parse(out);
  assert.equal(hops.length, 4);
  // Privacy: private/LAN hop IPs are masked to null, but the hop and its RTT survive.
  assert.deepEqual(hops[0], { hop: 1, ip: null, rttMs: 1.234 });
  assert.deepEqual(hops[1], { hop: 2, ip: null, rttMs: 5.678 });
  assert.deepEqual(hops[2], { hop: 3, ip: null, rttMs: null }); // '*' = no reply
  assert.deepEqual(hops[3], { hop: 4, ip: '8.8.8.8', rttMs: 12 }); // public hop kept
});

test('parse: masks CGNAT and link-local hops but keeps public ones', () => {
  const out = [
    ' 1  100.64.0.1  1.0 ms', // CGNAT
    ' 2  169.254.1.1  2.0 ms', // link-local
    ' 3  1.1.1.1  3.0 ms', // public
  ].join('\n');
  const hops = parse(out);
  assert.equal(hops[0].ip, null);
  assert.equal(hops[1].ip, null);
  assert.equal(hops[2].ip, '1.1.1.1');
});

test('parse: ignores the header and any non-hop lines', () => {
  const out = ['garbage line', ' 1  1.1.1.1  2.5 ms', 'another non-hop'].join('\n');
  const hops = parse(out);
  assert.equal(hops.length, 1);
  assert.equal(hops[0].ip, '1.1.1.1');
});

test('parse: empty output → no hops', () => {
  assert.deepEqual(parse(''), []);
});

test('traceroute: invalid/flag-like target returns [] without executing traceroute', async () => {
  assert.deepEqual(await traceroute('-rf'), []);
  assert.deepEqual(await traceroute('8.8.8.8 && rm'), []);
});
