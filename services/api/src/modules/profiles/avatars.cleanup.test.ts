import assert from 'node:assert/strict';
import test from 'node:test';

import { selectOrphanedAvatarKeys } from './avatars.cleanup.js';

test('avatar cleanup selects only old unreferenced normalized objects', () => {
  const now = new Date('2026-08-21T12:00:00.000Z');
  const objects = [
    {
      key: 'avatars/user-1/old.webp',
      lastModified: new Date('2026-08-20T10:00:00.000Z')
    },
    {
      key: 'avatars/user-2/referenced.webp',
      lastModified: new Date('2026-08-20T10:00:00.000Z')
    },
    {
      key: 'avatars/user-3/fresh.webp',
      lastModified: new Date('2026-08-21T11:30:00.000Z')
    },
    {
      key: 'avatars/user-4/source.png',
      lastModified: new Date('2026-08-20T10:00:00.000Z')
    },
    {
      key: 'other/old.webp',
      lastModified: new Date('2026-08-20T10:00:00.000Z')
    }
  ];

  assert.deepEqual(
    selectOrphanedAvatarKeys(
      objects,
      new Set(['avatars/user-2/referenced.webp']),
      now
    ),
    ['avatars/user-1/old.webp']
  );
});
