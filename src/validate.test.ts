import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, isPublicIpv4, isPublicIpv6, isPublicTarget, isValidHost } from './validate';

test('isValidHost: accepts IPv4 / IPv6 / hostnames', () => {
  assert.equal(isValidHost('8.8.8.8'), true);
  assert.equal(isValidHost('1.1.1.1'), true);
  assert.equal(isValidHost('2606:4700:4700::1111'), true);
  assert.equal(isValidHost('::1'), true);
  assert.equal(isValidHost('example.com'), true);
  assert.equal(isValidHost('speed.cloudflare.com'), true);
  assert.equal(isValidHost('a-b.example.co.uk'), true);
  assert.equal(isValidHost('localhost'), true);
});

test('isValidHost: rejects flag-like and injection-shaped values', () => {
  assert.equal(isValidHost('-rf'), false); // could be read as a ping flag
  assert.equal(isValidHost('-c5'), false);
  assert.equal(isValidHost('8.8.8.8; rm -rf /'), false);
  assert.equal(isValidHost('8.8.8.8 -f'), false); // space
  assert.equal(isValidHost('a`whoami`.com'), false);
  assert.equal(isValidHost('$(reboot)'), false);
  assert.equal(isValidHost('foo|bar'), false);
  assert.equal(isValidHost('-'), false);
  assert.equal(isValidHost('host-.com'), false); // label ends with hyphen
  assert.equal(isValidHost('.com'), false); // empty leading label
});

test('isValidHost: rejects empty / oversized / non-string', () => {
  assert.equal(isValidHost(''), false);
  assert.equal(isValidHost('a'.repeat(254)), false); // > 253
  // @ts-expect-error runtime guard for non-string input
  assert.equal(isValidHost(undefined), false);
  // @ts-expect-error runtime guard for non-string input
  assert.equal(isValidHost(123), false);
});

test('isValidHost: is not vulnerable to catastrophic backtracking (bounded length)', () => {
  const start = Date.now();
  isValidHost('a'.repeat(253)); // max length, no dots — worst case for the label regex
  isValidHost(`${'a'.repeat(60)}.`.repeat(50)); // many labels
  assert.ok(Date.now() - start < 100, 'host validation should be near-instant');
});

test('isPublicIpv4: rejects private / reserved ranges', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
    assert.equal(isPublicIpv4(ip), false, ip);
  }
});

test('isPublicIpv4: accepts public addresses; false for non-IPv4', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '9.9.9.9']) {
    assert.equal(isPublicIpv4(ip), true, ip);
  }
  assert.equal(isPublicIpv4('example.com'), false);
  assert.equal(isPublicIpv4('2606:4700:4700::1111'), false);
});

test('isPublicIpv6: rejects loopback / ULA / link-local, accepts public', () => {
  assert.equal(isPublicIpv6('::1'), false);
  assert.equal(isPublicIpv6('::'), false);
  assert.equal(isPublicIpv6('fd00::1'), false); // ULA
  assert.equal(isPublicIpv6('fe80::1'), false); // link-local
  assert.equal(isPublicIpv6('2606:4700:4700::1111'), true);
});

test('isPublicTarget: hostnames pass, private IP literals rejected', () => {
  assert.equal(isPublicTarget('speed.cloudflare.com'), true);
  assert.equal(isPublicTarget('1.1.1.1'), true);
  assert.equal(isPublicTarget('192.168.0.1'), false);
  assert.equal(isPublicTarget('10.1.2.3'), false);
  assert.equal(isPublicTarget('fd00::1'), false);
  assert.equal(isPublicTarget('-rf'), false); // still rejects injection-shaped values
});

test('clamp: bounds a value to [lo, hi]', () => {
  assert.equal(clamp(1, 5, 20), 5);
  assert.equal(clamp(999, 1, 20), 20);
  assert.equal(clamp(10, 5, 20), 10);
  assert.equal(clamp(5, 5, 20), 5);
  assert.equal(clamp(20, 5, 20), 20);
  assert.equal(clamp(-3, 0, 0.5), 0);
  assert.equal(clamp(0.9, 0, 0.5), 0.5);
});
