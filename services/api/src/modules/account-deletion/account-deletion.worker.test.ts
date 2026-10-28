import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DELETION_STEP_ORDER,
  accountDeletionStepHandlers,
  assertDeletionStepHandlersReady,
  processDeletionBatch,
  type AccountDeletionWorkerRepository,
  type DeletionStepHandler
} from './account-deletion.worker.js';

test('production_worker_handlers_cover_every_step', () => {
  assert.doesNotThrow(() => assertDeletionStepHandlersReady(accountDeletionStepHandlers));
});

type MemoryOperation = {
  id: string;
  status: 'pending' | 'processing' | 'retrying' | 'completed';
  attempts: number;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  availableAt: Date;
};

type MemoryRepository = AccountDeletionWorkerRepository & { transferLease(operationId: string, owner: string): void };

function createMemoryRepository(ids: string[]): MemoryRepository {
  const operations = new Map<string, MemoryOperation>(ids.map((id) => [id, {
    id, status: 'pending', attempts: 0, leaseOwner: null, leaseUntil: null, availableAt: new Date(0)
  }]));
  const completedSteps = new Map<string, Set<string>>();
  const processingSteps = new Map<string, string>();

  const ownsLease = (operationId: string, owner: string) => operations.get(operationId)?.leaseOwner === owner;
  return {
    transferLease(operationId, owner) {
      const row = operations.get(operationId);
      if (row) row.leaseOwner = owner;
    },
    async claim(limit, now, leaseOwner) {
      const rows = [...operations.values()]
        .filter((row) => row.status !== 'completed' && row.availableAt <= now && (!row.leaseUntil || row.leaseUntil <= now))
        .slice(0, limit);
      return rows.map((row) => {
        row.status = 'processing';
        row.leaseOwner = leaseOwner;
        row.leaseUntil = new Date(now.getTime() + 120_000);
        return { operationId: row.id, attempts: row.attempts, leaseOwner };
      });
    },
    async nextStep(operationId) {
      const completed = completedSteps.get(operationId) ?? new Set<string>();
      return DELETION_STEP_ORDER.find((stepKey) => !completed.has(stepKey)) ?? null;
    },
    async allStepsCompleted(operationId) {
      return (completedSteps.get(operationId)?.size ?? 0) === DELETION_STEP_ORDER.length;
    },
    async markStepProcessing(operationId, stepKey, leaseOwner) {
      if (!ownsLease(operationId, leaseOwner)) return false;
      processingSteps.set(operationId, stepKey);
      return true;
    },
    async markStepCompleted(operationId, stepKey, leaseOwner) {
      if (!ownsLease(operationId, leaseOwner)) return false;
      const completed = completedSteps.get(operationId) ?? new Set<string>();
      completed.add(stepKey);
      completedSteps.set(operationId, completed);
      processingSteps.delete(operationId);
      return true;
    },
    async markStepPending(operationId, stepKey, leaseOwner) {
      if (!ownsLease(operationId, leaseOwner)) return false;
      assert.equal(processingSteps.get(operationId), stepKey);
      processingSteps.delete(operationId);
      return true;
    },
    async markStepRetrying(operationId, stepKey, leaseOwner) {
      if (!ownsLease(operationId, leaseOwner)) return false;
      assert.equal(processingSteps.get(operationId), stepKey);
      return true;
    },
    async renewLease(operationId, leaseOwner, now) {
      const row = operations.get(operationId);
      if (!row || row.leaseOwner !== leaseOwner) return false;
      row.leaseUntil = new Date(now.getTime() + 120_000);
      return true;
    },
    async yieldOperation(operationId, leaseOwner, now) {
      const row = operations.get(operationId);
      if (row?.leaseOwner !== leaseOwner) return false;
      row.status = 'pending';
      row.availableAt = now;
      row.leaseOwner = null;
      row.leaseUntil = null;
      return true;
    },
    async retryOperation(operationId, leaseOwner, now, delaySeconds) {
      const row = operations.get(operationId);
      if (row?.leaseOwner !== leaseOwner) return false;
      row.status = 'retrying';
      row.attempts += 1;
      row.availableAt = new Date(now.getTime() + delaySeconds * 1_000);
      row.leaseOwner = null;
      row.leaseUntil = null;
      return true;
    },
    async completeOperation(operationId, leaseOwner) {
      const row = operations.get(operationId);
      if (!row || row.leaseOwner !== leaseOwner) return false;
      row.status = 'completed';
      row.leaseOwner = null;
      row.leaseUntil = null;
      return true;
    }
  };
}

function completeEveryStep(): Record<string, DeletionStepHandler> {
  return Object.fromEntries(DELETION_STEP_ORDER.map((stepKey) => [stepKey, async () => ({ done: true })]));
}

test('two_workers_claim_once', async () => {
  const repository = createMemoryRepository(['operation-1']);
  let entered!: () => void;
  let release!: () => void;
  const handlerEntered = new Promise<void>((resolve) => { entered = resolve; });
  const handlerRelease = new Promise<void>((resolve) => { release = resolve; });
  const handlers = completeEveryStep();
  handlers.discovery = async () => {
    entered();
    await handlerRelease;
    return { done: true };
  };

  const first = processDeletionBatch({ limit: 1, now: new Date('2026-10-12T10:00:00Z') }, { repository, handlers });
  const didStart = await Promise.race([
    handlerEntered.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25))
  ]);
  const second = await processDeletionBatch({ limit: 1, now: new Date('2026-10-12T10:00:01Z') }, { repository, handlers });
  release();
  const firstResult = await first;

  assert.equal(didStart, true, 'the claimed operation must reach its first step');
  assert.deepEqual(second, { processed: 0, completed: 0, retrying: 0 });
  assert.deepEqual(firstResult, { processed: 1, completed: 1, retrying: 0 });
});

test('expired_lease_resumes', async () => {
  const repository = createMemoryRepository(['operation-1']);
  await repository.claim(1, new Date('2026-10-12T10:00:00Z'), 'crashed-worker');

  const resumed = await processDeletionBatch({ limit: 1, now: new Date('2026-10-12T10:02:01Z') }, { repository, handlers: completeEveryStep() });
  assert.deepEqual(resumed, { processed: 1, completed: 1, retrying: 0 });
});

test('restart_keeps_step_progress', async () => {
  const repository = createMemoryRepository(['operation-1']);
  let discoveryRuns = 0;
  await processDeletionBatch({ limit: 1, now: new Date('2026-10-12T10:00:00Z') }, {
    repository,
    handlers: { ...completeEveryStep(), discovery: async () => { discoveryRuns += 1; return { done: true }; }, notifications: async () => ({ done: false }) }
  });

  const resumed = await processDeletionBatch({ limit: 1, now: new Date('2026-10-12T10:00:01Z') }, { repository, handlers: completeEveryStep() });
  assert.equal(discoveryRuns, 1);
  assert.deepEqual(resumed, { processed: 1, completed: 1, retrying: 0 });
});

test('retry_does_not_repeat_committed_step', async () => {
  const repository = createMemoryRepository(['operation-1']);
  let discoveryRuns = 0;
  const failingHandlers = {
    ...completeEveryStep(),
    discovery: async () => { discoveryRuns += 1; return { done: true }; },
    notifications: async () => { throw new Error('temporary failure'); }
  };
  const first = await processDeletionBatch({ limit: 1, now: new Date('2026-10-12T10:00:00Z') }, { repository, handlers: failingHandlers });
  const second = await processDeletionBatch({ limit: 1, now: new Date('2026-10-12T10:00:05Z') }, { repository, handlers: completeEveryStep() });

  assert.deepEqual(first, { processed: 1, completed: 0, retrying: 1 });
  assert.deepEqual(second, { processed: 1, completed: 1, retrying: 0 });
  assert.equal(discoveryRuns, 1);
});

test('large_account_yields_between_batches', async () => {
  const repository = createMemoryRepository(['operation-1', 'operation-2']);
  let discoveryBatches = 0;
  const handlers = {
    ...completeEveryStep(),
    discovery: async (operationId: string) => {
      if (operationId === 'operation-1') {
        discoveryBatches += 1;
        return { done: false };
      }
      return { done: true };
    }
  };

  const firstBatch = await processDeletionBatch({ limit: 2, now: new Date('2026-10-12T10:00:00Z') }, { repository, handlers });
  const secondBatch = await processDeletionBatch({ limit: 1, now: new Date('2026-10-12T10:00:01Z') }, { repository, handlers: completeEveryStep() });

  assert.equal(discoveryBatches, 1);
  assert.deepEqual(firstBatch, { processed: 2, completed: 1, retrying: 0 });
  assert.deepEqual(secondBatch, { processed: 1, completed: 1, retrying: 0 });
});

test('missing_required_step_never_marks_operation_completed', async () => {
  const repository = createMemoryRepository(['operation-1']);
  const result = await processDeletionBatch(
    { limit: 1, now: new Date('2026-10-12T10:00:00Z') },
    { repository, handlers: {} }
  );

  assert.deepEqual(result, { processed: 1, completed: 0, retrying: 1 });
});

test('expired_worker_cannot_commit_a_step_after_lease_transfer', async () => {
  const repository = createMemoryRepository(['operation-1']);
  const handlers = completeEveryStep();
  handlers.discovery = async () => {
    repository.transferLease('operation-1', 'new-owner');
    return { done: true };
  };

  const result = await processDeletionBatch(
    { limit: 1, now: new Date('2026-10-12T10:00:00Z') },
    { repository, handlers }
  );

  assert.deepEqual(result, { processed: 1, completed: 0, retrying: 0 });
});
