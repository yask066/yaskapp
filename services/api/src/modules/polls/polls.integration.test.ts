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
  };
  accessToken: string;
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
  };
};

type ListPollsResponse = {
  items: Array<{
    id: string;
  }>;
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
