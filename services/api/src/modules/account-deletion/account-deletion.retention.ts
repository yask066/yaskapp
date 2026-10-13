import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { cleanupExpiredCompletedDeletionJournal } from './account-deletion.journal.js';

const PERMISSION_RETENTION_SQL = `
  DELETE FROM account_deletion_permissions
  WHERE expires_at <= $1`;

const PREPARED_RETENTION_SQL = `
  DELETE FROM account_deletion_operations operation
  WHERE operation.status = 'not_started'
    AND NOT EXISTS (
      SELECT 1 FROM account_deletion_permissions permission
      WHERE permission.operation_id = operation.id AND permission.expires_at > $1
    )`;

const MODERATION_RETENTION_SQL = `
  DELETE FROM account_deletion_moderation_identifiers
  WHERE expires_at <= $1`;

const JOURNAL_RETENTION_SQL = `
  DELETE FROM account_deletion_operations
  WHERE status = 'completed' AND accepted_at <= $1::timestamptz - interval '35 days'`;

export type AccountDeletionRetentionRepository = {
  cleanupExpiredPermissions(now: Date): Promise<number>;
  cleanupExpiredPreparedOperations(now: Date): Promise<number>;
  cleanupExpiredModerationIdentifiers(now: Date): Promise<number>;
  cleanupExpiredCompletedJournal(now: Date): Promise<number>;
};

function affectedRows(result: { rowCount: number | null }) {
  return result.rowCount ?? 0;
}

export function createAccountDeletionRetentionRepository(executor: typeof db = db): AccountDeletionRetentionRepository {
  async function execute(client: PoolClient, sql: string, now: Date) {
    return affectedRows(await client.query(sql, [now]));
  }

  async function withTransaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await executor.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async cleanupExpiredPermissions(now) {
      return withTransaction((client) => execute(client, PERMISSION_RETENTION_SQL, now));
    },
    async cleanupExpiredPreparedOperations(now) {
      return withTransaction((client) => execute(client, PREPARED_RETENTION_SQL, now));
    },
    async cleanupExpiredModerationIdentifiers(now) {
      return withTransaction((client) => execute(client, MODERATION_RETENTION_SQL, now));
    },
    async cleanupExpiredCompletedJournal(now) {
      return withTransaction((client) => execute(client, JOURNAL_RETENTION_SQL, now));
    }
  };
}

export function createAccountDeletionRetentionService(
  repository: AccountDeletionRetentionRepository,
  cleanupExternalJournal: (now: Date) => Promise<unknown> = async () => undefined
) {
  return {
    async cleanupDeletionRetention(now: Date): Promise<{ deleted: number }> {
      if (!Number.isFinite(now.getTime())) throw new Error('invalid_retention_time');
      await cleanupExternalJournal(now);
      const permissions = await repository.cleanupExpiredPermissions(now);
      const prepared = await repository.cleanupExpiredPreparedOperations(now);
      const moderation = await repository.cleanupExpiredModerationIdentifiers(now);
      const journal = await repository.cleanupExpiredCompletedJournal(now);
      return { deleted: permissions + prepared + moderation + journal };
    }
  };
}

const retentionService = createAccountDeletionRetentionService(
  createAccountDeletionRetentionRepository(),
  (now) => cleanupExpiredCompletedDeletionJournal(db, now)
);

export const cleanupDeletionRetention = retentionService.cleanupDeletionRetention;
