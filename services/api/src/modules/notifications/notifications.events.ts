import type { NotificationItem, NotificationRealtimeEventV1 } from '@yaskapp/shared';

export type NotificationCreatedEvent = Extract<NotificationRealtimeEventV1, { type: 'notification.created' }>;

export type NotificationEventPublisher = (
  recipientUserId: string,
  event: NotificationCreatedEvent
) => void | Promise<void>;

export function buildNotificationCreatedEvent(
  notification: NotificationItem,
  unreadCount: number
): NotificationCreatedEvent {
  return {
    version: 1,
    type: 'notification.created',
    payload: { notification, unreadCount }
  };
}

export type PostCommitNotificationPublisherDependencies = {
  getNotification: (notificationId: string, recipientUserId: string) => Promise<NotificationItem | null>;
  countUnread: (recipientUserId: string) => Promise<number>;
  publish: NotificationEventPublisher;
};

export function createPostCommitNotificationPublisher(
  dependencies: PostCommitNotificationPublisherDependencies
) {
  return async (recipientUserId: string, notificationId: string) => {
    const notification = await dependencies.getNotification(notificationId, recipientUserId);
    if (!notification) return;

    await dependencies.publish(
      recipientUserId,
      buildNotificationCreatedEvent(notification, await dependencies.countUnread(recipientUserId))
    );
  };
}
