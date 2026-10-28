import type { PoolClient } from 'pg';

import { db, type Database } from '../../config/database.js';
import { discoverAccountMedia, purgeAccountMedia, verifyAccountMediaEmpty } from './account-deletion.media.js';

const REQUIRED_PRE_COMPLETION_STEPS = [
  'discovery', 'notifications', 'moderation', 'content', 'relationships', 'media'
] as const;

type DeletionOperation = { userId: string; status: string };

export type AccountDeletionCompletionRepository = {
  getOperation(operationId: string): Promise<DeletionOperation | null>;
  arePreviousStepsComplete(operationId: string): Promise<boolean>;
  hasDatabaseRemainders(operationId: string, userId: string): Promise<boolean>;
  deleteUser(userId: string): Promise<void>;
  hasPostDeleteRemainders(operationId: string, userId: string): Promise<boolean>;
  removeManifest(operationId: string): Promise<void>;
  removeContentTargets(operationId: string): Promise<void>;
  removeDeletedContentTargets(operationId: string): Promise<void>;
  removeCounterTargets(operationId: string): Promise<void>;
};

type AccountDeletionCompletionMedia = {
  discover(operationId: string): Promise<{ done: boolean }>;
  purge(operationId: string): Promise<{ done: boolean }>;
  verifyEmpty(operationId: string): Promise<boolean>;
};

const COUNT_CHECK_SQL = `
  WITH target_polls AS (
    SELECT target_id AS poll_id FROM account_deletion_content_targets
    WHERE operation_id = $1 AND target_type = 'poll'
    UNION
    SELECT target_id AS poll_id FROM account_deletion_counter_targets
    WHERE operation_id = $1 AND target_type = 'poll'
    UNION
    SELECT comment.poll_id FROM account_deletion_content_targets target
    JOIN comments comment ON comment.id = target.target_id
    WHERE target.operation_id = $1 AND target.target_type = 'comment'
    UNION
    SELECT comment.poll_id FROM account_deletion_counter_targets target
    JOIN comments comment ON comment.id = target.target_id
    WHERE target.operation_id = $1 AND target.target_type = 'comment'
  ), target_comments AS (
    SELECT target_id AS comment_id FROM account_deletion_content_targets
    WHERE operation_id = $1 AND target_type = 'comment'
    UNION
    SELECT target_id AS comment_id FROM account_deletion_counter_targets
    WHERE operation_id = $1 AND target_type = 'comment'
  )
  SELECT EXISTS (
    SELECT 1 FROM polls poll JOIN target_polls target ON target.poll_id = poll.id
    WHERE poll.votes_count <> (SELECT count(*)::int FROM poll_votes WHERE poll_id = poll.id)
       OR poll.likes_count <> (SELECT count(*)::int FROM likes WHERE poll_id = poll.id)
       OR poll.comments_count <> (
         SELECT count(*)::int FROM comments comment
         JOIN users author ON author.id = comment.author_id
         WHERE comment.poll_id = poll.id AND comment.deleted_at IS NULL
           AND author.status = 'active' AND author.deleted_at IS NULL
       )
  ) OR EXISTS (
    SELECT 1 FROM poll_options option JOIN target_polls target ON target.poll_id = option.poll_id
    WHERE option.votes_count <> (SELECT count(*)::int FROM poll_votes WHERE option_id = option.id)
  ) OR EXISTS (
    SELECT 1 FROM comments comment JOIN target_comments target ON target.comment_id = comment.id
    WHERE comment.replies_count <> (
      SELECT count(*)::int FROM comments reply
      JOIN users author ON author.id = reply.author_id
      WHERE reply.parent_comment_id = comment.id AND reply.deleted_at IS NULL
        AND author.status = 'active' AND author.deleted_at IS NULL
      ) OR comment.likes_count <> (SELECT count(*)::int FROM likes WHERE comment_id = comment.id)
  ) OR EXISTS (
    SELECT 1 FROM profiles profile
    JOIN account_deletion_counter_targets target ON target.target_id = profile.user_id
    WHERE target.operation_id = $1 AND target.target_type = 'profile'
      AND (profile.followers_count <> (SELECT count(*)::int FROM follows WHERE followee_id = profile.user_id)
        OR profile.following_count <> (SELECT count(*)::int FROM follows WHERE follower_id = profile.user_id))
  ) AS exists`;

const RESIDUAL_SQL = `
  WITH deleted_targets AS (
    SELECT target_type, target_id FROM account_deletion_deleted_content_targets WHERE operation_id = $2
  ), deleted_polls AS (SELECT target_id AS id FROM deleted_targets WHERE target_type = 'poll'),
       deleted_comments AS (SELECT target_id AS id FROM deleted_targets WHERE target_type = 'comment')
  SELECT
    ($3::boolean AND (EXISTS (SELECT 1 FROM users WHERE id = $1)
      OR EXISTS (SELECT 1 FROM profiles WHERE user_id = $1)))
    OR EXISTS (SELECT 1 FROM polls WHERE author_id = $1)
    OR EXISTS (SELECT 1 FROM poll_votes WHERE voter_id = $1)
    OR EXISTS (SELECT 1 FROM comments WHERE author_id = $1 OR
       parent_comment_id IN (SELECT id FROM deleted_comments))
    OR EXISTS (SELECT 1 FROM likes WHERE user_id = $1 OR
       poll_id IN (SELECT id FROM deleted_polls) OR comment_id IN (SELECT id FROM deleted_comments))
    OR EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 OR followee_id = $1)
    OR EXISTS (SELECT 1 FROM notifications WHERE recipient_user_id = $1 OR actor_user_id = $1)
    OR EXISTS (SELECT 1 FROM notifications WHERE poll_id IN (SELECT id FROM deleted_polls)
       OR comment_id IN (SELECT id FROM deleted_comments))
    OR EXISTS (SELECT 1 FROM notification_push_jobs WHERE recipient_user_id = $1)
    OR EXISTS (SELECT 1 FROM notification_push_jobs WHERE poll_id IN (SELECT id FROM deleted_polls)
       OR comment_id IN (SELECT id FROM deleted_comments))
    OR EXISTS (SELECT 1 FROM notification_devices WHERE user_id = $1)
    OR EXISTS (SELECT 1 FROM notification_preferences WHERE user_id = $1)
    OR EXISTS (SELECT 1 FROM reports WHERE reporter_user_id = $1 OR
       (target_type = 'user' AND target_id = $1) OR
       (target_type = 'poll' AND target_id IN (SELECT id FROM deleted_polls)) OR
       (target_type = 'comment' AND target_id IN (SELECT id FROM deleted_comments)))
    OR EXISTS (SELECT 1 FROM moderation_cases WHERE assigned_to_user_id = $1 OR
       (target_type = 'user' AND target_id = $1) OR
       (target_type = 'poll' AND target_id IN (SELECT id FROM deleted_polls)) OR
       (target_type = 'comment' AND target_id IN (SELECT id FROM deleted_comments)))
    OR EXISTS (SELECT 1 FROM moderation_case_notes WHERE author_user_id = $1)
    OR EXISTS (SELECT 1 FROM appeals WHERE user_id = $1 OR resolved_by_user_id = $1)
    OR EXISTS (SELECT 1 FROM sanctions WHERE user_id = $1 OR created_by_user_id = $1 OR revoked_by_user_id = $1)
    OR EXISTS (SELECT 1 FROM user_strikes WHERE user_id = $1)
    OR EXISTS (SELECT 1 FROM moderation_idempotency_keys WHERE actor_user_id = $1)
    OR EXISTS (SELECT 1 FROM admin_audit_log WHERE actor_user_id = $1 OR
       (target_type = 'user' AND target_id = $1) OR
       (target_type = 'poll' AND target_id IN (SELECT id FROM deleted_polls)) OR
       (target_type = 'comment' AND target_id IN (SELECT id FROM deleted_comments)))
    OR EXISTS (SELECT 1 FROM moderation_policies WHERE updated_by_user_id = $1)
    OR EXISTS (SELECT 1 FROM account_deletion_media_manifest WHERE operation_id = $2 AND status <> 'completed')
    AS exists`;

export function createAccountDeletionCompletionRepository(executor: Database = db): AccountDeletionCompletionRepository {
  async function inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await executor.connect();
    try {
      await client.query('BEGIN');
      const value = await run(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function hasRemainders(operationId: string, userId: string, includeIdentity: boolean) {
    const [residual, counts] = await Promise.all([
      executor.query<{ exists: boolean }>(RESIDUAL_SQL, [userId, operationId, includeIdentity]),
      executor.query<{ exists: boolean }>(COUNT_CHECK_SQL, [operationId])
    ]);
    return residual.rows[0]?.exists === true || counts.rows[0]?.exists === true;
  }

  return {
    async getOperation(operationId) {
      const result = await executor.query<{ user_id: string; status: string }>(
        'SELECT user_id, status FROM account_deletion_operations WHERE id = $1',
        [operationId]
      );
      const row = result.rows[0];
      return row ? { userId: row.user_id, status: row.status } : null;
    },
    async arePreviousStepsComplete(operationId) {
      const requiredBeforeCompletion = REQUIRED_PRE_COMPLETION_STEPS;
      const result = await executor.query<{ total: number; required: number; completed: number; completion_processing: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE step_key = ANY($2::text[]))::int AS required,
                count(*) FILTER (WHERE step_key = ANY($2::text[]) AND status = 'completed')::int AS completed,
                count(*) FILTER (WHERE step_key = 'completion' AND status = 'processing')::int AS completion_processing
         FROM account_deletion_steps WHERE operation_id = $1`,
        [operationId, requiredBeforeCompletion]
      );
      const row = result.rows[0];
      return row?.total === REQUIRED_PRE_COMPLETION_STEPS.length + 1
        && row.required === REQUIRED_PRE_COMPLETION_STEPS.length
        && row.completed === requiredBeforeCompletion.length
        && row.completion_processing === 1;
    },
    hasDatabaseRemainders(operationId, userId) {
      return hasRemainders(operationId, userId, false);
    },
    async deleteUser(userId) {
      await inTransaction(async (client) => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
      });
    },
    hasPostDeleteRemainders(operationId, userId) {
      return hasRemainders(operationId, userId, true);
    },
    async removeManifest(operationId) {
      await executor.query('DELETE FROM account_deletion_media_manifest WHERE operation_id = $1', [operationId]);
    },
    async removeContentTargets(operationId) {
      await executor.query('DELETE FROM account_deletion_content_targets WHERE operation_id = $1', [operationId]);
    },
    async removeDeletedContentTargets(operationId) {
      await executor.query('DELETE FROM account_deletion_deleted_content_targets WHERE operation_id = $1', [operationId]);
    },
    async removeCounterTargets(operationId) {
      await executor.query('DELETE FROM account_deletion_counter_targets WHERE operation_id = $1', [operationId]);
    }
  };
}

export function createAccountDeletionCompletionService(input: {
  repository: AccountDeletionCompletionRepository;
  media: AccountDeletionCompletionMedia;
}) {
  return {
    async verifyAndCompleteDeletion(operationId: string): Promise<{ done: boolean }> {
      const operation = await input.repository.getOperation(operationId);
      if (!operation) throw new Error('account_deletion_operation_not_found');
      if (operation.status === 'completed') return { done: true };
      if (operation.status !== 'processing' || !await input.repository.arePreviousStepsComplete(operationId)) {
        return { done: false };
      }

      const discovered = await input.media.discover(operationId);
      if (!discovered.done) return { done: false };
      const purged = await input.media.purge(operationId);
      if (!purged.done || !await input.media.verifyEmpty(operationId)) return { done: false };
      if (await input.repository.hasDatabaseRemainders(operationId, operation.userId)) return { done: false };

      await input.repository.deleteUser(operation.userId);
      if (await input.repository.hasPostDeleteRemainders(operationId, operation.userId)) return { done: false };

      await input.repository.removeManifest(operationId);
      await input.repository.removeContentTargets(operationId);
      await input.repository.removeDeletedContentTargets(operationId);
      await input.repository.removeCounterTargets(operationId);
      return { done: true };
    }
  };
}

const completionService = createAccountDeletionCompletionService({
  repository: createAccountDeletionCompletionRepository(),
  media: {
    discover: discoverAccountMedia,
    purge: purgeAccountMedia,
    verifyEmpty: verifyAccountMediaEmpty
  }
});

export const verifyAndCompleteDeletion = completionService.verifyAndCompleteDeletion;
