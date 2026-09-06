import { apiClient } from './client';
import { decodePublicProfile, responseField, type PublicProfile } from './models';

export function getPublicProfile(userId: string): Promise<PublicProfile> {
  return apiClient.get(`/users/${userId}`, (body) => responseField(body, 'user', decodePublicProfile));
}
