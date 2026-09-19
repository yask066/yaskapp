import type { Poll } from '../modules/polls/polls.repository.js';
import type { NotificationCreatedEvent } from '../modules/notifications/notifications.events.js';
import {
  recordCommitToClient,
  recordSocketConnected,
  recordSocketDisconnected
} from '../modules/notifications/notifications.metrics.js';
import type { RealtimeEvent as SharedRealtimeEvent } from '@yaskapp/shared';

type RealtimeSocket = {
  readyState?: number;
  send(data: string): void;
  close?: (code?: number, reason?: string) => void;
};

type PollVoteCreatedEvent = {
  type: 'poll.vote.created';
  payload: {
    poll: Omit<Poll, 'viewerVoteOptionId'>;
    vote: {
      pollId: string;
      optionId: string;
      votesCount: number;
    };
  };
};

type PollVoteUpdatedEvent = {
  type: 'poll.vote.updated';
  payload: {
    poll: Omit<Poll, 'viewerVoteOptionId'>;
  };
};

type ConnectionReadyEvent = {
  version: 1;
  type: 'connection.ready';
};

type LegacyNotificationCreatedEvent = {
  type: 'notification.created';
  payload: {
    notification: {
      id: string;
      type: string;
      actorId: string | null;
      pollId: string | null;
      commentId: string | null;
      createdAt: string;
    };
    unreadCount: number;
  };
};

type NotificationReadEvent = {
  type: 'notification.read';
  payload: { notificationId: string; unreadCount: number };
};

type PollDeletedEvent = {
  type: 'poll.admin_deleted';
  payload: {
    pollId: string;
  };
};

type CommentDeletedEvent = {
  type: 'comment.admin_deleted';
  payload: {
    commentId: string;
    pollId: string;
  };
};

type UserBlockedEvent = {
  type: 'user.blocked';
  payload: { userId: string };
};

type UserUnblockedEvent = {
  type: 'user.unblocked';
  payload: { userId: string };
};

type ModerationSanctionCreatedEvent = {
  type: 'moderation.sanction_created';
  payload: { sanctionId: string; userId: string; sanctionType: string; status: string };
};

type ModerationSanctionRevokedEvent = {
  type: 'moderation.sanction_revoked';
  payload: { sanctionId: string; userId: string; sanctionType: string };
};

type ModerationAppealCreatedEvent = {
  type: 'moderation.appeal_created';
  payload: { appealId: string; sanctionId: string; userId: string };
};

type ModerationAppealResolvedEvent = {
  type: 'moderation.appeal_resolved';
  payload: { appealId: string; sanctionId: string; userId: string; status: string };
};

type RealtimeEvent =
  | SharedRealtimeEvent
  | ConnectionReadyEvent
  | NotificationCreatedEvent
  | LegacyNotificationCreatedEvent
  | NotificationReadEvent
  | PollVoteCreatedEvent
  | PollVoteUpdatedEvent
  | PollDeletedEvent
  | CommentDeletedEvent
  | UserBlockedEvent
  | UserUnblockedEvent
  | ModerationSanctionCreatedEvent
  | ModerationSanctionRevokedEvent
  | ModerationAppealCreatedEvent
  | ModerationAppealResolvedEvent;

const openReadyState = 1;
const idleTimeoutMs = 90_000;
const clients = new Map<RealtimeSocket, { userId: string | undefined; lastSeen: number }>();
const disconnectMetrics: Record<string, number> = {};
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

export function createConnectionReadyEvent(): ConnectionReadyEvent {
  return { version: 1, type: 'connection.ready' };
}

export function getRealtimeConnectionMetrics() {
  return {
    activeSockets: clients.size,
    disconnectsByReason: { ...disconnectMetrics }
  };
}

export function resetRealtimeConnectionMetrics() {
  // Test helper: socket metrics are process-global and the detailed counters live in notifications.metrics.
  for (const socket of clients.keys()) socket.close?.(4000, 'test_reset');
  clients.clear();
  for (const key of Object.keys(disconnectMetrics)) delete disconnectMetrics[key];
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

function send(socket: RealtimeSocket, event: RealtimeEvent) {
  if (socket.readyState !== undefined && socket.readyState !== openReadyState) {
    return;
  }

  if (event.type === 'notification.created') {
    const createdAt = Date.parse(event.payload.notification.createdAt);
    if (Number.isFinite(createdAt)) recordCommitToClient(Date.now() - createdAt);
  }
  socket.send(JSON.stringify(event));
}

export function addRealtimeClient(socket: RealtimeSocket, userId?: string) {
  clients.set(socket, { userId, lastSeen: Date.now() });
  recordSocketConnected();
  ensureHeartbeat();

  send(socket, createConnectionReadyEvent());

  return (reason = 'client_close') => {
    if (!clients.delete(socket)) return;
    recordSocketDisconnected(reason);
    disconnectMetrics[reason] = (disconnectMetrics[reason] ?? 0) + 1;
    if (clients.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };
}

export function handleRealtimeMessage(socket: RealtimeSocket, message: Buffer | ArrayBuffer | string) {
  const state = clients.get(socket);
  if (state) state.lastSeen = Date.now();
  const value = message.toString();
  if (value === 'ping' || value === JSON.stringify({ type: 'ping' })) {
    send(socket, { version: 1, type: 'pong' } as RealtimeEvent);
  }
}

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    sweepIdleRealtimeClients(Date.now());
  }, 30_000);
  heartbeatTimer.unref?.();
}

export function sweepIdleRealtimeClients(now: number) {
  for (const [socket, state] of clients) {
    if (now - state.lastSeen <= idleTimeoutMs) continue;
    socket.close?.(4001, 'idle_timeout');
    removeRealtimeClient(socket, 'idle_timeout');
  }
}

function removeRealtimeClient(socket: RealtimeSocket, reason: string) {
  if (!clients.delete(socket)) return;
  recordSocketDisconnected(reason);
  disconnectMetrics[reason] = (disconnectMetrics[reason] ?? 0) + 1;
  if (clients.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

export function broadcastPollVoteCreated(payload: PollVoteCreatedEvent['payload']) {
  broadcast({
    type: 'poll.vote.created',
    payload: {
      ...payload,
      poll: sanitizePoll(payload.poll)
    }
  });
}

export function broadcastPollVoteUpdated(payload: PollVoteUpdatedEvent['payload']) {
  broadcast({
    type: 'poll.vote.updated',
    payload: {
      poll: sanitizePoll(payload.poll)
    }
  });
}

export function broadcastPollDeleted(payload: PollDeletedEvent['payload']) {
  broadcast({
    type: 'poll.admin_deleted',
    payload
  });
}

export function broadcastCommentDeleted(payload: CommentDeletedEvent['payload']) {
  broadcast({
    type: 'comment.admin_deleted',
    payload
  });
}

export function broadcastUserBlocked(payload: UserBlockedEvent['payload']) {
  broadcast({ type: 'user.blocked', payload });
}

export function broadcastUserUnblocked(payload: UserUnblockedEvent['payload']) {
  broadcast({ type: 'user.unblocked', payload });
}

export function broadcastModerationSanctionCreated(payload: ModerationSanctionCreatedEvent['payload']) {
  broadcast({ type: 'moderation.sanction_created', payload });
}

export function broadcastModerationSanctionRevoked(payload: ModerationSanctionRevokedEvent['payload']) {
  broadcast({ type: 'moderation.sanction_revoked', payload });
}

export function broadcastModerationAppealCreated(payload: ModerationAppealCreatedEvent['payload']) {
  broadcast({ type: 'moderation.appeal_created', payload });
}

export function broadcastModerationAppealResolved(payload: ModerationAppealResolvedEvent['payload']) {
  broadcast({ type: 'moderation.appeal_resolved', payload });
}

export function sendNotificationCreated(
  userId: string,
  event: NotificationCreatedEvent | LegacyNotificationCreatedEvent['payload']
) {
  sendToUser(userId, 'version' in event ? event : { type: 'notification.created', payload: event });
}

export function sendNotificationRead(
  userId: string,
  payload: NotificationReadEvent['payload']
) {
  sendToUser(userId, { type: 'notification.read', payload });
}

function sanitizePoll(
  poll: Poll | Omit<Poll, 'viewerVoteOptionId'>
): Omit<Poll, 'viewerVoteOptionId'> {
  const { viewerVoteOptionId: _viewerVoteOptionId, ...safePoll } = poll as Poll;

  return safePoll;
}

function broadcast(event: RealtimeEvent) {
  for (const client of clients.keys()) {
    try {
      send(client, event);
    } catch {
      clients.delete(client);
    }
  }
}

export function sendToUser(userId: string, event: RealtimeEvent) {
  for (const [client, state] of clients) {
    if (state.userId !== userId) continue;
    state.lastSeen = Date.now();
    try {
      send(client, event);
    } catch {
      clients.delete(client);
    }
  }
}
