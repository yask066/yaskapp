#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  cleanupPollPaginationFixtures,
  expandPollPaginationFixtures,
  readPollPaginationFixtures,
  seedPollPaginationFixtures
} from '../services/api/src/modules/polls/poll-pagination.fixtures.ts';
import {
  createPollCursorOwnerKey,
  encodePollCursor
} from '../services/api/src/modules/polls/poll-pagination.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'docs', 'pagination-evidence');
const pageSize = 20;
const cursorSetupLimit = 50;
const deepOffset = 1_000;
const pollCount = 100_000;
const rootCount = 10_000;
const replyCount = 2_000;
const authorCount = 1_000;
const sparseFolloweeCount = 20;
const readerCount = 20;
const pollQuestionPrefix = 'Pagination load fixture';
const userEmailPrefix = 'pagination-load+';
const userNamePrefix = 'pl_a_';
const nowIso = () => new Date().toISOString();

function usage() {
  return [
    'Usage:',
    '  node --import tsx scripts/pagination-load.mjs seed <seed> --confirm',
    '  node --import tsx scripts/pagination-load.mjs load <seed>',
    '  node --import tsx scripts/pagination-load.mjs cleanup <seed> --confirm',
    '',
    'Required local environment: DATABASE_URL, PAGINATION_TEST_DB_NAME, PAGINATION_EXPECTED_DB_HOST,',
    'PAGINATION_TARGET_LABEL, PAGINATION_API_BASE_URL, PAGINATION_EXPECTED_API_HOST,',
    'PAGINATION_LOAD_TOKEN_FILE. The token file must contain 20 unique test-user JWTs.'
  ].join('\n');
}

function parseArguments(argv) {
  const [mode, seed, ...flags] = argv;
  if (mode === '--help' || mode === '-h') return { help: true };
  if (!['seed', 'load', 'cleanup'].includes(mode) || !seed || flags.some((flag) => flag !== '--confirm')) {
    throw new Error(usage());
  }
  if ((mode === 'seed' || mode === 'cleanup') && !flags.includes('--confirm')) {
    throw new Error(`${mode} requires --confirm.\n${usage()}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(seed)) {
    throw new Error('Seed must be 1–32 lowercase letters, digits, or hyphens.');
  }
  return { mode, seed };
}

function config() {
  const databaseUrl = process.env.DATABASE_URL;
  const expectedDatabase = process.env.PAGINATION_TEST_DB_NAME;
  const expectedDatabaseHost = process.env.PAGINATION_EXPECTED_DB_HOST;
  const targetLabel = process.env.PAGINATION_TARGET_LABEL;
  const apiBaseUrl = process.env.PAGINATION_API_BASE_URL;
  const expectedApiHost = process.env.PAGINATION_EXPECTED_API_HOST;
  const tokenFile = process.env.PAGINATION_LOAD_TOKEN_FILE;
  if (!databaseUrl || !expectedDatabase || !expectedDatabaseHost || !targetLabel || !apiBaseUrl || !expectedApiHost || !tokenFile) {
    throw new Error('Missing required local environment settings.\n' + usage());
  }

  const database = new URL(databaseUrl);
  const actualDatabase = decodeURIComponent(database.pathname.replace(/^\//, ''));
  if (!actualDatabase || actualDatabase !== expectedDatabase) {
    throw new Error('DATABASE_URL does not match PAGINATION_TEST_DB_NAME; refusing to touch the database.');
  }
  if (database.host.toLowerCase() !== expectedDatabaseHost.toLowerCase()) {
    throw new Error('DATABASE_URL does not match PAGINATION_EXPECTED_DB_HOST; refusing to touch the database.');
  }

  const api = new URL(apiBaseUrl);
  if (api.host.toLowerCase() !== expectedApiHost.toLowerCase()) {
    throw new Error('PAGINATION_API_BASE_URL does not match PAGINATION_EXPECTED_API_HOST.');
  }
  if (api.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(api.hostname)) {
    throw new Error('Remote API URLs must use HTTPS.');
  }

  return {
    databaseUrl,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    targetLabel,
    tokenFile: path.resolve(tokenFile),
    warmupBursts: positiveInteger(process.env.PAGINATION_LOAD_WARMUP_BURSTS, 1),
    sampleBursts: positiveInteger(process.env.PAGINATION_LOAD_SAMPLE_BURSTS, 5),
    maxDurationSeconds: positiveInteger(process.env.PAGINATION_LOAD_MAX_DURATION_SECONDS, 1_200)
  };
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('Load burst settings must be positive integers.');
  return parsed;
}

async function readReaders(file) {
  const source = await readFile(file, 'utf8');
  const tokens = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (tokens.length !== readerCount) throw new Error(`Token file must contain exactly ${readerCount} JWTs.`);
  const readers = tokens.map((token, index) => ({ token, id: jwtSubject(token), index }));
  if (new Set(readers.map(({ id }) => id)).size !== readerCount) {
    throw new Error('Each load reader must have a distinct user ID.');
  }
  return readers;
}

function jwtSubject(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('The reader token file contains a malformed JWT.');
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('The reader token file contains a malformed JWT payload.');
  }
  if (typeof claims.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)) {
    throw new Error('Each reader JWT must contain a UUID subject.');
  }
  return claims.sub.toLowerCase();
}

function fixture(seed) {
  return expandPollPaginationFixtures(readPollPaginationFixtures(), seed);
}

function namespacedUuid(seed, sourceId) {
  const bytes = createHash('sha256')
    .update(`feed-comments-pagination:v1\0${seed}\0${sourceId}`)
    .digest();
  const uuidBytes = Buffer.from(bytes.subarray(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = uuidBytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function generatedRows(seed, expanded) {
  const fixtureAuthors = expanded.accounts.filter(({ key }) => key === 'authorA' || key === 'authorB');
  const generatedAuthorCount = authorCount - fixtureAuthors.length;
  const extraAuthorIds = Array.from({ length: generatedAuthorCount }, (_, index) =>
    namespacedUuid(seed, `t26:author:${index + 1}`));
  const authors = [...fixtureAuthors.map(({ id }) => id), ...extraAuthorIds];
  const baselineActivePollCount = expanded.polls.length + 1;
  const extraPollCount = pollCount - baselineActivePollCount;
  const generatedPolls = Array.from({ length: extraPollCount }, (_, index) => {
    const number = index + 1;
    const createdAt = new Date(Date.UTC(2026, 0, 2) + (number - 1) * 1_000).toISOString();
    return {
      id: namespacedUuid(seed, `t26:poll:${number}`),
      author_id: authors[(number - 1) % authors.length],
      question: `${pollQuestionPrefix} ${seed} #${number}`,
      visibility: 'public',
      options_count: 2,
      comments_count: 0,
      created_at: createdAt,
      deleted_at: null
    };
  });
  const generatedOptions = generatedPolls.flatMap((poll, index) => [0, 1].map((position) => ({
    id: namespacedUuid(seed, `t26:option:${index + 1}:${position}`),
    poll_id: poll.id,
    text: `Option ${position + 1}`,
    position
  })));
  const authorRows = extraAuthorIds.map((id, index) => {
    const number = index + 1;
    const suffix = seedHash(seed);
    return {
      id,
      email: `${userEmailPrefix}${seed}-${number}@yaskapp.test`,
      username: `${userNamePrefix}${suffix}_${String(number).padStart(4, '0')}`,
      password_hash: 'pagination-load-fixture-not-for-login',
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      display_name: `Pagination author ${number}`
    };
  });
  const baseRoot = expanded.target.roots[0];
  if (!baseRoot) throw new Error('The T02 fixture does not contain the target root required for load testing.');
  const commentAuthorA = fixtureAuthors[0]?.id;
  const commentAuthorB = fixtureAuthors[1]?.id;
  if (!commentAuthorA || !commentAuthorB) throw new Error('T02 fixture author accounts are missing.');
  const extraRoots = Array.from({ length: rootCount - expanded.target.roots.length }, (_, index) => ({
    id: namespacedUuid(seed, `t26:root:${index + 1}`),
    poll_id: expanded.target.poll.id,
    author_id: index % 2 === 0 ? commentAuthorA : commentAuthorB,
    parent_comment_id: null,
    body: `Pagination load root ${seed} #${index + 1}`,
    created_at: new Date(Date.UTC(2026, 0, 2) + index * 1_000).toISOString(),
    deleted_at: null,
    replies_count: 0
  }));
  const extraReplies = Array.from({ length: replyCount - expanded.target.replies.length }, (_, index) => ({
    id: namespacedUuid(seed, `t26:reply:${index + 1}`),
    poll_id: expanded.target.poll.id,
    author_id: index % 2 === 0 ? commentAuthorA : commentAuthorB,
    parent_comment_id: baseRoot.id,
    body: `Pagination load reply ${seed} #${index + 1}`,
    created_at: new Date(Date.UTC(2026, 0, 2) + index * 1_000).toISOString(),
    deleted_at: null,
    replies_count: 0
  }));
  return {
    authors,
    extraAuthorIds,
    authorRows,
    generatedPolls,
    generatedOptions,
    generatedPollIds: generatedPolls.map(({ id }) => id),
    extraRoots,
    extraReplies,
    readerIds: expanded.ids.accounts,
    loadReaderIds: null,
    targetPollId: expanded.target.poll.id,
    targetRootId: baseRoot.id
  };
}

function seedHash(seed) {
  return createHash('sha256').update(seed).digest('hex').slice(0, 10);
}

async function insertJson(client, sql, rows, batchSize = 4_000) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await client.query(sql, [JSON.stringify(rows.slice(offset, offset + batchSize))]);
  }
}

async function ensureTokenUsers(client, readers) {
  const result = await client.query(
    `SELECT u.id::text AS id
     FROM users u JOIN profiles pr ON pr.user_id = u.id
     WHERE u.id = ANY($1::uuid[]) AND u.status = 'active' AND u.deleted_at IS NULL`,
    [readers.map(({ id }) => id)]
  );
  if (result.rowCount !== readerCount) {
    throw new Error('All 20 reader JWTs must identify active users with profiles in the selected test database.');
  }
}

async function makeFixtureDirectory(seed, mustNotExist = false) {
  const directory = path.join(outputRoot, `t26-${seed}`);
  if (mustNotExist) {
    try {
      await readFile(path.join(directory, 'fixture-manifest.json'), 'utf8');
      throw new Error(`Evidence already exists for seed ${seed}; use a new seed.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Evidence already exists')) throw error;
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await mkdir(directory, { recursive: true });
  return directory;
}

async function readManifest(directory, seed) {
  const manifestPath = path.join(directory, 'fixture-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.seed !== seed) throw new Error('Evidence manifest seed does not match the requested seed.');
  return { manifest, manifestPath };
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function seedDataset(pool, seed, readers, settings) {
  const expanded = fixture(seed);
  const rows = generatedRows(seed, expanded);
  rows.loadReaderIds = readers.map(({ id }) => id);
  const directory = await makeFixtureDirectory(seed, true);
  const manifestPath = path.join(directory, 'fixture-manifest.json');
  const manifest = {
    task: 'T26',
    seed,
    status: 'seeding',
    createdAt: nowIso(),
    expected: { publicPolls: pollCount, roots: rootCount, replies: replyCount },
    generatedPollCount: rows.generatedPolls.length,
    generatedAuthorCount: rows.extraAuthorIds.length,
    readerCount,
    readerFingerprints: readers.map(({ id }) => readerFingerprint(id)).sort(),
    sparseFolloweeCount,
    targetLabel: settings.targetLabel,
    runStartedAt: null,
    snapshotIds: [],
    cleanup: null
  };
  await writeJson(manifestPath, manifest);
  let baseFixturesSeeded = false;
  try {
    const existingPolls = await pool.query('SELECT count(*)::integer AS count FROM polls');
    if (Number(existingPolls.rows[0].count) !== 0) {
      throw new Error('The selected test database must have no polls before T26 seed mode.');
    }
    const seeded = await seedPollPaginationFixtures(pool, seed);
    baseFixturesSeeded = true;
    const extraClient = await pool.connect();
    try {
      await extraClient.query('BEGIN');
      await insertJson(extraClient,
        `INSERT INTO users (id, email, username, password_hash, status, created_at)
         SELECT r.id, r.email, r.username, r.password_hash, r.status::user_status, r.created_at::timestamptz
         FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, email text, username text, password_hash text, status text, created_at text)`,
        rows.authorRows);
      await insertJson(extraClient,
        `INSERT INTO profiles (user_id, display_name)
         SELECT r.id, r.display_name
         FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, display_name text)`,
        rows.authorRows.map(({ id, display_name }) => ({ id, display_name })));
      await insertJson(extraClient,
        `INSERT INTO polls (id, author_id, question, visibility, options_count, comments_count, created_at, deleted_at)
         SELECT r.id, r.author_id, r.question, r.visibility::poll_visibility,
                r.options_count, r.comments_count, r.created_at::timestamptz, r.deleted_at::timestamptz
         FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, author_id uuid, question text, visibility text,
                                                options_count integer, comments_count integer, created_at text, deleted_at text)`,
        rows.generatedPolls);
      await insertJson(extraClient,
        `INSERT INTO poll_options (id, poll_id, text, position)
         SELECT r.id, r.poll_id, r.text, r.position::smallint
         FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, poll_id uuid, text text, position integer)`,
        rows.generatedOptions);
      await insertJson(extraClient,
        `INSERT INTO comments (id, poll_id, author_id, parent_comment_id, body, created_at, deleted_at, replies_count)
         SELECT r.id, r.poll_id, r.author_id, r.parent_comment_id, r.body,
                r.created_at::timestamptz, r.deleted_at::timestamptz, r.replies_count
         FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, poll_id uuid, author_id uuid, parent_comment_id uuid,
                                                body text, created_at text, deleted_at text, replies_count integer)`,
        [...rows.extraRoots, ...rows.extraReplies]);
      await extraClient.query('UPDATE comments SET replies_count = $2 WHERE id = $1', [rows.targetRootId, replyCount]);
      await extraClient.query('UPDATE polls SET comments_count = $2 WHERE id = $1', [rows.targetPollId, rootCount + replyCount]);
      await insertSparseFollows(extraClient, readers, rows.authors.slice(0, sparseFolloweeCount));
      await extraClient.query(
        `UPDATE profiles pr SET polls_count = (
           SELECT count(*)::integer FROM polls p WHERE p.author_id = pr.user_id AND p.deleted_at IS NULL
         ) WHERE pr.user_id = ANY($1::uuid[])`,
        [rows.authors]
      );
      await extraClient.query('COMMIT');
    } catch (error) {
      await extraClient.query('ROLLBACK');
      throw error;
    } finally {
      extraClient.release();
    }

    const observed = await inspectFixture(pool, expanded, rows);
    if (observed.publicPolls !== pollCount || observed.globalPublicPolls !== pollCount ||
        observed.roots !== rootCount || observed.replies !== replyCount ||
        observed.sparseFollowRows !== readerCount * sparseFolloweeCount) {
      throw new Error(`Seed counts do not match: ${JSON.stringify(observed)}.`);
    }
    manifest.status = 'seeded';
    manifest.seededAt = nowIso();
    manifest.counts = observed;
    manifest.fixturePollIds = seeded.ids.polls;
    manifest.targetPollIds = seeded.ids.targetPolls;
    await writeJson(manifestPath, manifest);
    return { directory, manifest, expanded, rows };
  } catch (error) {
    if (baseFixturesSeeded) {
      await cleanupDataset(pool, seed, readers, settings).catch(() => {});
    }
    await writeJson(manifestPath, { ...manifest, status: 'seed-failed', failedAt: nowIso() });
    throw error;
  }
}

async function insertSparseFollows(client, readers, followeeIds) {
  const rows = readers.flatMap(({ id: followerId }) => followeeIds.map((followeeId) => ({ follower_id: followerId, followee_id: followeeId })));
  await insertJson(client,
    `INSERT INTO follows (follower_id, followee_id)
     SELECT r.follower_id, r.followee_id
     FROM jsonb_to_recordset($1::jsonb) AS r(follower_id uuid, followee_id uuid)
     ON CONFLICT (follower_id, followee_id) DO NOTHING`,
    rows);
}

async function inspectFixture(pool, expanded, rows) {
  const extraPublicPolls = await pool.query(
    `SELECT count(*)::integer AS count FROM polls
     WHERE id = ANY($1::uuid[]) AND visibility = 'public' AND deleted_at IS NULL`,
    [rows.generatedPollIds]
  );
  const basePublicPolls = await pool.query(
    `SELECT count(*)::integer AS count FROM polls
     WHERE id = ANY($1::uuid[]) AND visibility = 'public' AND deleted_at IS NULL`,
    [[...expanded.ids.polls, ...expanded.ids.targetPolls]]
  );
  const rootsAndReplies = await pool.query(
    `SELECT count(*) FILTER (WHERE parent_comment_id IS NULL)::integer AS roots,
            count(*) FILTER (WHERE parent_comment_id = $2)::integer AS replies
     FROM comments WHERE poll_id = $1 AND deleted_at IS NULL`,
    [rows.targetPollId, rows.targetRootId]
  );
  const globalPublicPolls = await pool.query(
    `SELECT count(*)::integer AS count
     FROM polls p JOIN users u ON u.id = p.author_id
     WHERE p.visibility = 'public' AND p.deleted_at IS NULL
       AND u.status = 'active' AND u.deleted_at IS NULL`);
  const sparseFollowRows = await pool.query(
    `SELECT count(*)::integer AS count FROM follows
     WHERE follower_id = ANY($1::uuid[]) AND followee_id = ANY($2::uuid[])`,
    [rows.loadReaderIds, rows.authors.slice(0, sparseFolloweeCount)]
  );
  return {
    publicPolls: Number(extraPublicPolls.rows[0].count) + Number(basePublicPolls.rows[0].count),
    globalPublicPolls: Number(globalPublicPolls.rows[0].count),
    roots: Number(rootsAndReplies.rows[0].roots),
    replies: Number(rootsAndReplies.rows[0].replies),
    sparseFollowRows: Number(sparseFollowRows.rows[0].count)
  };
}

async function cleanupDataset(pool, seed, readers, settings) {
  const directory = path.join(outputRoot, `t26-${seed}`);
  const { manifest, manifestPath } = await readManifest(directory, seed);
  const expanded = fixture(seed);
  const rows = generatedRows(seed, expanded);
  await ensureTokenUsers(pool, readers);
  assertReaderSet(manifest, readers);
  const readerIds = readers.map(({ id }) => id);
  const authorIds = rows.authors;
  const ownerKeys = readerIds.map(userOwnerKey);
  const client = await pool.connect();
  let removedSnapshots = 0;
  let removedFollowRows = 0;
  try {
    await client.query('BEGIN');
    if (manifest.runStartedAt) {
      const snapshotDelete = await client.query(
        `DELETE FROM poll_feed_snapshots
         WHERE owner_key = ANY($1::text[]) AND created_at >= $2::timestamptz`,
        [ownerKeys, manifest.runStartedAt]
      );
      removedSnapshots = snapshotDelete.rowCount ?? 0;
    }
    const followDelete = await client.query(
      'DELETE FROM follows WHERE follower_id = ANY($1::uuid[]) AND followee_id = ANY($2::uuid[])',
      [readerIds, authorIds]
    );
    removedFollowRows = followDelete.rowCount ?? 0;
    await client.query(
      `DELETE FROM polls WHERE id = ANY($1::uuid[]) AND question LIKE $2`,
      [rows.generatedPollIds, `${pollQuestionPrefix} ${seed} #%`]
    );
    const authorDelete = await client.query(
      'DELETE FROM users WHERE id = ANY($1::uuid[]) AND username LIKE $2',
      [rows.extraAuthorIds, `${userNamePrefix}${seedHash(seed)}_%`]
    );
    await client.query('COMMIT');
    await cleanupPollPaginationFixtures(pool, {
      seed,
      ids: expanded.ids,
      expectedIds: expanded.expectedIds,
      expectedIdWindows: expanded.expectedIdWindows
    });
    const remnants = await countRemnants(pool, rows, readers, ownerKeys, manifest.runStartedAt, expanded);
    if (remnants.polls !== 0 || remnants.authors !== 0 || remnants.followRows !== 0 ||
        remnants.snapshots !== 0 || remnants.basePolls !== 0 || remnants.baseAccounts !== 0 ||
        remnants.targetComments !== 0) {
      throw new Error(`Cleanup verification failed: ${JSON.stringify(remnants)}.`);
    }
    manifest.status = 'cleaned';
    manifest.cleanup = {
      completedAt: nowIso(),
      removedSnapshotCount: removedSnapshots,
      removedFollowCount: removedFollowRows,
      removedAuthorCount: authorDelete.rowCount ?? 0,
      generatedPollCount: rows.generatedPollIds.length,
      verifiedRemnants: remnants,
      targetLabel: settings.targetLabel
    };
    await writeJson(manifestPath, manifest);
    return manifest.cleanup;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function countRemnants(pool, rows, readers, ownerKeys, runStartedAt, expanded) {
  const generated = await pool.query(
    'SELECT count(*)::integer AS count FROM polls WHERE id = ANY($1::uuid[])',
    [rows.generatedPollIds]
  );
  const authors = await pool.query(
    'SELECT count(*)::integer AS count FROM users WHERE id = ANY($1::uuid[])',
    [rows.extraAuthorIds]
  );
  const follows = await pool.query(
    'SELECT count(*)::integer AS count FROM follows WHERE follower_id = ANY($1::uuid[]) AND followee_id = ANY($2::uuid[])',
    [readers.map(({ id }) => id), rows.authors]
  );
  const snapshots = runStartedAt
    ? await pool.query(
      'SELECT count(*)::integer AS count FROM poll_feed_snapshots WHERE owner_key = ANY($1::text[]) AND created_at >= $2::timestamptz',
      [ownerKeys, runStartedAt])
    : { rows: [{ count: 0 }] };
  const basePolls = await pool.query(
    'SELECT count(*)::integer AS count FROM polls WHERE id = ANY($1::uuid[])', [expanded.ids.allPolls]);
  const baseAccounts = await pool.query(
    'SELECT count(*)::integer AS count FROM users WHERE id = ANY($1::uuid[])', [expanded.ids.accounts]);
  const targetComments = await pool.query(
    'SELECT count(*)::integer AS count FROM comments WHERE poll_id = $1', [rows.targetPollId]);
  return {
    polls: Number(generated.rows[0].count),
    authors: Number(authors.rows[0].count),
    followRows: Number(follows.rows[0].count),
    snapshots: Number(snapshots.rows[0].count),
    basePolls: Number(basePolls.rows[0].count),
    baseAccounts: Number(baseAccounts.rows[0].count),
    targetComments: Number(targetComments.rows[0].count)
  };
}

function userOwnerKey(userId) {
  return createPollCursorOwnerKey({ type: 'user', userId });
}

function readerFingerprint(userId) {
  return createHash('sha256').update(`t26-reader:${userId}`).digest('hex');
}

function assertReaderSet(manifest, readers) {
  const actual = readers.map(({ id }) => readerFingerprint(id)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(manifest.readerFingerprints)) {
    throw new Error('The reader token file must contain the same 20 test users used during seed mode.');
  }
}

function decodeSnapshotId(cursor) {
  if (!cursor || !cursor.startsWith('c1.')) return null;
  try {
    const payload = JSON.parse(Buffer.from(cursor.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.snapshotId === 'string' ? payload.snapshotId : null;
  } catch {
    return null;
  }
}

async function fetchPage(settings, reader, pathAndQuery, signal) {
  const startedAt = performance.now();
  let response;
  let body;
  try {
    response = await fetch(`${settings.apiBaseUrl}${pathAndQuery}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${reader.token}`, accept: 'application/json' },
      signal
    });
    body = await response.json();
  } catch (error) {
    return {
      durationMs: performance.now() - startedAt,
      status: null,
      itemCount: 0,
      nextCursorPresent: false,
      errorCode: error?.name === 'TimeoutError' ? 'timeout' : 'network_error',
      nextCursor: null
    };
  }
  return {
    durationMs: performance.now() - startedAt,
    status: response.status,
    itemCount: Array.isArray(body?.items) ? body.items.length : 0,
    nextCursorPresent: typeof body?.nextCursor === 'string',
    errorCode: response.ok ? null : (typeof body?.error === 'string' ? body.error : `http_${response.status}`),
    nextCursor: typeof body?.nextCursor === 'string' ? body.nextCursor : null
  };
}

function requestSignal(deadlineAt) {
  const remainingMs = Math.max(1, Math.min(30_000, deadlineAt - performance.now()));
  return AbortSignal.timeout(remainingMs);
}

function endpointPath(type, ids, cursor, limit) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  switch (type) {
    case 'feed-newest': return `/polls?sort=newest&${params}`;
    case 'feed-popular': return `/polls?sort=popular&${params}`;
    case 'subscriptions': return `/polls/subscriptions?sort=newest&${params}`;
    case 'roots': return `/polls/${ids.targetPollId}/comments?order=newest&${params}`;
    case 'replies': return `/polls/${ids.targetPollId}/comments/${ids.targetRootId}/replies?${params}`;
    default: throw new Error(`Unknown pagination endpoint: ${type}`);
  }
}

async function deepCursorsForReaders(pool, readers, type, ids) {
  return Promise.all(readers.map((reader) => deepCursor(pool, reader, type, ids)));
}

async function deepCursor(pool, reader, type, ids) {
  const owner = createPollCursorOwnerKey({ type: 'user', userId: reader.id });
  let source;
  let createdAtColumn;
  let idColumn;
  let boundaryParams = [];
  let payloadContext;
  let order;
  switch (type) {
    case 'feed-newest':
      source = `FROM polls p JOIN users u ON u.id = p.author_id
        WHERE p.visibility = 'public' AND p.deleted_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL`;
      createdAtColumn = 'p.created_at';
      idColumn = 'p.id';
      payloadContext = { kind: 'polls', sort: 'newest', owner };
      order = `${createdAtColumn} DESC, ${idColumn} DESC`;
      break;
    case 'subscriptions':
      source = `FROM polls p JOIN follows f ON f.followee_id = p.author_id
        JOIN users u ON u.id = p.author_id
        WHERE f.follower_id = $1 AND p.visibility = 'public' AND p.deleted_at IS NULL
          AND u.status = 'active' AND u.deleted_at IS NULL`;
      createdAtColumn = 'p.created_at';
      idColumn = 'p.id';
      boundaryParams = [reader.id];
      payloadContext = { kind: 'subscriptions', sort: 'newest', owner };
      order = `${createdAtColumn} DESC, ${idColumn} DESC`;
      break;
    case 'roots':
      source = `FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.poll_id = $1 AND c.parent_comment_id IS NULL AND c.deleted_at IS NULL
          AND u.status = 'active' AND u.deleted_at IS NULL`;
      createdAtColumn = 'c.created_at';
      idColumn = 'c.id';
      boundaryParams = [ids.targetPollId];
      payloadContext = { kind: 'comment-roots', order: 'newest', pollId: ids.targetPollId, owner };
      order = `${createdAtColumn} DESC, ${idColumn} DESC`;
      break;
    case 'replies':
      source = `FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.poll_id = $1 AND c.parent_comment_id = $2 AND c.deleted_at IS NULL
          AND u.status = 'active' AND u.deleted_at IS NULL`;
      createdAtColumn = 'c.created_at';
      idColumn = 'c.id';
      boundaryParams = [ids.targetPollId, ids.targetRootId];
      payloadContext = { kind: 'comment-replies', order: 'oldest', pollId: ids.targetPollId, rootId: ids.targetRootId, owner };
      order = `${createdAtColumn} ASC, ${idColumn} ASC`;
      break;
    default:
      throw new Error(`No chronological cursor setup is defined for ${type}.`);
  }
  const boundary = await pool.query(
    `SELECT to_char(${createdAtColumn} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
            ${idColumn}::text AS id ${source} ORDER BY ${order} OFFSET $${boundaryParams.length + 1} LIMIT 1`,
    [...boundaryParams, deepOffset - 1]
  );
  const highWatermark = await pool.query(
    `SELECT to_char(${createdAtColumn} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
            ${idColumn}::text AS id ${source} ORDER BY ${createdAtColumn} DESC, ${idColumn} DESC LIMIT 1`,
    boundaryParams
  );
  const boundaryTuple = boundary.rows[0];
  const highTuple = highWatermark.rows[0];
  if (!boundaryTuple || !highTuple) throw new Error(`${type} has no row at the 1,000-item deep offset.`);
  return encodePollCursor({
    ...payloadContext,
    boundary: { createdAt: boundaryTuple.cursor_created_at, id: boundaryTuple.id },
    highWatermark: { createdAt: highTuple.cursor_created_at, id: highTuple.id }
  });
}

function popularDeepCursor(reader, snapshotId) {
  const owner = createPollCursorOwnerKey({ type: 'user', userId: reader.id });
  return encodePollCursor({
    kind: 'polls',
    sort: 'popular',
    owner,
    snapshotId,
    position: deepOffset - 1
  });
}

async function preparePopularDeepCursors(pool, settings, readers, ids, manifest, manifestPath, snapshots, deadlineAt) {
  assertWithinDeadline(deadlineAt);
  const setupPages = await Promise.all(readers.map((reader) =>
    fetchPage(settings, reader, endpointPath('feed-popular', ids, null, cursorSetupLimit), requestSignal(deadlineAt))));
  const snapshotIds = setupPages.map((result) => {
    if (result.status !== 200 || !result.nextCursor) {
      throw new Error(`Popular snapshot plan setup failed with ${result.errorCode}.`);
    }
    const snapshotId = decodeSnapshotId(result.nextCursor);
    if (!snapshotId) throw new Error('A popular cursor did not contain a snapshot ID.');
    return snapshotId;
  });
  const counts = await pool.query(
    `SELECT snapshot_id::text AS snapshot_id, count(*)::integer AS count
     FROM poll_feed_snapshot_items WHERE snapshot_id = ANY($1::uuid[]) GROUP BY snapshot_id`,
    [snapshotIds]
  );
  const countsBySnapshot = new Map(counts.rows.map(({ snapshot_id, count }) => [snapshot_id, Number(count)]));
  for (const snapshotId of snapshotIds) {
    const count = countsBySnapshot.get(snapshotId) ?? 0;
    if (count !== pollCount) throw new Error(`Popular snapshot stored ${count} IDs; expected ${pollCount}.`);
    snapshots.add(snapshotId);
  }
  manifest.snapshotIds = [...new Set([...manifest.snapshotIds, ...snapshotIds])];
  await writeJson(manifestPath, manifest);
  return readers.map((reader, index) => popularDeepCursor(reader, snapshotIds[index]));
}

async function captureScenario(settings, directory, readers, endpointType, scenario, page, ids, cursors, manifest, manifestPath, deadlineAt) {
  const records = [];
  const pathFor = (index) => endpointPath(endpointType, ids, cursors?.[index] ?? null, pageSize);
  const runBurst = async (round, warmup) => {
    assertWithinDeadline(deadlineAt);
    const burst = await Promise.all(readers.map(async (reader, readerIndex) => {
      const result = await fetchPage(settings, reader, pathFor(readerIndex), requestSignal(deadlineAt));
      const responseValid = result.status === 200 && result.itemCount === pageSize && result.nextCursorPresent;
      if (endpointType === 'feed-popular' && result.nextCursor) {
        const snapshotId = decodeSnapshotId(result.nextCursor);
        if (snapshotId) manifest.snapshotIds = [...new Set([...manifest.snapshotIds, snapshotId])];
      }
      return {
        scenario,
        page,
        reader: readerIndex + 1,
        round,
        warmup,
        durationMs: Number(result.durationMs.toFixed(3)),
        status: result.status,
        itemCount: result.itemCount,
        nextCursorPresent: result.nextCursorPresent,
        responseValid,
        errorCode: result.errorCode ?? (responseValid ? null : 'unexpected_page_shape')
      };
    }));
    if (!warmup) records.push(...burst);
    await writeJson(manifestPath, manifest);
  };
  for (let round = 1; round <= settings.warmupBursts; round += 1) await runBurst(round, true);
  for (let round = 1; round <= settings.sampleBursts; round += 1) await runBurst(round, false);
  return records;
}

function percentile95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function assertWithinDeadline(deadlineAt) {
  if (performance.now() >= deadlineAt) {
    throw new Error('T26 load run exceeded PAGINATION_LOAD_MAX_DURATION_SECONDS.');
  }
}

function summarize(records) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.scenario}/${record.page}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const scenarios = {};
  for (const [key, group] of groups) {
    const values = group.filter(({ status, responseValid }) => status === 200 && responseValid).map(({ durationMs }) => durationMs);
    scenarios[key] = {
      requests: group.length,
      failures: group.length - values.length,
      p95Ms: percentile95(values),
      averageMs: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      maxMs: values.length ? Math.max(...values) : null
    };
  }
  const growthKeys = [
    ['feed-newest/first', 'feed-newest/deep'],
    ['subscriptions-sparse/first', 'subscriptions-sparse/deep'],
    ['subscriptions-dense/first', 'subscriptions-dense/deep'],
    ['roots/first', 'roots/deep'],
    ['replies/first', 'replies/deep'],
    ['feed-popular/first', 'feed-popular/deep']
  ];
  const growth = growthKeys.map(([first, deep]) => ({
    first,
    deep,
    ratio: scenarios[first]?.averageMs && scenarios[deep]?.averageMs
      ? scenarios[deep].averageMs / scenarios[first].averageMs
      : null
  })).filter(({ ratio }) => ratio !== null);
  const averageDeepGrowth = growth.length
    ? growth.reduce((sum, item) => sum + item.ratio, 0) / growth.length
    : null;
  const latencyPass = Object.entries(scenarios).every(([key, value]) => {
    if (value.failures || value.p95Ms === null) return false;
    return value.p95Ms <= (key === 'feed-popular/first' ? 1_500 : 500);
  });
  const growthPass = averageDeepGrowth !== null && averageDeepGrowth <= 2;
  return {
    scenarios,
    averageDeepGrowth,
    growth,
    budgetsMs: { chronologicalAndAppend: 500, popularFirst: 1_500, averageDeepGrowthRatio: 2 },
    pass: latencyPass && growthPass,
    latencyPass,
    growthPass
  };
}

async function capturePlans(pool, readers, ids, label) {
  const client = await pool.connect();
  const plans = [`# Query plans (${label})`, `# Captured at ${nowIso()}`, '# EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING OFF)'];
  const explain = async (name, sql, params) => {
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING OFF) ${sql}`, params);
    plans.push(`\n## ${name}`, ...result.rows.map((row) => row['QUERY PLAN']));
  };
  try {
    const feedBoundaries = await client.query(
      `SELECT p.created_at, p.id FROM polls p JOIN users u ON u.id = p.author_id
       WHERE p.visibility = 'public' AND p.deleted_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL
       ORDER BY p.created_at DESC, p.id DESC OFFSET 999 LIMIT 1`);
    const feedHigh = await client.query(
      `SELECT p.created_at, p.id FROM polls p JOIN users u ON u.id = p.author_id
       WHERE p.visibility = 'public' AND p.deleted_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL
       ORDER BY p.created_at DESC, p.id DESC LIMIT 1`);
    const boundary = feedBoundaries.rows[0];
    const high = feedHigh.rows[0];
    const feedSql = `WITH available_polls AS (
      SELECT p.id, p.created_at FROM polls p JOIN users u ON u.id = p.author_id
      WHERE p.visibility = 'public' AND p.deleted_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL
    ), page_candidates AS (
      SELECT id, created_at, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
      FROM available_polls
      WHERE ($1::timestamptz IS NULL OR (created_at, id) < ($1::timestamptz, $2::uuid))
        AND ($3::timestamptz IS NULL OR (created_at, id) <= ($3::timestamptz, $4::uuid))
      ORDER BY created_at DESC, id DESC LIMIT 21
    ) SELECT id, cursor_created_at FROM page_candidates ORDER BY created_at DESC, id DESC`;
    await explain('feed-newest-deep-page', feedSql, [boundary?.created_at ?? null, boundary?.id ?? null, high?.created_at ?? null, high?.id ?? null]);

    const readerId = readers[0].id;
    const subscriptionBoundaryResult = await client.query(
      `SELECT p.created_at, p.id FROM polls p JOIN follows f ON f.followee_id = p.author_id
       JOIN users u ON u.id = p.author_id
       WHERE f.follower_id = $1 AND p.visibility = 'public' AND p.deleted_at IS NULL
         AND u.status = 'active' AND u.deleted_at IS NULL
       ORDER BY p.created_at DESC, p.id DESC OFFSET 999 LIMIT 1`, [readerId]);
    const subscriptionHighResult = await client.query(
      `SELECT p.created_at, p.id FROM polls p JOIN follows f ON f.followee_id = p.author_id
       JOIN users u ON u.id = p.author_id
       WHERE f.follower_id = $1 AND p.visibility = 'public' AND p.deleted_at IS NULL
         AND u.status = 'active' AND u.deleted_at IS NULL
       ORDER BY p.created_at DESC, p.id DESC LIMIT 1`, [readerId]);
    const subscriptionBoundary = subscriptionBoundaryResult.rows[0];
    const subscriptionHigh = subscriptionHighResult.rows[0];
    const subscriptionSql = `WITH available_polls AS (
      SELECT p.id, p.created_at FROM polls p JOIN follows f ON f.followee_id = p.author_id
      JOIN users u ON u.id = p.author_id
      WHERE f.follower_id = $1 AND p.visibility = 'public' AND p.deleted_at IS NULL
        AND u.status = 'active' AND u.deleted_at IS NULL
    ), page_candidates AS (
      SELECT id, created_at, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
      FROM available_polls
      WHERE ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
        AND ($4::timestamptz IS NULL OR (created_at, id) <= ($4::timestamptz, $5::uuid))
      ORDER BY created_at DESC, id DESC LIMIT 21
    ) SELECT id, cursor_created_at FROM page_candidates ORDER BY created_at DESC, id DESC`;
    await explain('subscriptions-current-graph-deep-page', subscriptionSql, [readerId, subscriptionBoundary?.created_at ?? null, subscriptionBoundary?.id ?? null, subscriptionHigh?.created_at ?? null, subscriptionHigh?.id ?? null]);

    const rootBoundaryResult = await client.query(
      'SELECT created_at, id FROM comments WHERE poll_id = $1 AND parent_comment_id IS NULL AND deleted_at IS NULL ORDER BY created_at DESC, id DESC OFFSET 999 LIMIT 1',
      [ids.targetPollId]);
    const rootBoundary = rootBoundaryResult.rows[0];
    const rootSql = `WITH available_comments AS NOT MATERIALIZED (
      SELECT c.id, c.created_at FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.poll_id = $1 AND c.parent_comment_id IS NULL AND c.deleted_at IS NULL
        AND u.status = 'active' AND u.deleted_at IS NULL
    ), high_watermark AS (
      SELECT id, created_at AS raw_created_at,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
      FROM available_comments ORDER BY raw_created_at DESC, id DESC LIMIT 1
    ), page_candidates AS MATERIALIZED (
      SELECT a.id, a.created_at FROM available_comments a CROSS JOIN high_watermark h
      WHERE (a.created_at, a.id) < ($2::timestamptz, $3::uuid)
        AND (a.created_at, a.id) <= (h.raw_created_at, h.id)
      ORDER BY a.created_at DESC, a.id DESC LIMIT 21
    ) SELECT c.id,
      (SELECT count(*)::int FROM comments r JOIN users u ON u.id = r.author_id
       WHERE r.parent_comment_id = c.id AND r.deleted_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL) AS replies_count
      FROM page_candidates pc JOIN comments c ON c.id = pc.id`;
    await explain('comment-roots-deep-page', rootSql, [ids.targetPollId, rootBoundary?.created_at ?? null, rootBoundary?.id ?? null]);

    const replyBoundaryResult = await client.query(
      'SELECT created_at, id FROM comments WHERE poll_id = $1 AND parent_comment_id = $2 AND deleted_at IS NULL ORDER BY created_at ASC, id ASC OFFSET 999 LIMIT 1',
      [ids.targetPollId, ids.targetRootId]);
    const replyBoundary = replyBoundaryResult.rows[0];
    const repliesSql = `WITH available_replies AS NOT MATERIALIZED (
      SELECT c.id, c.created_at FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.poll_id = $1 AND c.parent_comment_id = $2 AND c.deleted_at IS NULL
        AND u.status = 'active' AND u.deleted_at IS NULL
    ), high_watermark AS (
      SELECT id, created_at AS raw_created_at FROM available_replies
      ORDER BY raw_created_at DESC, id DESC LIMIT 1
    ), page_candidates AS MATERIALIZED (
      SELECT a.id, a.created_at FROM available_replies a CROSS JOIN high_watermark h
      WHERE (a.created_at, a.id) > ($3::timestamptz, $4::uuid)
        AND (a.created_at, a.id) <= (h.raw_created_at, h.id)
      ORDER BY a.created_at ASC, a.id ASC LIMIT 21
    ) SELECT c.id FROM page_candidates pc JOIN comments c ON c.id = pc.id ORDER BY pc.created_at ASC, pc.id ASC`;
    await explain('comment-replies-deep-page', repliesSql, [ids.targetPollId, ids.targetRootId, replyBoundary?.created_at ?? null, replyBoundary?.id ?? null]);

    const snapshotSql = `SELECT p.id FROM polls p JOIN users u ON u.id = p.author_id
      WHERE p.visibility = 'public' AND p.deleted_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL
      ORDER BY (p.votes_count * 2 + p.likes_count * 1.5 + p.comments_count) DESC, p.created_at DESC, p.id DESC`;
    await explain('popular-snapshot-ordering', snapshotSql, []);
    const ownerKey = userOwnerKey(readers[0].id);
    const snapshotResult = await client.query(
      'SELECT id FROM poll_feed_snapshots WHERE owner_key = $1 ORDER BY created_at DESC LIMIT 1', [ownerKey]);
    const snapshotId = snapshotResult.rows[0]?.id;
    if (snapshotId) {
      const appendSql = `SELECT snapshot_item.position::text AS position, snapshot_item.poll_id::text AS poll_id
        FROM poll_feed_snapshots snapshot
        LEFT JOIN LATERAL (
          SELECT position, poll_id FROM poll_feed_snapshot_items snapshot_item
          WHERE snapshot_item.snapshot_id = snapshot.id AND snapshot_item.position > $3
          ORDER BY snapshot_item.position ASC LIMIT $4::integer + 1
        ) snapshot_item ON TRUE
        WHERE snapshot.id = $1 AND snapshot.owner_key = $2 AND snapshot.expires_at > clock_timestamp()
        ORDER BY snapshot_item.position ASC`;
      await explain('popular-snapshot-deep-page', appendSql, [snapshotId, ownerKey, 999, pageSize]);
    }
    return plans.join('\n') + '\n';
  } finally {
    client.release();
  }
}

async function addDenseFollowEdges(pool, readers, authorIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dense = authorIds.slice(sparseFolloweeCount);
    await insertSparseFollows(client, readers, dense);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resetSparseFollowGraph(pool, readers, authorIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM follows WHERE follower_id = ANY($1::uuid[]) AND followee_id = ANY($2::uuid[])',
      [readers.map(({ id }) => id), authorIds.slice(sparseFolloweeCount)]
    );
    await insertSparseFollows(client, readers, authorIds.slice(0, sparseFolloweeCount));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadDataset(pool, settings, seed, readers) {
  const directory = path.join(outputRoot, `t26-${seed}`);
  const { manifest, manifestPath } = await readManifest(directory, seed);
  if (!['seeded', 'loaded', 'load-failed'].includes(manifest.status)) {
    throw new Error(`Fixture seed ${seed} is not ready for load mode.`);
  }
  await ensureTokenUsers(pool, readers);
  assertReaderSet(manifest, readers);
  const expanded = fixture(seed);
  const rows = generatedRows(seed, expanded);
  rows.loadReaderIds = readers.map(({ id }) => id);
  const ids = { targetPollId: rows.targetPollId, targetRootId: rows.targetRootId };
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDirectory = path.join(directory, 'runs', runId);
  await mkdir(path.dirname(runDirectory), { recursive: true });
  await mkdir(runDirectory, { recursive: false });
  const runStartedAt = nowIso();
  const measurementPlan = {
    runId,
    startedAt: nowIso(),
    targetLabel: settings.targetLabel,
    concurrency: readerCount,
    warmupBursts: settings.warmupBursts,
    sampleBursts: settings.sampleBursts,
    samplesPerScenario: readerCount * settings.sampleBursts,
    maxDurationSeconds: settings.maxDurationSeconds,
    pageSize,
    cursorSetupLimit,
    deepOffset,
    seedCounts: manifest.counts,
    snapshotPollCount: null,
    durationPolicy: 'Fixed warmup and measured bursts with a hard elapsed-time ceiling; wall-clock duration is recorded.'
  };
  await writeJson(path.join(runDirectory, 'measurement-plan.json'), measurementPlan);
  manifest.status = 'loading';
  manifest.runStartedAt ??= runStartedAt;
  manifest.runs ??= [];
  manifest.runs.push({ runId, startedAt: runStartedAt, status: 'running' });
  await writeJson(manifestPath, manifest);
  const records = [];
  const snapshots = new Set();
  const readerList = readers;
  const processStartedAt = performance.now();
  const deadlineAt = processStartedAt + settings.maxDurationSeconds * 1_000;

  const collect = async (type, scenarioName, page, cursors) => {
    const measured = await captureScenario(settings, runDirectory, readerList, type, scenarioName, page, ids, cursors, manifest, manifestPath, deadlineAt);
    records.push(...measured);
  };
  try {
    const observed = await inspectFixture(pool, expanded, rows);
    if (observed.publicPolls !== pollCount || observed.globalPublicPolls !== pollCount ||
        observed.roots !== rootCount || observed.replies !== replyCount) {
      throw new Error(`Load preflight counts do not match: ${JSON.stringify(observed)}.`);
    }
    await resetSparseFollowGraph(pool, readers, rows.authors);
    const sparseCount = await pool.query(
      `SELECT count(*)::integer AS count FROM follows
       WHERE follower_id = ANY($1::uuid[]) AND followee_id = ANY($2::uuid[])`,
      [readers.map(({ id }) => id), rows.authors.slice(0, sparseFolloweeCount)]
    );
    if (Number(sparseCount.rows[0].count) !== readerCount * sparseFolloweeCount) {
      throw new Error('Sparse subscription graph did not contain exactly 20 authors per reader.');
    }
    assertWithinDeadline(deadlineAt);
    const popularCursors = await preparePopularDeepCursors(
      pool, settings, readerList, ids, manifest, manifestPath, snapshots, deadlineAt
    );
    measurementPlan.snapshotPollCount = pollCount;
    await writeJson(path.join(runDirectory, 'measurement-plan.json'), measurementPlan);
    const planBefore = await capturePlans(pool, readers, ids, 'before-load-sparse-follow-graph');
    await writeFile(path.join(runDirectory, 'query-plans-before.txt'), planBefore, 'utf8');

    let cursors = await deepCursorsForReaders(pool, readerList, 'feed-newest', ids);
    await collect('feed-newest', 'feed-newest', 'first', null);
    await collect('feed-newest', 'feed-newest', 'deep', cursors);

    cursors = await deepCursorsForReaders(pool, readerList, 'subscriptions', ids);
    await collect('subscriptions', 'subscriptions-sparse', 'first', null);
    await collect('subscriptions', 'subscriptions-sparse', 'deep', cursors);

    await addDenseFollowEdges(pool, readers, rows.authors);
    cursors = await deepCursorsForReaders(pool, readerList, 'subscriptions', ids);
    await collect('subscriptions', 'subscriptions-dense', 'first', null);
    await collect('subscriptions', 'subscriptions-dense', 'deep', cursors);

    cursors = await deepCursorsForReaders(pool, readerList, 'roots', ids);
    await collect('roots', 'roots', 'first', null);
    await collect('roots', 'roots', 'deep', cursors);

    cursors = await deepCursorsForReaders(pool, readerList, 'replies', ids);
    await collect('replies', 'replies', 'first', null);
    await collect('replies', 'replies', 'deep', cursors);

    // Measure continuation before first-page bursts can evict popular snapshots at the owner quota.
    await collect('feed-popular', 'feed-popular', 'deep', popularCursors);
    await collect('feed-popular', 'feed-popular', 'first', null);

    manifest.snapshotIds = [...new Set([...manifest.snapshotIds, ...snapshots])];
    manifest.status = 'loaded';
    manifest.loadedAt = nowIso();
    await writeJson(manifestPath, manifest);
    const serialized = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    await writeFile(path.join(runDirectory, 'measurements.jsonl'), serialized, 'utf8');
    const summary = summarize(records);
    const result = {
      ...summary,
      run: {
        startedAt: measurementPlan.startedAt,
        completedAt: nowIso(),
        durationMs: Math.round(performance.now() - processStartedAt),
        concurrency: readerCount,
        warmupBursts: settings.warmupBursts,
        sampleBursts: settings.sampleBursts,
        maxDurationSeconds: settings.maxDurationSeconds,
        requestsPerScenario: readerCount * settings.sampleBursts,
        snapshotPollCount: measurementPlan.snapshotPollCount,
        targetLabel: settings.targetLabel
      }
    };
    await writeJson(path.join(runDirectory, 'summary.json'), result);
    const planAfter = await capturePlans(pool, readers, ids, 'after-load-dense-follow-graph');
    await writeFile(path.join(runDirectory, 'query-plans-after.txt'), planAfter, 'utf8');
    manifest.runs[manifest.runs.length - 1] = {
      runId,
      startedAt: runStartedAt,
      completedAt: nowIso(),
      status: result.pass ? 'passed' : 'failed',
      summaryPath: `runs/${runId}/summary.json`
    };
    await writeJson(manifestPath, manifest);
    return result;
  } catch (error) {
    manifest.status = 'load-failed';
    manifest.failedAt = nowIso();
    manifest.snapshotIds = [...new Set([...manifest.snapshotIds, ...snapshots])];
    await writeJson(manifestPath, manifest);
    const serialized = records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
    await writeFile(path.join(runDirectory, 'measurements.jsonl'), serialized, 'utf8');
    await writeJson(path.join(runDirectory, 'run-failure.json'), {
      failedAt: nowIso(),
      error: error?.message ?? String(error),
      completedMeasurements: records.length,
      snapshotIdsTracked: manifest.snapshotIds.length
    });
    manifest.runs[manifest.runs.length - 1] = {
      runId,
      startedAt: runStartedAt,
      failedAt: nowIso(),
      status: 'failed',
      failurePath: `runs/${runId}/run-failure.json`
    };
    await writeJson(manifestPath, manifest);
    throw error;
  }
}

async function main() {
  let args;
  try {
    args = parseArguments(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const settings = config();
    const readers = await readReaders(settings.tokenFile);
    const pool = new pg.Pool({ connectionString: settings.databaseUrl, max: 8, connectionTimeoutMillis: 10_000 });
    const lockClient = await pool.connect();
    try {
      const lock = await lockClient.query(
        "SELECT pg_try_advisory_lock(hashtextextended('yaskapp:t26:' || current_database(), 0)) AS locked"
      );
      if (!lock.rows[0]?.locked) throw new Error('Another T26 process is already using this database.');
      await ensureTokenUsers(pool, readers);
      if (args.mode === 'seed') {
        const seeded = await seedDataset(pool, args.seed, readers, settings);
        process.stdout.write(JSON.stringify({ mode: 'seed', seed: args.seed, counts: seeded.manifest.counts, evidenceDirectory: seeded.directory }, null, 2) + '\n');
      } else if (args.mode === 'load') {
        const result = await loadDataset(pool, settings, args.seed, readers);
        process.stdout.write(JSON.stringify({ mode: 'load', seed: args.seed, pass: result.pass, summary: result.scenarios }, null, 2) + '\n');
        if (!result.pass) process.exitCode = 2;
      } else {
        const cleanup = await cleanupDataset(pool, args.seed, readers, settings);
        process.stdout.write(JSON.stringify({ mode: 'cleanup', seed: args.seed, cleanup }, null, 2) + '\n');
      }
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock(hashtextextended('yaskapp:t26:' || current_database(), 0))").catch(() => {});
      lockClient.release();
      await pool.end();
    }
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
