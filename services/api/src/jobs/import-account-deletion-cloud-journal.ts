import type {
  AccountDeletionJournal,
  AccountDeletionJournalEntry
} from '../modules/account-deletion/account-deletion.journal.js';
import {
  verifyLegacyAccountDeletionJournalEntry,
  type LegacyAccountDeletionJournalEntry,
  type LegacyAccountDeletionJournalSource
} from '../modules/account-deletion/account-deletion.legacy-s3-journal.js';

type ImportableEntry = AccountDeletionJournalEntry;

function sameEntry(left: LegacyAccountDeletionJournalEntry, right: LegacyAccountDeletionJournalEntry) {
  return left.version === right.version && left.state === right.state && left.operationId === right.operationId &&
    left.intentId === right.intentId && left.userId === right.userId && left.acceptedAt === right.acceptedAt &&
    left.deadlineAt === right.deadlineAt && left.hmac === right.hmac;
}

function sameAcceptance(left: LegacyAccountDeletionJournalEntry, right: LegacyAccountDeletionJournalEntry) {
  return left.operationId === right.operationId && left.intentId === right.intentId && left.userId === right.userId &&
    left.acceptedAt === right.acceptedAt && left.deadlineAt === right.deadlineAt;
}

function deduplicateEntries(
  values: unknown[],
  states: LegacyAccountDeletionJournalEntry['state'][],
  signingKey: string
) {
  const entries = new Map<string, LegacyAccountDeletionJournalEntry>();
  for (const value of values) {
    if (!verifyLegacyAccountDeletionJournalEntry(value, signingKey) || !states.includes(value.state)) {
      throw new Error('account_deletion_legacy_journal_integrity_failed');
    }
    const entry = value;
    const key = `${entry.state}:${entry.operationId}`;
    const existing = entries.get(key);
    if (existing && !sameEntry(existing, entry)) throw new Error('account_deletion_legacy_journal_conflict');
    entries.set(key, entry);
  }
  return [...entries.values()];
}

function asRuntimeEntry(entry: LegacyAccountDeletionJournalEntry): ImportableEntry {
  if (entry.state === 'checkpoint') throw new Error('account_deletion_legacy_journal_checkpoint_incomplete');
  return {
    version: entry.version,
    state: entry.state,
    operationId: entry.operationId,
    intentId: entry.intentId,
    userId: entry.userId,
    acceptedAt: entry.acceptedAt,
    deadlineAt: entry.deadlineAt,
    hmac: entry.hmac
  };
}

export async function importLegacyAccountDeletionJournal(
  source: LegacyAccountDeletionJournalSource,
  target: Pick<AccountDeletionJournal, 'assertReady' | 'importEntry'>,
  signingKey = process.env.ACCOUNT_DELETION_JOURNAL_HMAC_KEY ?? ''
): Promise<{ prepared: number; accepted: number; conflicts: number }> {
  if (signingKey.length < 32) throw new Error('account_deletion_journal_hmac_key_too_short');

  const inventory = await source.readInventory();
  const entries = deduplicateEntries(inventory.entries, ['prepared', 'accepted'], signingKey);
  const checkpoints = deduplicateEntries(inventory.checkpoints, ['checkpoint'], signingKey);
  const preparedByOperation = new Map(
    entries.filter((entry) => entry.state === 'prepared').map((entry) => [entry.operationId, entry])
  );
  const acceptedByOperation = new Map(
    entries.filter((entry) => entry.state === 'accepted').map((entry) => [entry.operationId, entry])
  );
  const checkpointsByOperation = new Map(checkpoints.map((entry) => [entry.operationId, entry]));

  for (const accepted of acceptedByOperation.values()) {
    const prepared = preparedByOperation.get(accepted.operationId);
    if (!prepared || !sameAcceptance(prepared, accepted)) {
      throw new Error('account_deletion_legacy_journal_incomplete');
    }
    const checkpoint = checkpointsByOperation.get(accepted.operationId);
    if (!checkpoint || !sameAcceptance(checkpoint, accepted)) {
      throw new Error('account_deletion_legacy_journal_checkpoint_incomplete');
    }
    checkpointsByOperation.delete(accepted.operationId);
  }
  if (checkpointsByOperation.size > 0) {
    throw new Error('account_deletion_legacy_journal_checkpoint_incomplete');
  }

  // Validate the complete source before touching the destination. The journal
  // itself verifies each original signature again before persisting it.
  await target.assertReady();
  for (const entry of entries.filter((candidate) => candidate.state === 'prepared')) {
    await target.importEntry(asRuntimeEntry(entry));
  }
  for (const entry of entries.filter((candidate) => candidate.state === 'accepted')) {
    await target.importEntry(asRuntimeEntry(entry));
  }

  return {
    prepared: preparedByOperation.size,
    accepted: acceptedByOperation.size,
    conflicts: 0
  };
}
