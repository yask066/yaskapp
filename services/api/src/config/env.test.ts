import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseEnv } from './env.js';

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://yaskapp:yaskapp@localhost:5432/yaskapp',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-very-strong-jwt-secret-key-at-least-32-bytes',
  PAGINATION_CURSOR_SECRET: 'a-separate-pagination-cursor-secret-32-bytes',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'yaskapp-media',
  S3_ACCESS_KEY_ID: 'yaskapp',
  S3_SECRET_ACCESS_KEY: 'yaskapp-secret'
};

test('S3_FORCE_PATH_STYLE parses explicit false string as boolean false', () => {
  assert.equal(parseEnv({ ...baseEnv, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE, false);
  assert.equal(parseEnv({ ...baseEnv, S3_FORCE_PATH_STYLE: 'true' }).S3_FORCE_PATH_STYLE, true);
  assert.equal(parseEnv(baseEnv).S3_FORCE_PATH_STYLE, true);
});

test('wildcard CORS_ORIGINS is rejected in production', () => {
  assert.throws(
    () => parseEnv({ ...baseEnv, NODE_ENV: 'production', CORS_ORIGINS: '*' }),
    /Wildcard CORS_ORIGINS is not allowed in production/
  );
  assert.equal(
    parseEnv({ ...baseEnv, NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' }).CORS_ORIGINS,
    'https://app.example.com'
  );
});

test('JWT_SECRET must be at least 32 UTF-8 bytes in production', () => {
  assert.throws(
    () => parseEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.example.com',
      JWT_SECRET: 'short-production-secret'
    }),
    /JWT_SECRET of at least 32 bytes is required/
  );
  assert.equal(
    parseEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.example.com',
      JWT_SECRET: 'a-very-strong-jwt-secret-key-at-least-32-bytes'
    }).JWT_SECRET,
    'a-very-strong-jwt-secret-key-at-least-32-bytes'
  );
});

test('COOKIE_SECURE parses explicit boolean strings and defaults to undefined', () => {
  assert.equal(parseEnv(baseEnv).COOKIE_SECURE, undefined);
  assert.equal(parseEnv({ ...baseEnv, COOKIE_SECURE: 'true' }).COOKIE_SECURE, true);
  assert.equal(parseEnv({ ...baseEnv, COOKIE_SECURE: 'false' }).COOKIE_SECURE, false);
});
