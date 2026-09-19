import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Poll } from '../modules/polls/polls.repository.js';
import { getNotificationMetrics } from '../modules/notifications/notifications.metrics.js';
import {
  addRealtimeClient,
  broadcastPollVoteCreated,
  broadcastPollVoteUpdated,
  broadcastPollDeleted,
  broadcastCommentDeleted,
  broadcastUserBlocked,
  broadcastUserUnblocked,
  broadcastModerationSanctionCreated,
  broadcastModerationSanctionRevoked,
  broadcastModerationAppealCreated,
  broadcastModerationAppealResolved
  , sendNotificationCreated,
  sendNotificationRead,
  createConnectionReadyEvent,
  handleRealtimeMessage,
  getRealtimeConnectionMetrics,
  resetRealtimeConnectionMetrics,
  sweepIdleRealtimeClients
} from './realtime.hub.js';

test('connection ready is versioned and sent only after socket registration', () => {
  resetRealtimeConnectionMetrics();
  const messages: string[] = [];
  const remove = addRealtimeClient({ readyState: 1, send: (message) => messages.push(message) }, 'user-ready');

  assert.deepEqual(JSON.parse(messages[0] ?? ''), createConnectionReadyEvent());
  assert.deepEqual(JSON.parse(messages[0] ?? ''), {
    version: 1,
    type: 'connection.ready'
  });
  assert.equal(getRealtimeConnectionMetrics().activeSockets, 1);
  remove();
  assert.equal(getRealtimeConnectionMetrics().activeSockets, 0);
});

test('heartbeat replies with a versioned pong and never includes recipient identity', () => {
  const messages: string[] = [];
  const socket = { readyState: 1, send: (message: string) => messages.push(message) };
  handleRealtimeMessage(socket, 'ping');
  handleRealtimeMessage(socket, JSON.stringify({ type: 'ping' }));

  assert.deepEqual(messages.map((message) => JSON.parse(message)), [
    { version: 1, type: 'pong' },
    { version: 1, type: 'pong' }
  ]);
  assert.equal(messages.some((message) => message.includes('user-')), false);
});

test('disconnect metrics retain a safe reason without payload data', () => {
  resetRealtimeConnectionMetrics();
  const remove = addRealtimeClient({ readyState: 1, send: () => undefined }, 'user-disconnect');
  remove('idle_timeout');

  assert.equal(getRealtimeConnectionMetrics().disconnectsByReason.idle_timeout, 1);
});

test('heartbeat closes idle sockets with a safe close reason', () => {
  resetRealtimeConnectionMetrics();
  const closes: string[] = [];
  const remove = addRealtimeClient({
    readyState: 1,
    send: () => undefined,
    close: (_code, reason) => closes.push(reason ?? '')
  }, 'user-idle');

  sweepIdleRealtimeClients(Date.now() + 90_001);

  assert.deepEqual(closes, ['idle_timeout']);
  assert.equal(getRealtimeConnectionMetrics().activeSockets, 0);
  remove();
});

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
        imageUrl: null,
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
        imageUrl: null,
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
      type: 'poll.admin_deleted',
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
    type: 'comment.admin_deleted',
    payload: {
      commentId: 'comment-deleted',
      pollId: 'poll-1'
    }
  });
});

test('realtime user moderation events broadcast only the user id', () => {
  const messages: string[] = [];
  const remove = addRealtimeClient({
    readyState: 1,
    send: (message) => messages.push(message)
  });
  messages.length = 0;

  broadcastUserBlocked({ userId: 'user-blocked' });
  broadcastUserUnblocked({ userId: 'user-unblocked' });

  assert.deepEqual(messages.map((message) => JSON.parse(message)), [
    { type: 'user.blocked', payload: { userId: 'user-blocked' } },
    { type: 'user.unblocked', payload: { userId: 'user-unblocked' } }
  ]);
  remove();
});

test('realtime moderation events contain identifiers and state only', () => {
  const messages: string[] = [];
  const remove = addRealtimeClient({ readyState: 1, send: (message) => messages.push(message) });
  messages.length = 0;
  broadcastModerationSanctionCreated({ sanctionId: 'sanction-1', userId: 'user-1', sanctionType: 'permanent_ban', status: 'active' });
  broadcastModerationSanctionRevoked({ sanctionId: 'sanction-1', userId: 'user-1', sanctionType: 'permanent_ban' });
  broadcastModerationAppealCreated({ appealId: 'appeal-1', sanctionId: 'sanction-1', userId: 'user-1' });
  broadcastModerationAppealResolved({ appealId: 'appeal-1', sanctionId: 'sanction-1', userId: 'user-1', status: 'revoked' });
  remove();
  assert.deepEqual(messages.map((message) => JSON.parse(message)), [
    { type: 'moderation.sanction_created', payload: { sanctionId: 'sanction-1', userId: 'user-1', sanctionType: 'permanent_ban', status: 'active' } },
    { type: 'moderation.sanction_revoked', payload: { sanctionId: 'sanction-1', userId: 'user-1', sanctionType: 'permanent_ban' } },
    { type: 'moderation.appeal_created', payload: { appealId: 'appeal-1', sanctionId: 'sanction-1', userId: 'user-1' } },
    { type: 'moderation.appeal_resolved', payload: { appealId: 'appeal-1', sanctionId: 'sanction-1', userId: 'user-1', status: 'revoked' } }
  ]);
});

test('notification events are delivered only to the matching user', () => {
  const first: string[] = [];
  const second: string[] = [];
  const removeFirst = addRealtimeClient({ readyState: 1, send: (message) => first.push(message) }, 'user-1');
  const removeSecond = addRealtimeClient({ readyState: 1, send: (message) => second.push(message) }, 'user-2');
  first.length = 0;
  second.length = 0;

  sendNotificationCreated('user-1', {
    notification: { id: 'notification-1', type: 'follow', actorId: 'actor-1', pollId: null, commentId: null, createdAt: '2026-08-29T10:00:00.000Z' },
    unreadCount: 1
  });
  sendNotificationRead('user-1', { notificationId: 'notification-1', unreadCount: 0 });

  assert.equal(first.length, 2);
  assert.equal(second.length, 0);
  assert.equal(JSON.parse(first[0] ?? '').type, 'notification.created');
  assert.equal(JSON.parse(first[1] ?? '').type, 'notification.read');
  removeFirst();
  removeSecond();
});

test('notification delivery records commit-to-client latency without logging payloads', () => {
  const before = getNotificationMetrics().commitToClientSamples;
  const remove = addRealtimeClient({ readyState: 1, send: () => undefined }, 'user-latency');

  sendNotificationCreated('user-latency', {
    version: 1,
    type: 'notification.created',
    payload: {
      notification: {
        id: 'notification-latency',
        type: 'follow',
        actor: null,
        targetType: 'profile',
        pollId: null,
        commentId: null,
        payload: {},
        readAt: null,
        createdAt: new Date(Date.now() - 10).toISOString(),
        isTargetAvailable: true
      },
      unreadCount: 1
    }
  });

  assert.equal(getNotificationMetrics().commitToClientSamples, before + 1);
  remove();
});
