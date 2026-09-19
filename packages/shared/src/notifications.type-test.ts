import type {
  NotificationItem,
  NotificationListResponse,
  NotificationRealtimeEventV1,
  NotificationTargetType,
  NotificationType,
  Poll,
  RealtimeEvent
} from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type Expect<Value extends true> = Value;

type ExpectedNotificationType =
  | 'poll_vote'
  | 'comment'
  | 'comment_reply'
  | 'like'
  | 'follow';

type ExpectedNotificationItem = {
  id: string;
  type: ExpectedNotificationType;
  actor: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  targetType: 'poll' | 'comment' | 'profile';
  pollId: string | null;
  commentId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  isTargetAvailable: boolean;
};

type ExpectedNotificationRealtimeEventV1 =
  | {
      version: 1;
      type: 'notification.created';
      payload: { notification: ExpectedNotificationItem; unreadCount: number };
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

type ExpectedLegacyRealtimeEvent =
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
      payload: { poll: Omit<Poll, 'viewerVoteOptionId'> };
    }
  | { type: 'connection.ready' }
  | { type: 'poll.admin_deleted'; payload: { pollId: string } }
  | {
      type: 'comment.admin_deleted';
      payload: { commentId: string; pollId: string };
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

type NotificationTypeContract = Expect<
  Equal<NotificationType, ExpectedNotificationType>
>;
type NotificationTargetTypeContract = Expect<
  Equal<NotificationTargetType, 'poll' | 'comment' | 'profile'>
>;
type NotificationItemContract = Expect<
  Equal<NotificationItem, ExpectedNotificationItem>
>;
type NotificationListResponseContract = Expect<
  Equal<
    NotificationListResponse,
    {
      items: NotificationItem[];
      nextCursor: string | null;
      unreadCount: number;
    }
  >
>;
type NotificationRealtimeEventContract = Expect<
  Equal<NotificationRealtimeEventV1, ExpectedNotificationRealtimeEventV1>
>;
type RealtimeEventContract = Expect<
  Equal<RealtimeEvent, ExpectedNotificationRealtimeEventV1 | ExpectedLegacyRealtimeEvent>
>;
