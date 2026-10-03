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
    poll: Omit<Poll, 'viewerVoteOptionId' | 'viewerHasLiked'>;
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
    poll: Omit<Poll, 'viewerVoteOptionId' | 'viewerHasLiked'>;
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

export function createConnectionReadyEvent(): ConnectionReadyEvent {
  return { version: 1, type: 'connection.ready' };
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

type RealtimeHubOptions = { recordMetrics?: boolean };

/** A process-local socket registry. Each API process owns one hub instance. */
export class RealtimeHub {
  private readonly clients = new Map<RealtimeSocket, { userId: string | undefined; lastSeen: number }>();
  private readonly disconnectMetrics: Record<string, number> = {};
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: RealtimeHubOptions = {}) {}

  getConnectionMetrics() {
    return {
      activeSockets: this.clients.size,
      disconnectsByReason: { ...this.disconnectMetrics }
    };
  }

  reset() {
    for (const socket of this.clients.keys()) socket.close?.(4000, 'test_reset');
    this.clients.clear();
    for (const key of Object.keys(this.disconnectMetrics)) delete this.disconnectMetrics[key];
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  addRealtimeClient(socket: RealtimeSocket, userId?: string) {
    this.clients.set(socket, { userId, lastSeen: Date.now() });
    if (this.options.recordMetrics) recordSocketConnected();
    this.ensureHeartbeat();
    send(socket, createConnectionReadyEvent());

    return (reason = 'client_close') => this.removeRealtimeClient(socket, reason);
  }

  handleRealtimeMessage(socket: RealtimeSocket, message: Buffer | ArrayBuffer | string) {
    const state = this.clients.get(socket);
    if (state) state.lastSeen = Date.now();
    const value = message.toString();
    if (value === 'ping' || value === JSON.stringify({ type: 'ping' })) {
      send(socket, { version: 1, type: 'pong' } as RealtimeEvent);
    }
  }

  sweepIdleRealtimeClients(now: number) {
    for (const [socket, state] of this.clients) {
      if (now - state.lastSeen <= idleTimeoutMs) continue;
      socket.close?.(4001, 'idle_timeout');
      this.removeRealtimeClient(socket, 'idle_timeout');
    }
  }

  broadcast(event: RealtimeEvent) {
    for (const client of this.clients.keys()) {
      try {
        send(client, event);
      } catch {
        this.removeRealtimeClient(client, 'socket_error');
      }
    }
  }

  sendToUser(userId: string, event: RealtimeEvent) {
    for (const [client, state] of this.clients) {
      if (state.userId !== userId) continue;
      state.lastSeen = Date.now();
      try {
        send(client, event);
      } catch {
        this.removeRealtimeClient(client, 'socket_error');
      }
    }
  }

  private ensureHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.sweepIdleRealtimeClients(Date.now());
    }, 30_000);
    this.heartbeatTimer.unref?.();
  }

  private removeRealtimeClient(socket: RealtimeSocket, reason: string) {
    if (!this.clients.delete(socket)) return;
    if (this.options.recordMetrics) recordSocketDisconnected(reason);
    this.disconnectMetrics[reason] = (this.disconnectMetrics[reason] ?? 0) + 1;
    if (this.clients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}

const processRealtimeHub = new RealtimeHub({ recordMetrics: true });

export function getRealtimeConnectionMetrics() {
  return processRealtimeHub.getConnectionMetrics();
}

export function resetRealtimeConnectionMetrics() {
  // Test helper: socket metrics are process-global and the detailed counters live in notifications.metrics.
  processRealtimeHub.reset();
}

export function addRealtimeClient(socket: RealtimeSocket, userId?: string) {
  return processRealtimeHub.addRealtimeClient(socket, userId);
}

export function handleRealtimeMessage(socket: RealtimeSocket, message: Buffer | ArrayBuffer | string) {
  processRealtimeHub.handleRealtimeMessage(socket, message);
}

export function sweepIdleRealtimeClients(now: number) {
  processRealtimeHub.sweepIdleRealtimeClients(now);
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
  poll: Poll | Omit<Poll, 'viewerVoteOptionId' | 'viewerHasLiked'>
): Omit<Poll, 'viewerVoteOptionId' | 'viewerHasLiked'> {
  const {
    viewerVoteOptionId: _viewerVoteOptionId,
    viewerHasLiked: _viewerHasLiked,
    ...safePoll
  } = poll as Poll;

  return safePoll;
}

function broadcast(event: RealtimeEvent) {
  processRealtimeHub.broadcast(event);
}

export function sendToUser(userId: string, event: RealtimeEvent) {
  processRealtimeHub.sendToUser(userId, event);
}
