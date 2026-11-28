import type { Poll } from '../modules/polls/polls.repository.js';
import type { UserRole } from '../modules/auth/auth.repository.js';
import type { NotificationCreatedEvent } from '../modules/notifications/notifications.events.js';
import { findActiveAccountIds, isActiveAccount } from '../modules/account-deletion/account-activity.guard.js';
import {
  recordCommitToClient,
  recordSocketConnected,
  recordSocketDisconnected
} from '../modules/notifications/notifications.metrics.js';
import type { RealtimeEvent as SharedRealtimeEvent } from '@yaskapp/shared';
import type { RealtimeBusControlEvent } from './realtime.bus.js';

type RealtimeSocket = {
  readyState?: number;
  bufferedAmount?: number;
  send(data: string): void;
  close?: (code?: number, reason?: string) => void;
};

export type RealtimeClientMeta = {
  role?: UserRole;
  sessionVersion?: number;
  exp?: number;
};

type RealtimeClientState = {
  userId: string | undefined;
  role: UserRole | undefined;
  sessionVersion: number | undefined;
  exp: number | undefined;
  lastSeen: number;
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
  | ModerationAppealResolvedEvent
  | RealtimeBusControlEvent;

const openReadyState = 1;
const idleTimeoutMs = 90_000;
const defaultMaxSocketsPerUser = 10;
const defaultMaxTotalSockets = 10_000;
const defaultMaxBufferedBytes = 256 * 1024;

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

type RealtimeHubOptions = {
  recordMetrics?: boolean;
  maxSocketsPerUser?: number;
  maxTotalSockets?: number;
  maxBufferedBytes?: number;
};

type AccountDeletedEvent = Extract<RealtimeEvent, { type: 'account.deleted' }>;
export type RealtimeDisconnectReason = 'account_deleted' | 'session_revoked' | 'session_expired';
type RealtimeHubOptionsWithGuard = RealtimeHubOptions & {
  canDeliverToUser?: (userId: string) => boolean | Promise<boolean>;
  findActiveUsers?: (userIds: readonly string[]) => Promise<Set<string>>;
};

function isModeratorRole(role: UserRole | undefined): boolean {
  return role === 'moderator' || role === 'superadmin';
}

/** A process-local socket registry. Each API process owns one hub instance. */
export class RealtimeHub {
  private readonly clients = new Map<RealtimeSocket, RealtimeClientState>();
  private readonly disconnectMetrics: Record<string, number> = {};
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: RealtimeHubOptionsWithGuard = {}) {}

  getConnectionMetrics() {
    return {
      activeSockets: this.clients.size,
      disconnectsByReason: { ...this.disconnectMetrics }
    };
  }

  reset() {
    for (const socket of this.clients.keys()) {
      try {
        socket.close?.(4000, 'test_reset');
      } catch {
        // Ignore close errors during test teardown.
      }
    }
    this.clients.clear();
    for (const key of Object.keys(this.disconnectMetrics)) delete this.disconnectMetrics[key];
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  addRealtimeClient(socket: RealtimeSocket, userId?: string, meta: RealtimeClientMeta = {}) {
    const maxTotal = this.options.maxTotalSockets ?? defaultMaxTotalSockets;
    if (this.clients.size >= maxTotal) {
      try {
        socket.close?.(4008, 'too_many_connections');
      } catch {
        // Ignore close failure on rejected socket.
      }
      return () => undefined;
    }

    if (userId) {
      const maxPerUser = this.options.maxSocketsPerUser ?? defaultMaxSocketsPerUser;
      let userSocketCount = 0;
      for (const state of this.clients.values()) {
        if (state.userId === userId) userSocketCount += 1;
      }
      if (userSocketCount >= maxPerUser) {
        try {
          socket.close?.(4008, 'too_many_connections');
        } catch {
          // Ignore close failure on rejected socket.
        }
        return () => undefined;
      }
    }

    this.clients.set(socket, {
      userId,
      role: meta.role,
      sessionVersion: meta.sessionVersion,
      exp: meta.exp,
      lastSeen: Date.now()
    });
    if (this.options.recordMetrics) recordSocketConnected();
    this.ensureHeartbeat();
    this.sendToClient(socket, createConnectionReadyEvent());

    return (reason = 'client_close') => this.removeRealtimeClient(socket, reason);
  }

  handleRealtimeMessage(socket: RealtimeSocket, message: Buffer | ArrayBuffer | string) {
    const now = Date.now();
    const state = this.clients.get(socket);
    if (state) {
      if (state.exp !== undefined && state.exp * 1000 <= now) {
        this.closeSocket(socket, 4003, 'session_expired');
        return;
      }
      state.lastSeen = now;
    }
    const value = message.toString();
    if (value === 'ping' || value === JSON.stringify({ type: 'ping' })) {
      this.sendToClient(socket, { version: 1, type: 'pong' } as RealtimeEvent);
    }
  }

  sweepIdleRealtimeClients(now: number) {
    for (const [socket, state] of this.clients) {
      if (state.exp !== undefined && state.exp * 1000 <= now) {
        this.closeSocket(socket, 4003, 'session_expired');
        continue;
      }
      if (now - state.lastSeen <= idleTimeoutMs) continue;
      this.closeSocket(socket, 4001, 'idle_timeout');
    }
  }

  broadcast(event: RealtimeEvent) {
    const now = Date.now();
    for (const [client, state] of this.clients) {
      if (state.exp !== undefined && state.exp * 1000 <= now) {
        this.closeSocket(client, 4003, 'session_expired');
        continue;
      }
      this.sendToClient(client, event);
    }
  }

  sendToUserAndModerators(targetUserId: string, event: RealtimeEvent) {
    const now = Date.now();
    for (const [client, state] of this.clients) {
      if (state.userId !== targetUserId && !isModeratorRole(state.role)) continue;
      if (state.exp !== undefined && state.exp * 1000 <= now) {
        this.closeSocket(client, 4003, 'session_expired');
        continue;
      }
      this.sendToClient(client, event);
    }
  }

  sendToUser(userId: string, event: RealtimeEvent) {
    if (event.type === 'session.revoked') {
      this.disconnectUser(userId, 'session_revoked');
      return;
    }
    if (event.type === 'ip_ban.changed') {
      return;
    }
    let permission: boolean | Promise<boolean> = true;
    try {
      permission = this.options.canDeliverToUser?.(userId) ?? true;
    } catch {
      return;
    }
    if (typeof permission === 'boolean') {
      if (!permission) {
        this.disconnectUser(userId, 'account_deleted');
        return;
      }
      this.sendToActiveUser(userId, event);
      return;
    }
    return permission.then((allowed) => {
      if (allowed) this.sendToActiveUser(userId, event);
      else this.disconnectUser(userId, 'account_deleted');
    }).catch(() => {
      // Do not falsely disconnect active users on transient database errors.
    });
  }

  async sweepInactiveRealtimeClients() {
    const userIds = [
      ...new Set(
        [...this.clients.values()].flatMap((state) => (state.userId ? [state.userId] : []))
      )
    ];
    if (userIds.length === 0) return;

    if (this.options.findActiveUsers) {
      try {
        const activeUserIds = await this.options.findActiveUsers(userIds);
        for (const userId of userIds) {
          if (!activeUserIds.has(userId)) this.disconnectUser(userId, 'account_deleted');
        }
      } catch {
        // Skip this sweep tick on transient database errors.
      }
      return;
    }

    if (!this.options.canDeliverToUser) return;
    await Promise.all(userIds.map(async (userId) => {
      try {
        const active = await this.options.canDeliverToUser?.(userId) === true;
        if (!active) this.disconnectUser(userId, 'account_deleted');
      } catch {
        // Skip disconnecting user on transient database errors.
      }
    }));
  }

  disconnectUser(userId: string, reason: RealtimeDisconnectReason, event?: AccountDeletedEvent) {
    for (const [client, state] of this.clients) {
      if (state.userId !== userId) continue;
      try {
        if (event) send(client, event);
      } catch {
        // Closing the connection below still revokes access when event delivery fails.
      }
      this.closeSocket(client, 4003, reason);
    }
  }

  private closeSocket(client: RealtimeSocket, code: number, reason: string) {
    try {
      client.close?.(code, reason);
    } catch {
      // Removing the socket from the registry still prevents further deliveries.
    } finally {
      this.removeRealtimeClient(client, reason);
    }
  }

  private sendToActiveUser(userId: string, event: RealtimeEvent) {
    const now = Date.now();
    for (const [client, state] of this.clients) {
      if (state.userId !== userId) continue;
      if (state.exp !== undefined && state.exp * 1000 <= now) {
        this.closeSocket(client, 4003, 'session_expired');
        continue;
      }
      this.sendToClient(client, event);
    }
  }

  private sendToClient(client: RealtimeSocket, event: RealtimeEvent) {
    const maxBuffered = this.options.maxBufferedBytes ?? defaultMaxBufferedBytes;
    if (client.bufferedAmount !== undefined && client.bufferedAmount > maxBuffered) {
      this.closeSocket(client, 4009, 'slow_consumer');
      return;
    }
    try {
      send(client, event);
    } catch {
      this.removeRealtimeClient(client, 'socket_error');
    }
  }

  private ensureHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.sweepIdleRealtimeClients(Date.now());
      void this.sweepInactiveRealtimeClients();
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

const processRealtimeHub = new RealtimeHub({
  recordMetrics: true,
  canDeliverToUser: process.env.NODE_TEST_CONTEXT ? () => true : isActiveAccount,
  findActiveUsers: process.env.NODE_TEST_CONTEXT
    ? async (userIds) => new Set(userIds)
    : findActiveAccountIds
});

export function getRealtimeConnectionMetrics() {
  return processRealtimeHub.getConnectionMetrics();
}

export function resetRealtimeConnectionMetrics() {
  // Test helper: socket metrics are process-global and the detailed counters live in notifications.metrics.
  processRealtimeHub.reset();
}

export function addRealtimeClient(socket: RealtimeSocket, userId?: string, meta?: RealtimeClientMeta) {
  return processRealtimeHub.addRealtimeClient(socket, userId, meta);
}

export function handleRealtimeMessage(socket: RealtimeSocket, message: Buffer | ArrayBuffer | string) {
  processRealtimeHub.handleRealtimeMessage(socket, message);
}

export function sweepIdleRealtimeClients(now: number) {
  processRealtimeHub.sweepIdleRealtimeClients(now);
}

export function broadcastPollVoteCreated(payload: PollVoteCreatedEvent['payload']) {
  if (payload.poll.visibility !== 'public') return;
  broadcast({
    type: 'poll.vote.created',
    payload: {
      ...payload,
      poll: sanitizePoll(payload.poll)
    }
  });
}

export function broadcastPollVoteUpdated(payload: PollVoteUpdatedEvent['payload']) {
  if (payload.poll.visibility !== 'public') return;
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
  processRealtimeHub.sendToUserAndModerators(payload.userId, { type: 'user.blocked', payload });
}

export function broadcastUserUnblocked(payload: UserUnblockedEvent['payload']) {
  processRealtimeHub.sendToUserAndModerators(payload.userId, { type: 'user.unblocked', payload });
}

export function broadcastModerationSanctionCreated(payload: ModerationSanctionCreatedEvent['payload']) {
  processRealtimeHub.sendToUserAndModerators(payload.userId, { type: 'moderation.sanction_created', payload });
}

export function broadcastModerationSanctionRevoked(payload: ModerationSanctionRevokedEvent['payload']) {
  processRealtimeHub.sendToUserAndModerators(payload.userId, { type: 'moderation.sanction_revoked', payload });
}

export function broadcastModerationAppealCreated(payload: ModerationAppealCreatedEvent['payload']) {
  processRealtimeHub.sendToUserAndModerators(payload.userId, { type: 'moderation.appeal_created', payload });
}

export function broadcastModerationAppealResolved(payload: ModerationAppealResolvedEvent['payload']) {
  processRealtimeHub.sendToUserAndModerators(payload.userId, { type: 'moderation.appeal_resolved', payload });
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
  return processRealtimeHub.sendToUser(userId, event);
}

export function disconnectUser(userId: string, reason: RealtimeDisconnectReason, event?: AccountDeletedEvent) {
  processRealtimeHub.disconnectUser(userId, reason, event);
}
