import type { Poll } from './index.js';

export type NotificationType =
  | 'poll_vote'
  | 'comment'
  | 'comment_reply'
  | 'like'
  | 'follow';

export type NotificationTargetType = 'poll' | 'comment' | 'profile';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  actor: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  targetType: NotificationTargetType;
  pollId: string | null;
  commentId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  isTargetAvailable: boolean;
};

export type NotificationListResponse = {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
};

export type NotificationRealtimeEventV1 =
  | {
      version: 1;
      type: 'notification.created';
      payload: { notification: NotificationItem; unreadCount: number };
    }
  | {
      version: 1;
      type: 'notification.read';
      payload: { notificationId: string; readAt: string; unreadCount: number };
    }
  | {
      version: 1;
      type: 'notifications.read_all';
      payload: { readAt: string; unreadCount: 0 };
    };

export type RealtimeEvent =
  | NotificationRealtimeEventV1
  | {
      type: 'poll.vote.created';
      payload: {
        poll: Omit<Poll, 'viewerVoteOptionId'>;
        vote: {
          pollId: string;
          optionId: string;
          votesCount: number;
        };
      };
    }
  | {
      type: 'poll.vote.updated';
      payload: {
        poll: Omit<Poll, 'viewerVoteOptionId'>;
      };
    }
  | {
      type: 'connection.ready';
    }
  | {
      type: 'poll.admin_deleted';
      payload: {
        pollId: string;
      };
    }
  | {
      type: 'comment.admin_deleted';
      payload: {
        commentId: string;
        pollId: string;
      };
    }
  | {
      type: 'user.blocked' | 'user.unblocked';
      payload: { userId: string };
    }
  | {
      type: 'moderation.sanction_created';
      payload: {
        sanctionId: string;
        userId: string;
        sanctionType: string;
        status: string;
      };
    }
  | {
      type: 'moderation.sanction_revoked';
      payload: { sanctionId: string; userId: string; sanctionType: string };
    }
  | {
      type: 'moderation.appeal_created';
      payload: { appealId: string; sanctionId: string; userId: string };
    }
  | {
      type: 'moderation.appeal_resolved';
      payload: {
        appealId: string;
        sanctionId: string;
        userId: string;
        status: string;
      };
    };
