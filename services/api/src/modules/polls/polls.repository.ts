import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { avatarUrlForUser } from '../profiles/avatar-url.js';
import { countUnreadNotifications, createNotification } from '../notifications/notifications.repository.js';
import { sendNotificationCreated } from '../../realtime/realtime.hub.js';

export type PollVisibility = 'public' | 'followers' | 'private';

export type PollAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatarObjectKey: string | null;
  avatarUrl: string | null;
};

export type PollOption = {
  id: string;
  text: string;
  position: number;
  votesCount: number;
};

export type PollComment = {
  id: string;
  pollId: string;
  author: PollAuthor;
  body: string;
  likesCount: number;
  viewerHasLiked: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Poll = {
  id: string;
  authorId: string;
  author: PollAuthor;
  question: string;
  description: string | null;
  imageUrl: string | null;
  visibility: PollVisibility;
  optionsCount: number;
  votesCount: number;
  commentsCount: number;
  likesCount: number;
  allowVoteCancellation: boolean;
  viewerHasLiked: boolean;
  viewerVoteOptionId: string | null;
  options: PollOption[];
  createdAt: string;
  updatedAt: string;
  endsAt: string | null;
};

export type CreatePollRecordInput = {
  authorId: string;
  question: string;
  description?: string;
  imageObjectKey?: string;
  visibility: PollVisibility;
  options: string[];
  endsAt?: Date;
  allowVoteCancellation: boolean;
};

export type CreatePollCommentRecordInput = {
  pollId: string;
  authorId: string;
  body: string;
};

type PollRow = {
  id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_object_key: string | null;
  question: string;
  description: string | null;
  image_object_key: string | null;
  visibility: PollVisibility;
  options_count: number;
  votes_count: number;
  comments_count: number;
  likes_count: number;
  allow_vote_cancellation: boolean;
  created_at: Date;
  updated_at: Date;
  ends_at: Date | null;
};

type PollOptionRow = {
  id: string;
  poll_id: string;
  text: string;
  position: number;
  votes_count: number;
};

type PollCommentRow = {
  id: string;
  poll_id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_object_key: string | null;
  body: string;
  likes_count: number;
  viewer_has_liked: boolean;
  created_at: Date;
  updated_at: Date;
};

function mapPoll(
  row: PollRow,
  options: PollOption[],
  viewerLikedPollIds: Set<string>,
  viewerVoteOptionIds: Map<string, string>
): Poll {
  return {
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
    viewerHasLiked: viewerLikedPollIds.has(row.id),
    viewerVoteOptionId: viewerVoteOptionIds.get(row.id) ?? null,
    options,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null
  };
}

function mapOption(row: PollOptionRow): PollOption {
  return {
    id: row.id,
    text: row.text,
    position: row.position,
    votesCount: row.votes_count
  };
}

function mapComment(row: PollCommentRow): PollComment {
  return {
    id: row.id,
    pollId: row.poll_id,
    author: {
      id: row.author_id,
      username: row.author_username,
      displayName: row.author_display_name,
      avatarObjectKey: row.author_avatar_object_key,
      avatarUrl: avatarUrlForUser(row.author_id, row.author_avatar_object_key)
    },
    body: row.body,
    likesCount: row.likes_count,
    viewerHasLiked: row.viewer_has_liked,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

async function findPollRowsByIds(client: PoolClient, pollIds: string[]) {
  if (pollIds.length === 0) {
    return [];
  }

  const result = await client.query<PollRow>(
    `
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
        p.ends_at
      FROM polls p
      JOIN users u ON u.id = p.author_id
      JOIN profiles pr ON pr.user_id = p.author_id
      WHERE p.id = ANY($1::uuid[])
        AND p.deleted_at IS NULL
        AND u.status = 'active'
      ORDER BY p.created_at DESC, p.id DESC
    `,
    [pollIds]
  );

  return result.rows;
}

async function findOptionRowsByPollIds(client: PoolClient, pollIds: string[]) {
  if (pollIds.length === 0) {
    return [];
  }

  const result = await client.query<PollOptionRow>(
    `
      SELECT id, poll_id, text, position, votes_count
      FROM poll_options
      WHERE poll_id = ANY($1::uuid[])
      ORDER BY poll_id, position ASC
    `,
    [pollIds]
  );

  return result.rows;
}

async function findViewerLikedPollIds(
  client: PoolClient,
  pollIds: string[],
  viewerId: string | undefined
) {
  if (!viewerId || pollIds.length === 0) {
    return new Set<string>();
  }

  const result = await client.query<{ poll_id: string }>(
    `
      SELECT poll_id
      FROM likes
      WHERE user_id = $1
        AND poll_id = ANY($2::uuid[])
    `,
    [viewerId, pollIds]
  );

  return new Set(result.rows.map((row) => row.poll_id));
}

async function findViewerVoteOptionIds(
  client: PoolClient,
  pollIds: string[],
  viewerId: string | undefined
) {
  if (!viewerId || pollIds.length === 0) {
    return new Map<string, string>();
  }

  const result = await client.query<{ poll_id: string; option_id: string }>(
    `
      SELECT poll_id, option_id
      FROM poll_votes
      WHERE voter_id = $1
        AND poll_id = ANY($2::uuid[])
    `,
    [viewerId, pollIds]
  );

  return new Map(result.rows.map((row) => [row.poll_id, row.option_id]));
}

async function hydratePolls(client: PoolClient, pollIds: string[], viewerId?: string) {
  const pollRows = await findPollRowsByIds(client, pollIds);
  const optionRows = await findOptionRowsByPollIds(client, pollIds);
  const viewerLikedPollIds = await findViewerLikedPollIds(client, pollIds, viewerId);
  const viewerVoteOptionIds = await findViewerVoteOptionIds(client, pollIds, viewerId);
  const optionsByPollId = new Map<string, PollOption[]>();

  for (const optionRow of optionRows) {
    const options = optionsByPollId.get(optionRow.poll_id) ?? [];
    options.push(mapOption(optionRow));
    optionsByPollId.set(optionRow.poll_id, options);
  }

  return pollRows.map((row) =>
    mapPoll(
      row,
      optionsByPollId.get(row.id) ?? [],
      viewerLikedPollIds,
      viewerVoteOptionIds
    )
  );
}

export async function createPollRecord(input: CreatePollRecordInput) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const pollResult = await client.query<{ id: string }>(
      `
        INSERT INTO polls (
          author_id,
          question,
          description,
          image_object_key,
          visibility,
          options_count,
          allow_vote_cancellation,
          ends_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        input.authorId,
        input.question,
        input.description ?? null,
        input.imageObjectKey ?? null,
        input.visibility,
        input.options.length,
        input.allowVoteCancellation,
        input.endsAt ?? null
      ]
    );

    const pollId = pollResult.rows[0]?.id;

    if (!pollId) {
      throw new Error('Poll insert did not return an id.');
    }

    for (const [position, text] of input.options.entries()) {
      await client.query(
        `
          INSERT INTO poll_options (poll_id, text, position)
          VALUES ($1, $2, $3)
        `,
        [pollId, text, position]
      );
    }

    await client.query(
      `
        UPDATE profiles
        SET polls_count = polls_count + 1
        WHERE user_id = $1
      `,
      [input.authorId]
    );

    const [poll] = await hydratePolls(client, [pollId]);

    if (!poll) {
      throw new Error('Created poll could not be loaded.');
    }

    await client.query('COMMIT');

    return poll;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePollRecord(input: {
  pollId: string;
  authorId: string;
}) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query<{ id: string; image_object_key: string | null }>(
      `
        UPDATE polls
        SET deleted_at = now(), updated_at = now()
        WHERE id = $1
          AND author_id = $2
          AND deleted_at IS NULL
        RETURNING id, image_object_key
      `,
      [input.pollId, input.authorId]
    );

    if (result.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    await client.query(
      `
        UPDATE profiles
        SET polls_count = GREATEST(polls_count - 1, 0)
        WHERE user_id = $1
      `,
      [input.authorId]
    );

    await client.query('COMMIT');

    return {
      status: 'deleted' as const,
      imageObjectKey: result.rows[0]?.image_object_key ?? null
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePollCommentRecord(input: {
  pollId: string;
  commentId: string;
  authorId: string;
}) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        UPDATE comments c
        SET deleted_at = now(), updated_at = now()
        FROM polls p
        WHERE c.id = $1
          AND c.poll_id = $2
          AND c.author_id = $3
          AND c.deleted_at IS NULL
          AND p.id = c.poll_id
          AND p.visibility = 'public'
          AND p.deleted_at IS NULL
        RETURNING c.id
      `,
      [input.commentId, input.pollId, input.authorId]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    await client.query(
      `
        UPDATE polls
        SET comments_count = GREATEST(comments_count - 1, 0), updated_at = now()
        WHERE id = $1
      `,
      [input.pollId]
    );

    await client.query('COMMIT');
    return { status: 'deleted' as const };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listPublicPollRecords(
  limit: number,
  viewerId?: string,
  sort: 'newest' | 'popular' = 'newest'
) {
  const client = await db.connect();

  try {
    const result = await client.query<{ id: string }>(
      `
        SELECT id
        FROM polls
        WHERE visibility = 'public'
          AND deleted_at IS NULL
        ORDER BY
          CASE WHEN $2 = 'popular' THEN votes_count * 2 + likes_count * 1.5 + comments_count ELSE 0 END DESC,
          created_at DESC,
          id DESC
        LIMIT $1
      `,
      [limit, sort]
    );

    return hydratePolls(
      client,
      result.rows.map((row) => row.id),
      viewerId
    );
  } finally {
    client.release();
  }
}

export async function listSubscriptionPollRecords(
  followerId: string,
  limit: number
) {
  const client = await db.connect();

  try {
    const result = await client.query<{ id: string }>(
      `
        SELECT p.id
        FROM polls p
        JOIN follows f ON f.followee_id = p.author_id
        JOIN users u ON u.id = p.author_id
        WHERE f.follower_id = $1
          AND p.visibility = 'public'
          AND p.deleted_at IS NULL
          AND u.status = 'active'
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $2
      `,
      [followerId, limit]
    );

    return hydratePolls(
      client,
      result.rows.map((row) => row.id),
      followerId
    );
  } finally {
    client.release();
  }
}

export async function listPollRecordsByAuthor(
  authorId: string,
  limit: number,
  viewerId?: string
) {
  const client = await db.connect();

  try {
    const result = await client.query<{ id: string }>(
      `
        SELECT id
        FROM polls
        WHERE author_id = $1
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [authorId, limit]
    );

    return hydratePolls(
      client,
      result.rows.map((row) => row.id),
      viewerId
    );
  } finally {
    client.release();
  }
}

export async function listPublicPollRecordsByAuthor(
  authorId: string,
  limit: number,
  viewerId?: string
) {
  const client = await db.connect();

  try {
    const result = await client.query<{ id: string }>(
      `
        SELECT id
        FROM polls
        WHERE author_id = $1
          AND visibility = 'public'
          AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [authorId, limit]
    );

    return hydratePolls(
      client,
      result.rows.map((row) => row.id),
      viewerId
    );
  } finally {
    client.release();
  }
}

export async function findPollRecordById(pollId: string) {
  const client = await db.connect();

  try {
    const [poll] = await hydratePolls(client, [pollId]);

    return poll ?? null;
  } finally {
    client.release();
  }
}

export async function findViewablePollImageRecord(
  pollId: string,
  viewerId?: string
) {
  const result = await db.query<{
    image_object_key: string | null;
    visibility: 'public' | 'followers' | 'private';
  }>(
    `
      SELECT p.image_object_key, p.visibility
      FROM polls p
      JOIN users u ON u.id = p.author_id
      WHERE p.id = $1
        AND p.deleted_at IS NULL
        AND u.status = 'active'
        AND (
          p.visibility = 'public'
          OR p.author_id = $2
          OR (
            p.visibility = 'followers'
            AND EXISTS (
              SELECT 1
              FROM follows f
              WHERE f.follower_id = $2
                AND f.followee_id = p.author_id
            )
          )
        )
    `,
    [pollId, viewerId ?? null]
  );

  return result.rows[0] ?? null;
}

export async function listPollCommentRecords(input: { pollId: string; limit: number; viewerId?: string }) {
  const client = await db.connect();

  try {
    const pollResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM polls
        WHERE id = $1
          AND visibility = 'public'
          AND deleted_at IS NULL
      `,
      [input.pollId]
    );

    if (pollResult.rowCount === 0) {
      return { status: 'not_found' as const };
    }

    const commentsResult = await client.query<PollCommentRow>(
      `
        SELECT
          c.id,
          c.poll_id,
          c.author_id,
          u.username::text AS author_username,
          pr.display_name AS author_display_name,
          pr.avatar_object_key AS author_avatar_object_key,
          c.body,
          c.likes_count,
          EXISTS (
            SELECT 1 FROM likes l
            WHERE l.comment_id = c.id AND l.user_id = $3
          ) AS viewer_has_liked,
          c.created_at,
          c.updated_at
        FROM comments c
        JOIN users u ON u.id = c.author_id
        JOIN profiles pr ON pr.user_id = c.author_id
        WHERE c.poll_id = $1
          AND c.parent_comment_id IS NULL
          AND c.deleted_at IS NULL
        ORDER BY c.created_at ASC
        LIMIT $2
      `,
      [input.pollId, input.limit, input.viewerId ?? null]
    );

    return {
      status: 'found' as const,
      items: commentsResult.rows.map(mapComment)
    };
  } finally {
    client.release();
  }
}

export async function createPollCommentRecord(input: CreatePollCommentRecordInput) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    let notificationId: string | null = null;

    const pollResult = await client.query<{ id: string; author_id: string }>(
      `
        SELECT id, author_id
        FROM polls
        WHERE id = $1
          AND visibility = 'public'
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [input.pollId]
    );

    if (pollResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    const commentResult = await client.query<PollCommentRow>(
      `
        WITH inserted_comment AS (
          INSERT INTO comments (poll_id, author_id, body)
          VALUES ($1, $2, $3)
          RETURNING
            id,
            poll_id,
            author_id,
            body,
            likes_count,
            created_at,
            updated_at
        )
        SELECT
          c.id,
          c.poll_id,
          c.author_id,
          u.username::text AS author_username,
          pr.display_name AS author_display_name,
          pr.avatar_object_key AS author_avatar_object_key,
          c.body,
          c.likes_count,
          false AS viewer_has_liked,
          c.created_at,
          c.updated_at
        FROM inserted_comment c
        JOIN users u ON u.id = c.author_id
        JOIN profiles pr ON pr.user_id = c.author_id
      `,
      [input.pollId, input.authorId, input.body]
    );

    const comment = commentResult.rows[0];

    if (!comment) {
      await client.query('ROLLBACK');
      throw new Error('Comment insert did not return a row.');
    }

    if (pollResult.rows[0].author_id !== input.authorId) {
      notificationId = (await createNotification({
        recipientUserId: pollResult.rows[0].author_id,
        actorUserId: input.authorId,
        type: 'comment',
        pollId: input.pollId,
        commentId: comment.id,
        deduplicationKey: `comment:${comment.id}:${pollResult.rows[0].author_id}`
      }, client)).id;
    }

    await client.query(
      `
        UPDATE polls
        SET comments_count = comments_count + 1
        WHERE id = $1
      `,
      [input.pollId]
    );

    const [poll] = await hydratePolls(client, [input.pollId], input.authorId);

    if (!poll) {
      await client.query('ROLLBACK');
      throw new Error('Updated poll could not be loaded.');
    }

    await client.query('COMMIT');

    if (notificationId) {
      sendNotificationCreated(pollResult.rows[0].author_id, {
        notification: { id: notificationId, type: 'comment', actorId: input.authorId, pollId: input.pollId, commentId: comment.id, createdAt: new Date().toISOString() },
        unreadCount: await countUnreadNotifications(pollResult.rows[0].author_id)
      });
    }

    return {
      status: 'created' as const,
      comment: mapComment(comment),
      poll
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findCommentForUpdate(client: PoolClient, commentId: string) {
  const result = await client.query<PollCommentRow>(
    `
      SELECT
        c.id, c.poll_id, c.author_id,
        u.username::text AS author_username,
        pr.display_name AS author_display_name,
        pr.avatar_object_key AS author_avatar_object_key,
        c.body, c.likes_count,
        false AS viewer_has_liked,
        c.created_at, c.updated_at
      FROM comments c
      JOIN polls p ON p.id = c.poll_id
      JOIN users u ON u.id = c.author_id
      JOIN profiles pr ON pr.user_id = c.author_id
      WHERE c.id = $1
        AND p.visibility = 'public'
        AND p.deleted_at IS NULL
        AND c.deleted_at IS NULL
      FOR UPDATE OF c
    `,
    [commentId]
  );

  return result.rows[0] ?? null;
}

export async function likeCommentRecord(input: { pollId: string; commentId: string; userId: string }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const comment = await findCommentForUpdate(client, input.commentId);
    if (!comment || comment.poll_id !== input.pollId) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    const result = await client.query(
      `INSERT INTO likes (user_id, comment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [input.userId, input.commentId]
    );
    if (result.rowCount === 1) {
      await client.query(
        'UPDATE comments SET likes_count = likes_count + 1 WHERE id = $1',
        [input.commentId]
      );
    }

    const updated = await client.query<PollCommentRow>(
      `
        SELECT c.id, c.poll_id, c.author_id,
          u.username::text AS author_username,
          pr.display_name AS author_display_name,
          pr.avatar_object_key AS author_avatar_object_key,
          c.body, c.likes_count, true AS viewer_has_liked,
          c.created_at, c.updated_at
        FROM comments c
        JOIN users u ON u.id = c.author_id
        JOIN profiles pr ON pr.user_id = c.author_id
        WHERE c.id = $1
      `,
      [input.commentId]
    );
    await client.query('COMMIT');
    return { status: 'liked' as const, comment: mapComment(updated.rows[0]) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function unlikeCommentRecord(input: { pollId: string; commentId: string; userId: string }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const comment = await findCommentForUpdate(client, input.commentId);
    if (!comment || comment.poll_id !== input.pollId) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    const result = await client.query(
      'DELETE FROM likes WHERE user_id = $1 AND comment_id = $2',
      [input.userId, input.commentId]
    );
    if (result.rowCount === 1) {
      await client.query(
        'UPDATE comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1',
        [input.commentId]
      );
    }

    const updated = await client.query<PollCommentRow>(
      `
        SELECT c.id, c.poll_id, c.author_id,
          u.username::text AS author_username,
          pr.display_name AS author_display_name,
          pr.avatar_object_key AS author_avatar_object_key,
          c.body, c.likes_count, false AS viewer_has_liked,
          c.created_at, c.updated_at
        FROM comments c
        JOIN users u ON u.id = c.author_id
        JOIN profiles pr ON pr.user_id = c.author_id
        WHERE c.id = $1
      `,
      [input.commentId]
    );
    await client.query('COMMIT');
    return { status: 'unliked' as const, comment: mapComment(updated.rows[0]) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function likePollRecord(input: {
  pollId: string;
  userId: string;
}) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    let notificationId: string | null = null;

    const pollResult = await client.query<{ id: string; author_id: string }>(
      `
        SELECT id, author_id
        FROM polls
        WHERE id = $1
          AND visibility = 'public'
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [input.pollId]
    );

    if (pollResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    const likeResult = await client.query<{ id: string }>(
      `
        INSERT INTO likes (user_id, poll_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        RETURNING id
      `,
      [input.userId, input.pollId]
    );

    if (likeResult.rowCount === 1) {
      if (pollResult.rows[0].author_id !== input.userId) {
        notificationId = (await createNotification({
          recipientUserId: pollResult.rows[0].author_id,
          actorUserId: input.userId,
          type: 'like',
          pollId: input.pollId,
          deduplicationKey: `like:poll:${input.pollId}:${input.userId}`
        }, client)).id;
      }
      await client.query(
        `
          UPDATE polls
          SET likes_count = likes_count + 1
          WHERE id = $1
        `,
        [input.pollId]
      );
    }

    const [poll] = await hydratePolls(client, [input.pollId], input.userId);

    await client.query('COMMIT');

    if (notificationId) {
      sendNotificationCreated(pollResult.rows[0].author_id, {
        notification: { id: notificationId, type: 'like', actorId: input.userId, pollId: input.pollId, commentId: null, createdAt: new Date().toISOString() },
        unreadCount: await countUnreadNotifications(pollResult.rows[0].author_id)
      });
    }

    return {
      status: 'liked' as const,
      poll
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function unlikePollRecord(input: {
  pollId: string;
  userId: string;
}) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const pollResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM polls
        WHERE id = $1
          AND visibility = 'public'
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [input.pollId]
    );

    if (pollResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    const unlikeResult = await client.query<{ id: string }>(
      `
        DELETE FROM likes
        WHERE user_id = $1
          AND poll_id = $2
        RETURNING id
      `,
      [input.userId, input.pollId]
    );

    if (unlikeResult.rowCount === 1) {
      await client.query(
        `
          UPDATE polls
          SET likes_count = GREATEST(likes_count - 1, 0)
          WHERE id = $1
        `,
        [input.pollId]
      );
    }

    const [poll] = await hydratePolls(client, [input.pollId], input.userId);

    await client.query('COMMIT');

    return {
      status: 'unliked' as const,
      poll
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createVoteRecord(input: {
  pollId: string;
  optionId: string;
  voterId: string;
}) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    let notificationId: string | null = null;

    const pollResult = await client.query<{
      id: string;
      author_id: string;
      ends_at: Date | null;
      option_id: string | null;
    }>(
      `
        SELECT p.id, p.author_id, p.ends_at, po.id AS option_id
        FROM polls p
        LEFT JOIN poll_options po
          ON po.poll_id = p.id
          AND po.id = $2
        WHERE p.id = $1
          AND p.visibility = 'public'
          AND p.deleted_at IS NULL
        FOR UPDATE OF p
      `,
      [input.pollId, input.optionId]
    );

    const poll = pollResult.rows[0];

    if (!poll || !poll.option_id) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    if (poll.ends_at && poll.ends_at <= new Date()) {
      await client.query('ROLLBACK');
      return { status: 'closed' as const };
    }

    const voteResult = await client.query<{ id: string }>(
      `
        INSERT INTO poll_votes (poll_id, option_id, voter_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (poll_id, voter_id) DO NOTHING
        RETURNING id
      `,
      [input.pollId, input.optionId, input.voterId]
    );

    if (voteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'already_voted' as const };
    }

    const optionResult = await client.query<{ votes_count: number }>(
      `
        UPDATE poll_options
        SET votes_count = votes_count + 1
        WHERE id = $1
        RETURNING votes_count
      `,
      [input.optionId]
    );

    await client.query(
      `
        UPDATE polls
        SET votes_count = votes_count + 1
        WHERE id = $1
      `,
      [input.pollId]
    );

    if (poll.author_id !== input.voterId) {
      notificationId = (await createNotification({
        recipientUserId: poll.author_id,
        actorUserId: input.voterId,
        type: 'poll_vote',
        pollId: input.pollId,
        deduplicationKey: `poll_vote:${input.pollId}:${input.voterId}`
      }, client)).id;
    }

    const [updatedPoll] = await hydratePolls(client, [input.pollId], input.voterId);

    await client.query('COMMIT');

    if (notificationId) {
      sendNotificationCreated(poll.author_id, {
        notification: { id: notificationId, type: 'poll_vote', actorId: input.voterId, pollId: input.pollId, commentId: null, createdAt: new Date().toISOString() },
        unreadCount: await countUnreadNotifications(poll.author_id)
      });
    }

    return {
      status: 'created' as const,
      optionVotesCount: optionResult.rows[0]?.votes_count ?? 0,
      poll: updatedPoll
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelVoteRecord(input: {
  pollId: string;
  voterId: string;
}) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const pollResult = await client.query<{
      id: string;
      ends_at: Date | null;
      allow_vote_cancellation: boolean;
    }>(
      `
        SELECT p.id, p.ends_at, p.allow_vote_cancellation
        FROM polls p
        WHERE p.id = $1
          AND p.visibility = 'public'
          AND p.deleted_at IS NULL
        FOR UPDATE
      `,
      [input.pollId]
    );

    const poll = pollResult.rows[0];

    if (!poll) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    if (poll.ends_at && poll.ends_at <= new Date()) {
      await client.query('ROLLBACK');
      return { status: 'closed' as const };
    }

    if (!poll.allow_vote_cancellation) {
      await client.query('ROLLBACK');
      return { status: 'cancellation_not_allowed' as const };
    }

    const voteResult = await client.query<{ option_id: string }>(
      `
        DELETE FROM poll_votes
        WHERE poll_id = $1
          AND voter_id = $2
        RETURNING option_id
      `,
      [input.pollId, input.voterId]
    );

    const optionId = voteResult.rows[0]?.option_id;

    if (optionId) {
      await client.query(
        `
          UPDATE poll_options
          SET votes_count = GREATEST(votes_count - 1, 0)
          WHERE id = $1
        `,
        [optionId]
      );

      await client.query(
        `
          UPDATE polls
          SET votes_count = GREATEST(votes_count - 1, 0)
          WHERE id = $1
        `,
        [input.pollId]
      );
    }

    const [updatedPoll] = await hydratePolls(client, [input.pollId], input.voterId);

    await client.query('COMMIT');

    return {
      status: 'canceled' as const,
      poll: updatedPoll
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setVoteRecord(input: {
  pollId: string;
  optionId: string;
  voterId: string;
}) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const pollResult = await client.query<{
      id: string;
      ends_at: Date | null;
      option_id: string | null;
    }>(
      `
        SELECT p.id, p.ends_at, po.id AS option_id
        FROM polls p
        LEFT JOIN poll_options po
          ON po.poll_id = p.id
          AND po.id = $2
        WHERE p.id = $1
          AND p.visibility = 'public'
          AND p.deleted_at IS NULL
        FOR UPDATE OF p
      `,
      [input.pollId, input.optionId]
    );

    const poll = pollResult.rows[0];

    if (!poll || !poll.option_id) {
      await client.query('ROLLBACK');
      return { status: 'not_found' as const };
    }

    if (poll.ends_at && poll.ends_at <= new Date()) {
      await client.query('ROLLBACK');
      return { status: 'closed' as const };
    }

    const currentVoteResult = await client.query<{ option_id: string }>(
      `
        SELECT option_id
        FROM poll_votes
        WHERE poll_id = $1
          AND voter_id = $2
        FOR UPDATE
      `,
      [input.pollId, input.voterId]
    );

    const currentOptionId = currentVoteResult.rows[0]?.option_id;
    let optionVotesCount = 0;

    if (!currentOptionId) {
      await client.query(
        `
          INSERT INTO poll_votes (poll_id, option_id, voter_id)
          VALUES ($1, $2, $3)
        `,
        [input.pollId, input.optionId, input.voterId]
      );

      const optionResult = await client.query<{ votes_count: number }>(
        `
          UPDATE poll_options
          SET votes_count = votes_count + 1
          WHERE id = $1
          RETURNING votes_count
        `,
        [input.optionId]
      );

      optionVotesCount = optionResult.rows[0]?.votes_count ?? 0;

      await client.query(
        `
          UPDATE polls
          SET votes_count = votes_count + 1
          WHERE id = $1
        `,
        [input.pollId]
      );
    } else if (currentOptionId === input.optionId) {
      const optionResult = await client.query<{ votes_count: number }>(
        `
          SELECT votes_count
          FROM poll_options
          WHERE id = $1
        `,
        [input.optionId]
      );

      optionVotesCount = optionResult.rows[0]?.votes_count ?? 0;
    } else {
      await client.query(
        `
          UPDATE poll_votes
          SET option_id = $1
          WHERE poll_id = $2
            AND voter_id = $3
        `,
        [input.optionId, input.pollId, input.voterId]
      );

      await client.query(
        `
          UPDATE poll_options
          SET votes_count = GREATEST(votes_count - 1, 0)
          WHERE id = $1
        `,
        [currentOptionId]
      );

      const optionResult = await client.query<{ votes_count: number }>(
        `
          UPDATE poll_options
          SET votes_count = votes_count + 1
          WHERE id = $1
          RETURNING votes_count
        `,
        [input.optionId]
      );

      optionVotesCount = optionResult.rows[0]?.votes_count ?? 0;
    }

    const [updatedPoll] = await hydratePolls(client, [input.pollId], input.voterId);

    await client.query('COMMIT');

    return {
      status: 'set' as const,
      operation: currentOptionId ? ('updated' as const) : ('created' as const),
      optionVotesCount,
      poll: updatedPoll
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
