import { sendNotificationCreated } from '../../realtime/realtime.hub.js';
import {
  createPostCommitNotificationPublisher,
  type NotificationCreatedEvent,
  type NotificationEventPublisher
} from './notifications.events.js';
import {
  countUnreadNotifications,
  getNotificationForRecipient
} from './notifications.repository.js';
import { incrementNotificationMetric } from './notifications.metrics.js';

export const publishNotificationEvent: NotificationEventPublisher = (recipientUserId, event: NotificationCreatedEvent) => {
  sendNotificationCreated(recipientUserId, event);
};

const publishCreatedNotification = createPostCommitNotificationPublisher({
  getNotification: (notificationId, recipientUserId) =>
    getNotificationForRecipient(notificationId, recipientUserId),
  countUnread: countUnreadNotifications,
  publish: publishNotificationEvent
});

export async function publishNotificationAfterCommit(recipientUserId: string, notificationId: string) {
  try {
    await publishCreatedNotification(recipientUserId, notificationId);
  } catch {
    // The database mutation has already committed; realtime delivery is best effort.
    incrementNotificationMetric('publishFailed');
  }
}
