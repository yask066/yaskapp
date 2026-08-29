import type { Poll } from '../modules/polls/polls.repository.js';

type RealtimeSocket = {
  readyState?: number;
  send(data: string): void;
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
  type: 'connection.ready';
};

type NotificationCreatedEvent = {
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
  | ConnectionReadyEvent
  | NotificationCreatedEvent
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
const clients = new Map<RealtimeSocket, string | undefined>();

function send(socket: RealtimeSocket, event: RealtimeEvent) {
  if (socket.readyState !== undefined && socket.readyState !== openReadyState) {
    return;
  }

  socket.send(JSON.stringify(event));
}

export function addRealtimeClient(socket: RealtimeSocket, userId?: string) {
  clients.set(socket, userId);

  send(socket, {
    type: 'connection.ready'
  });

  return () => {
    clients.delete(socket);
  };
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
  payload: NotificationCreatedEvent['payload']
) {
  sendToUser(userId, { type: 'notification.created', payload });
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

function sendToUser(userId: string, event: RealtimeEvent) {
  for (const [client, clientUserId] of clients) {
    if (clientUserId !== userId) continue;
    try {
      send(client, event);
    } catch {
      clients.delete(client);
    }
  }
}
