import assert from 'node:assert/strict';
import test from 'node:test';

import { db } from '../../config/database.js';
import { deletePollCommentRecord } from './polls.repository.js';

test('comment deletion locks the poll before locking comments', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);

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
    assert.match(queries[1] ?? '', /FROM polls[\s\S]*FOR UPDATE/i);
    assert.match(queries[2] ?? '', /^\s*UPDATE comments c/i);
  } finally {
    Object.defineProperty(db, 'connect', {
      configurable: true,
      value: originalConnect
    });
  }
});
