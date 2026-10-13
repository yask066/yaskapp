import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountDeletionMediaService, type DeletionMediaObject } from './account-deletion.media.js';

function fixture() {
  const manifest = new Map<string, DeletionMediaObject>();
  const deleted: DeletionMediaObject[][] = [];
  let failDelete = false;
  const listed = new Map<string, DeletionMediaObject[][]>();
  const service = createAccountDeletionMediaService({
    repository: {
      async getOwner() { return 'user-1'; },
      async getReferencedKeys() { return ['legacy/verified-cover.webp']; },
      async addManifest(_operationId, _userId, objects) {
        for (const object of objects) manifest.set(`${object.key}\0${object.versionId ?? ''}`, object);
      },
      async claimManifest() { return [...manifest.values()].slice(0, 100); },
      async markManifestCompleted(_operationId, objects) {
        for (const object of objects) manifest.delete(`${object.key}\0${object.versionId ?? ''}`);
      },
      async markManifestRetrying() {},
      async hasUncompletedManifest() { return manifest.size > 0; },
      async getManifestKeys() { return [...new Set([...manifest.values()].map(({ key }) => key))]; }
    },
    storage: {
      async listObjectVersions(prefix, markers) {
        const pages = listed.get(prefix) ?? [];
        const index = markers?.keyMarker === 'page-2' ? 1 : 0;
        const objects = pages[index] ?? [];
        const hasNext = index + 1 < pages.length;
        return { objects, isTruncated: hasNext, nextKeyMarker: hasNext ? 'page-2' : undefined };
      },
      async deleteObjects(objects) {
        if (failDelete) throw new Error('partial delete failure');
        deleted.push(objects);
        for (const object of objects) {
          for (const [prefix, pages] of listed) {
            listed.set(prefix, pages.map((page) => page.filter((listedObject) =>
              listedObject.key !== object.key || listedObject.versionId !== object.versionId)));
          }
        }
      }
    }
  });
  return {
    service, manifest, deleted, listed,
    failDelete(value: boolean) { failDelete = value; }
  };
}

async function finishPurge(service: ReturnType<typeof createAccountDeletionMediaService>, operationId: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await service.purgeAccountMedia(operationId);
    if (result.done) return result;
  }
  assert.fail('media purge did not finish within 10 batches');
}

test('batch_delete_error_keeps_retrying', async () => {
  const f = fixture();
  f.manifest.set('avatars/user-1/a.webp\0v1', { key: 'avatars/user-1/a.webp', versionId: 'v1' });
  f.failDelete(true);
  const result = await f.service.purgeAccountMedia('operation-1');
  assert.deepEqual(result, { done: false });
  assert.equal(f.manifest.size, 1);
});

test('old_avatar_and_orphan_removed', async () => {
  const f = fixture();
  f.listed.set('avatars/user-1/', [[
    { key: 'avatars/user-1/old.webp', versionId: 'old-version' },
  ], [
    { key: 'avatars/user-1/orphan.webp', versionId: 'orphan-version' }
  ]]);
  f.listed.set('poll-images/user-1/', [[]]);
  f.listed.set('legacy/verified-cover.webp', [[{ key: 'legacy/verified-cover.webp', versionId: 'legacy-v1' }]]);
  const discovery = await f.service.discoverAccountMedia('operation-1');
  assert.deepEqual(discovery, { done: true });
  const result = await finishPurge(f.service, 'operation-1');
  assert.deepEqual(result, { done: true });
  assert.equal(f.deleted.flat().some((object) => object.key === 'avatars/user-1/old.webp'), true);
  assert.equal(f.deleted.flat().some((object) => object.key === 'avatars/user-1/orphan.webp'), true);
  assert.equal(f.deleted.flat().some((object) => object.key === 'legacy/verified-cover.webp'), true);
});

test('all_versions_removed', async () => {
  const f = fixture();
  f.listed.set('avatars/user-1/', [[
    { key: 'avatars/user-1/a.webp', versionId: 'v1' },
    { key: 'avatars/user-1/a.webp', versionId: 'v2' },
    { key: 'avatars/user-1/a.webp', versionId: 'delete-marker' }
  ]]);
  f.listed.set('poll-images/user-1/', [[]]);
  await f.service.discoverAccountMedia('operation-1');
  await finishPurge(f.service, 'operation-1');
  assert.deepEqual(f.deleted.flat().filter((object) => object.key === 'avatars/user-1/a.webp'), [
    { key: 'avatars/user-1/a.webp', versionId: 'v1' },
    { key: 'avatars/user-1/a.webp', versionId: 'v2' },
    { key: 'avatars/user-1/a.webp', versionId: 'delete-marker' }
  ]);
});

test('late_upload_enters_manifest', async () => {
  const f = fixture();
  f.listed.set('avatars/user-1/', [[]]);
  f.listed.set('poll-images/user-1/', [[]]);
  await f.service.discoverAccountMedia('operation-1');
  f.manifest.set('poll-images/user-1/late.webp\0v1', {
    key: 'poll-images/user-1/late.webp', versionId: 'v1'
  });
  const result = await finishPurge(f.service, 'operation-1');
  assert.deepEqual(result, { done: true });
  assert.deepEqual(f.deleted.flat().filter((object) => object.key === 'poll-images/user-1/late.webp'), [
    { key: 'poll-images/user-1/late.webp', versionId: 'v1' }
  ]);
});

test('foreign_prefix_never_deleted', async () => {
  const f = fixture();
  f.listed.set('avatars/user-1/', [[
    { key: 'avatars/user-2/private.webp', versionId: 'foreign-version' },
    { key: 'avatars/user-1/../user-2/private.webp', versionId: 'traversal' }
  ]]);
  f.listed.set('poll-images/user-1/', [[]]);
  await f.service.discoverAccountMedia('operation-1');
  await finishPurge(f.service, 'operation-1');
  assert.deepEqual(f.deleted.flat(), []);
});

test('final_scan_blocks_completion_when_owned_object_arrives_late', async () => {
  const f = fixture();
  f.listed.set('avatars/user-1/', [[{ key: 'avatars/user-1/late.webp', versionId: 'v2' }]]);
  assert.equal(await f.service.verifyAccountMediaEmpty('operation-1'), false);
});

test('final_scan_checks_legacy_referenced_keys', async () => {
  const f = fixture();
  f.listed.set('legacy/verified-cover.webp', [[{ key: 'legacy/verified-cover.webp', versionId: 'legacy-v1' }]]);
  assert.equal(await f.service.verifyAccountMediaEmpty('operation-1'), false);
});

test('legacy_referenced_key_versions_are_discovered_and_deleted', async () => {
  const f = fixture();
  f.listed.set('legacy/verified-cover.webp', [[
    { key: 'legacy/verified-cover.webp.backup', versionId: 'neighbor' }
  ], [
    { key: 'legacy/verified-cover.webp', versionId: 'legacy-v1' },
    { key: 'legacy/verified-cover.webp', versionId: 'legacy-v2' }
  ]]);

  assert.deepEqual(await f.service.discoverAccountMedia('operation-1'), { done: true });
  assert.deepEqual(await finishPurge(f.service, 'operation-1'), { done: true });
  assert.deepEqual(f.deleted.flat().filter(({ key }) => key === 'legacy/verified-cover.webp'), [
    { key: 'legacy/verified-cover.webp', versionId: 'legacy-v1' },
    { key: 'legacy/verified-cover.webp', versionId: 'legacy-v2' }
  ]);
  assert.equal(f.deleted.flat().some(({ key }) => key.includes('.backup')), false);
  assert.equal(await f.service.verifyAccountMediaEmpty('operation-1'), true);
});
