import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  countryCatalogVersion,
  supportedCountryCodes
} from '../countries.js';

process.env.NODE_ENV = 'test';

const [
  { buildApp },
  { closeDatabaseConnection, db },
  { closeRedisConnection },
  { closeStorageConnection }
] = await Promise.all([
  import('../../app.js'),
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('../../config/storage.js')
]);

const app = buildApp();
app.get('/test-error-handler', async () => {
  throw new Error('sensitive internal detail');
});
const createdUserIds = new Set<string>();

test('country catalog contains unique uppercase ISO alpha-2 codes', () => {
  assert.equal(countryCatalogVersion, 1);
  assert.equal(new Set(supportedCountryCodes).size, supportedCountryCodes.length);
  assert.ok(supportedCountryCodes.every((code) => /^[A-Z]{2}$/.test(code)));
});

type AuthResponse = {
  user: {
    id: string;
    username: string;
    profile: {
      displayName: string;
      bio: string | null;
      countryCode: string | null;
      avatarObjectKey: string | null;
      avatarUrl: string | null;
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
      countryCode: string | null;
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

type FollowResponse = {
  following: boolean;
  followerFollowingCount: number;
  followeeFollowersCount: number;
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
      displayName: 'Test User',
      countryCode: 'BY'
    }
  });

  assert.equal(response.statusCode, 201, response.body);

  const auth = response.json<AuthResponse>();
  assert.equal(auth.user.profile.countryCode, 'BY');
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

function multipartFileBody(
  boundary: string,
  fieldName: string,
  content: string | Buffer
) {
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="avatar.png"\r\n` +
      'Content-Type: image/png\r\n\r\n'
  );
  const body = typeof content === 'string' ? Buffer.from(content) : content;
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

  return Buffer.concat([header, body, footer]);
}

function animatedWebpBody() {
  const body = Buffer.alloc(12 + 8 + 10);

  body.write('RIFF', 0, 'ascii');
  body.writeUInt32LE(body.length - 8, 4);
  body.write('WEBP', 8, 'ascii');
  body.write('VP8X', 12, 'ascii');
  body.writeUInt32LE(10, 16);
  body[20] = 0x02;

  return body;
}

test('global error handler returns safe and consistent errors', async () => {
  const notFoundResponse = await app.inject({
    method: 'GET',
    url: '/route-that-does-not-exist'
  });

  assert.equal(notFoundResponse.statusCode, 404, notFoundResponse.body);
  assert.deepEqual(notFoundResponse.json(), {
    error: 'not_found',
    message: 'Route was not found.'
  });

  const malformedJsonResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: {
      'content-type': 'application/json'
    },
    payload: '{"email":'
  });

  assert.equal(malformedJsonResponse.statusCode, 400, malformedJsonResponse.body);
  assert.deepEqual(malformedJsonResponse.json(), {
    error: 'validation_error',
    message: 'Request input is invalid.'
  });

  const internalErrorResponse = await app.inject({
    method: 'GET',
    url: '/test-error-handler'
  });

  assert.equal(internalErrorResponse.statusCode, 500, internalErrorResponse.body);
  assert.deepEqual(internalErrorResponse.json(), {
    error: 'internal_server_error',
    message: 'An unexpected error occurred.'
  });
});

test('health endpoints report service status', async () => {
  const healthResponse = await app.inject({
    method: 'GET',
    url: '/health'
  });

  assert.equal(healthResponse.statusCode, 200, healthResponse.body);
  assert.deepEqual(healthResponse.json(), {
    status: 'ok',
    service: 'api'
  });

  const databaseHealthResponse = await app.inject({
    method: 'GET',
    url: '/health/db'
  });

  assert.equal(databaseHealthResponse.statusCode, 200, databaseHealthResponse.body);
  assert.equal(databaseHealthResponse.json<{ status: string }>().status, 'ok');

  const readinessResponse = await app.inject({
    method: 'GET',
    url: '/health/ready'
  });

  assert.ok([200, 503].includes(readinessResponse.statusCode), readinessResponse.body);

  if (readinessResponse.statusCode === 503) {
    assert.deepEqual(readinessResponse.json(), {
      status: 'unavailable',
      service: 'api'
    });
    return;
  }

  const readiness = readinessResponse.json<{
    status: string;
    database: { connected: boolean };
    redis: { connected: boolean };
    storage: { connected: boolean };
  }>();
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.database.connected, true);
  assert.equal(readiness.redis.connected, true);
  assert.equal(readiness.storage.connected, true);
});

test('authentication rejects invalid credentials and duplicate registration', async () => {
  const registered = await registerTestUser();

  const duplicateResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `${registered.user.username}@yaskapp.test`,
      username: registered.user.username,
      password: registered.password,
      countryCode: 'BY'
    }
  });

  assert.equal(duplicateResponse.statusCode, 409, duplicateResponse.body);
  assert.equal(duplicateResponse.json<{ error: string }>().error, 'conflict');

  const wrongPasswordResponse = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      login: registered.user.username,
      password: 'wrong-password'
    }
  });

  assert.equal(wrongPasswordResponse.statusCode, 401, wrongPasswordResponse.body);
  assert.equal(wrongPasswordResponse.json<{ error: string }>().error, 'unauthorized');
});

test('poll creation rejects invalid dates and option counts', async () => {
  const registered = await registerTestUser();

  const pastPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'This poll should be rejected.',
      options: ['Yes', 'No'],
      endsAt: '2020-01-01T00:00:00.000Z'
    }
  });

  assert.equal(pastPollResponse.statusCode, 400, pastPollResponse.body);

  const tooManyOptionsResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(registered.accessToken),
    payload: {
      question: 'This poll has too many options.',
      options: ['1', '2', '3', '4', '5', '6']
    }
  });

  assert.equal(tooManyOptionsResponse.statusCode, 400, tooManyOptionsResponse.body);
});

after(async () => {
  for (const userId of createdUserIds) {
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
  }

  await app.close();
  await closeDatabaseConnection();
  await closeRedisConnection();
  closeStorageConnection();
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
  assert.equal(login.user.profile.countryCode, 'BY');
  assert.ok(login.accessToken);

  const meResponse = await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: bearer(login.accessToken)
  });

  assert.equal(meResponse.statusCode, 200, meResponse.body);
  assert.equal(
    meResponse.json<AuthResponse>().user.profile.countryCode,
    'BY'
  );

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

test('request validation rejects unknown fields', async () => {
  const registerResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `strict_${uniqueSuffix()}@yaskapp.test`,
      username: `strict_${uniqueSuffix()}`,
      password: 'password123',
      unexpected: 'field'
    }
  });

  assert.equal(registerResponse.statusCode, 400, registerResponse.body);

  const pollsResponse = await app.inject({
    method: 'GET',
    url: '/polls?limit=5&unexpected=field'
  });

  assert.equal(pollsResponse.statusCode, 400, pollsResponse.body);
});

test('profile can be updated by the current user', async () => {
  const registered = await registerTestUser();

  const updateResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    headers: bearer(registered.accessToken),
    payload: {
      displayName: 'Updated Tester',
      bio: 'I test profile updates.',
      countryCode: 'pl'
    }
  });

  assert.equal(updateResponse.statusCode, 200, updateResponse.body);

  const updatedProfile = updateResponse.json<ProfileResponse>();
  assert.equal(updatedProfile.user.id, registered.user.id);
  assert.equal(updatedProfile.user.profile.displayName, 'Updated Tester');
  assert.equal(updatedProfile.user.profile.bio, 'I test profile updates.');
  assert.equal(updatedProfile.user.profile.countryCode, 'PL');

  const clearCountryResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    headers: bearer(registered.accessToken),
    payload: {
      countryCode: null
    }
  });

  assert.equal(clearCountryResponse.statusCode, 400, clearCountryResponse.body);

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

test('avatar upload requires authentication and a multipart file', async () => {
  const unauthorizedResponse = await app.inject({
    method: 'POST',
    url: '/profiles/me/avatar'
  });

  assert.equal(unauthorizedResponse.statusCode, 401, unauthorizedResponse.body);

  const invalidTokenResponse = await app.inject({
    method: 'POST',
    url: '/profiles/me/avatar',
    headers: bearer('invalid-token')
  });

  assert.equal(invalidTokenResponse.statusCode, 401, invalidTokenResponse.body);

  const registered = await registerTestUser();
  const missingFileResponse = await app.inject({
    method: 'POST',
    url: '/profiles/me/avatar',
    headers: {
      ...bearer(registered.accessToken),
      'content-type': 'multipart/form-data; boundary=avatar-test'
    },
    payload: '--avatar-test--\r\n'
  });

  assert.equal(missingFileResponse.statusCode, 400, missingFileResponse.body);

  const wrongFieldBoundary = 'wrong-avatar-field';
  const wrongFieldResponse = await app.inject({
    method: 'POST',
    url: '/profiles/me/avatar',
    headers: {
      ...bearer(registered.accessToken),
      'content-type': `multipart/form-data; boundary=${wrongFieldBoundary}`
    },
    payload: multipartFileBody(wrongFieldBoundary, 'file', 'not-an-avatar')
  });

  assert.equal(wrongFieldResponse.statusCode, 400, wrongFieldResponse.body);

  const tooLargeBoundary = 'too-large-avatar';
  const tooLargeResponse = await app.inject({
    method: 'POST',
    url: '/profiles/me/avatar',
    headers: {
      ...bearer(registered.accessToken),
      'content-type': `multipart/form-data; boundary=${tooLargeBoundary}`
    },
    payload: multipartFileBody(
      tooLargeBoundary,
      'avatar',
      'x'.repeat(5 * 1024 * 1024 + 1)
    )
  });

  assert.equal(tooLargeResponse.statusCode, 400, tooLargeResponse.body);
  assert.equal(tooLargeResponse.json<{ error: string }>().error, 'avatar_too_large');

  const unsupportedTypeBoundary = 'unsupported-avatar-type';
  const unsupportedTypeResponse = await app.inject({
    method: 'POST',
    url: '/profiles/me/avatar',
    headers: {
      ...bearer(registered.accessToken),
      'content-type': `multipart/form-data; boundary=${unsupportedTypeBoundary}`
    },
    payload: multipartFileBody(
      unsupportedTypeBoundary,
      'avatar',
      'not-an-image'
    ).toString().replace('Content-Type: image/png', 'Content-Type: text/plain')
  });

  assert.equal(unsupportedTypeResponse.statusCode, 400, unsupportedTypeResponse.body);
  assert.equal(
    unsupportedTypeResponse.json<{ error: string }>().error,
    'avatar_unsupported_type'
  );

  const invalidSignatureBoundary = 'invalid-avatar-signature';
  const invalidSignatureResponse = await app.inject({
    method: 'POST',
    url: '/profiles/me/avatar',
    headers: {
      ...bearer(registered.accessToken),
      'content-type': `multipart/form-data; boundary=${invalidSignatureBoundary}`
    },
    payload: multipartFileBody(
      invalidSignatureBoundary,
      'avatar',
      'not-a-png-file'
    )
  });

  assert.equal(invalidSignatureResponse.statusCode, 400, invalidSignatureResponse.body);
  assert.equal(
    invalidSignatureResponse.json<{ error: string }>().error,
    'avatar_unsupported_type'
  );

  const animatedBoundary = 'animated-avatar';
  const animatedResponse = await app.inject({
    method: 'POST',
    url: '/profiles/me/avatar',
    headers: {
      ...bearer(registered.accessToken),
      'content-type': `multipart/form-data; boundary=${animatedBoundary}`
    },
    payload: multipartFileBody(animatedBoundary, 'avatar', animatedWebpBody())
  });

  assert.equal(animatedResponse.statusCode, 400, animatedResponse.body);
  assert.equal(
    animatedResponse.json<{ error: string }>().error,
    'avatar_unsupported_type'
  );
});

test('avatar deletion requires authentication and is idempotent', async () => {
  const unauthorizedResponse = await app.inject({
    method: 'DELETE',
    url: '/profiles/me/avatar'
  });

  assert.equal(unauthorizedResponse.statusCode, 401, unauthorizedResponse.body);

  const invalidTokenResponse = await app.inject({
    method: 'DELETE',
    url: '/profiles/me/avatar',
    headers: bearer('invalid-token')
  });

  assert.equal(invalidTokenResponse.statusCode, 401, invalidTokenResponse.body);

  const registered = await registerTestUser();
  const firstDeleteResponse = await app.inject({
    method: 'DELETE',
    url: '/profiles/me/avatar',
    headers: bearer(registered.accessToken)
  });

  assert.equal(firstDeleteResponse.statusCode, 200, firstDeleteResponse.body);
  assert.doesNotMatch(
    firstDeleteResponse.body,
    /passwordHash|password_hash|JWT_SECRET|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|secretAccessKey/
  );
  assert.equal(
    firstDeleteResponse.json<AuthResponse>().user.profile.avatarObjectKey,
    null
  );

  const secondDeleteResponse = await app.inject({
    method: 'DELETE',
    url: '/profiles/me/avatar',
    headers: bearer(registered.accessToken)
  });

  assert.equal(secondDeleteResponse.statusCode, 200, secondDeleteResponse.body);
  assert.equal(
    secondDeleteResponse.json<AuthResponse>().user.profile.avatarObjectKey,
    null
  );
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

  const unsupportedCountryResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    headers: bearer(registered.accessToken),
    payload: {
      countryCode: 'ZZ'
    }
  });

  assert.equal(
    unsupportedCountryResponse.statusCode,
    400,
    unsupportedCountryResponse.body
  );
});

test('profile update requires at least one known field', async () => {
  const registered = await registerTestUser();

  const emptyResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    headers: bearer(registered.accessToken),
    payload: {}
  });

  assert.equal(emptyResponse.statusCode, 400, emptyResponse.body);

  const unknownResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    headers: bearer(registered.accessToken),
    payload: { headline: 'Unknown field' }
  });

  assert.equal(unknownResponse.statusCode, 400, unknownResponse.body);
});

test('public profile returns safe data and viewer relationship state', async () => {
  const viewer = await registerTestUser();
  const target = await registerTestUser();

  const emptyAvatarProfileResponse = await app.inject({
    method: 'GET',
    url: `/users/${target.user.id}`
  });
  const emptyAvatarProfile = emptyAvatarProfileResponse.json<{
    user: { profile: { avatarObjectKey: string | null; avatarUrl: string | null } };
  }>().user;
  assert.equal(emptyAvatarProfile.profile.avatarObjectKey, null);
  assert.equal(emptyAvatarProfile.profile.avatarUrl, null);

  const missingAvatarResponse = await app.inject({
    method: 'GET',
    url: `/media/avatars/${target.user.id}`
  });
  assert.equal(missingAvatarResponse.statusCode, 404, missingAvatarResponse.body);

  await db.query(
    'UPDATE profiles SET avatar_object_key = $2 WHERE user_id = $1',
    [target.user.id, 'avatars/target/opaque-key.webp']
  );

  const createdPollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(target.accessToken),
    payload: {
      question: 'A poll visible on a public profile?',
      options: ['Yes', 'Not yet']
    }
  });
  assert.equal(createdPollResponse.statusCode, 201, createdPollResponse.body);
  const createdPoll = createdPollResponse.json<PollResponse>().poll;

  const anonymousResponse = await app.inject({
    method: 'GET',
    url: `/users/${target.user.id}`
  });

  assert.equal(anonymousResponse.statusCode, 200, anonymousResponse.body);
  const anonymousProfile = anonymousResponse.json<{
    user: {
      id: string;
      username: string;
      viewerIsFollowing: boolean;
      profile: {
        followersCount: number;
        countryCode: string | null;
        avatarObjectKey: string | null;
        avatarUrl: string | null;
      };
      email?: string;
    };
  }>().user;
  assert.equal(anonymousProfile.id, target.user.id);
  assert.equal(anonymousProfile.username, target.user.username);
  assert.equal(anonymousProfile.viewerIsFollowing, false);
  assert.equal(anonymousProfile.profile.followersCount, 0);
  assert.equal(anonymousProfile.profile.countryCode, 'BY');
  assert.equal(anonymousProfile.profile.avatarObjectKey, 'avatars/target/opaque-key.webp');
  assert.equal(
    anonymousProfile.profile.avatarUrl,
    `/media/avatars/${target.user.id}`
  );
  assert.equal(anonymousProfile.email, undefined);

  const publicPollsResponse = await app.inject({
    method: 'GET',
    url: `/users/${target.user.id}/polls`
  });
  assert.equal(publicPollsResponse.statusCode, 200, publicPollsResponse.body);
  const publicPolls = publicPollsResponse.json<{ items: PollResponse['poll'][] }>();
  assert.ok(publicPolls.items.some((poll) => poll.id === createdPoll.id));

  const followResponse = await app.inject({
    method: 'POST',
    url: `/users/${target.user.id}/follow`,
    headers: bearer(viewer.accessToken)
  });
  assert.equal(followResponse.statusCode, 201, followResponse.body);

  const authenticatedResponse = await app.inject({
    method: 'GET',
    url: `/users/${target.user.id}`,
    headers: bearer(viewer.accessToken)
  });

  assert.equal(authenticatedResponse.statusCode, 200, authenticatedResponse.body);
  const authenticatedProfile = authenticatedResponse.json<{
    user: { viewerIsFollowing: boolean; profile: { followersCount: number } };
  }>().user;
  assert.equal(authenticatedProfile.viewerIsFollowing, true);
  assert.equal(authenticatedProfile.profile.followersCount, 1);

  const missingResponse = await app.inject({
    method: 'GET',
    url: '/users/00000000-0000-0000-0000-000000000000'
  });
  assert.equal(missingResponse.statusCode, 404, missingResponse.body);

  const invalidParamsResponse = await app.inject({
    method: 'GET',
    url: '/users/not-a-uuid'
  });
  assert.equal(invalidParamsResponse.statusCode, 400, invalidParamsResponse.body);
});

test('legacy users without a country remain compatible', async () => {
  const registered = await registerTestUser();

  await db.query(
    'UPDATE profiles SET country_code = NULL WHERE user_id = $1',
    [registered.user.id]
  );

  const legacyUpdateResponse = await app.inject({
    method: 'PATCH',
    url: '/profiles/me',
    headers: bearer(registered.accessToken),
    payload: {
      countryCode: null
    }
  });

  assert.equal(legacyUpdateResponse.statusCode, 200, legacyUpdateResponse.body);

  const meResponse = await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: bearer(registered.accessToken)
  });

  assert.equal(meResponse.statusCode, 200, meResponse.body);
  assert.equal(
    meResponse.json<AuthResponse>().user.profile.countryCode,
    null
  );
});

test('following and followers lists return stable public profiles', async () => {
  const viewer = await registerTestUser();
  const followedUser = await registerTestUser();
  const secondFollower = await registerTestUser();

  const followViewerResponse = await app.inject({
    method: 'POST',
    url: `/users/${followedUser.user.id}/follow`,
    headers: bearer(viewer.accessToken)
  });
  assert.equal(followViewerResponse.statusCode, 201, followViewerResponse.body);

  const followSecondResponse = await app.inject({
    method: 'POST',
    url: `/users/${followedUser.user.id}/follow`,
    headers: bearer(secondFollower.accessToken)
  });
  assert.equal(followSecondResponse.statusCode, 201, followSecondResponse.body);

  const followingResponse = await app.inject({
    method: 'GET',
    url: '/profiles/me/following?limit=10',
    headers: bearer(viewer.accessToken)
  });

  assert.equal(followingResponse.statusCode, 200, followingResponse.body);
  const following = followingResponse.json<{
    items: Array<{ id: string; username: string; viewerIsFollowing: boolean; email?: string }>;
  }>();
  assert.equal(following.items.length, 1);
  assert.equal(following.items[0]?.id, followedUser.user.id);
  assert.equal(following.items[0]?.username, followedUser.user.username);
  assert.equal(following.items[0]?.viewerIsFollowing, true);
  assert.equal(following.items[0]?.email, undefined);

  const followersResponse = await app.inject({
    method: 'GET',
    url: `/users/${followedUser.user.id}/followers?limit=10`,
    headers: bearer(viewer.accessToken)
  });

  assert.equal(followersResponse.statusCode, 200, followersResponse.body);
  const followers = followersResponse.json<{
    items: Array<{ id: string; viewerIsFollowing: boolean }>;
  }>();
  assert.equal(followers.items.length, 2);
  assert.ok(followers.items.some((item) => item.id === viewer.user.id));
  assert.ok(followers.items.some((item) => item.id === secondFollower.user.id));
  assert.equal(
    followers.items.find((item) => item.id === viewer.user.id)?.viewerIsFollowing,
    false
  );

  const unauthenticatedFollowersResponse = await app.inject({
    method: 'GET',
    url: `/users/${followedUser.user.id}/followers?limit=1`
  });
  assert.equal(unauthenticatedFollowersResponse.statusCode, 200);
  assert.equal(unauthenticatedFollowersResponse.json<{ items: unknown[] }>().items.length, 1);

  const invalidLimitResponse = await app.inject({
    method: 'GET',
    url: '/profiles/me/following?limit=0',
    headers: bearer(viewer.accessToken)
  });
  assert.equal(invalidLimitResponse.statusCode, 400, invalidLimitResponse.body);

  const missingFollowersResponse = await app.inject({
    method: 'GET',
    url: '/users/00000000-0000-0000-0000-000000000000/followers'
  });
  assert.equal(missingFollowersResponse.statusCode, 404, missingFollowersResponse.body);
});

test('subscription feed returns only public polls from followed users', async () => {
  const viewer = await registerTestUser();
  const followedAuthor = await registerTestUser();
  const unfollowedAuthor = await registerTestUser();

  const followResponse = await app.inject({
    method: 'POST',
    url: `/users/${followedAuthor.user.id}/follow`,
    headers: bearer(viewer.accessToken)
  });

  assert.equal(followResponse.statusCode, 201, followResponse.body);

  async function createPoll(author: AuthResponse, question: string, visibility?: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/polls',
      headers: bearer(author.accessToken),
      payload: {
        question,
        options: ['Yes', 'No'],
        ...(visibility ? { visibility } : {})
      }
    });

    assert.equal(response.statusCode, 201, response.body);
    return response.json<PollResponse>().poll;
  }

  const followedPublicPoll = await createPoll(followedAuthor, 'Followed public poll');
  const followedPrivatePoll = await createPoll(
    followedAuthor,
    'Followed private poll',
    'private'
  );
  const unfollowedPublicPoll = await createPoll(
    unfollowedAuthor,
    'Unfollowed public poll'
  );

  const unauthenticatedResponse = await app.inject({
    method: 'GET',
    url: '/polls/subscriptions'
  });
  assert.equal(unauthenticatedResponse.statusCode, 401, unauthenticatedResponse.body);

  const emptyFeedResponse = await app.inject({
    method: 'GET',
    url: '/polls/subscriptions?limit=10',
    headers: bearer(unfollowedAuthor.accessToken)
  });
  assert.equal(emptyFeedResponse.statusCode, 200, emptyFeedResponse.body);
  assert.deepEqual(emptyFeedResponse.json<ListPollsResponse>().items, []);

  const subscriptionResponse = await app.inject({
    method: 'GET',
    url: '/polls/subscriptions?limit=10',
    headers: bearer(viewer.accessToken)
  });
  assert.equal(subscriptionResponse.statusCode, 200, subscriptionResponse.body);

  const subscriptionPolls = subscriptionResponse.json<ListPollsResponse>().items;
  assert.deepEqual(
    subscriptionPolls.map((poll) => poll.id),
    [followedPublicPoll.id]
  );
  assert.equal(subscriptionPolls[0]?.viewerHasLiked, false);
  assert.equal(subscriptionPolls.some((poll) => poll.id === followedPrivatePoll.id), false);
  assert.equal(subscriptionPolls.some((poll) => poll.id === unfollowedPublicPoll.id), false);

  const unfollowResponse = await app.inject({
    method: 'DELETE',
    url: `/users/${followedAuthor.user.id}/follow`,
    headers: bearer(viewer.accessToken)
  });
  assert.equal(unfollowResponse.statusCode, 200, unfollowResponse.body);

  const refreshedResponse = await app.inject({
    method: 'GET',
    url: '/polls/subscriptions?limit=10',
    headers: bearer(viewer.accessToken)
  });
  assert.equal(refreshedResponse.statusCode, 200, refreshedResponse.body);
  assert.deepEqual(refreshedResponse.json<ListPollsResponse>().items, []);

  const invalidLimitResponse = await app.inject({
    method: 'GET',
    url: '/polls/subscriptions?limit=51',
    headers: bearer(viewer.accessToken)
  });
  assert.equal(invalidLimitResponse.statusCode, 400, invalidLimitResponse.body);
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

test('users can follow and unfollow safely', async () => {
  const follower = await registerTestUser();
  const followee = await registerTestUser();

  const unauthenticatedResponse = await app.inject({
    method: 'POST',
    url: `/users/${followee.user.id}/follow`
  });

  assert.equal(unauthenticatedResponse.statusCode, 401);

  const followResponse = await app.inject({
    method: 'POST',
    url: `/users/${followee.user.id}/follow`,
    headers: bearer(follower.accessToken)
  });

  assert.equal(followResponse.statusCode, 201, followResponse.body);
  assert.deepEqual(followResponse.json<FollowResponse>(), {
    following: true,
    followerFollowingCount: 1,
    followeeFollowersCount: 1
  });

  const duplicateFollowResponse = await app.inject({
    method: 'POST',
    url: `/users/${followee.user.id}/follow`,
    headers: bearer(follower.accessToken)
  });

  assert.equal(duplicateFollowResponse.statusCode, 201);
  assert.deepEqual(duplicateFollowResponse.json<FollowResponse>(), {
    following: true,
    followerFollowingCount: 1,
    followeeFollowersCount: 1
  });

  const selfFollowResponse = await app.inject({
    method: 'POST',
    url: `/users/${follower.user.id}/follow`,
    headers: bearer(follower.accessToken)
  });

  assert.equal(selfFollowResponse.statusCode, 400);

  const unfollowResponse = await app.inject({
    method: 'DELETE',
    url: `/users/${followee.user.id}/follow`,
    headers: bearer(follower.accessToken)
  });

  assert.equal(unfollowResponse.statusCode, 200, unfollowResponse.body);
  assert.deepEqual(unfollowResponse.json<FollowResponse>(), {
    following: false,
    followerFollowingCount: 0,
    followeeFollowersCount: 0
  });

  const duplicateUnfollowResponse = await app.inject({
    method: 'DELETE',
    url: `/users/${followee.user.id}/follow`,
    headers: bearer(follower.accessToken)
  });

  assert.equal(duplicateUnfollowResponse.statusCode, 200);
  assert.deepEqual(duplicateUnfollowResponse.json<FollowResponse>(), {
    following: false,
    followerFollowingCount: 0,
    followeeFollowersCount: 0
  });
});

test('follow graph hides deleted targets consistently', async () => {
  const follower = await registerTestUser();
  const deletedTarget = await registerTestUser();

  await db.query('UPDATE users SET deleted_at = now() WHERE id = $1', [deletedTarget.user.id]);

  const followResponse = await app.inject({
    method: 'POST',
    url: `/users/${deletedTarget.user.id}/follow`,
    headers: bearer(follower.accessToken)
  });
  assert.equal(followResponse.statusCode, 404, followResponse.body);
  assert.equal(followResponse.json<{ error: string }>().error, 'not_found');

  const unfollowResponse = await app.inject({
    method: 'DELETE',
    url: `/users/${deletedTarget.user.id}/follow`,
    headers: bearer(follower.accessToken)
  });
  assert.equal(unfollowResponse.statusCode, 404, unfollowResponse.body);
  assert.equal(unfollowResponse.json<{ error: string }>().error, 'not_found');
});

test('concurrent follow and unfollow requests keep counters consistent', async () => {
  const follower = await registerTestUser();
  const followee = await registerTestUser();
  const followUrl = `/users/${followee.user.id}/follow`;

  const followResponses = await Promise.all(
    Array.from({ length: 8 }, () =>
      app.inject({
        method: 'POST',
        url: followUrl,
        headers: bearer(follower.accessToken)
      })
    )
  );

  assert.ok(followResponses.every((response) => response.statusCode === 201));

  const followedCounts = await db.query<{
    follower_following_count: number;
    followee_followers_count: number;
    relationship_count: string;
  }>(
    `
      SELECT
        (SELECT following_count FROM profiles WHERE user_id = $1) AS follower_following_count,
        (SELECT followers_count FROM profiles WHERE user_id = $2) AS followee_followers_count,
        (SELECT count(*)::text FROM follows WHERE follower_id = $1 AND followee_id = $2)
          AS relationship_count
    `,
    [follower.user.id, followee.user.id]
  );

  assert.equal(followedCounts.rows[0]?.follower_following_count, 1);
  assert.equal(followedCounts.rows[0]?.followee_followers_count, 1);
  assert.equal(followedCounts.rows[0]?.relationship_count, '1');

  const unfollowResponses = await Promise.all(
    Array.from({ length: 8 }, () =>
      app.inject({
        method: 'DELETE',
        url: followUrl,
        headers: bearer(follower.accessToken)
      })
    )
  );

  assert.ok(unfollowResponses.every((response) => response.statusCode === 200));

  const unfollowedCounts = await db.query<{
    follower_following_count: number;
    followee_followers_count: number;
    relationship_count: string;
  }>(
    `
      SELECT
        (SELECT following_count FROM profiles WHERE user_id = $1) AS follower_following_count,
        (SELECT followers_count FROM profiles WHERE user_id = $2) AS followee_followers_count,
        (SELECT count(*)::text FROM follows WHERE follower_id = $1 AND followee_id = $2)
          AS relationship_count
    `,
    [follower.user.id, followee.user.id]
  );

  assert.equal(unfollowedCounts.rows[0]?.follower_following_count, 0);
  assert.equal(unfollowedCounts.rows[0]?.followee_followers_count, 0);
  assert.equal(unfollowedCounts.rows[0]?.relationship_count, '0');
});
