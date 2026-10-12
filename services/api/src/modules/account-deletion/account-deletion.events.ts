import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { realtimeBus } from '../../realtime/realtime.bus.js';
import type { RealtimeEvent } from '@yaskapp/shared';

export type ClaimedDeletionEvent = {
  id: string;
  userId: string;
  operationId: string;
};

type DeliveryDependencies = {
  publish(event: Extract<RealtimeEvent, { type: 'account.deleted' }>): Promise<void>;
  markDelivered(): Promise<void>;
  scheduleRetry(): Promise<void>;
};

export async function dispatchClaimedDeletionEvent(
  claimed: ClaimedDeletionEvent,
  dependencies: DeliveryDependencies
) {
  const event: Extract<RealtimeEvent, { type: 'account.deleted' }> = {
    type: 'account.deleted',
    payload: { userId: claimed.userId, operationId: claimed.operationId }
  };
  try {
    await dependencies.publish(event);
    await dependencies.markDelivered();
    return true;
  } catch {
    await dependencies.scheduleRetry();
    return false;
  }
}

async function claimDeletionEvents(client: PoolClient, limit: number, leaseOwner: string) {
  const result = await client.query<{ id: string; operation_id: string; user_id: string }>(
    `WITH claimable AS (
       SELECT event.id, event.operation_id, operation.user_id
       FROM account_deletion_events event
       JOIN account_deletion_operations operation ON operation.id = event.operation_id
       WHERE event.event_key = 'access_revoked'
         AND event.delivered_at IS NULL
         AND event.available_at <= now()
         AND (event.lease_until IS NULL OR event.lease_until <= now())
       ORDER BY event.created_at, event.id
       FOR UPDATE OF event SKIP LOCKED
       LIMIT $1
     )
     UPDATE account_deletion_events event
     SET lease_owner = $2, lease_until = now() + interval '30 seconds',
         attempts = attempts + 1
     FROM claimable
     WHERE event.id = claimable.id
     RETURNING event.id, event.operation_id, claimable.user_id`,
    [limit, leaseOwner]
  );
  return result.rows;
}

export async function dispatchPendingDeletionEvents(limit = 50) {
  const client = await db.connect();
  const leaseOwner = randomUUID();
  let claimed: Awaited<ReturnType<typeof claimDeletionEvents>>;
  try {
    await client.query('BEGIN');
    claimed = await claimDeletionEvents(client, limit, leaseOwner);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  let delivered = 0;
  await Promise.all(claimed.map(async (row) => {
    const queryClient = await db.connect();
    try {
      const result = await dispatchClaimedDeletionEvent({
        id: row.id,
        userId: row.user_id,
        operationId: row.operation_id
      }, {
        publish: (event) => realtimeBus.publish(row.user_id, event),
        markDelivered: async () => {
          await queryClient.query(
            `UPDATE account_deletion_events
             SET delivered_at = now(), lease_owner = NULL, lease_until = NULL, last_error_code = NULL
             WHERE id = $1 AND lease_owner = $2`,
            [row.id, leaseOwner]
          );
        },
        scheduleRetry: async () => {
          await queryClient.query(
            `UPDATE account_deletion_events
             SET available_at = now() + interval '5 seconds', lease_owner = NULL, lease_until = NULL,
                 last_error_code = 'realtime_unavailable'
             WHERE id = $1 AND lease_owner = $2`,
            [row.id, leaseOwner]
          );
        }
      });
      if (result) delivered += 1;
    } finally {
      queryClient.release();
    }
  }));
  return { claimed: claimed.length, delivered };
}
