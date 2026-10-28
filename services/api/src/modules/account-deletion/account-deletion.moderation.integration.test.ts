import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';

const [{ db, closeDatabaseConnection }, { closeRedisConnection }, { closeStorageConnection }, { purgeAccountModerationData }, { getModerationCase }] = await Promise.all([
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('../../config/storage.js'),
  import('./account-deletion.moderation.js'),
  import('../moderation/moderation.repository.js')
]);

const userIds = new Set<string>();
const operationIds = new Set<string>();

function suffix() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

async function createUser() {
  const id = randomUUID();
  const username = `ad09_${suffix()}`;
  await db.query('INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)', [id, `${username}@yaskapp.test`, username, 'test-hash']);
  await db.query('INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)', [id, username]);
  userIds.add(id);
  return id;
}

async function createOperation(userId: string) {
  const id = randomUUID();
  await db.query(`INSERT INTO account_deletion_operations (id, user_id, status, accepted_at, deadline_at)
    VALUES ($1, $2, 'pending', now(), now() + interval '24 hours')`, [id, userId]);
  await db.query("UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = $1", [userId]);
  operationIds.add(id);
  return id;
}

async function finishPurge(operationId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await purgeAccountModerationData(operationId)).done) return;
  }
  assert.fail('moderation cleanup did not finish within 20 batches');
}

after(async () => {
  for (const id of operationIds) await db.query('DELETE FROM account_deletion_operations WHERE id = $1', [id]);
  for (const id of userIds) await db.query('DELETE FROM users WHERE id = $1', [id]);
  await closeDatabaseConnection();
  await closeRedisConnection();
  await closeStorageConnection();
});

test('foreign_report_keeps_resolution_without_snapshot', async () => {
  const deletedUserId = await createUser();
  const reporterId = await createUser();
  const moderatorId = await createUser();
  const operationId = await createOperation(deletedUserId);
  const foreignReportId = randomUUID();
  const ownedReportId = randomUUID();
  const caseId = randomUUID();
  await db.query(`INSERT INTO reports (id, reporter_user_id, target_type, target_id, category, description, status)
    VALUES ($1, $2, 'user', $3, 'harassment', 'PII copied from deleted profile', 'resolved'),
           ($4, $5, 'user', $6, 'spam', 'My report', 'open')`,
  [foreignReportId, reporterId, deletedUserId, ownedReportId, deletedUserId, reporterId]);
  await db.query(`INSERT INTO moderation_cases (id, target_type, target_id, status, assigned_to_user_id, resolution_code, resolution_note, resolved_at)
    VALUES ($1, 'user', $2, 'resolved', $3, 'action_taken', 'Snapshot includes private details', now())`,
  [caseId, deletedUserId, moderatorId]);
  await db.query('INSERT INTO moderation_case_reports (case_id, report_id) VALUES ($1, $2)', [caseId, foreignReportId]);

  await finishPurge(operationId);

  const report = await db.query<{ target_id: string | null; description: string; status: string }>(
    'SELECT target_id, description, status FROM reports WHERE id = $1', [foreignReportId]);
  const ownReport = await db.query('SELECT id FROM reports WHERE id = $1', [ownedReportId]);
  const moderationCase = await db.query<{ target_id: string | null; resolution_code: string; resolution_note: string | null }>(
    'SELECT target_id, resolution_code, resolution_note FROM moderation_cases WHERE id = $1', [caseId]);
  const caseView = await getModerationCase(caseId);
  assert.equal(report.rows[0]?.target_id, null);
  assert.equal(report.rows[0]?.description, 'Removed during account deletion.');
  assert.equal(report.rows[0]?.status, 'resolved');
  assert.equal(ownReport.rowCount, 0);
  assert.equal(moderationCase.rows[0]?.target_id, null);
  assert.equal(moderationCase.rows[0]?.resolution_code, 'action_taken');
  assert.equal(moderationCase.rows[0]?.resolution_note, null);
  assert.equal(caseView.case.targetId, null);
  assert.equal(caseView.case.targetAvailable, false);
});

test('deleted_moderator_releases_assigned_case', async () => {
  const deletedModeratorId = await createUser();
  const targetId = await createUser();
  const operationId = await createOperation(deletedModeratorId);
  const caseId = randomUUID();
  await db.query(`INSERT INTO moderation_cases (id, target_type, target_id, status, assigned_to_user_id)
    VALUES ($1, 'user', $2, 'in_review', $3)`, [caseId, targetId, deletedModeratorId]);
  await db.query(`INSERT INTO moderation_case_notes (case_id, author_user_id, body)
    VALUES ($1, $2, 'Moderator note with private content')`, [caseId, deletedModeratorId]);

  await finishPurge(operationId);

  const moderationCase = await db.query<{ assigned_to_user_id: string | null }>(
    'SELECT assigned_to_user_id FROM moderation_cases WHERE id = $1', [caseId]);
  const note = await db.query<{ author_user_id: string | null; body: string }>(
    'SELECT author_user_id, body FROM moderation_case_notes WHERE case_id = $1', [caseId]);
  assert.equal(moderationCase.rows[0]?.assigned_to_user_id, null);
  assert.equal(note.rows[0]?.author_user_id, null);
  assert.equal(note.rows[0]?.body, 'Removed during account deletion.');
});
