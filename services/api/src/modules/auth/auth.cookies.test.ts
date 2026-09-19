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

  const cleared = serializeSessionCookie(null, true);
  assert.match(cleared, /^yaskapp_session=;/);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /Secure/);
});

test('accepts configured web origins and rejects cross-site origins', () => {
  assert.equal(isTrustedOrigin('https://web-staging.example.com', 'https://web-staging.example.com'), true);
  assert.equal(isTrustedOrigin('https://evil.example', 'https://web-staging.example.com'), false);
  assert.equal(isTrustedOrigin(undefined, 'https://web-staging.example.com'), true);
});
