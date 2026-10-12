import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { db } from '../../config/database.js';
import {
  deletePollCommentRecord,
  findViewablePollImageRecord,
  listPollCommentRecords,
  listPollCommentReplyRecords
} from './polls.repository.js';

test('poll image lookup excludes deleted owners before storage is purged', async (context: TestContext) => {
  let query = '';
  context.mock.method(db, 'query', async (sql: string) => {
    query = sql;
    return { rows: [] } as never;
  });

  await findViewablePollImageRecord('poll-1');

  assert.match(query, /u\.status = 'active'/);
  assert.match(query, /u\.deleted_at IS NULL/);
});

test('comment lists and replies exclude deleted poll owners and comment authors', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      return { rows: [], rowCount: /SELECT (?:p|c)\.id/.test(sql) ? 1 : 0 };
    },
    release() {}
  };
  const originalConnect = db.connect.bind(db);
  Object.defineProperty(db, 'connect', { configurable: true, value: async () => client as never });

  try {
    await listPollCommentRecords({ pollId: 'poll-1', limit: 20 });
    await listPollCommentReplyRecords({ pollId: 'poll-1', commentId: 'root-1', limit: 20 });
  } finally {
    Object.defineProperty(db, 'connect', { configurable: true, value: originalConnect });
  }

  const pollVisibilityQuery = queries[0] ?? '';
  const rootListQuery = queries[1] ?? '';
  const rootVisibilityQuery = queries[2] ?? '';
  const replyListQuery = queries[3] ?? '';
  assert.match(pollVisibilityQuery, /poll_author\.status = 'active'/);
  assert.match(pollVisibilityQuery, /poll_author\.deleted_at IS NULL/);
  assert.match(rootListQuery, /u\.status = 'active'/);
  assert.match(rootListQuery, /u\.deleted_at IS NULL/);
  assert.match(rootVisibilityQuery, /root_author\.status = 'active'/);
  assert.match(rootVisibilityQuery, /root_author\.deleted_at IS NULL/);
  assert.match(rootVisibilityQuery, /poll_author\.deleted_at IS NULL/);
  assert.match(replyListQuery, /u\.status = 'active'/);
  assert.match(replyListQuery, /u\.deleted_at IS NULL/);
});

test('comment deletion locks the poll before locking comments', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);

      if (sql.includes('SELECT status, deleted_at FROM users')) {
        return { rows: [{ status: 'active', deleted_at: null }], rowCount: 1 };
      }

      if (sql.includes('SELECT id') && sql.includes('FROM polls')) {
        return { rows: [{ id: 'poll-1' }], rowCount: 1 };
      }

      if (sql.includes('UPDATE comments c')) {
        return {
          rows: [{ id: 'comment-1', parent_comment_id: null }],
          rowCount: 1
        };
      }

      if (sql.includes('UPDATE comments')) {
        return { rows: [{ id: 'reply-1' }], rowCount: 1 };
      }

      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const originalConnect = db.connect.bind(db);
  Object.defineProperty(db, 'connect', {
    configurable: true,
    value: async () => client as never
  });

  try {
    const result = await deletePollCommentRecord({
      pollId: 'poll-1',
      commentId: 'comment-1',
      authorId: 'author-1'
    });

    assert.equal(result.status, 'deleted');
    assert.match(queries[1] ?? '', /SELECT status, deleted_at FROM users[\s\S]*FOR UPDATE/i);
    assert.match(queries[2] ?? '', /FROM polls[\s\S]*FOR UPDATE/i);
    assert.match(queries[3] ?? '', /^\s*UPDATE comments c/i);
  } finally {
    Object.defineProperty(db, 'connect', {
      configurable: true,
      value: originalConnect
    });
  }
});
