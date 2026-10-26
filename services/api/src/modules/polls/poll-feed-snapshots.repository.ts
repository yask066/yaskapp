import { randomUUID } from 'node:crypto';
import type { PollCursorOwnerIdentity } from './poll-pagination.js';

import { db } from '../../config/database.js';
import { createPollCursorOwnerKey } from './poll-pagination.js';

const maximumActiveSnapshotsPerOwner = 3;
const snapshotPageLimit = 50;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerKeyPattern = /^[A-Za-z0-9_-]{43}$/;

type FeedSnapshotRow = {
  created_at: Date;
  expires_at: Date;
};

type FeedSnapshotItemRow = {
  position: string | null;
  poll_id: string | null;
};

export type FeedSnapshot = Readonly<{
  snapshotId: string;
  ownerKey: string;
  createdAt: string;
  expiresAt: string;
}>;

export type FeedSnapshotPage = Readonly<{
  items: ReadonlyArray<Readonly<{ position: number; pollId: string }>>;
  nextPosition: number | null;
}>;

export type ReadFeedSnapshotPageInput = Readonly<{
  snapshotId: string;
  ownerKey: string;
  afterPosition: number;
  limit: number;
}>;

function validateReadInput(input: ReadFeedSnapshotPageInput) {
  if (!uuidPattern.test(input.snapshotId)) {
    throw new TypeError('snapshotId must be a UUID.');
  }
  if (!ownerKeyPattern.test(input.ownerKey)) {
    throw new TypeError('ownerKey must be a base64url SHA-256 HMAC.');
  }
  if (!Number.isSafeInteger(input.afterPosition) || input.afterPosition < -1) {
    throw new RangeError('afterPosition must be a safe integer of at least -1.');
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > snapshotPageLimit) {
    throw new RangeError(`limit must be an integer between 1 and ${snapshotPageLimit}.`);
  }
}

function readPosition(value: string): number {
  const position = Number(value);
  if (!Number.isSafeInteger(position) || position < 0) {
    throw new Error('Feed snapshot position is outside the supported range.');
  }
  return position;
}

export async function createFeedSnapshot(identity: PollCursorOwnerIdentity): Promise<FeedSnapshot> {
  const ownerKey = createPollCursorOwnerKey(identity);
  const snapshotId = randomUUID();
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('yaskapp:poll-feed-snapshot-owner:v1:' || $1::text, 0))`,
      [ownerKey]
    );

    await client.query(
      `DELETE FROM poll_feed_snapshots
       WHERE owner_key = $1 AND expires_at <= clock_timestamp()`,
      [ownerKey]
    );

    const snapshotResult = await client.query<FeedSnapshotRow>(
      `WITH creation_time AS (
         SELECT clock_timestamp() AS created_at
       )
       INSERT INTO poll_feed_snapshots (id, owner_key, created_at, expires_at)
       SELECT $1::uuid, $2::text, creation_time.created_at,
              creation_time.created_at + INTERVAL '30 minutes'
       FROM creation_time
       RETURNING created_at, expires_at`,
      [snapshotId, ownerKey]
    );
    const snapshot = snapshotResult.rows[0];
    if (!snapshot) {
      throw new Error('Poll feed snapshot was not created.');
    }

    await client.query(
      `INSERT INTO poll_feed_snapshot_items (snapshot_id, position, poll_id)
       SELECT $1::uuid,
              ROW_NUMBER() OVER (
                ORDER BY
                  (p.votes_count * 2 + p.likes_count * 1.5 + p.comments_count) DESC,
                  p.created_at DESC,
                  p.id DESC
              ) - 1,
              p.id
       FROM polls p
       JOIN users u ON u.id = p.author_id
       WHERE p.visibility = 'public'
         AND p.deleted_at IS NULL
         AND u.status = 'active'
         AND u.deleted_at IS NULL`,
      [snapshotId]
    );

    await client.query(
      `DELETE FROM poll_feed_snapshots
       WHERE id IN (
         SELECT id
         FROM poll_feed_snapshots
         WHERE owner_key = $1 AND expires_at > clock_timestamp()
         ORDER BY created_at DESC, id DESC
         OFFSET $2
       )`,
      [ownerKey, maximumActiveSnapshotsPerOwner]
    );

    await client.query('COMMIT');

    return {
      snapshotId,
      ownerKey,
      createdAt: snapshot.created_at.toISOString(),
      expiresAt: snapshot.expires_at.toISOString()
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function readFeedSnapshotPage(input: ReadFeedSnapshotPageInput): Promise<FeedSnapshotPage | null> {
  validateReadInput(input);

  const result = await db.query<FeedSnapshotItemRow>(
    `SELECT snapshot_item.position::text AS position,
            snapshot_item.poll_id::text AS poll_id
     FROM poll_feed_snapshots snapshot
     LEFT JOIN LATERAL (
       SELECT position, poll_id
       FROM poll_feed_snapshot_items snapshot_item
       WHERE snapshot_item.snapshot_id = snapshot.id
         AND snapshot_item.position > $3
       ORDER BY snapshot_item.position ASC
       LIMIT $4::integer + 1
     ) snapshot_item ON TRUE
     WHERE snapshot.id = $1
       AND snapshot.owner_key = $2
       AND snapshot.expires_at > clock_timestamp()
     ORDER BY snapshot_item.position ASC`,
    [input.snapshotId, input.ownerKey, input.afterPosition, input.limit]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const orderedRows = result.rows.filter(
    (row): row is FeedSnapshotItemRow & { position: string; poll_id: string } =>
      row.position !== null && row.poll_id !== null
  );
  const hasMore = orderedRows.length > input.limit;
  const items = orderedRows.slice(0, input.limit).map((row) => ({
    position: readPosition(row.position),
    pollId: row.poll_id
  }));

  return {
    items,
    nextPosition: hasMore ? items.at(-1)?.position ?? null : null
  };
}

export async function deleteExpiredFeedSnapshots(): Promise<number> {
  const result = await db.query(
    `DELETE FROM poll_feed_snapshots
     WHERE expires_at <= clock_timestamp()
     RETURNING id`
  );

  return result.rowCount ?? 0;
}
