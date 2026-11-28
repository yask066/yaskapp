import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeRateLimitIp } from './rate-limit.js';

test('normalizeRateLimitIp normalizes IPv4, IPv4-mapped IPv6, and IPv6 /64 prefixes', () => {
  assert.equal(normalizeRateLimitIp('203.0.113.5'), '203.0.113.5');
  assert.equal(normalizeRateLimitIp('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(normalizeRateLimitIp('2001:db8:abcd:0012:ffff::1'), '2001:0db8:abcd:0012::/64');
  assert.equal(normalizeRateLimitIp('2001:db8:abcd:0012:0000:0000:0000:9999'), '2001:0db8:abcd:0012::/64');
  assert.equal(normalizeRateLimitIp('2001:db8::1'), '2001:0db8:0000:0000::/64');
  assert.equal(normalizeRateLimitIp('::1'), '0000:0000:0000:0000::/64');
  assert.equal(normalizeRateLimitIp(''), 'unknown');
});
