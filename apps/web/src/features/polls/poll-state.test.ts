import { describe, expect, test } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { decodePoll, type Poll } from '../../api/models';
import { beginPollOperation, fetchPollQuery, finishPollOperation, mergePollSnapshot, replacePollInQueryData, resetPollSession } from './poll-state';

const poll = {
  id: 'poll-1', author: { id: 'author-1', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null },
  question: 'Question?', imageUrl: null,
  options: [{ id: 'a', text: 'A', position: 0, votesCount: 5 }, { id: 'b', text: 'B', position: 1, votesCount: 4 }],
  votesCount: 9, commentsCount: 2, likesCount: 9, viewerHasLiked: false, allowVoteCancellation: true,
  createdAt: '2026-01-01T00:00:00.000Z', viewerVoteOptionId: null, endsAt: null,
  stateRevisions: { votes: '0', likes: '0', comments: '0' },
} satisfies Poll;

const snapshot = (changes: Partial<Poll>, revisions = poll.stateRevisions) =>
  ({ ...poll, ...changes, stateRevisions: revisions }) as Poll;

describe('mergePollSnapshot', () => {
  test('keeps independently newer reaction groups regardless of response order', () => {
    const vote = snapshot({ votesCount: 10, options: [{ ...poll.options[0], votesCount: 6 }, poll.options[1]], viewerVoteOptionId: 'a' }, { votes: '1', likes: '0', comments: '0' });
    const like = snapshot({ likesCount: 10, viewerHasLiked: true }, { votes: '0', likes: '1', comments: '0' });
    expect(mergePollSnapshot(mergePollSnapshot(poll, like, 'http', 'viewer').poll, vote, 'mutation', 'viewer').poll)
      .toMatchObject({ votesCount: 10, likesCount: 10, viewerVoteOptionId: 'a', viewerHasLiked: true });
    expect(mergePollSnapshot(mergePollSnapshot(poll, vote, 'mutation', 'viewer').poll, like, 'http', 'viewer').poll)
      .toMatchObject({ votesCount: 10, likesCount: 10, viewerVoteOptionId: 'a', viewerHasLiked: true });
  });

  test('ignores stale groups, duplicate revisions and broadcast viewer fields', () => {
    const newer = snapshot({ likesCount: 10, viewerHasLiked: true }, { votes: '0', likes: '2', comments: '0' });
    const merged = mergePollSnapshot(newer, snapshot({ likesCount: 8, viewerHasLiked: false, commentsCount: 3 }, { votes: '0', likes: '1', comments: '1' }), 'realtime', 'viewer');
    expect(merged.poll).toMatchObject({ likesCount: 10, viewerHasLiked: true, commentsCount: 3 });
    expect(mergePollSnapshot(merged.poll, newer, 'http', 'viewer').poll).toMatchObject({
      likesCount: merged.poll.likesCount, commentsCount: merged.poll.commentsCount,
      stateRevisions: merged.poll.stateRevisions, viewerHasLiked: merged.poll.viewerHasLiked,
    });
  });

  test('compares bigint revisions exactly and preserves legacy unknown revisions after a known value', () => {
    const high = snapshot({ likesCount: 10 }, { votes: '0', likes: '9007199254740993', comments: '0' });
    expect(mergePollSnapshot(high, snapshot({ likesCount: 11 }, { votes: '0', likes: '9007199254740992', comments: '0' }), 'http', 'viewer').poll?.likesCount).toBe(10);
    expect(mergePollSnapshot(high, snapshot({ likesCount: 11 }, undefined as never), 'http', 'viewer').poll?.likesCount).toBe(10);
  });

  test('rejects a snapshot for a different poll and preserves nested search payload shape', () => {
    expect(mergePollSnapshot(poll, { ...poll, id: 'other' }, 'http', 'viewer').poll).toBe(poll);
    const data = { items: [{ type: 'user', score: 3, user: { id: 'u' } }, { type: 'poll', score: 1, poll }], nextCursor: 'next' };
    const updated = replacePollInQueryData(data, snapshot({ likesCount: 4 }));
    expect(updated).toMatchObject({ nextCursor: 'next', items: [{ type: 'user', score: 3, user: { id: 'u' } }, { type: 'poll', score: 1, poll: { likesCount: 4 } }] });
  });

  test('discards an HTTP response that finishes after the session changes', async () => {
    const client = new QueryClient();
    let release!: (value: Poll[]) => void;
    const pending = fetchPollQuery(client, 'viewer-a', () => new Promise<Poll[]>((resolve) => { release = resolve; }));
    resetPollSession(client);
    release([poll]);
    await expect(pending).rejects.toMatchObject({ silent: true });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  test('does not bootstrap a legacy snapshot from a request started before a reaction', async () => {
    const client = new QueryClient();
    const legacyPoll = { ...poll, stateRevisions: undefined };
    client.setQueryData(['polls'], [legacyPoll]);
    let release!: (value: Poll[]) => void;
    const pending = fetchPollQuery(client, 'viewer', () => new Promise<Poll[]>((resolve) => { release = resolve; }));
    const token = beginPollOperation(client, poll.id, 'like');
    release([{ ...legacyPoll, likesCount: 8 }]);
    const result = await pending;
    expect(result[0].likesCount).toBe(9);
    if (token) finishPollOperation(client, poll.id, 'like', token);
    client.clear();
  });

  test('decodes revisions exactly and rejects inconsistent vote totals', () => {
    const decoded = decodePoll({ ...poll, stateRevisions: { votes: '9007199254740993', likes: '0', comments: '0' } });
    expect(decoded.stateRevisions?.votes).toBe('9007199254740993');
    expect(decoded.viewerState).toEqual({ hasLiked: false, voteOptionId: null });
    expect(() => decodePoll({ ...poll, votesCount: 10 })).toThrow();
  });
});
