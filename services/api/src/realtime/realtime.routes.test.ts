import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createRealtimeHandshakeRateLimit,
  getRealtimeAuthMode,
  isAllowedRealtimeOrigin,
  isRealtimeTokenInQuery,
  redactRealtimeLogFields
} from './realtime.routes.js';

test('realtime handshake accepts cookie sessions only from an allowed Origin', () => {
  assert.equal(isAllowedRealtimeOrigin('https://web.example.com', 'https://web.example.com'), true);
  assert.equal(isAllowedRealtimeOrigin('https://evil.example', 'https://web.example.com'), false);
  assert.equal(getRealtimeAuthMode({ headers: { cookie: 'yaskapp_session=session' } }), 'cookie');
});

test('realtime handshake accepts bearer auth and rejects token query parameters', () => {
  assert.equal(getRealtimeAuthMode({ headers: { authorization: 'Bearer access-token' } }), 'bearer');
  assert.equal(isRealtimeTokenInQuery('/realtime?token=access-token'), true);
  assert.equal(isRealtimeTokenInQuery('/realtime'), false);
});

test('realtime handshake has a dedicated rate limit policy', () => {
  assert.deepEqual(createRealtimeHandshakeRateLimit(), {
    keyPrefix: 'realtime-handshake',
    limit: 20,
    windowMs: 60_000,
    keyBy: 'ip'
  });
});

test('realtime log fields redact payloads, comment bodies, cookies and tokens', () => {
  const fields = redactRealtimeLogFields({
    recipientUserId: 'user-1',
    notification: { payload: { body: 'private comment' } },
    commentBody: 'private comment',
    cookie: 'yaskapp_session=secret',
    token: 'secret-token',
    authorization: 'Bearer secret-token',
    reason: 'idle_timeout'
  });

  assert.deepEqual(fields, {
    recipientUserId: 'user-1',
    reason: 'idle_timeout'
  });
});
