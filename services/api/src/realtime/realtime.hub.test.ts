import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Poll } from '../modules/polls/polls.repository.js';
import {
  addRealtimeClient,
  broadcastPollVoteCreated,
  broadcastPollVoteUpdated,
  broadcastPollDeleted,
  broadcastCommentDeleted
} from './realtime.hub.js';

test('realtime vote events omit viewer-specific vote state', () => {
  let message = '';
  const removeClient = addRealtimeClient({
    readyState: 1,
    send(data) {
      message = data;
    }
  });

  try {
    broadcastPollVoteCreated({
      poll: {
        id: 'poll-1',
        authorId: 'author-1',
        author: {
          id: 'author-1',
          username: 'author',
          displayName: 'Author',
          avatarObjectKey: null,
          avatarUrl: null
        },
        question: 'Question',
        description: null,
        imageObjectKey: null,
        visibility: 'public',
        optionsCount: 2,
        votesCount: 1,
        commentsCount: 0,
        likesCount: 0,
        allowVoteCancellation: false,
        viewerHasLiked: false,
        viewerVoteOptionId: 'option-1',
        options: [],
        createdAt: '2026-08-23T10:00:00.000Z',
        updatedAt: '2026-08-23T10:00:00.000Z',
        endsAt: null
      } as Poll,
      vote: {
        pollId: 'poll-1',
        optionId: 'option-1',
        votesCount: 1
      }
    });

    const event = JSON.parse(message) as {
      payload: { poll: Record<string, unknown> };
    };

    assert.equal(event.payload.poll.id, 'poll-1');
    assert.equal('viewerVoteOptionId' in event.payload.poll, false);
  } finally {
    removeClient();
  }
});

test('realtime vote update events broadcast aggregate poll state', () => {
  let message = '';
  const removeClient = addRealtimeClient({
    readyState: 1,
    send(data) {
      message = data;
    }
  });

  try {
    broadcastPollVoteUpdated({
      poll: {
        id: 'poll-2',
        authorId: 'author-1',
        author: {
          id: 'author-1',
          username: 'author',
          displayName: 'Author',
          avatarObjectKey: null,
          avatarUrl: null
        },
        question: 'Question',
        description: null,
        imageObjectKey: null,
        visibility: 'public',
        optionsCount: 2,
        votesCount: 0,
        commentsCount: 0,
        likesCount: 0,
        allowVoteCancellation: false,
        viewerHasLiked: false,
        viewerVoteOptionId: null,
        options: [],
        createdAt: '2026-08-23T10:00:00.000Z',
        updatedAt: '2026-08-23T10:00:00.000Z',
        endsAt: null
      } as Poll
    });

    const event = JSON.parse(message) as {
      type: string;
      payload: { poll: Record<string, unknown> };
    };

    assert.equal(event.type, 'poll.vote.updated');
    assert.equal(event.payload.poll.id, 'poll-2');
    assert.equal('viewerVoteOptionId' in event.payload.poll, false);
  } finally {
    removeClient();
  }
});

test('realtime poll deletion events broadcast only the poll id', () => {
  let message = '';
  const removeClient = addRealtimeClient({
    readyState: 1,
    send(data) {
      message = data;
    }
  });

  try {
    broadcastPollDeleted({ pollId: 'poll-deleted' });

    assert.deepEqual(JSON.parse(message), {
      type: 'poll.deleted',
      payload: { pollId: 'poll-deleted' }
    });
  } finally {
    removeClient();
  }
});

test('realtime comment deletion events broadcast only comment and poll ids', () => {
  const messages: string[] = [];
  const remove = addRealtimeClient({
    readyState: 1,
    send: (message) => messages.push(message)
  });

  messages.length = 0;
  broadcastCommentDeleted({ commentId: 'comment-deleted', pollId: 'poll-1' });
  remove();

  assert.deepEqual(JSON.parse(messages[0] ?? ''), {
    type: 'comment.deleted',
    payload: {
      commentId: 'comment-deleted',
      pollId: 'poll-1'
    }
  });
});
