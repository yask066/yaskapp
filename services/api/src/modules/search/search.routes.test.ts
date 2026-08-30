import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeSearchQuery,
  searchWithRepositories,
  type SearchRepositories
} from './search.service.js';
import { parseSearchQuery } from './search.routes.js';

const repositories: SearchRepositories = {
  searchPollRecords: async () => [
    {
      score: 0.9,
      poll: {
        id: 'poll-1',
        authorId: 'author-1',
        author: {
          id: 'author-1',
          username: 'alice',
          displayName: 'Alice',
          avatarObjectKey: null,
          avatarUrl: null
        },
        question: 'Climate change?',
        description: null,
        imageUrl: null,
        visibility: 'public',
        optionsCount: 2,
        votesCount: 1,
        commentsCount: 0,
        likesCount: 0,
        allowVoteCancellation: false,
        viewerHasLiked: false,
        viewerVoteOptionId: null,
        options: [],
        createdAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T10:00:00.000Z',
        endsAt: null
      }
    }
  ],
  searchUserRecords: async () => [
    {
      score: 0.8,
      user: {
        id: 'user-1',
        username: 'bob',
        status: 'active',
        createdAt: '2026-08-30T09:00:00.000Z',
        updatedAt: '2026-08-30T09:00:00.000Z',
        viewerIsFollowing: false,
        profile: {
          displayName: 'Bob',
          bio: null,
          countryCode: null,
          avatarObjectKey: null,
          avatarUrl: null,
          pollsCount: 0,
          followersCount: 0,
          followingCount: 0
        }
      }
    }
  ]
};

test('search query normalization trims and collapses whitespace', () => {
  assert.equal(normalizeSearchQuery('  climate   change  '), 'climate change');
  assert.throws(() => normalizeSearchQuery('x'), /between 2 and 100/);
  assert.throws(() => normalizeSearchQuery('x'.repeat(101)), /between 2 and 100/);
});

test('search route parser applies defaults and rejects invalid or unknown query parameters', () => {
  const parsed = parseSearchQuery({ q: '  climate change  ' });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data, {
      q: 'climate change',
      type: 'all',
      sort: 'relevance',
      limit: 20
    });
  }

  assert.equal(parseSearchQuery({ q: 'x' }).success, false);
  assert.equal(parseSearchQuery({ q: 'climate', type: 'groups' }).success, false);
  assert.equal(parseSearchQuery({ q: 'climate', limit: 0 }).success, false);
  assert.equal(parseSearchQuery({ q: 'climate', unknown: 'value' }).success, false);
});

test('search service applies defaults and returns mixed typed results', async () => {
  const result = await searchWithRepositories({
    viewerId: 'viewer-1',
    query: '  climate  ',
    repositories
  });

  assert.deepEqual(result.items.map((item) => item.type), ['poll', 'user']);
  assert.equal(result.items[0]?.type, 'poll');
  assert.equal(result.items[0]?.type === 'poll' ? result.items[0].poll.id : undefined, 'poll-1');
  assert.equal(result.items[1]?.type, 'user');
  assert.equal(result.items[1]?.type === 'user' ? result.items[1].user.id : undefined, 'user-1');
  assert.equal(result.nextCursor, null);
});

test('search service restricts result type while preserving supported sorting', async () => {
  const polls = await searchWithRepositories({
    viewerId: 'viewer-1',
    query: 'poll',
    type: 'polls',
    sort: 'newest',
    limit: 5,
    repositories
  });
  assert.deepEqual(polls.items.map((item) => item.type), ['poll']);

  const users = await searchWithRepositories({
    viewerId: 'viewer-1',
    query: 'user',
    type: 'users',
    sort: 'newest',
    repositories
  });
  assert.deepEqual(users.items.map((item) => item.type), ['user']);
});
