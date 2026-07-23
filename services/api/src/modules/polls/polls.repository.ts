import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';

export type PollVisibility = 'public' | 'followers' | 'private';

export type PollAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatarObjectKey: string | null;
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
  createdAt: string;
  updatedAt: string;
};

export type Poll = {
  id: string;
  authorId: string;
  author: PollAuthor;
  question: string;
  description: string | null;
  imageObjectKey: string | null;
  visibility: PollVisibility;
  optionsCount: number;
  votesCount: number;
  commentsCount: number;
  likesCount: number;
  viewerHasLiked: boolean;
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
  created_at: Date;
  updated_at: Date;
};

function mapPoll(row: PollRow, options: PollOption[], viewerLikedPollIds: Set<string>): Poll {
  return {
    id: row.id,
    authorId: row.author_id,
    author: {
      id: row.author_id,
      username: row.author_username,
      displayName: row.author_display_name,
      avatarObjectKey: row.author_avatar_object_key
    },
    question: row.question,
    description: row.description,
    imageObjectKey: row.image_object_key,
    visibility: row.visibility,
    optionsCount: row.options_count,
    votesCount: row.votes_count,
    commentsCount: row.comments_count,
    likesCount: row.likes_count,
    viewerHasLiked: viewerLikedPollIds.has(row.id),
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
      avatarObjectKey: row.author_avatar_object_key
    },
    body: row.body,
    likesCount: row.likes_count,
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
        p.created_at,
        p.updated_at,
        p.ends_at
      FROM polls p
      JOIN users u ON u.id = p.author_id
      JOIN profiles pr ON pr.user_id = p.author_id
      WHERE p.id = ANY($1::uuid[])
        AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
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

async function hydratePolls(client: PoolClient, pollIds: string[], viewerId?: string) {
  const pollRows = await findPollRowsByIds(client, pollIds);
  const optionRows = await findOptionRowsByPollIds(client, pollIds);
  const viewerLikedPollIds = await findViewerLikedPollIds(client, pollIds, viewerId);
  const optionsByPollId = new Map<string, PollOption[]>();

  for (const optionRow of optionRows) {
    const options = optionsByPollId.get(optionRow.poll_id) ?? [];
    options.push(mapOption(optionRow));
    optionsByPollId.set(optionRow.poll_id, options);
  }

  return pollRows.map((row) =>
    mapPoll(row, optionsByPollId.get(row.id) ?? [], viewerLikedPollIds)
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
          ends_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        input.authorId,
        input.question,
        input.description ?? null,
        input.imageObjectKey ?? null,
        input.visibility,
        input.options.length,
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

export async function listPublicPollRecords(limit: number, viewerId?: string) {
  const client = await db.connect();

  try {
    const result = await client.query<{ id: string }>(
      `
        SELECT id
        FROM polls
        WHERE visibility = 'public'
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit]
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

export async function findPollRecordById(pollId: string) {
  const client = await db.connect();

  try {
    const [poll] = await hydratePolls(client, [pollId]);

    return poll ?? null;
  } finally {
    client.release();
  }
}

export async function listPollCommentRecords(input: { pollId: string; limit: number }) {
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
      [input.pollId, input.limit]
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

export async function likePollRecord(input: {
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

    const [updatedPoll] = await hydratePolls(client, [input.pollId]);

    await client.query('COMMIT');

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
