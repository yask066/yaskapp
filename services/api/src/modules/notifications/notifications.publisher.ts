import { realtimeBus } from '../../realtime/realtime.bus.js';
import { sendToUser } from '../../realtime/realtime.hub.js';
import {
  createPostCommitNotificationPublisher,
  refreshNotificationCreatedEvent,
  type NotificationCreatedEvent,
  type NotificationEventPublisher
} from './notifications.events.js';
import {
  countUnreadNotifications,
  getNotificationForRecipient
} from './notifications.repository.js';
import { recordRealtimePublishError } from './notifications.metrics.js';

export const publishNotificationEvent: NotificationEventPublisher = async (recipientUserId, event: NotificationCreatedEvent) => {
  const currentEvent = await refreshNotificationCreatedEvent(recipientUserId, event, {
    getNotification: getNotificationForRecipient,
    countUnread: countUnreadNotifications
  });
  if (currentEvent) sendToUser(recipientUserId, currentEvent);
  return realtimeBus.publish(recipientUserId, event);
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
    recordRealtimePublishError();
  }
}
