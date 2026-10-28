import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { cleanupExpiredCompletedDeletionJournal } from './account-deletion.journal.js';
import { cleanupDeletedAccountArchives } from './account-deletion.archive.js';

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

const ELIGIBLE_JOURNAL_OPERATIONS_SQL = `
  SELECT id FROM account_deletion_operations
  WHERE status = 'completed' AND accepted_at <= $1::timestamptz - interval '35 days'
  ORDER BY accepted_at, id`;

export type AccountDeletionRetentionRepository = {
  cleanupExpiredPermissions(now: Date): Promise<number>;
  cleanupExpiredPreparedOperations(now: Date): Promise<number>;
  cleanupExpiredModerationIdentifiers(now: Date): Promise<number>;
  findExpiredCompletedJournalOperationIds(now: Date): Promise<string[]>;
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
    async findExpiredCompletedJournalOperationIds(now) {
      return withTransaction(async (client) => {
        const result = await client.query<{ id: string }>(ELIGIBLE_JOURNAL_OPERATIONS_SQL, [now]);
        return result.rows.map((row) => row.id);
      });
    },
    async cleanupExpiredCompletedJournal(now) {
      return withTransaction((client) => execute(client, JOURNAL_RETENTION_SQL, now));
    }
  };
}

export function createAccountDeletionRetentionService(
  repository: AccountDeletionRetentionRepository,
  cleanupExternalJournal: (now: Date, operationIds: string[]) => Promise<unknown> = async () => undefined
) {
  return {
    async cleanupDeletionRetention(now: Date): Promise<{ deleted: number }> {
      if (!Number.isFinite(now.getTime())) throw new Error('invalid_retention_time');
      const expiredOperationIds = await repository.findExpiredCompletedJournalOperationIds(now);
      await cleanupExternalJournal(now, expiredOperationIds);
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
  async (_now, operationIds) => {
    if (env.ACCOUNT_DELETION_JOURNAL_ENABLED) await cleanupExpiredCompletedDeletionJournal(operationIds);
  }
);

export async function cleanupDeletionRetention(now: Date) {
  // Archive retention must continue even if the optional legacy journal is down.
  if (!Number.isFinite(now.getTime())) throw new Error('invalid_retention_time');
  const archived = await cleanupDeletedAccountArchives(now);
  const result = await retentionService.cleanupDeletionRetention(now);
  return { deleted: archived + result.deleted };
}
