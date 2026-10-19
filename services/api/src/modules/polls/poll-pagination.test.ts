import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { env, parseEnv } from '../../config/env.js';
import {
  createPollCursorOwnerKey,
  decodePollCursor,
  encodePollCursor,
  PollPaginationCursorError,
  type PollCursorContext,
  type PollCursorPayload,
  type PollCursorTuple
} from './poll-pagination.js';

const pollId = '11111111-1111-4111-8111-111111111111';
const otherPollId = '22222222-2222-4222-8222-222222222222';
const rootId = '33333333-3333-4333-8333-333333333333';
const otherRootId = '44444444-4444-4444-8444-444444444444';
const boundaryId = '55555555-5555-4555-8555-555555555555';
const highWatermarkId = '66666666-6666-4666-8666-666666666666';
const boundary: PollCursorTuple = { createdAt: '2026-10-19T12:34:56.123456Z', id: boundaryId };
const highWatermark: PollCursorTuple = { createdAt: '2026-10-19T12:34:56.123457Z', id: highWatermarkId };
const accountOwner = createPollCursorOwnerKey({ type: 'user', userId: 'viewer-account-one' });

const replyCursor: PollCursorPayload = {
  kind: 'comment-replies',
  order: 'oldest',
  pollId,
  rootId,
  owner: accountOwner,
  boundary,
  highWatermark
};

const replyContext: PollCursorContext = {
  kind: 'comment-replies',
  order: 'oldest',
  pollId,
  rootId,
  owner: accountOwner
};

function signedRawCursor(payload: string): string {
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
  const unsignedCursor = `c1.${encodedPayload}`;
  const signature = createHmac('sha256', env.PAGINATION_CURSOR_SECRET)
    .update(unsignedCursor, 'ascii')
    .digest('base64url');
  return `${unsignedCursor}.${signature}`;
}
function assertInvalidCursor(action: () => unknown): void {
  assert.throws(action, (error: unknown) =>
    error instanceof PollPaginationCursorError &&
    error.code === 'pagination_cursor_invalid' &&
    error.statusCode === 400 &&
    error.message === 'The pagination cursor is invalid.'
  );
}

test('signed cursor round-trips PostgreSQL tuple timestamps without losing microseconds', () => {
  const cursor = encodePollCursor(replyCursor);

  assert.match(cursor, /^c1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePollCursor(cursor, replyContext), replyCursor);
});

test('signs the canonical c1 payload with HMAC-SHA-256', () => {
  const cursor = encodePollCursor(replyCursor);
  const [prefix, payload, signature] = cursor.split('.');
  const expectedSignature = createHmac('sha256', env.PAGINATION_CURSOR_SECRET)
    .update(`${prefix}.${payload}`, 'ascii')
    .digest('base64url');

  assert.equal(prefix, 'c1');
  assert.equal(signature, expectedSignature);
});
test('popular cursor round-trips a snapshot ID and position', () => {
  const popularCursor: PollCursorPayload = {
    kind: 'polls',
    sort: 'popular',
    owner: accountOwner,
    snapshotId: '77777777-7777-4777-8777-777777777777',
    position: 40
  };

  assert.deepEqual(
    decodePollCursor(encodePollCursor(popularCursor), {
      kind: 'polls', sort: 'popular', owner: accountOwner
    }),
    popularCursor
  );
});

test('cursor owner keys bind an account without exposing its ID in the token', () => {
  const cursor = encodePollCursor(replyCursor);

  assert.notEqual(accountOwner, 'viewer-account-one');
  assert.equal(cursor.includes('viewer-account-one'), false);
  assert.notEqual(
    accountOwner,
    createPollCursorOwnerKey({ type: 'user', userId: 'viewer-account-two' })
  );
});

test('rejects cursors scoped to another list, poll, root, or account', () => {
  const cursor = encodePollCursor(replyCursor);
  const otherAccount = createPollCursorOwnerKey({ type: 'user', userId: 'viewer-account-two' });
  const wrongContexts: PollCursorContext[] = [
    { kind: 'polls', sort: 'newest', owner: accountOwner },
    { ...replyContext, pollId: otherPollId },
    { ...replyContext, rootId: otherRootId },
    { ...replyContext, owner: otherAccount }
  ];

  for (const context of wrongContexts) {
    assertInvalidCursor(() => decodePollCursor(cursor, context));
  }
});

test('rejects a cursor used with another feed sort', () => {
  const feedCursor = encodePollCursor({
    kind: 'polls', sort: 'newest', owner: accountOwner,
    boundary, highWatermark
  });

  assertInvalidCursor(() => decodePollCursor(feedCursor, {
    kind: 'polls', sort: 'popular', owner: accountOwner
  }));
});

test('rejects a root cursor used with another order', () => {
  const rootCursor = encodePollCursor({
    kind: 'comment-roots', order: 'newest', pollId,
    boundary, highWatermark
  });

  assertInvalidCursor(() => decodePollCursor(rootCursor, {
    kind: 'comment-roots', order: 'oldest', pollId
  }));
});
test('rejects an unsupported cursor version', () => {
  const cursor = encodePollCursor(replyCursor);
  const [, payload, signature] = cursor.split('.');

  assertInvalidCursor(() => decodePollCursor(`c2.${payload}.${signature}`, replyContext));
});

test('rejects a changed signature', () => {
  const cursor = encodePollCursor(replyCursor);
  const parts = cursor.split('.');
  const signature = parts[2]!;
  parts[2] = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;

  assertInvalidCursor(() => decodePollCursor(parts.join('.'), replyContext));
});

test('rejects malformed and overlong cursor encodings', () => {
  assertInvalidCursor(() => decodePollCursor('c1.%!.AA', replyContext));
  assertInvalidCursor(() => decodePollCursor(`c1.${'A'.repeat(3000)}.AA`, replyContext));
});

test('rejects a malformed payload even when it has a valid signature', () => {
  assertInvalidCursor(() => decodePollCursor(signedRawCursor('{"v":2}'), replyContext));
});
test('rejects malformed signatures and damaged payloads', () => {
  const cursor = encodePollCursor(replyCursor);
  const [, payload, signature] = cursor.split('.');
  const changedPayload = `${payload[0] === 'A' ? 'B' : 'A'}${payload.slice(1)}`;

  assertInvalidCursor(() => decodePollCursor(`c1.${payload}.AA`, replyContext));
  assertInvalidCursor(() => decodePollCursor(`c1.${changedPayload}.${signature}`, replyContext));
});

test('rejects cursor payloads with an invalid UUID or timestamp', () => {
  assertInvalidCursor(() => encodePollCursor({
    ...replyCursor,
    boundary: { ...boundary, id: 'not-a-uuid' }
  } as PollCursorPayload));
  assertInvalidCursor(() => encodePollCursor({
    ...replyCursor,
    boundary: { ...boundary, createdAt: '2026-10-19T12:34:56.123Z' }
  } as PollCursorPayload));
});

test('keeps legacy unsigned replies cursors out of the signed cursor decoder', () => {
  const legacy = Buffer.from(JSON.stringify({
    createdAt: '2026-10-19T12:34:56.123456Z', id: boundaryId
  })).toString('base64url');

  assertInvalidCursor(() => decodePollCursor(legacy, replyContext));
});

test('requires a dedicated production cursor secret of at least 32 bytes', () => {
  const productionEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SECRET: 'jwt-secret-that-is-not-the-cursor-key',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: 'test-s3-secret'
  };

  assert.throws(() => parseEnv(productionEnv));
  assert.throws(() => parseEnv({
    ...productionEnv,
    PAGINATION_CURSOR_SECRET: 'short'
  }));
  assert.throws(() => parseEnv({
    ...productionEnv,
    PAGINATION_CURSOR_SECRET: productionEnv.JWT_SECRET
  }));
  assert.doesNotThrow(() => parseEnv({
    ...productionEnv,
    PAGINATION_CURSOR_SECRET: 'cursor-secret-with-at-least-32-random-looking-bytes'
  }));
});
