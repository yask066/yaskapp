import { ApiError } from './client';
import type { NotificationItem, NotificationRealtimeEventV1, NotificationType } from '@yaskapp/shared';

export type { NotificationItem, NotificationRealtimeEventV1, NotificationType } from '@yaskapp/shared';

export type NotificationListResponse = {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
};

export type NotificationPreferences = Record<NotificationType, { inApp: boolean; push: boolean }>;
export type NotificationPreferencesPatch = Partial<Record<NotificationType, Partial<{ inApp: boolean; push: boolean }>>>;

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
  stateRevisions?: PollStateRevisions;
  /** Decoder presence metadata; absent viewer keys are not confirmations. */
  viewerState?: { hasLiked?: boolean; voteOptionId?: string | null };
  /** Client-only independent viewer watermarks. */
  viewerStateRevisions?: { hasLiked?: string; voteOptionId?: string };
}

export interface PollStateRevisions { votes?: string; likes?: string; comments?: string }

export interface PollComment {
  id: string;
  pollId: string;
  author: PollAuthor;
  body: string;
  likesCount: number;
  viewerHasLiked: boolean;
  parentCommentId: string | null;
  repliesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PollCommentRepliesPage {
  items: PollComment[];
  nextCursor: string | null;
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

function timestamp(value: unknown): string {
  const parsed = string(value);
  if (!Number.isFinite(Date.parse(parsed))) invalidResponse('The server returned an invalid timestamp.');
  return parsed;
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
  const revisions = source.stateRevisions === undefined ? undefined : object(source.stateRevisions);
  const stateRevisions = revisions ? {
    votes: revision(revisions.votes), likes: revision(revisions.likes), comments: revision(revisions.comments),
  } : undefined;
  const options = array(source.options).map(decodePollOption);
  const votesCount = number(source.votesCount);
  const commentsCount = number(source.commentsCount);
  const likesCount = number(source.likesCount);
  const viewerVoteOptionId = nullableString(source.viewerVoteOptionId);
  if (!Number.isSafeInteger(votesCount) || votesCount < 0 || !Number.isSafeInteger(commentsCount) || commentsCount < 0 ||
    !Number.isSafeInteger(likesCount) || likesCount < 0 || new Set(options.map((option) => option.id)).size !== options.length ||
    options.some((option) => !Number.isSafeInteger(option.votesCount) || option.votesCount < 0) ||
    options.reduce((sum, option) => sum + option.votesCount, 0) !== votesCount ||
    (viewerVoteOptionId !== null && !options.some((option) => option.id === viewerVoteOptionId))) invalidResponse();
  const decoded: Poll = {
    id: string(source.id), author: decodePollAuthor(source.author), question: string(source.question), imageUrl: nullableString(source.imageUrl),
    options, votesCount, commentsCount,
    likesCount, viewerHasLiked: boolean(source.viewerHasLiked), allowVoteCancellation: boolean(source.allowVoteCancellation),
    createdAt: string(source.createdAt), viewerVoteOptionId, endsAt: nullableString(source.endsAt),
    ...(stateRevisions ? { stateRevisions } : {}),
  };
  Object.defineProperty(decoded, 'viewerState', {
    value: {
      ...(Object.hasOwn(source, 'viewerHasLiked') ? { hasLiked: boolean(source.viewerHasLiked) } : {}),
      ...(Object.hasOwn(source, 'viewerVoteOptionId') ? { voteOptionId: nullableString(source.viewerVoteOptionId) } : {}),
    },
    enumerable: false,
  });
  return decoded;
}

function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 9223372036854775807n) invalidResponse();
  return value;
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
  return {
    id: string(source.id),
    pollId: string(source.pollId),
    author: decodePollAuthor(source.author),
    body: string(source.body),
    likesCount: number(source.likesCount),
    viewerHasLiked: boolean(source.viewerHasLiked),
    parentCommentId: nullableString(source.parentCommentId),
    repliesCount: source.repliesCount === undefined ? 0 : number(source.repliesCount),
    createdAt: string(source.createdAt),
    updatedAt: string(source.updatedAt),
  };
}

export function decodePollCommentRepliesPage(value: unknown): PollCommentRepliesPage {
  const source = object(value);
  return {
    items: array(source.items).map(decodePollComment),
    nextCursor: nullableString(source.nextCursor),
  };
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

export function decodeNotificationItem(value: unknown): NotificationItem {
  const source = object(value);
  const type = source.type;
  if (type !== 'poll_vote' && type !== 'comment' && type !== 'comment_reply' && type !== 'like' && type !== 'follow') invalidResponse();
  const targetType = source.targetType;
  if (targetType !== 'poll' && targetType !== 'comment' && targetType !== 'profile') invalidResponse();
  let actor: NotificationItem['actor'] = null;
  if (source.actor !== null && source.actor !== undefined) {
    const actorSource = object(source.actor);
    actor = {
      id: string(actorSource.id),
      username: string(actorSource.username),
      displayName: string(actorSource.displayName),
      avatarUrl: nullableString(actorSource.avatarUrl),
    };
  }
  return {
    id: string(source.id),
    type,
    actor,
    targetType,
    pollId: nullableString(source.pollId),
    commentId: nullableString(source.commentId),
    payload: object(source.payload),
    readAt: source.readAt === null || source.readAt === undefined ? null : timestamp(source.readAt),
    createdAt: timestamp(source.createdAt),
    isTargetAvailable: boolean(source.isTargetAvailable),
  };
}

export function decodeNotificationListResponse(value: unknown): NotificationListResponse {
  const source = object(value);
  return {
    items: array(source.items).map(decodeNotificationItem),
    nextCursor: nullableString(source.nextCursor),
    unreadCount: number(source.unreadCount),
  };
}

export function decodeNotificationPreferences(value: unknown): NotificationPreferences {
  const source = object(value);
  const types: NotificationType[] = ['poll_vote', 'comment', 'comment_reply', 'like', 'follow'];
  return Object.fromEntries(types.map((type) => {
    const preference = object(source[type]);
    return [type, { inApp: boolean(preference.inApp), push: boolean(preference.push) }];
  })) as NotificationPreferences;
}

export function decodeUnreadCount(value: unknown): { unreadCount: number } {
  const source = object(value);
  return { unreadCount: number(source.unreadCount) };
}

export function decodeNotificationRead(value: unknown): { notificationId: string; readAt: string; unreadCount: number } {
  const source = object(value);
  return { notificationId: string(source.notificationId), readAt: timestamp(source.readAt), unreadCount: number(source.unreadCount) };
}

export function decodeNotificationsReadAll(value: unknown): { readAt: string; updatedCount: number; unreadCount: 0 } {
  const source = object(value);
  if (source.unreadCount !== 0) invalidResponse();
  return { readAt: timestamp(source.readAt), updatedCount: number(source.updatedCount), unreadCount: 0 };
}

export function decodeNotificationRealtimeEvent(value: unknown): NotificationRealtimeEventV1 {
  const source = object(value);
  if (source.version !== 1 || typeof source.type !== 'string') invalidResponse();
  if (source.type === 'notification.created') {
    const payload = object(source.payload);
    return { version: 1, type: source.type, payload: { notification: decodeNotificationItem(payload.notification), unreadCount: number(payload.unreadCount) } };
  }
  if (source.type === 'notification.read') {
    const payload = object(source.payload);
    return { version: 1, type: source.type, payload: { notificationId: string(payload.notificationId), readAt: timestamp(payload.readAt), unreadCount: number(payload.unreadCount) } };
  }
  if (source.type === 'notifications.read_all') {
    const payload = object(source.payload);
    if (payload.unreadCount !== 0) invalidResponse();
    return { version: 1, type: source.type, payload: { readAt: timestamp(payload.readAt), unreadCount: 0 } };
  }
  invalidResponse();
}

export const decodeRealtimeNotificationEvent = decodeNotificationRealtimeEvent;

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
