import type { Pool, PoolClient } from 'pg';

import { db } from '../../config/database.js';

type QueryExecutor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
export type DevicePlatform = 'android' | 'ios';

export async function registerNotificationDevice(userId: string, token: string, platform: DevicePlatform, executor: QueryExecutor = db) {
  const result = await executor.query<{ id: string }>(
    `INSERT INTO notification_devices (user_id, token, platform, last_seen_at, revoked_at)
     VALUES ($1, $2, $3, now(), NULL)
     ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, last_seen_at = now(), revoked_at = NULL
     RETURNING id`,
    [userId, token, platform]
  );
  return { id: result.rows[0].id };
}

export async function revokeNotificationDevice(userId: string, token: string, executor: QueryExecutor = db) {
  const result = await executor.query(
    `UPDATE notification_devices SET revoked_at = COALESCE(revoked_at, now())
     WHERE user_id = $1 AND token = $2 AND revoked_at IS NULL`,
    [userId, token]
  );
  return result.rowCount === 1;
}

export async function listActiveNotificationDevices(userId: string, executor: QueryExecutor = db) {
  const result = await executor.query<{ id: string; token: string; platform: DevicePlatform }>(
    `SELECT id, token, platform FROM notification_devices
     WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC`,
    [userId]
  );
  return result.rows;
}
