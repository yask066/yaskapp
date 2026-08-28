import assert from 'node:assert/strict';
import test from 'node:test';

import { selectOrphanedPollImageKeys } from './cleanup-poll-image-objects.js';

test('poll image cleanup selects only old unreferenced normalized objects', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');
  const objects = [
    { key: 'poll-images/user-1/old.webp', lastModified: new Date('2026-08-27T10:00:00.000Z') },
    { key: 'poll-images/user-2/referenced.webp', lastModified: new Date('2026-08-27T10:00:00.000Z') },
    { key: 'poll-images/user-3/fresh.webp', lastModified: new Date('2026-08-28T11:30:00.000Z') },
    { key: 'poll-images/user-4/source.png', lastModified: new Date('2026-08-27T10:00:00.000Z') },
    { key: 'avatars/user-5/old.webp', lastModified: new Date('2026-08-27T10:00:00.000Z') }
  ];

  assert.deepEqual(
    selectOrphanedPollImageKeys(
      objects,
      new Set(['poll-images/user-2/referenced.webp']),
      now
    ),
    ['poll-images/user-1/old.webp']
  );
});
