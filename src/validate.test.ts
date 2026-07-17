import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, isValidHost } from './validate';

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

test('clamp: bounds a value to [lo, hi]', () => {
  assert.equal(clamp(1, 5, 20), 5);
  assert.equal(clamp(999, 1, 20), 20);
  assert.equal(clamp(10, 5, 20), 10);
  assert.equal(clamp(5, 5, 20), 5);
  assert.equal(clamp(20, 5, 20), 20);
  assert.equal(clamp(-3, 0, 0.5), 0);
  assert.equal(clamp(0.9, 0, 0.5), 0.5);
});
