import { ApiError } from './client';

export interface AuthUserProfile {
  displayName: string;
  pollsCount: number;
  followersCount: number;
  followingCount: number;
  countryCode: string | null;
  bio: string | null;
  avatarObjectKey: string | null;
  avatarUrl: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  status: string;
  profile: AuthUserProfile;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  tokenType: string;
  expiresIn: string;
}

export interface PollAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarObjectKey: string | null;
  avatarUrl: string | null;
}

export interface PollOption {
  id: string;
  text: string;
  position: number;
  votesCount: number;
}

export interface Poll {
  id: string;
  author: PollAuthor;
  question: string;
  imageUrl: string | null;
  options: PollOption[];
  votesCount: number;
  commentsCount: number;
  likesCount: number;
  viewerHasLiked: boolean;
  allowVoteCancellation: boolean;
  createdAt: string;
  viewerVoteOptionId: string | null;
  endsAt: string | null;
}

export interface PollComment {
  id: string;
  pollId: string;
  author: PollAuthor;
  body: string;
  likesCount: number;
  viewerHasLiked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfile {
  id: string;
  username: string;
  status: string;
  profile: AuthUserProfile;
  viewerIsFollowing: boolean;
}

export interface FollowRelationship {
  following: boolean;
  followerFollowingCount: number;
  followeeFollowersCount: number;
}

export type SearchResult =
  | { type: 'poll'; score: number; poll: Poll }
  | { type: 'user'; score: number; user: PublicProfile };

export interface SearchPage {
  items: SearchResult[];
  nextCursor: string | null;
}

type JsonObject = Record<string, unknown>;

function invalidResponse(message = 'The server returned an invalid response.'): never {
  throw new ApiError(502, 'invalid_response', message);
}

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
  return value as JsonObject;
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalidResponse();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return string(value);
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidResponse();
  return value;
}

function boolean(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') invalidResponse();
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalidResponse();
  return value;
}

export function decodeAuthUser(value: unknown): AuthUser {
  const source = object(value);
  const profile = object(source.profile);
  return {
    id: string(source.id),
    email: string(source.email),
    username: string(source.username),
    status: string(source.status),
    profile: {
      displayName: string(profile.displayName),
      pollsCount: number(profile.pollsCount ?? 0),
      followersCount: number(profile.followersCount ?? 0),
      followingCount: number(profile.followingCount ?? 0),
      countryCode: nullableString(profile.countryCode),
      bio: nullableString(profile.bio),
      avatarObjectKey: nullableString(profile.avatarObjectKey),
      avatarUrl: nullableString(profile.avatarUrl),
    },
  };
}

export function decodeAuthSession(value: unknown): AuthSession {
  const source = object(value);
  return {
    user: decodeAuthUser(source.user),
    accessToken: string(source.accessToken),
    tokenType: string(source.tokenType),
    expiresIn: string(source.expiresIn),
  };
}

export function decodePoll(value: unknown): Poll {
  const source = object(value);
  return {
    id: string(source.id), author: decodePollAuthor(source.author), question: string(source.question), imageUrl: nullableString(source.imageUrl),
    options: array(source.options).map(decodePollOption), votesCount: number(source.votesCount), commentsCount: number(source.commentsCount),
    likesCount: number(source.likesCount), viewerHasLiked: boolean(source.viewerHasLiked), allowVoteCancellation: boolean(source.allowVoteCancellation),
    createdAt: string(source.createdAt), viewerVoteOptionId: nullableString(source.viewerVoteOptionId), endsAt: nullableString(source.endsAt),
  };
}

function decodePollAuthor(value: unknown): PollAuthor {
  const source = object(value);
  return { id: string(source.id), username: string(source.username), displayName: string(source.displayName), avatarObjectKey: nullableString(source.avatarObjectKey), avatarUrl: nullableString(source.avatarUrl) };
}

function decodePollOption(value: unknown): PollOption {
  const source = object(value);
  return { id: string(source.id), text: string(source.text), position: number(source.position), votesCount: number(source.votesCount) };
}

export function decodePollComment(value: unknown): PollComment {
  const source = object(value);
  return { id: string(source.id), pollId: string(source.pollId), author: decodePollAuthor(source.author), body: string(source.body), likesCount: number(source.likesCount), viewerHasLiked: boolean(source.viewerHasLiked), createdAt: string(source.createdAt), updatedAt: string(source.updatedAt) };
}

export function decodePublicProfile(value: unknown): PublicProfile {
  const source = object(value);
  return { id: string(source.id), username: string(source.username), status: string(source.status), profile: decodeAuthUser({ ...source, email: '', profile: source.profile }).profile, viewerIsFollowing: boolean(source.viewerIsFollowing) };
}

export function decodeFollowRelationship(value: unknown): FollowRelationship {
  const source = object(value);
  return { following: boolean(source.following), followerFollowingCount: number(source.followerFollowingCount), followeeFollowersCount: number(source.followeeFollowersCount) };
}

export function decodeSearchPage(value: unknown): SearchPage {
  const source = object(value);
  return { items: array(source.items).map(decodeSearchResult), nextCursor: nullableString(source.nextCursor) };
}

function decodeSearchResult(value: unknown): SearchResult {
  const source = object(value);
  const score = number(source.score);
  if (source.type === 'poll') return { type: 'poll', score, poll: decodePoll(source.poll) };
  if (source.type === 'user') return { type: 'user', score, user: decodePublicProfile(source.user) };
  return invalidResponse();
}

export function responseField<T>(value: unknown, field: string, decoder: (input: unknown) => T): T {
  return decoder(object(value)[field]);
}

export function responseItems<T>(value: unknown, decoder: (input: unknown) => T): T[] {
  return array(object(value).items).map(decoder);
}
