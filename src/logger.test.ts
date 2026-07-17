import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean } from './logger';

test('clean: strips CR/LF (no log-line injection)', () => {
  assert.equal(clean('a\r\nADMIN: forged'), 'a  ADMIN: forged');
});

test('clean: neutralizes the ESC that starts ANSI sequences', () => {
  const out = clean('x\x1b[31mred\x1b[0m');
  assert.ok(!out.includes('\x1b'), 'ESC byte removed');
  assert.equal(out, 'x [31mred [0m');
});

test('clean: strips other C0 controls and DEL', () => {
  assert.equal(clean('a\x07\x00\x7fb'), 'a   b');
});

test('clean: leaves normal text untouched', () => {
  assert.equal(clean('update 1.2.3 available'), 'update 1.2.3 available');
});

test('clean: truncates to the max length with an ellipsis', () => {
  assert.equal(clean('x'.repeat(500), 10), 'xxxxxxxxxx…');
  assert.equal(clean('short', 10), 'short');
});

test('clean: coerces non-strings safely', () => {
  // @ts-expect-error runtime robustness for unexpected input
  assert.equal(clean(12345), '12345');
});
