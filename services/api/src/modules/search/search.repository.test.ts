import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPollSearchQuery,
  buildUserSearchQuery,
  decodeSearchCursor,
  mapPollSearchRow,
  mapUserSearchRow,
  type SearchRepositoryInput
} from './search.repository.js';

const baseInput: SearchRepositoryInput = {
  viewerId: 'viewer-id',
  query: '  climate change  ',
  type: 'all',
  sort: 'relevance',
  limit: 20
};

test('search repository query covers public visibility, matching, relevance and stable cursor ordering', () => {
  const cursor = { score: 0.8, createdAt: '2026-08-30T10:00:00.000Z', id: 'poll-1' };
  const { text, values } = buildPollSearchQuery({ ...baseInput, cursor });

  assert.match(text, /p\.deleted_at IS NULL/);
  assert.match(text, /p\.visibility = 'public'/);
  assert.match(text, /u\.status = 'active'/);
  assert.match(text, /u\.deleted_at IS NULL/);
  assert.match(text, /to_tsvector\('simple', p\.question\)/);
  assert.match(text, /plainto_tsquery\('simple'/);
  assert.match(text, /p\.created_at.*p\.id/s);
  assert.match(text, /LIMIT \$\d+/);
  assert.deepEqual(values, [
    'climate change',
    'viewer-id',
    0.8,
    '2026-08-30T10:00:00.000Z',
    'poll-1',
    21
  ]);
});

test('search repository query supports newest and popular ordering with username/display-name matching', () => {
  const newest = buildPollSearchQuery({ ...baseInput, sort: 'newest', cursor: undefined });
  assert.match(newest.text, /ORDER BY p\.created_at DESC, p\.id DESC/);
  assert.deepEqual(newest.values, ['climate change', 'viewer-id', 21]);

  const popularPoll = buildPollSearchQuery({ ...baseInput, sort: 'popular', cursor: undefined });
  const popularPollSelect = popularPoll.text.split('FROM polls')[0];
  assert.match(popularPollSelect, /p\.votes_count \* 2[\s\S]*p\.likes_count \* 1\.5[\s\S]*p\.comments_count[\s\S]*AS score/);

  const popular = buildUserSearchQuery({ ...baseInput, type: 'users', sort: 'popular' });
  const popularUserSelect = popular.text.split('FROM users')[0];
  assert.match(popular.text, /u\.username::text ILIKE/);
  assert.match(popular.text, /pr\.display_name ILIKE/);
  assert.match(popular.text, /ORDER BY .*followers_count.*polls_count.*u\.created_at.*u\.id/s);
  assert.match(popularUserSelect, /pr\.followers_count \* 2 \+ pr\.polls_count\) AS score/);
  assert.deepEqual(popular.values, ['climate change', '%climate change%', '%climate change%', 'viewer-id', 21]);
});

test('search repository escapes ILIKE wildcards in user queries', () => {
  const { text, values } = buildUserSearchQuery({
    ...baseInput,
    type: 'users',
    query: '100%_match\\name'
  });

  assert.ok(text.includes("u.username::text ILIKE $2 ESCAPE '\\'"));
  assert.ok(text.includes("pr.display_name ILIKE $3 ESCAPE '\\'"));
  assert.deepEqual(values, [
    '100%_match\\name',
    '%100\\%\\_match\\\\name%',
    '%100\\%\\_match\\\\name%',
    'viewer-id',
    21
  ]);
});

test('search repository decodes opaque cursor values and maps poll/user rows', () => {
  const encoded = Buffer.from(
    JSON.stringify({ score: 0.75, createdAt: '2026-08-30T09:00:00.000Z', id: 'row-1' }),
    'utf8'
  ).toString('base64url');
  assert.deepEqual(decodeSearchCursor(encoded), {
    score: 0.75,
    createdAt: '2026-08-30T09:00:00.000Z',
    id: 'row-1'
  });

  const poll = mapPollSearchRow({
    id: 'poll-1',
    author_id: 'user-1',
    author_username: 'alice',
    author_display_name: 'Alice',
    author_avatar_object_key: null,
    question: 'Climate?',
    description: null,
    image_object_key: null,
    visibility: 'public',
    options_count: 2,
    votes_count: 4,
    comments_count: 1,
    likes_count: 3,
    allow_vote_cancellation: true,
    created_at: new Date('2026-08-30T10:00:00.000Z'),
    updated_at: new Date('2026-08-30T10:00:00.000Z'),
    ends_at: null,
    score: 0.9
  });
  assert.equal(poll.poll.id, 'poll-1');
  assert.equal(poll.poll.author.username, 'alice');
  assert.equal(poll.score, 0.9);

  const user = mapUserSearchRow({
    id: 'user-1',
    username: 'alice',
    status: 'active',
    created_at: new Date('2026-08-30T10:00:00.000Z'),
    updated_at: new Date('2026-08-30T10:00:00.000Z'),
    display_name: 'Alice',
    bio: null,
    country_code: null,
    avatar_object_key: null,
    polls_count: 2,
    followers_count: 5,
    following_count: 1,
    viewer_is_following: false,
    score: 0.7
  });
  assert.equal(user.user.id, 'user-1');
  assert.equal(user.user.profile.displayName, 'Alice');
  assert.equal(user.score, 0.7);
});
