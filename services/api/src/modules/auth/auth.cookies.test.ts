import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTrustedOrigin, parseCookieHeader, serializeSessionCookie } from './auth.cookies.js';

test('parses the session cookie without exposing unrelated cookie values', () => {
  assert.deepEqual(parseCookieHeader('theme=dark; yaskapp_session=jwt.value; empty='), {
    theme: 'dark',
    yaskapp_session: 'jwt.value',
    empty: ''
  });
});

test('serializes a secure HttpOnly session cookie and a clearing cookie', () => {
  const cookie = serializeSessionCookie('jwt.value', false);
  assert.match(cookie, /^yaskapp_session=jwt.value;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Secure/);

  const secured = serializeSessionCookie('jwt.value', true);
  assert.match(secured, /Secure/);

  const cleared = serializeSessionCookie(null, true);
  assert.match(cleared, /^yaskapp_session=;/);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /Secure/);
});

test('clears an HTTP session cookie without a Secure attribute', () => {
  const cleared = serializeSessionCookie(null, false);
  assert.match(cleared, /Max-Age=0/);
  assert.doesNotMatch(cleared, /Secure/);
});

test('accepts configured web origins and rejects cross-site origins', () => {
  assert.equal(isTrustedOrigin('https://web-staging.example.com', 'https://web-staging.example.com'), true);
  assert.equal(isTrustedOrigin('https://evil.example', 'https://web-staging.example.com'), false);
  assert.equal(isTrustedOrigin(undefined, 'https://web-staging.example.com'), true);
});

test('trusts only the exact HTTP origin of the configured staging IP', () => {
  const configuredOrigins = 'https://web-staging.example.com';
  assert.equal(isTrustedOrigin('http://5.44.44.197', configuredOrigins, '5.44.44.197'), true);
  assert.equal(isTrustedOrigin('https://web-staging.example.com', configuredOrigins, '5.44.44.197'), true);
  for (const origin of ['http://5.44.44.198', 'http://5.44.44.197:8080', 'https://5.44.44.197', 'http://5.44.44.197.evil.example', 'null']) {
    assert.equal(isTrustedOrigin(origin, configuredOrigins, '5.44.44.197'), false, origin);
  }
  assert.equal(isTrustedOrigin('http://5.44.44.197', configuredOrigins), false);
  assert.equal(isTrustedOrigin('http://[::1]', configuredOrigins, '::1'), true);
});

test('staging IP trust preserves the restricted wildcard development origins', () => {
  assert.equal(isTrustedOrigin('http://5.44.44.197', '*', '5.44.44.197'), true);
  assert.equal(isTrustedOrigin('http://localhost:5173', '*', '5.44.44.197'), true);
  assert.equal(isTrustedOrigin('http://127.0.0.1:5173', '*', '5.44.44.197'), true);
  assert.equal(isTrustedOrigin('https://evil.example', '*', '5.44.44.197'), false);
});
