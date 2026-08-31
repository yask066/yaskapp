import {
  findProfileCountryCode,
  findPublicProfileRecord,
  listFollowerRecords,
  listFollowingRecords,
  listPopularProfileRecords,
  updateProfileRecord
} from './profiles.repository.js';
import {
  followUserRecord,
  FollowRepositoryError,
  unfollowUserRecord
} from './follows.repository.js';
import {
  listPollRecordsByAuthor,
  listPublicPollRecordsByAuthor
} from '../polls/polls.repository.js';

export class ProfileNotFoundError extends Error {}
export class CountryClearNotAllowedError extends Error {}

export { FollowRepositoryError };

export type UpdateProfileInput = {
  userId: string;
  displayName?: string;
  bio?: string | null;
  countryCode?: string | null;
};

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === null) {
    return null;
  }

  return normalizeOptionalText(value);
}

function normalizeCountryCode(value: string | null | undefined) {
  if (value === null) {
    return null;
  }

  return value?.trim().toUpperCase();
}

export async function updateProfile(input: UpdateProfileInput) {
  if ('countryCode' in input && input.countryCode === null) {
    const currentCountryCode = await findProfileCountryCode(input.userId);

    if (currentCountryCode === undefined) {
      throw new ProfileNotFoundError('Profile was not found.');
    }

    if (currentCountryCode !== null) {
      throw new CountryClearNotAllowedError(
        'Country cannot be cleared after it has been selected.'
      );
    }
  }

  const user = await updateProfileRecord({
    userId: input.userId,
    displayName: normalizeOptionalText(input.displayName),
    ...('bio' in input ? { bio: normalizeNullableText(input.bio) ?? null } : {}),
    ...('countryCode' in input
      ? { countryCode: normalizeCountryCode(input.countryCode) ?? null }
      : {})
  });

  if (!user) {
    throw new ProfileNotFoundError('Profile was not found.');
  }

  return user;
}

export async function getPublicProfile(userId: string, viewerId?: string) {
  const profile = await findPublicProfileRecord(userId, viewerId);

  if (!profile) {
    throw new ProfileNotFoundError('Profile was not found.');
  }

  return profile;
}

export async function listFollowing(userId: string, limit: number) {
  return listFollowingRecords(userId, limit);
}

export async function listPopularUsers(viewerId: string | undefined, limit: number) {
  return listPopularProfileRecords(viewerId, limit);
}

export async function listFollowers(
  userId: string,
  viewerId: string | undefined,
  limit: number
) {
  const profile = await findPublicProfileRecord(userId, viewerId);

  if (!profile) {
    throw new ProfileNotFoundError('Profile was not found.');
  }

  return listFollowerRecords(userId, viewerId, limit);
}

export async function listMyPolls(userId: string, limit: number) {
  return listPollRecordsByAuthor(userId, limit, userId);
}

export async function listUserPolls(
  userId: string,
  limit: number,
  viewerId?: string
) {
  const profile = await findPublicProfileRecord(userId, viewerId);

  if (!profile) {
    throw new ProfileNotFoundError('Profile was not found.');
  }

  return listPublicPollRecordsByAuthor(userId, limit, viewerId);
}

export async function followUser(followerId: string, followeeId: string) {
  return followUserRecord({ followerId, followeeId });
}

export async function unfollowUser(followerId: string, followeeId: string) {
  return unfollowUserRecord({ followerId, followeeId });
}
