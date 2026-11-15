import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

const { db } = await import('../../config/database.js');
const { setUserBlock } = await import('./user-blocks.repository.js');

const viewerId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';

type Follow = { follower_id: string; followee_id: string };

function mockDatabase(
  context: TestContext,
  options: { blocked?: boolean; targetExists?: boolean; follows?: Follow[]; revision?: string } = {}
) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const outbox: Array<{ userId: string; type: string; payload: Record<string, unknown> }> = [];
  const follows = [...(options.follows ?? [])];
  const revisions = new Map([[viewerId, options.revision ?? '0'], [targetId, options.revision ?? '0']]);
  let blocked = options.blocked ?? false;
  const knownUsers = new Set([viewerId, ...(options.targetExists === false ? [] : [targetId])]);

  const client = {
    async query(sql: string, values: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      statements.push({ sql: normalized, values });

      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith('SELECT id FROM users WHERE id = $1 FOR UPDATE')) {
        return { rows: knownUsers.has(String(values[0])) ? [{ id: values[0] }] : [], rowCount: 1 };
      }
      if (normalized.includes('FROM users WHERE id = ANY($1::uuid[])')) {
        return {
          rows: (values[0] as string[]).filter((id) => knownUsers.has(id)).map((id) => ({
            id,
            status: 'active',
            deleted_at: null
          })),
          rowCount: knownUsers.size
        };
      }
      if (normalized.startsWith('INSERT INTO user_blocks (')) {
        if (blocked) return { rows: [], rowCount: 0 };
        blocked = true;
        return { rows: [{ blocked_user_id: values[1] }], rowCount: 1 };
      }
      if (normalized.startsWith('DELETE FROM user_blocks')) {
        if (!blocked) return { rows: [], rowCount: 0 };
        blocked = false;
        return { rows: [{ blocked_user_id: values[1] }], rowCount: 1 };
      }
      if (normalized.startsWith('DELETE FROM follows')) {
        const removed = follows.splice(0);
        return { rows: removed, rowCount: removed.length };
      }
      if (normalized.startsWith('UPDATE profiles')) return { rows: [], rowCount: 1 };
      if (normalized.startsWith('INSERT INTO notification_suppressions')) {
        return { rows: [], rowCount: 2 };
      }
      if (normalized.includes('INSERT INTO user_visibility_revisions')) {
        if (normalized.includes('DO UPDATE SET revision')) {
          for (const id of values[0] as string[]) {
            revisions.set(id, String(Number(revisions.get(id) ?? '0') + 1));
          }
          return {
            rows: (values[0] as string[]).map((id) => ({ user_id: id, revision: revisions.get(id) })),
            rowCount: 2
          };
        }
        const id = String(values[0]);
        if (!revisions.has(id)) revisions.set(id, '0');
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith('SELECT COALESCE(( SELECT revision::text FROM user_visibility_revisions')) {
        return { rows: [{ revision: revisions.get(String(values[0])) ?? '0' }], rowCount: 1 };
      }
      if (normalized.startsWith('INSERT INTO user_blocks_outbox')) {
        outbox.push({ userId: String(values[0]), type: String(values[1]), payload: JSON.parse(String(values[2])) });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
    release() {}
  };

  context.mock.method(db, 'connect', async () => client as never);
  return { statements, outbox, follows };
}

test('blocking removes both follows and commits counters, suppression, revisions, and outbox together', async (context) => {
  const scenario = mockDatabase(context, {
    follows: [
      { follower_id: viewerId, followee_id: targetId },
      { follower_id: targetId, followee_id: viewerId }
    ]
  });

  const result = await setUserBlock({ blockerId: viewerId, blockedId: targetId, blocked: true });

  assert.deepEqual(result, {
    targetUserId: targetId,
    blockedByViewer: true,
    viewerVisibilityRevision: '1'
  });
  assert.equal(scenario.follows.length, 0);
  assert.deepEqual(
    scenario.statements.filter(({ sql }) => sql.startsWith('UPDATE profiles')).map(({ values }) => values),
    [[viewerId, 1, 1], [targetId, 1, 1]]
  );
  assert.ok(scenario.statements.some(({ sql }) => sql.startsWith('INSERT INTO notification_suppressions')));
  assert.deepEqual(scenario.outbox.map(({ userId, type }) => [userId, type]), [
    [viewerId, 'user_blocks.changed'],
    [viewerId, 'viewer.visibility_invalidated'],
    [targetId, 'viewer.visibility_invalidated']
  ]);
  assert.equal(scenario.statements[0]?.sql, 'BEGIN');
  assert.equal(scenario.statements.at(-1)?.sql, 'COMMIT');
});

test('repeating a block does not change follows, revisions, suppression, or outbox', async (context) => {
  const scenario = mockDatabase(context, { blocked: true, revision: '7' });

  const result = await setUserBlock({ blockerId: viewerId, blockedId: targetId, blocked: true });

  assert.deepEqual(result, {
    targetUserId: targetId,
    blockedByViewer: true,
    viewerVisibilityRevision: '7'
  });
  assert.equal(scenario.statements.some(({ sql }) => sql.startsWith('DELETE FROM follows')), false);
  assert.equal(scenario.statements.some(({ sql }) => sql.startsWith('INSERT INTO notification_suppressions')), false);
  assert.equal(scenario.statements.some(({ sql }) => sql.includes('INSERT INTO user_visibility_revisions')), false);
  assert.equal(scenario.outbox.length, 0);
});

test('unblocking clears only the viewer decision and does not restore follows', async (context) => {
  const scenario = mockDatabase(context, { blocked: true, revision: '7' });

  const result = await setUserBlock({ blockerId: viewerId, blockedId: targetId, blocked: false });

  assert.deepEqual(result, {
    targetUserId: targetId,
    blockedByViewer: false,
    viewerVisibilityRevision: '8'
  });
  assert.equal(scenario.statements.some(({ sql }) => sql.startsWith('INSERT INTO follows')), false);
  assert.equal(scenario.statements.some(({ sql }) => sql.startsWith('DELETE FROM follows')), false);
  assert.equal(scenario.outbox.length, 3);
});

test('unblocking an unknown target is idempotent', async (context) => {
  const scenario = mockDatabase(context, { targetExists: false, revision: '4' });

  const result = await setUserBlock({ blockerId: viewerId, blockedId: targetId, blocked: false });

  assert.deepEqual(result, {
    targetUserId: targetId,
    blockedByViewer: false,
    viewerVisibilityRevision: '4'
  });
  assert.equal(scenario.outbox.length, 0);
});
