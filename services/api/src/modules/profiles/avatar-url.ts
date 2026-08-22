export function avatarUrlForUser(userId: string, objectKey: string | null) {
  return objectKey === null ? null : `/media/avatars/${userId}`;
}
