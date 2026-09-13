import { apiClient } from './client';
import { decodeAuthUser, decodeFollowRelationship, decodePoll, decodePublicProfile, responseField, responseItems, type AuthUser, type FollowRelationship, type Poll, type PublicProfile } from './models';

export function getPublicProfile(userId: string): Promise<PublicProfile> {
  return apiClient.get(`/users/${userId}`, (body) => responseField(body, 'user', decodePublicProfile));
}

export function listPopularUsers(limit = 3): Promise<PublicProfile[]> {
  return apiClient.get(`/users?sort=popular&limit=${limit}`, (body) => responseItems(body, decodePublicProfile));
}

export function listUserPolls(userId: string): Promise<Poll[]> { return apiClient.get(`/users/${userId}/polls?limit=20`, (body) => responseItems(body, decodePoll)); }
export function followUser(userId: string): Promise<FollowRelationship> { return apiClient.send(`/users/${userId}/follow`, { method: 'POST' }, decodeFollowRelationship); }
export function unfollowUser(userId: string): Promise<FollowRelationship> { return apiClient.send(`/users/${userId}/follow`, { method: 'DELETE' }, decodeFollowRelationship); }
export function getMyProfile(): Promise<AuthUser> { return apiClient.get('/profiles/me', (body) => responseField(body, 'user', decodeAuthUser)); }
export function updateMyProfile(input: { displayName?: string; bio?: string | null; countryCode?: string }): Promise<AuthUser> { return apiClient.send('/profiles/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, (body) => responseField(body, 'user', decodeAuthUser)); }
export function uploadAvatar(avatar: File): Promise<AuthUser> { const body = new FormData(); body.set('avatar', avatar); return apiClient.send('/profiles/me/avatar', { method: 'POST', body }, (value) => responseField(value, 'user', decodeAuthUser)); }
export function deleteAvatar(): Promise<AuthUser> { return apiClient.send('/profiles/me/avatar', { method: 'DELETE' }, (body) => responseField(body, 'user', decodeAuthUser)); }
