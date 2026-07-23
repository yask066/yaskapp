import { updateProfileRecord } from './profiles.repository.js';
import { listPollRecordsByAuthor } from '../polls/polls.repository.js';

export class ProfileNotFoundError extends Error {}

export type UpdateProfileInput = {
  userId: string;
  displayName?: string;
  bio?: string | null;
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

export async function updateProfile(input: UpdateProfileInput) {
  const user = await updateProfileRecord({
    userId: input.userId,
    displayName: normalizeOptionalText(input.displayName),
    ...('bio' in input ? { bio: normalizeNullableText(input.bio) ?? null } : {})
  });

  if (!user) {
    throw new ProfileNotFoundError('Profile was not found.');
  }

  return user;
}

export async function listMyPolls(userId: string, limit: number) {
  return listPollRecordsByAuthor(userId, limit, userId);
}
