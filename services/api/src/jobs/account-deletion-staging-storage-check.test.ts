import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertBackupLifecycle, assertObjectLockReady, assertStorageSeparation } from './account-deletion-staging-storage-check.js';

test('staging journal bucket requires versioning and 35-day compliance lock', () => {
  assert.doesNotThrow(() => assertObjectLockReady('journal', {
    versioning: { Status: 'Enabled' },
    objectLock: {
      ObjectLockEnabled: 'Enabled',
      Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 35 } }
    }
  }));
});

test('staging journal bucket rejects a missing versioning configuration', () => {
  assert.throws(
    () => assertObjectLockReady('journal', {
      versioning: { Status: 'Suspended' },
      objectLock: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 35 } }
      }
    }),
    /account_deletion_storage_check:journal:versioning_not_enabled/
  );
});

test('staging journal bucket rejects governance mode or short retention', () => {
  assert.throws(
    () => assertObjectLockReady('checkpoint', {
      versioning: { Status: 'Enabled' },
      objectLock: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 30 } }
      }
    }),
    /account_deletion_storage_check:checkpoint:compliance_retention_below_35_days/
  );
});

test('backup bucket requires current and noncurrent expiry within 30 days', () => {
  assert.doesNotThrow(() => assertBackupLifecycle('backups', {
    Rules: [{
      Status: 'Enabled',
      Filter: { Prefix: '' },
      Expiration: { Days: 30 },
      NoncurrentVersionExpiration: { NoncurrentDays: 30 }
    }]
  }));
});

test('backup bucket rejects a missing or late lifecycle expiry', () => {
  assert.throws(
    () => assertBackupLifecycle('backups', {
      Rules: [{ Status: 'Enabled', Expiration: { Days: 31 } }]
    }),
    /account_deletion_storage_check:backups:current_expiry_missing_or_after_30_days/
  );
});

test('backup bucket requires noncurrent-version expiry within 30 days', () => {
  assert.throws(
    () => assertBackupLifecycle('backups', {
      Rules: [{ Status: 'Enabled', Expiration: { Days: 30 } }]
    }),
    /account_deletion_storage_check:backups:noncurrent_expiry_missing_or_after_30_days/
  );
});

test('backup bucket lifecycle must cover unfiltered objects', () => {
  assert.throws(
    () => assertBackupLifecycle('backups', {
      Rules: [{
        Status: 'Enabled',
        Filter: { Prefix: 'staging/' },
        Expiration: { Days: 30 },
        NoncurrentVersionExpiration: { NoncurrentDays: 30 }
      }]
    }),
    /account_deletion_storage_check:backups:current_expiry_missing_or_after_30_days/
  );
});

test('AWS checkpoint and backup may share an endpoint when buckets differ from B2 journal', () => {
  assert.doesNotThrow(() => assertStorageSeparation({
    journalEndpoint: 'https://s3.us-west-004.backblazeb2.com',
    checkpointEndpoint: 'https://s3.us-east-1.amazonaws.com',
    backupEndpoint: 'https://s3.us-east-1.amazonaws.com',
    journalBucket: 'b2-journal',
    checkpointBucket: 'aws-checkpoint',
    backupBucket: 'aws-backups'
  }));
});

test('journal and checkpoint must use distinct endpoints and buckets', () => {
  assert.throws(() => assertStorageSeparation({
    journalEndpoint: 'https://same-s3.example',
    checkpointEndpoint: 'https://same-s3.example',
    backupEndpoint: 'https://s3.example',
    journalBucket: 'journal',
    checkpointBucket: 'checkpoint',
    backupBucket: 'backups'
  }), /account_deletion_storage_check:journal_checkpoint:stores_must_be_distinct/);
});
