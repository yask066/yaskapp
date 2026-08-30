import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../config/env.js';
import { db } from '../../config/database.js';
import { avatarUrlForUser } from '../profiles/avatar-url.js';
import type {
  SearchCursor,
  SearchInput,
  SearchPollRecord,
  SearchPollRow,
  SearchUserRecord,
  SearchUserRow
} from './search.types.js';

export type { SearchInput as SearchRepositoryInput } from './search.types.js';

type Query = { text: string; values: unknown[] };

function normalizedQuery(query: string) {
  return query.trim().replace(/\s+/g, ' ');
}

function escapeLikePattern(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function cursorPredicate(
  expression: string,
  cursor: SearchCursor | undefined,
  values: unknown[],
  dateColumn: string,
  idColumn: string
) {
  if (!cursor) return '';

  if (cursor.score === undefined) {
    values.push(cursor.createdAt, cursor.id);
    return `AND (${dateColumn}, ${idColumn}) < ($${values.length - 1}, $${values.length})`;
  }

  values.push(cursor.score, cursor.createdAt, cursor.id);
  return `AND (${expression}, ${dateColumn}, ${idColumn}) < ($${values.length - 2}, $${values.length - 1}, $${values.length})`;
}

const pollScore = `(
  CASE WHEN lower(p.question) = lower($1) THEN 1 ELSE 0 END
  + ts_rank_cd(to_tsvector('simple', p.question), plainto_tsquery('simple', $1))
)`;

const pollPopularityScore = `(
  p.votes_count * 2
  + p.likes_count * 1.5
  + p.comments_count
)`;

const userScore = `(
  CASE WHEN lower(u.username::text) = lower($1) THEN 1 ELSE 0 END
  + CASE WHEN lower(pr.display_name) = lower($1) THEN 0.8 ELSE 0 END
  + GREATEST(similarity(u.username::text, $1), similarity(pr.display_name, $1))
)`;

const userPopularityScore = '(pr.followers_count * 2 + pr.polls_count)';

export function buildPollSearchQuery(input: SearchInput): Query {
  const query = normalizedQuery(input.query);
  const values: unknown[] = [query, input.viewerId];
  const scoreExpression = input.sort === 'popular' ? pollPopularityScore : pollScore;
  const cursor = cursorPredicate(scoreExpression, input.cursor, values, 'p.created_at', 'p.id');
  const orderBy = input.sort === 'newest'
    ? 'p.created_at DESC, p.id DESC'
    : `${scoreExpression} DESC, p.created_at DESC, p.id DESC`;

  if (input.sort === 'newest' && input.cursor?.score !== undefined) {
    throw new Error('Newest search cursors must not contain a score.');
  }

  const limitPlaceholder = `$${values.length + 1}`;
  values.push(input.limit + 1);

  return {
    text: `
      SELECT
        p.id,
        p.author_id,
        u.username::text AS author_username,
        pr.display_name AS author_display_name,
        pr.avatar_object_key AS author_avatar_object_key,
        p.question,
        p.description,
        p.image_object_key,
        p.visibility,
        p.options_count,
        p.votes_count,
        p.comments_count,
        p.likes_count,
        p.allow_vote_cancellation,
        p.created_at,
        p.updated_at,
        p.ends_at,
        ${scoreExpression} AS score
      FROM polls p
      JOIN users u ON u.id = p.author_id
      JOIN profiles pr ON pr.user_id = p.author_id
      WHERE p.deleted_at IS NULL
        AND p.visibility = 'public'
        AND u.status = 'active'
        AND u.deleted_at IS NULL
        AND to_tsvector('simple', p.question) @@ plainto_tsquery('simple', $1)
        ${cursor}
      ORDER BY ${orderBy}
      LIMIT ${limitPlaceholder}
    `,
    values
  };
}

export function buildUserSearchQuery(input: SearchInput): Query {
  const query = normalizedQuery(input.query);
  const likeQuery = `%${escapeLikePattern(query)}%`;
  const values: unknown[] = [query, likeQuery, likeQuery, input.viewerId];
  const scoreExpression = input.sort === 'popular' ? userPopularityScore : userScore;
  const cursor = cursorPredicate(scoreExpression, input.cursor, values, 'u.created_at', 'u.id');
  const orderBy = input.sort === 'newest'
    ? 'u.created_at DESC, u.id DESC'
    : input.sort === 'popular'
      ? `${userPopularityScore} DESC, u.created_at DESC, u.id DESC`
      : `${scoreExpression} DESC, u.created_at DESC, u.id DESC`;
  const limitPlaceholder = `$${values.length + 1}`;
  values.push(input.limit + 1);

  return {
    text: `
      SELECT
        u.id,
        u.username::text AS username,
        u.status,
        u.created_at,
        u.updated_at,
        pr.display_name,
        pr.bio,
        pr.country_code,
        pr.avatar_object_key,
        pr.polls_count,
        pr.followers_count,
        pr.following_count,
        ($4::uuid IS NOT NULL AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = $4::uuid AND f.followee_id = u.id
        )) AS viewer_is_following,
        ${scoreExpression} AS score
      FROM users u
      JOIN profiles pr ON pr.user_id = u.id
      WHERE u.status = 'active'
        AND u.deleted_at IS NULL
        AND (u.username::text ILIKE $2 ESCAPE '\\' OR pr.display_name ILIKE $3 ESCAPE '\\')
        ${cursor}
      ORDER BY ${orderBy}
      LIMIT ${limitPlaceholder}
    `,
    values
  };
}

export function encodeSearchCursor(cursor: SearchCursor) {
  const payload = Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  const signature = createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeSearchCursor(
  value: string,
  expected?: { query: string; type: SearchInput['type']; sort: SearchInput['sort'] }
): SearchCursor {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) {
    throw new Error('Invalid search cursor.');
  }

  const expectedSignature = createHmac('sha256', env.JWT_SECRET)
    .update(payload)
    .digest();
  const actualSignature = Buffer.from(signature, 'base64url');
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error('Invalid search cursor.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid search cursor.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid search cursor.');
  }

  const cursor = parsed as Record<string, unknown>;
  if (
    typeof cursor.createdAt !== 'string' ||
    Number.isNaN(Date.parse(cursor.createdAt)) ||
    typeof cursor.id !== 'string' ||
    cursor.id.trim().length === 0 ||
    ('score' in cursor && (typeof cursor.score !== 'number' || !Number.isFinite(cursor.score)))
  ) {
    throw new Error('Invalid search cursor.');
  }

  const hasContext = 'query' in cursor || 'type' in cursor || 'sort' in cursor;
  if (hasContext && (
    typeof cursor.query !== 'string' ||
    !['all', 'polls', 'users'].includes(cursor.type as string) ||
    !['relevance', 'newest', 'popular'].includes(cursor.sort as string)
  )) {
    throw new Error('Invalid search cursor.');
  }

  if (expected && (
    cursor.query !== expected.query ||
    cursor.type !== expected.type ||
    cursor.sort !== expected.sort
  )) {
    throw new Error('Invalid search cursor.');
  }

  return cursor as SearchCursor;
}

export function mapPollSearchRow(row: SearchPollRow): SearchPollRecord {
  return {
    score: Number(row.score),
    poll: {
      id: row.id,
      authorId: row.author_id,
      author: {
        id: row.author_id,
        username: row.author_username,
        displayName: row.author_display_name,
        avatarObjectKey: row.author_avatar_object_key,
        avatarUrl: avatarUrlForUser(row.author_id, row.author_avatar_object_key)
      },
      question: row.question,
      description: row.description,
      imageUrl: row.image_object_key === null ? null : `/media/polls/${row.id}`,
      visibility: row.visibility,
      optionsCount: row.options_count,
      votesCount: row.votes_count,
      commentsCount: row.comments_count,
      likesCount: row.likes_count,
      allowVoteCancellation: row.allow_vote_cancellation,
      viewerHasLiked: false,
      viewerVoteOptionId: null,
      options: [],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      endsAt: row.ends_at?.toISOString() ?? null
    }
  };
}

export function mapUserSearchRow(row: SearchUserRow): SearchUserRecord {
  return {
    score: Number(row.score),
    user: {
      id: row.id,
      username: row.username,
      status: 'active',
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      viewerIsFollowing: row.viewer_is_following,
      profile: {
        displayName: row.display_name,
        bio: row.bio,
        countryCode: row.country_code,
        avatarObjectKey: row.avatar_object_key,
        avatarUrl: avatarUrlForUser(row.id, row.avatar_object_key),
        pollsCount: row.polls_count,
        followersCount: row.followers_count,
        followingCount: row.following_count
      }
    }
  };
}

export async function searchPollRecords(input: SearchInput) {
  const result = await db.query<SearchPollRow>(buildPollSearchQuery(input));
  return result.rows.map(mapPollSearchRow);
}

export async function searchUserRecords(input: SearchInput) {
  const result = await db.query<SearchUserRow>(buildUserSearchQuery(input));
  return result.rows.map(mapUserSearchRow);
}
