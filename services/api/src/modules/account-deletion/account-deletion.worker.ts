import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { purgeAccountContent } from './account-deletion.content.js';
import { purgeAccountModerationData } from './account-deletion.moderation.js';
import { purgeAccountNotifications } from './account-deletion.notifications.js';
import { purgeAccountRelationships } from './account-deletion.relationships.js';
import { discoverAccountMedia, purgeAccountMedia } from './account-deletion.media.js';
import { verifyAndCompleteDeletion } from './account-deletion.completion.js';

export const DELETION_STEP_ORDER = [
  'discovery', 'notifications', 'moderation', 'content', 'relationships', 'media', 'completion'
] as const;

export const DELETION_WORK_BATCH_SIZE = 100;
const LEASE_RENEWAL_MS = 30_000;
const INITIAL_RETRY_SECONDS = 5;
const MAX_RETRY_SECONDS = 15 * 60;

export type DeletionStepKey = typeof DELETION_STEP_ORDER[number];
export type DeletionStepResult = { done: boolean };
export type DeletionStepHandler = (operationId: string) => Promise<DeletionStepResult>;
export type ClaimedDeletionOperation = { operationId: string; attempts: number; leaseOwner: string };

export type AccountDeletionWorkerRepository = {
  claim(limit: number, now: Date, leaseOwner: string): Promise<ClaimedDeletionOperation[]>;
  nextStep(operationId: string): Promise<DeletionStepKey | null>;
  allStepsCompleted(operationId: string): Promise<boolean>;
  markStepProcessing(operationId: string, stepKey: DeletionStepKey, leaseOwner: string, now: Date): Promise<boolean>;
  markStepCompleted(operationId: string, stepKey: DeletionStepKey, leaseOwner: string, now: Date): Promise<boolean>;
  markStepPending(operationId: string, stepKey: DeletionStepKey, leaseOwner: string, now: Date): Promise<boolean>;
  markStepRetrying(operationId: string, stepKey: DeletionStepKey, leaseOwner: string, now: Date, delaySeconds: number, code: string): Promise<boolean>;
  renewLease(operationId: string, leaseOwner: string, now: Date): Promise<boolean>;
  yieldOperation(operationId: string, leaseOwner: string, now: Date): Promise<boolean>;
  retryOperation(operationId: string, leaseOwner: string, now: Date, delaySeconds: number, errorCode: string): Promise<boolean>;
  completeOperation(operationId: string, leaseOwner: string, now: Date): Promise<boolean>;
};

export type AccountDeletionWorkerDependencies = {
  repository: AccountDeletionWorkerRepository;
  handlers: Partial<Record<DeletionStepKey, DeletionStepHandler>>;
};

export class AccountDeletionStepError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
  }
}

function mapStepKey(value: string): DeletionStepKey {
  if ((DELETION_STEP_ORDER as readonly string[]).includes(value)) return value as DeletionStepKey;
  throw new AccountDeletionStepError('unknown_step');
}

async function claimDeletionOperations(limit: number, now: Date, leaseOwner: string, executor: typeof db): Promise<ClaimedDeletionOperation[]> {
  const client = await executor.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string; attempts: number }>(
      `WITH claimable AS (
         SELECT id FROM account_deletion_operations
         WHERE status IN ('pending', 'processing', 'retrying') AND accepted_at IS NOT NULL
           AND available_at <= $1 AND (lease_until IS NULL OR lease_until <= $1)
         ORDER BY available_at, accepted_at, id
         FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE account_deletion_operations operation
       SET status = 'processing', lease_owner = $3, lease_until = $1 + interval '120 seconds',
           updated_at = $1
       FROM claimable
       WHERE operation.id = claimable.id
       RETURNING operation.id, operation.attempts`,
      [now, limit, leaseOwner]
    );
    await client.query('COMMIT');
    return result.rows.map((row) => ({ operationId: row.id, attempts: row.attempts, leaseOwner }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function withClient<T>(run: (client: PoolClient) => Promise<T>, executor: typeof db): Promise<T> {
  const client = await executor.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export function createAccountDeletionWorkerRepository(executor: typeof db = db): AccountDeletionWorkerRepository {
  return {
  claim: (limit, now, owner) => claimDeletionOperations(limit, now, owner, executor),
  async nextStep(operationId) {
    return withClient(async (client) => {
      const result = await client.query<{ step_key: string; position: number }>(
        `SELECT step_key, position FROM account_deletion_steps
         WHERE operation_id = $1 AND status <> 'completed'
         ORDER BY position LIMIT 1`,
        [operationId]
      );
      if (!result.rows[0]) return null;
      const stepKey = mapStepKey(result.rows[0].step_key);
      if (DELETION_STEP_ORDER.indexOf(stepKey) !== result.rows[0].position) {
        throw new AccountDeletionStepError('step_order_invalid');
      }
      return stepKey;
    }, executor);
  },
  async allStepsCompleted(operationId) {
    return withClient(async (client) => {
      const result = await client.query<{ completed_count: number; total_count: number }>(
        `SELECT count(*) FILTER (WHERE step_key = ANY($2::text[]) AND status = 'completed')::int AS completed_count,
                count(*)::int AS total_count
         FROM account_deletion_steps WHERE operation_id = $1`,
        [operationId, [...DELETION_STEP_ORDER]]
      );
      return result.rows[0]?.completed_count === DELETION_STEP_ORDER.length
        && result.rows[0]?.total_count === DELETION_STEP_ORDER.length;
    }, executor);
  },
  async markStepProcessing(operationId, stepKey, leaseOwner, now) {
    const result = await executor.query(
      `UPDATE account_deletion_steps step
       SET status = 'processing', attempts = step.attempts + 1,
           started_at = COALESCE(started_at, $4), updated_at = $4
       FROM account_deletion_operations operation
       WHERE step.operation_id = $1 AND step.step_key = $2 AND step.status <> 'completed'
         AND operation.id = step.operation_id AND operation.lease_owner = $3
         AND operation.status = 'processing' AND operation.lease_until > $4`,
      [operationId, stepKey, leaseOwner, now]
    );
    return result.rowCount === 1;
  },
  async markStepCompleted(operationId, stepKey, leaseOwner, now) {
    const result = await executor.query(
      `UPDATE account_deletion_steps step
       SET status = 'completed', completed_at = $4, last_error_code = NULL, updated_at = $4
       FROM account_deletion_operations operation
       WHERE step.operation_id = $1 AND step.step_key = $2 AND step.status <> 'completed'
         AND operation.id = step.operation_id AND operation.lease_owner = $3
         AND operation.status = 'processing' AND operation.lease_until > $4`,
      [operationId, stepKey, leaseOwner, now]
    );
    if (result.rowCount === 1) {
      await executor.query(
        `UPDATE account_deletion_operations SET retry_started_at = NULL
         WHERE id = $1 AND lease_owner = $2 AND status = 'processing'`,
        [operationId, leaseOwner]
      );
    }
    return result.rowCount === 1;
  },
  async markStepPending(operationId, stepKey, leaseOwner, now) {
    const result = await executor.query(
      `UPDATE account_deletion_steps step SET status = 'pending', updated_at = $4
       FROM account_deletion_operations operation
       WHERE step.operation_id = $1 AND step.step_key = $2 AND step.status <> 'completed'
         AND operation.id = step.operation_id AND operation.lease_owner = $3
         AND operation.status = 'processing' AND operation.lease_until > $4`,
      [operationId, stepKey, leaseOwner, now]
    );
    return result.rowCount === 1;
  },
  async markStepRetrying(operationId, stepKey, leaseOwner, now, delaySeconds, code) {
    const result = await executor.query(
      `UPDATE account_deletion_steps step
       SET status = 'retrying', available_at = $4 + ($5::text || ' seconds')::interval,
           last_error_code = $6, updated_at = $4
       FROM account_deletion_operations operation
       WHERE step.operation_id = $1 AND step.step_key = $2 AND step.status <> 'completed'
         AND operation.id = step.operation_id AND operation.lease_owner = $3
         AND operation.status = 'processing' AND operation.lease_until > $4`,
      [operationId, stepKey, leaseOwner, now, delaySeconds, code]
    );
    return result.rowCount === 1;
  },
  async renewLease(operationId, leaseOwner, now) {
    const result = await executor.query(
      `UPDATE account_deletion_operations SET lease_until = $3 + interval '120 seconds', updated_at = $3
       WHERE id = $1 AND lease_owner = $2 AND status = 'processing'`,
      [operationId, leaseOwner, now]
    );
    return result.rowCount === 1;
  },
  async yieldOperation(operationId, leaseOwner, now) {
    const result = await executor.query(
      `UPDATE account_deletion_operations
       SET status = 'pending', available_at = $3, lease_owner = NULL, lease_until = NULL, updated_at = $3
       WHERE id = $1 AND lease_owner = $2 AND status = 'processing' AND lease_until > $3`,
      [operationId, leaseOwner, now]
    );
    return result.rowCount === 1;
  },
  async retryOperation(operationId, leaseOwner, now, delaySeconds, errorCode) {
    const result = await executor.query(
      `UPDATE account_deletion_operations
       SET status = 'retrying', available_at = $3 + ($4::text || ' seconds')::interval,
           lease_owner = NULL, lease_until = NULL, attempts = attempts + 1,
           last_error_code = $5, retry_started_at = COALESCE(retry_started_at, $3), updated_at = $3
       WHERE id = $1 AND lease_owner = $2 AND status = 'processing' AND lease_until > $3`,
      [operationId, leaseOwner, now, delaySeconds, errorCode]
    );
    return result.rowCount === 1;
  },
  async completeOperation(operationId, leaseOwner, now) {
    const result = await executor.query(
      `UPDATE account_deletion_operations operation
       SET status = 'completed', completed_at = $3, lease_owner = NULL, lease_until = NULL,
           last_error_code = NULL, retry_started_at = NULL, updated_at = $3
       WHERE id = $1 AND lease_owner = $2 AND status = 'processing'
         AND operation.lease_until > $3
         AND (SELECT count(*) FROM account_deletion_steps step
              WHERE step.operation_id = operation.id
                AND step.step_key = ANY($4::text[]) AND step.status = 'completed') = $5
         AND (SELECT count(*) FROM account_deletion_steps step
              WHERE step.operation_id = operation.id) = $5`,
      [operationId, leaseOwner, now, [...DELETION_STEP_ORDER], DELETION_STEP_ORDER.length]
    );
    return result.rowCount === 1;
  }
  };
}

const databaseRepository = createAccountDeletionWorkerRepository();

function retryDelaySeconds(attempts: number) {
  return Math.min(INITIAL_RETRY_SECONDS * (2 ** Math.max(0, attempts - 1)), MAX_RETRY_SECONDS);
}

function errorCode(error: unknown) {
  const candidate = error instanceof AccountDeletionStepError ? error.code : 'step_failed';
  return /^[a-z][a-z0-9_]{0,63}$/.test(candidate) ? candidate : 'step_failed';
}

async function runStepWithLeaseRenewal(
  operation: ClaimedDeletionOperation,
  step: DeletionStepHandler,
  repository: AccountDeletionWorkerRepository
) {
  let renewalFailure: Error | null = null;
  const timer = setInterval(() => {
    void repository.renewLease(operation.operationId, operation.leaseOwner, new Date())
      .then((renewed) => { if (!renewed) renewalFailure = new Error('lease_lost'); })
      .catch(() => { renewalFailure = new Error('lease_renewal_failed'); });
  }, LEASE_RENEWAL_MS);
  timer.unref?.();
  try {
    const result = await step(operation.operationId);
    if (renewalFailure) throw renewalFailure;
    return result;
  } finally {
    clearInterval(timer);
  }
}

export async function processDeletionBatch(
  input: { limit: number; now: Date },
  dependencies: AccountDeletionWorkerDependencies = { repository: databaseRepository, handlers: accountDeletionStepHandlers }
): Promise<{ processed: number; completed: number; retrying: number }> {
  const limit = Math.max(1, Math.min(Math.floor(input.limit), DELETION_WORK_BATCH_SIZE));
  const claimed = await dependencies.repository.claim(limit, input.now, randomUUID());
  let completed = 0;
  let retrying = 0;

  for (const operation of claimed) {
    let activeStep: DeletionStepKey | null = null;
    try {
      while (true) {
        const stepKey = await dependencies.repository.nextStep(operation.operationId);
        if (!stepKey) {
          if (!await dependencies.repository.allStepsCompleted(operation.operationId)) {
            throw new AccountDeletionStepError('required_steps_missing');
          }
          if (!await dependencies.repository.completeOperation(operation.operationId, operation.leaseOwner, input.now)) {
            throw new AccountDeletionStepError('completion_blocked');
          }
          completed += 1;
          break;
        }
        const handler = dependencies.handlers[stepKey];
        if (!handler) throw new AccountDeletionStepError('step_handler_unavailable');

        activeStep = stepKey;
        if (!await dependencies.repository.markStepProcessing(operation.operationId, stepKey, operation.leaseOwner, input.now)) {
          throw new AccountDeletionStepError('lease_lost');
        }
        const result = await runStepWithLeaseRenewal(operation, handler, dependencies.repository);
        if (result.done) {
          if (!await dependencies.repository.markStepCompleted(operation.operationId, stepKey, operation.leaseOwner, input.now)) {
            throw new AccountDeletionStepError('lease_lost');
          }
          activeStep = null;
          continue;
        }

        if (!await dependencies.repository.markStepPending(operation.operationId, stepKey, operation.leaseOwner, input.now)) {
          throw new AccountDeletionStepError('lease_lost');
        }
        activeStep = null;
        await dependencies.repository.yieldOperation(operation.operationId, operation.leaseOwner, input.now);
        break;
      }
    } catch (error) {
      const code = errorCode(error);
      const delaySeconds = retryDelaySeconds(operation.attempts + 1);
      if (activeStep) {
        await dependencies.repository.markStepRetrying(operation.operationId, activeStep, operation.leaseOwner, input.now, delaySeconds, code);
      }
      const scheduled = await dependencies.repository.retryOperation(
        operation.operationId,
        operation.leaseOwner,
        input.now,
        delaySeconds,
        code
      );
      if (scheduled) retrying += 1;
    }
  }

  return { processed: claimed.length, completed, retrying };
}

export const accountDeletionStepHandlers: Partial<Record<DeletionStepKey, DeletionStepHandler>> = {
  discovery: discoverAccountMedia,
  notifications: purgeAccountNotifications,
  moderation: purgeAccountModerationData,
  content: purgeAccountContent,
  relationships: purgeAccountRelationships,
  media: purgeAccountMedia,
  completion: verifyAndCompleteDeletion
};

export function assertDeletionStepHandlersReady(handlers: Partial<Record<DeletionStepKey, DeletionStepHandler>>) {
  const missing = DELETION_STEP_ORDER.filter((step) => !handlers[step]);
  if (missing.length) throw new Error(`Account deletion worker is missing required steps: ${missing.join(', ')}`);
}
