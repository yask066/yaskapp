import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.NODE_ENV = 'test';

const [{ buildApp }, { closeDatabaseConnection, db }] = await Promise.all([
  import('../../app.js'),
  import('../../config/database.js')
]);

const app = buildApp();
const createdUserIds = new Set<string>();

type AuthResponse = {
  user: {
    id: string;
    username: string;
    profile: {
      displayName: string;
      bio: string | null;
      pollsCount: number;
    };
  };
  accessToken: string;
};

type ProfileResponse = {
  user: {
    id: string;
    profile: {
      displayName: string;
      bio: string | null;
    };
  };
};

type PollResponse = {
  poll: {
    id: string;
    question: string;
    options: Array<{
      id: string;
      text: string;
      votesCount: number;
    }>;
    votesCount: number;
    commentsCount: number;
    likesCount: number;
    viewerHasLiked: boolean;
  };
};

type ListPollsResponse = {
  items: Array<PollResponse['poll']>;
};

type ListCommentsResponse = {
  items: Array<{
    id: string;
    pollId: string;
    author: {
      id: string;
      username: string;
      displayName: string;
    };
    body: string;
    likesCount: number;
  }>;
};

type CreateCommentResponse = {
  comment: ListCommentsResponse['items'][number];
  poll: PollResponse['poll'];
};

type VoteResponse = {
  poll: {
    id: string;
    votesCount: number;
  };
  vote: {
    pollId: string;
    optionId: string;
    votesCount: number;
  };
};

function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function registerTestUser() {
  const suffix = uniqueSuffix();
  const password = 'password123';
  const username = `test_${suffix}`;

  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `${username}@yaskapp.test`,
      username,
      password,
      displayName: 'Test User'
    }
  });

  assert.equal(response.statusCode, 201, response.body);

  const auth = response.json<AuthResponse>();
  createdUserIds.add(auth.user.id);

  return {
    ...auth,
    password
  };
}

function bearer(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`
  };
}

after(async () => {
  for (const userId of createdUserIds) {
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
  }

  await app.close();
  await closeDatabaseConnection();
});

test('auth and polls happy path works end to end', async () => {
  const registered = await registerTestUser();

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      login: registered.user.username,
      password: registered.password
    }
  });

  assert.equal(loginResponse.statusCode, 200, loginResponse.body);

  const login = loginResponse.json<AuthResponse>();
  assert.equal(login.user.id, registered.user.id);
  assert.ok(login.accessToken);

  const createPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(login.accessToken),
    payload: {
      question: 'Which backend integration path should stay green?',
      options: ['Register', 'Create poll', 'Vote']
    }
  });

  assert.equal(createPollResponse.statusCode, 201, createPollResponse.body);

  const createdPoll = createPollResponse.json<PollResponse>().poll;
  assert.equal(createdPoll.options.length, 3);
  assert.equal(createdPoll.votesCount, 0);

  const listPollsResponse = await app.inject({
    method: 'GET',
    url: '/polls?limit=5'
  });

  assert.equal(listPollsResponse.statusCode, 200, listPollsResponse.body);

  const polls = listPollsResponse.json<ListPollsResponse>();
  assert.ok(polls.items.some((poll) => poll.id === createdPoll.id));

  const optionId = createdPoll.options[0]?.id;
  assert.ok(optionId);

  const voteResponse = await app.inject({
    method: 'POST',
    url: `/polls/${createdPoll.id}/votes`,
    headers: bearer(login.accessToken),
    payload: {
      optionId
    }
  });

  assert.equal(voteResponse.statusCode, 201, voteResponse.body);

  const vote = voteResponse.json<VoteResponse>();
  assert.equal(vote.poll.id, createdPoll.id);
  assert.equal(vote.poll.votesCount, 1);
  assert.equal(vote.vote.pollId, createdPoll.id);
  assert.equal(vote.vote.optionId, optionId);
  assert.equal(vote.vote.votesCount, 1);

  const duplicateVoteResponse = await app.inject({
    method: 'POST',
    url: `/polls/${createdPoll.id}/votes`,
    headers: bearer(login.accessToken),
    payload: {
      optionId
    }
  });

  assert.equal(duplicateVoteResponse.statusCode, 409, duplicateVoteResponse.body);
});

test('poll creation and voting require authentication', async () => {
  const createPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    payload: {
      question: 'Should this request be rejected?',
      options: ['Yes', 'No']
    }
  });

  assert.equal(createPollResponse.statusCode, 401, createPollResponse.body);

  const voteResponse = await app.inject({
    method: 'POST',
    url: '/polls/00000000-0000-0000-0000-000000000000/votes',
    payload: {
      optionId: '00000000-0000-0000-0000-000000000000'
    }
  });

  assert.equal(voteResponse.statusCode, 401, voteResponse.body);
});

test('poll creation validates request body', async () => {
  const registered = await registerTestUser();

  const response = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: '',
      options: ['Same option', 'Same option']
    }
  });

  assert.equal(response.statusCode, 400, response.body);
});

test('profile can be updated by the current user', async () => {
  const registered = await registerTestUser();

  const updateResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    headers: bearer(registered.accessToken),
    payload: {
      displayName: 'Updated Tester',
      bio: 'I test profile updates.'
    }
  });

  assert.equal(updateResponse.statusCode, 200, updateResponse.body);

  const updatedProfile = updateResponse.json<ProfileResponse>();
  assert.equal(updatedProfile.user.id, registered.user.id);
  assert.equal(updatedProfile.user.profile.displayName, 'Updated Tester');
  assert.equal(updatedProfile.user.profile.bio, 'I test profile updates.');

  const clearBioResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    headers: bearer(registered.accessToken),
    payload: {
      bio: null
    }
  });

  assert.equal(clearBioResponse.statusCode, 200, clearBioResponse.body);

  const clearedProfile = clearBioResponse.json<ProfileResponse>();
  assert.equal(clearedProfile.user.profile.displayName, 'Updated Tester');
  assert.equal(clearedProfile.user.profile.bio, null);
});

test('profile update requires authentication and validates body', async () => {
  const unauthorizedResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    payload: {
      displayName: 'No Token'
    }
  });

  assert.equal(unauthorizedResponse.statusCode, 401, unauthorizedResponse.body);

  const registered = await registerTestUser();
  const invalidResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    headers: bearer(registered.accessToken),
    payload: {
      displayName: '',
      bio: 'x'.repeat(501)
    }
  });

  assert.equal(invalidResponse.statusCode, 400, invalidResponse.body);
});

test('current user can list their own polls and see poll counter', async () => {
  const registered = await registerTestUser();

  const createPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'Which profile section should show my polls?',
      options: ['Profile', 'Explore']
    }
  });

  assert.equal(createPollResponse.statusCode, 201, createPollResponse.body);

  const createdPoll = createPollResponse.json<PollResponse>().poll;

  const myPollsResponse = await app.inject({
    method: 'GET',
    url: '/profiles/me/polls?limit=10',
    headers: bearer(registered.accessToken)
  });

  assert.equal(myPollsResponse.statusCode, 200, myPollsResponse.body);

  const myPolls = myPollsResponse.json<ListPollsResponse>();
  assert.ok(myPolls.items.some((poll) => poll.id === createdPoll.id));

  const meResponse = await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: bearer(registered.accessToken)
  });

  assert.equal(meResponse.statusCode, 200, meResponse.body);

  const me = meResponse.json<{ user: AuthResponse['user'] }>();
  assert.equal(me.user.profile.pollsCount, 1);
});

test('listing current user polls requires authentication', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/profiles/me/polls'
  });

  assert.equal(response.statusCode, 401, response.body);
});

test('poll comments can be listed for an existing public poll', async () => {
  const registered = await registerTestUser();

  const createPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'Which comments path should work?',
      options: ['List', 'Create']
    }
  });

  assert.equal(createPollResponse.statusCode, 201, createPollResponse.body);

  const createdPoll = createPollResponse.json<PollResponse>().poll;

  const firstCommentResult = await db.query<{ id: string }>(
    `
      INSERT INTO comments (poll_id, author_id, body)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [createdPoll.id, registered.user.id, 'This comment should be listed.']
  );
  await db.query(
    `
      INSERT INTO comments (poll_id, author_id, body)
      VALUES ($1, $2, $3)
    `,
    [createdPoll.id, registered.user.id, 'This comment should be hidden by limit.']
  );

  const firstCommentId = firstCommentResult.rows[0]?.id;
  assert.ok(firstCommentId);

  const listCommentsResponse = await app.inject({
    method: 'GET',
    url: `/polls/${createdPoll.id}/comments?limit=1`
  });

  assert.equal(listCommentsResponse.statusCode, 200, listCommentsResponse.body);

  const comments = listCommentsResponse.json<ListCommentsResponse>();
  assert.equal(comments.items.length, 1);
  assert.equal(comments.items[0]?.id, firstCommentId);
  assert.equal(comments.items[0]?.pollId, createdPoll.id);
  assert.equal(comments.items[0]?.author.id, registered.user.id);
  assert.equal(comments.items[0]?.author.username, registered.user.username);
  assert.equal(comments.items[0]?.body, 'This comment should be listed.');
  assert.equal(comments.items[0]?.likesCount, 0);

  const invalidLimitResponse = await app.inject({
    method: 'GET',
    url: `/polls/${createdPoll.id}/comments?limit=0`
  });

  assert.equal(invalidLimitResponse.statusCode, 400, invalidLimitResponse.body);
});

test('poll comments are listed from oldest to newest', async () => {
  const registered = await registerTestUser();

  const createPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'Which comment should appear first?',
      options: ['Oldest', 'Newest']
    }
  });

  assert.equal(createPollResponse.statusCode, 201, createPollResponse.body);

  const createdPoll = createPollResponse.json<PollResponse>().poll;

  await db.query(
    `
      INSERT INTO comments (poll_id, author_id, body, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $4),
        ($1, $2, $5, $6, $6),
        ($1, $2, $7, $8, $8)
    `,
    [
      createdPoll.id,
      registered.user.id,
      'Newest comment.',
      new Date('2026-07-21T10:03:00.000Z'),
      'Oldest comment.',
      new Date('2026-07-21T10:01:00.000Z'),
      'Middle comment.',
      new Date('2026-07-21T10:02:00.000Z')
    ]
  );

  const listCommentsResponse = await app.inject({
    method: 'GET',
    url: `/polls/${createdPoll.id}/comments`
  });

  assert.equal(listCommentsResponse.statusCode, 200, listCommentsResponse.body);

  const comments = listCommentsResponse.json<ListCommentsResponse>();
  assert.deepEqual(
    comments.items.map((comment) => comment.body),
    ['Oldest comment.', 'Middle comment.', 'Newest comment.']
  );
});

test('creating a poll comment requires authentication', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/polls/00000000-0000-0000-0000-000000000000/comments',
    payload: {
      body: 'This should require auth.'
    }
  });

  assert.equal(response.statusCode, 401, response.body);
  assert.equal(response.json<{ error: string }>().error, 'unauthorized');
});

test('poll comment creation validates request body', async () => {
  const registered = await registerTestUser();

  const emptyBodyResponse = await app.inject({
    method: 'POST',
    url: '/polls/00000000-0000-0000-0000-000000000000/comments',
    headers: bearer(registered.accessToken),
    payload: {
      body: '   '
    }
  });

  assert.equal(emptyBodyResponse.statusCode, 400, emptyBodyResponse.body);

  const tooLongBodyResponse = await app.inject({
    method: 'POST',
    url: '/polls/00000000-0000-0000-0000-000000000000/comments',
    headers: bearer(registered.accessToken),
    payload: {
      body: 'x'.repeat(1001)
    }
  });

  assert.equal(tooLongBodyResponse.statusCode, 400, tooLongBodyResponse.body);
});

test('authenticated user can create a poll comment', async () => {
  const registered = await registerTestUser();

  const createPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'Which comment should be created?',
      options: ['First', 'Second']
    }
  });

  assert.equal(createPollResponse.statusCode, 201, createPollResponse.body);

  const createdPoll = createPollResponse.json<PollResponse>().poll;

  const createCommentResponse = await app.inject({
    method: 'POST',
    url: `/polls/${createdPoll.id}/comments`,
    headers: bearer(registered.accessToken),
    payload: {
      body: '  This comment should be created.  '
    }
  });

  assert.equal(createCommentResponse.statusCode, 201, createCommentResponse.body);

  const createdCommentResponse = createCommentResponse.json<CreateCommentResponse>();
  const createdComment = createdCommentResponse.comment;
  assert.equal(createdComment.pollId, createdPoll.id);
  assert.equal(createdComment.author.id, registered.user.id);
  assert.equal(createdComment.author.username, registered.user.username);
  assert.equal(createdComment.body, 'This comment should be created.');
  assert.equal(createdComment.likesCount, 0);
  assert.equal(createdCommentResponse.poll.id, createdPoll.id);
  assert.equal(createdCommentResponse.poll.commentsCount, 1);

  const commentRowResult = await db.query<{
    poll_id: string;
    author_id: string;
    body: string;
  }>(
    `
      SELECT poll_id, author_id, body
      FROM comments
      WHERE id = $1
    `,
    [createdComment.id]
  );

  assert.equal(commentRowResult.rows[0]?.poll_id, createdPoll.id);
  assert.equal(commentRowResult.rows[0]?.author_id, registered.user.id);
  assert.equal(commentRowResult.rows[0]?.body, 'This comment should be created.');

  const pollCounterResult = await db.query<{ comments_count: number }>(
    'SELECT comments_count FROM polls WHERE id = $1',
    [createdPoll.id]
  );

  assert.equal(pollCounterResult.rows[0]?.comments_count, 1);

  const listPollsResponse = await app.inject({
    method: 'GET',
    url: '/polls?limit=10'
  });

  assert.equal(listPollsResponse.statusCode, 200, listPollsResponse.body);

  const feedPoll = listPollsResponse
    .json<ListPollsResponse>()
    .items.find((poll) => poll.id === createdPoll.id);

  assert.equal(feedPoll?.commentsCount, 1);
});

test('poll comments return not found for missing deleted or non-public polls', async () => {
  const registered = await registerTestUser();

  const privatePollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'Should private poll comments be hidden?',
      options: ['Yes', 'No'],
      visibility: 'private'
    }
  });

  assert.equal(privatePollResponse.statusCode, 201, privatePollResponse.body);

  const privatePoll = privatePollResponse.json<PollResponse>().poll;

  const deletedPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'Should deleted poll comments be hidden?',
      options: ['Yes', 'No']
    }
  });

  assert.equal(deletedPollResponse.statusCode, 201, deletedPollResponse.body);

  const deletedPoll = deletedPollResponse.json<PollResponse>().poll;

  await db.query('UPDATE polls SET deleted_at = now() WHERE id = $1', [deletedPoll.id]);

  const pollIds = [
    '00000000-0000-0000-0000-000000000000',
    privatePoll.id,
    deletedPoll.id
  ];

  for (const pollId of pollIds) {
    const listResponse = await app.inject({
      method: 'GET',
      url: `/polls/${pollId}/comments`
    });

    assert.equal(listResponse.statusCode, 404, listResponse.body);

    const createResponse = await app.inject({
      method: 'POST',
      url: `/polls/${pollId}/comments`,
      headers: bearer(registered.accessToken),
      payload: {
        body: 'This should not be created.'
      }
    });

    assert.equal(createResponse.statusCode, 404, createResponse.body);
  }
});

test('current user can like a poll once', async () => {
  const registered = await registerTestUser();

  const createPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'Should this poll be liked?',
      options: ['Yes', 'Also yes']
    }
  });

  assert.equal(createPollResponse.statusCode, 201, createPollResponse.body);

  const createdPoll = createPollResponse.json<PollResponse>().poll;

  const likeResponse = await app.inject({
    method: 'POST',
    url: `/polls/${createdPoll.id}/likes`,
    headers: bearer(registered.accessToken)
  });

  assert.equal(likeResponse.statusCode, 201, likeResponse.body);
  const likedPoll = likeResponse.json<PollResponse>().poll;
  assert.equal(likedPoll.id, createdPoll.id);
  assert.equal(likedPoll.likesCount, 1);
  assert.equal(likedPoll.viewerHasLiked, true);

  const likedPollCounterResult = await db.query<{ likes_count: number }>(
    'SELECT likes_count FROM polls WHERE id = $1',
    [createdPoll.id]
  );

  assert.equal(likedPollCounterResult.rows[0]?.likes_count, 1);

  const likeRowResult = await db.query<{ count: string }>(
    `
      SELECT count(*) AS count
      FROM likes
      WHERE user_id = $1
        AND poll_id = $2
    `,
    [registered.user.id, createdPoll.id]
  );

  assert.equal(likeRowResult.rows[0]?.count, '1');

  const duplicateLikeResponse = await app.inject({
    method: 'POST',
    url: `/polls/${createdPoll.id}/likes`,
    headers: bearer(registered.accessToken)
  });

  assert.equal(duplicateLikeResponse.statusCode, 201, duplicateLikeResponse.body);
  const duplicateLikedPoll = duplicateLikeResponse.json<PollResponse>().poll;
  assert.equal(duplicateLikedPoll.id, createdPoll.id);
  assert.equal(duplicateLikedPoll.likesCount, 1);
  assert.equal(duplicateLikedPoll.viewerHasLiked, true);

  const unauthenticatedFeedResponse = await app.inject({
    method: 'GET',
    url: '/polls?limit=10'
  });

  assert.equal(unauthenticatedFeedResponse.statusCode, 200, unauthenticatedFeedResponse.body);

  const unauthenticatedFeed = unauthenticatedFeedResponse.json<{
    items: Array<PollResponse['poll']>;
  }>();
  const unauthenticatedFeedPoll = unauthenticatedFeed.items.find(
    (poll) => poll.id === createdPoll.id
  );

  assert.equal(unauthenticatedFeedPoll?.viewerHasLiked, false);

  const authenticatedFeedResponse = await app.inject({
    method: 'GET',
    url: '/polls?limit=10',
    headers: bearer(registered.accessToken)
  });

  assert.equal(authenticatedFeedResponse.statusCode, 200, authenticatedFeedResponse.body);

  const authenticatedFeed = authenticatedFeedResponse.json<{
    items: Array<PollResponse['poll']>;
  }>();
  const authenticatedFeedPoll = authenticatedFeed.items.find(
    (poll) => poll.id === createdPoll.id
  );

  assert.equal(authenticatedFeedPoll?.viewerHasLiked, true);

  const duplicateLikedPollCounterResult = await db.query<{ likes_count: number }>(
    'SELECT likes_count FROM polls WHERE id = $1',
    [createdPoll.id]
  );

  assert.equal(duplicateLikedPollCounterResult.rows[0]?.likes_count, 1);

  const duplicateLikeRowResult = await db.query<{ count: string }>(
    `
      SELECT count(*) AS count
      FROM likes
      WHERE user_id = $1
        AND poll_id = $2
    `,
    [registered.user.id, createdPoll.id]
  );

  assert.equal(duplicateLikeRowResult.rows[0]?.count, '1');
});

test('liking a poll requires authentication and an existing poll', async () => {
  const unauthorizedResponse = await app.inject({
    method: 'POST',
    url: '/polls/00000000-0000-0000-0000-000000000000/likes'
  });

  assert.equal(unauthorizedResponse.statusCode, 401, unauthorizedResponse.body);

  const registered = await registerTestUser();
  const missingPollResponse = await app.inject({
    method: 'POST',
    url: '/polls/00000000-0000-0000-0000-000000000000/likes',
    headers: bearer(registered.accessToken)
  });

  assert.equal(missingPollResponse.statusCode, 404, missingPollResponse.body);
});

test('current user can unlike a poll safely', async () => {
  const registered = await registerTestUser();

  const createPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'Should this poll be unliked?',
      options: ['Yes', 'No']
    }
  });

  assert.equal(createPollResponse.statusCode, 201, createPollResponse.body);

  const createdPoll = createPollResponse.json<PollResponse>().poll;

  const likeResponse = await app.inject({
    method: 'POST',
    url: `/polls/${createdPoll.id}/likes`,
    headers: bearer(registered.accessToken)
  });

  assert.equal(likeResponse.statusCode, 201, likeResponse.body);
  assert.equal(likeResponse.json<PollResponse>().poll.likesCount, 1);

  const unlikeResponse = await app.inject({
    method: 'DELETE',
    url: `/polls/${createdPoll.id}/likes`,
    headers: bearer(registered.accessToken)
  });

  assert.equal(unlikeResponse.statusCode, 200, unlikeResponse.body);
  const unlikedPoll = unlikeResponse.json<PollResponse>().poll;
  assert.equal(unlikedPoll.id, createdPoll.id);
  assert.equal(unlikedPoll.likesCount, 0);
  assert.equal(unlikedPoll.viewerHasLiked, false);

  const unlikedPollCounterResult = await db.query<{ likes_count: number }>(
    'SELECT likes_count FROM polls WHERE id = $1',
    [createdPoll.id]
  );

  assert.equal(unlikedPollCounterResult.rows[0]?.likes_count, 0);

  const likeRowResult = await db.query<{ count: string }>(
    `
      SELECT count(*) AS count
      FROM likes
      WHERE user_id = $1
        AND poll_id = $2
    `,
    [registered.user.id, createdPoll.id]
  );

  assert.equal(likeRowResult.rows[0]?.count, '0');

  const duplicateUnlikeResponse = await app.inject({
    method: 'DELETE',
    url: `/polls/${createdPoll.id}/likes`,
    headers: bearer(registered.accessToken)
  });

  assert.equal(duplicateUnlikeResponse.statusCode, 200, duplicateUnlikeResponse.body);
  const duplicateUnlikedPoll = duplicateUnlikeResponse.json<PollResponse>().poll;
  assert.equal(duplicateUnlikedPoll.id, createdPoll.id);
  assert.equal(duplicateUnlikedPoll.likesCount, 0);
  assert.equal(duplicateUnlikedPoll.viewerHasLiked, false);

  const duplicateUnlikedPollCounterResult = await db.query<{ likes_count: number }>(
    'SELECT likes_count FROM polls WHERE id = $1',
    [createdPoll.id]
  );

  assert.equal(duplicateUnlikedPollCounterResult.rows[0]?.likes_count, 0);
});

test('unliking a poll requires authentication and an existing poll', async () => {
  const unauthorizedResponse = await app.inject({
    method: 'DELETE',
    url: '/polls/00000000-0000-0000-0000-000000000000/likes'
  });

  assert.equal(unauthorizedResponse.statusCode, 401, unauthorizedResponse.body);

  const registered = await registerTestUser();
  const missingPollResponse = await app.inject({
    method: 'DELETE',
    url: '/polls/00000000-0000-0000-0000-000000000000/likes',
    headers: bearer(registered.accessToken)
  });

  assert.equal(missingPollResponse.statusCode, 404, missingPollResponse.body);
});

test('unliking a poll without a prior like is safe', async () => {
  const registered = await registerTestUser();

  const createPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'Can unlike be safe without a like?',
      options: ['Yes', 'Definitely']
    }
  });

  assert.equal(createPollResponse.statusCode, 201, createPollResponse.body);

  const createdPoll = createPollResponse.json<PollResponse>().poll;
  assert.equal(createdPoll.likesCount, 0);

  const unlikeResponse = await app.inject({
    method: 'DELETE',
    url: `/polls/${createdPoll.id}/likes`,
    headers: bearer(registered.accessToken)
  });

  assert.equal(unlikeResponse.statusCode, 200, unlikeResponse.body);
  assert.equal(unlikeResponse.json<PollResponse>().poll.likesCount, 0);

  const likeRowResult = await db.query<{ count: string }>(
    `
      SELECT count(*) AS count
      FROM likes
      WHERE user_id = $1
        AND poll_id = $2
    `,
    [registered.user.id, createdPoll.id]
  );

  assert.equal(likeRowResult.rows[0]?.count, '0');
});
